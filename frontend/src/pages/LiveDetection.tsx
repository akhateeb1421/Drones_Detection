import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area, trackThumbUrl } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { useAlarmsContext } from "../contexts/AlarmsContext";
import { useTheme } from "../contexts/ThemeContext";
import { DroneMap } from "../components/DroneMap";
import { usePlaceLabel, useClassLabel, useBilingualName } from "../i18n/places";
import { SAUDI_POPULATED_AREAS } from "../data/saudiPopulatedAreas";

function projectPath(lat: number, lon: number, speed: number, angleDeg: number, seconds = 60): [number, number] {
  const distance = Math.max(speed, 0) * seconds;
  const bearing = (angleDeg * Math.PI) / 180;
  const dN = distance * Math.cos(bearing);
  const dE = distance * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
}

const PREDICT_HORIZON_S = 60;

const HOSTILE_CLASSES = new Set([
  "shahed","shahed_136","shahed-136","shahed136",
  "orlan","orlan-10","orlan10","orlan_10",
  "dji","drone",
]);

function isHostileClass(cls: string | null | undefined): boolean {
  return HOSTILE_CLASSES.has(String(cls ?? "").toLowerCase().trim());
}

type Snapshot = {
  trackId: number; droneClass: string; lat: number; lon: number;
  speedMps: number; angleDeg: number; direction: string; confidence: number;
  nearestArea: string | null; etaS: number | null; lastSeenMs: number;
};

/* ── WMO helpers (all logic preserved) ─────────────────────── */
function wmoCondition(code: number, isDay: boolean): { key: string; glyph: string } {
  if (code === 0) return { key:"clear",          glyph: isDay ? "☀" : "🌙" };
  if (code === 1) return { key:"mostly_clear",   glyph: isDay ? "🌤" : "🌙" };
  if (code === 2) return { key:"partly_cloudy",  glyph: "⛅" };
  if (code === 3) return { key:"cloudy",         glyph: "☁" };
  if (code === 45 || code === 48) return { key:"fog",    glyph: "🌫" };
  if (code >= 51 && code <= 57)   return { key:"drizzle",glyph: "🌦" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { key:"rain", glyph: "🌧" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key:"snow", glyph: "❄" };
  if (code >= 95 && code <= 99) return { key:"storm", glyph: "⛈" };
  return { key:"unknown", glyph: "🌡" };
}

function detectionStatus(code: number, windKmh: number): "optimal" | "degraded" | "poor" {
  if ([45,48,95,96,99,71,73,75,77,65,67,82,86].includes(code) || windKmh >= 35) return "poor";
  if ([3,51,53,55,56,57,61,63,66,80,81,85].includes(code) || windKmh >= 20) return "degraded";
  return "optimal";
}

type Weather = { tempC: number; windKmh: number; code: number; isDay: boolean };

/* ── WeatherPanel — 3 separate mini cards ─────────────────── */
function WeatherPanel({ camera }: { camera: Camera | null }) {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const [w,   setW]   = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    setW(null); setErr(null);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${camera.latitude}` +
      `&longitude=${camera.longitude}&current_weather=true` +
      `&windspeed_unit=kmh&temperature_unit=celsius`;
    fetch(url)
      .then(r => r.json())
      .then((d: any) => {
        if (cancelled) return;
        const cw = d?.current_weather;
        if (!cw) throw new Error("no_data");
        setW({
          tempC:   Number(cw.temperature),
          windKmh: Number(cw.windspeed),
          code:    Number(cw.weathercode),
          isDay:   cw.is_day === 1 || cw.is_day === true,
        });
      })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [camera?.id]);

  if (!camera) return null;

  const cond   = w ? wmoCondition(w.code, w.isDay) : null;
  const status = w ? detectionStatus(w.code, w.windKmh) : null;

  /* Status color using CSS variables — no hardcoded hex */
  const statusColor =
    status === "optimal"  ? "var(--primary)" :
    status === "degraded" ? "var(--chart-5)" :
    status === "poor"     ? "var(--destructive)" : "var(--primary)";

  const camLabel = bilingualName(camera);

  if (err) return (
    <div className="card" style={{ fontSize:13, color:"var(--muted-foreground)", textAlign:"center" }}>
      {t("common.error")}
    </div>
  );
  if (!w) return (
    <div className="card" style={{ fontSize:13, color:"var(--muted-foreground)", textAlign:"center" }}>
      {t("common.loading")}
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Section label */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div className="label" style={{ marginBottom:0 }}>
          {t("live.weather")} · {camLabel} {cond ? cond.glyph : ""}
        </div>
        {status && (
          <span style={{
            fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:9999,
            background:`oklch(from ${statusColor} l c h / 0.12)`,
            color:statusColor,
            border:`1px solid oklch(from ${statusColor} l c h / 0.30)`,
            textTransform:"uppercase", letterSpacing:"0.10em",
          }}>
            {t(`live.weather_status_${status}`)}
          </span>
        )}
      </div>

      {/*
        THREE SEPARATE MINI CARDS — one per metric.
        Each is its own .weather-mini-card container,
        spaced with gap-4 (16px) between them.
      */}
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>

        {/* Card 1 — Status / الحالة */}
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_condition")}</span>
          <div className="w-value" style={{ color:statusColor }}>
            {`${t(`live.weather_cond_${cond?.key ?? "unknown"}`)} ${cond?.glyph ?? ""}`.trim()}
          </div>
        </div>

        {/* Card 2 — Temperature / الحرارة */}
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_temp")}</span>
          <div className="w-value">{Math.round(w.tempC)}°C</div>
        </div>

        {/* Card 3 — Wind Speed / سرعة الرياح */}
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_wind")}</span>
          <div className="w-value" dir="ltr">{Math.round(w.windKmh)} km/h</div>
        </div>

      </div>

      {/* Detection quality footer */}
      {status && (
        <div style={{
          padding:"9px 14px", borderRadius:"var(--radius)",
          background:`oklch(from ${statusColor} l c h / 0.08)`,
          border:`1px solid oklch(from ${statusColor} l c h / 0.25)`,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          fontSize:13, color:"var(--foreground)", fontWeight:600,
        }}>
          <span>{t(`live.weather_caption_${status}`)}</span>
          <span aria-hidden>{status === "optimal" ? "✓" : status === "degraded" ? "!" : "✗"}</span>
        </div>
      )}
    </div>
  );
}

/* ── Threat tier helper (logic preserved) ───────────────────── */
function threatTier(etaS: number | null, distM: number | null, droneClass: string | null, alarmFiredAt?: string | null): { label: string; cls: string } {
  if (!isHostileClass(droneClass)) return { label: "LOW", cls: "bg-success text-white" };
  if (alarmFiredAt) {
    if (etaS != null && etaS < 30) return { label: "CRITICAL", cls: "bg-danger text-white" };
    return { label: "HIGH", cls: "bg-warning text-black" };
  }
  if (etaS != null) {
    if (etaS < 30)  return { label: "CRITICAL", cls: "bg-danger text-white" };
    if (etaS < 60)  return { label: "HIGH",     cls: "bg-warning text-black" };
    if (etaS < 180) return { label: "MEDIUM",   cls: "bg-yellow-500 text-black" };
    return { label: "LOW", cls: "bg-success text-white" };
  }
  if (distM != null) {
    if (distM < 500)   return { label: "CRITICAL", cls: "bg-danger text-white" };
    if (distM < 2000)  return { label: "HIGH",     cls: "bg-warning text-black" };
    if (distM < 10000) return { label: "MEDIUM",   cls: "bg-yellow-500 text-black" };
    return { label: "LOW", cls: "bg-success text-white" };
  }
  return { label: "—", cls: "badge-muted" };
}

/* ── Main LiveDetection export ───────────────────────────────── */
export function LiveDetection() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const classLabel = useClassLabel();
  const bilingualName = useBilingualName();
  const [cameras,  setCameras]  = useState<Camera[]>([]);
  const [areas,    setAreas]    = useState<Area[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending,  setPending]  = useState<Track[]>([]);
  const [showAreas,     setShowAreas]     = useState(true);
  const [showCams,      setShowCams]      = useState(true);
  const [showIntercept, setShowIntercept] = useState(true);

  useEffect(() => {
    Cameras.list().then(cs => { setCameras(cs); setSelected(cs[0]?.id ?? null); });
    Areas.list().then(setAreas);
  }, []);

  const alarms = useAlarmsContext();
  const [threatCamMap, setThreatCamMap] = useState<Map<number,number>>(new Map());
  useEffect(() => {
    if (!alarms.latest) return;
    const camId = alarms.latest.camera_id;
    setThreatCamMap(prev => new Map(prev).set(camId, Date.now()));
  }, [alarms.latest]);
  useEffect(() => {
    const i = setInterval(() => {
      setThreatCamMap(prev => {
        const cutoff = Date.now() - 30_000;
        const next = new Map<number,number>();
        prev.forEach((ts, id) => { if (ts >= cutoff) next.set(id, ts); });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let emptyHits = 0;
    const fetchOnce = () => {
      Detections.pendingTracks()
        .then(rows => {
          if (cancelled) return;
          if (rows.length === 0) { emptyHits++; if (emptyHits >= 2) setPending([]); return; }
          emptyHits = 0; setPending(rows);
        })
        .catch(() => {});
    };
    fetchOnce();
    const i = setInterval(fetchOnce, 2000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const { imageUrl, meta, connected } = useLiveStream(selected);
  const [tracks, setTracks] = useState<Map<number,Snapshot>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(n => n+1), 200); return () => clearInterval(i); }, []);

  useEffect(() => {
    const dets = meta?.detections;
    if (!dets || dets.length === 0) return;
    setTracks(prev => {
      const next = new Map(prev);
      const now = Date.now();
      for (const d of dets) {
        const key = d.linked_track_id ?? d.track_id;
        next.set(key, {
          trackId: key, droneClass: String(d.drone_class ?? "unknown"),
          lat: d.lat, lon: d.lon, speedMps: d.speed_mps, angleDeg: d.angle_deg,
          direction: d.direction, confidence: d.confidence,
          nearestArea: d.nearest_area, etaS: d.eta_s, lastSeenMs: now,
        });
        if (d.linked_track_id != null && d.track_id !== key) next.delete(d.track_id);
      }
      return next;
    });
  }, [meta]);

  useEffect(() => {
    const i = setInterval(() => {
      setTracks(prev => {
        const cutoff = Date.now() - PREDICT_HORIZON_S * 1000;
        const next = new Map<number,Snapshot>();
        prev.forEach((snap, id) => { if (snap.lastSeenMs >= cutoff) next.set(id, snap); });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const focused: Snapshot | null = useMemo(() => {
    const hostile = Array.from(tracks.values()).filter(s => isHostileClass(s.droneClass));
    if (hostile.length === 0) return null;
    return hostile.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), hostile[0]);
  }, [tracks]);

  const focusedIsHostile = focused != null;

  const predictedPath = useMemo(() => {
    if (!focused || !focusedIsHostile) return null;
    const end = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, PREDICT_HORIZON_S);
    return [[focused.lat, focused.lon] as [number,number], end];
  }, [focused, focusedIsHostile]);

  const SAFETY_THRESHOLD_M = 800;
  const SAFETY_BUFFER_S = 5;
  const interceptPoint = useMemo(() => {
    if (!focused || !focusedIsHostile || focused.speedMps < 0.5) return null;
    const distM = (latA: number, lonA: number, latB: number, lonB: number) => {
      const dN = (latB-latA)*111320; const dE = (lonB-lonA)*111320*Math.cos((latA*Math.PI)/180);
      return Math.sqrt(dN*dN+dE*dE);
    };
    const samples = [5,8,12,16,22,30];
    const etaCap = focused.etaS != null ? focused.etaS - SAFETY_BUFFER_S : Infinity;
    type Candidate = { lat:number; lon:number; t:number; clearance:number };
    let best: Candidate | null = null;
    for (const secs of samples) {
      if (secs > etaCap) continue;
      const [lat,lon] = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, secs);
      let minClearance = Infinity;
      for (const a of areas) {
        const d = distM(lat,lon,a.latitude,a.longitude);
        if (d < minClearance) minClearance = d;
      }
      for (const city of SAUDI_POPULATED_AREAS) {
        const d = distM(lat,lon,city.lat,city.lon) - (city.radius_km ?? 5)*1000;
        if (d < minClearance) minClearance = Math.max(0,d);
      }
      if (minClearance >= SAFETY_THRESHOLD_M) { best = { lat,lon,t:secs,clearance:minClearance }; break; }
      if (!best || minClearance > best.clearance) best = { lat,lon,t:secs,clearance:minClearance };
    }
    if (!best) return null;
    return {
      lat: best.lat, lon: best.lon,
      label: `T+${best.t}s · ${(best.clearance/1000).toFixed(1)} km clearance`,
      safe: best.clearance >= SAFETY_THRESHOLD_M,
    };
  }, [focused, focusedIsHostile, areas, tick]);

  /* Map data */
  const sensitive = useMemo(() =>
    areas.map(a => ({ name: bilingualName(a), lat: a.latitude, lon: a.longitude })),
  [areas, bilingualName]);

  const detectionMarkers = useMemo(() => {
    const now = Date.now();
    return Array.from(tracks.values()).map(snap => {
      const elapsed = (now - snap.lastSeenMs) / 1000;
      if (elapsed > PREDICT_HORIZON_S) return null;
      const [lat,lon] = elapsed > 0.2
        ? projectPath(snap.lat, snap.lon, snap.speedMps, snap.angleDeg, elapsed)
        : [snap.lat, snap.lon];
      /* Use var(--destructive) for hostile, var(--chart-4) for predicted ghost */
      const color = isHostileClass(snap.droneClass) ? "var(--destructive)" : "var(--chart-4)";
      return { id:snap.trackId, lat, lon, color, label:`${classLabel(snap.droneClass)} #${snap.trackId}`, radius:elapsed > 0.2 ? 5 : 7 };
    }).filter(Boolean) as any[];
  }, [tracks, tick, classLabel]);

  const cameraMarkers = useMemo(() =>
    cameras.map(cam => ({
      id: cam.id, name: bilingualName(cam),
      lat: cam.latitude, lon: cam.longitude,
      heading_deg: cam.heading_deg, fov_h_deg: cam.fov_h_deg,
      distance_m: cam.assumed_target_distance_m,
      threatActive: threatCamMap.has(cam.id),
    })),
  [cameras, threatCamMap, bilingualName]);

  const interceptForMap = useMemo(() =>
    interceptPoint ? { lat:interceptPoint.lat, lon:interceptPoint.lon, label:interceptPoint.label } : null,
  [interceptPoint]);

  function distToNearest(p: Track): number | null {
    if (!p.last_lat || !p.last_lon || !p.nearest_area) return null;
    const a = areas.find(x => x.name === p.nearest_area);
    if (!a) return null;
    const dN = (a.latitude-p.last_lat)*111320;
    const dE = (a.longitude-p.last_lon)*111320*Math.cos((p.last_lat*Math.PI)/180);
    return Math.sqrt(dN*dN+dE*dE);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }} data-mount>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
        <h1 style={{ fontSize:"clamp(18px,2.5vw,24px)", fontWeight:800, color:"var(--foreground)", margin:0 }}>
          {t("live.title")}
        </h1>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className={`badge ${connected ? "bg-success text-white" : "badge-muted"}`}>
            {connected ? t("live.online") : t("live.offline")}
          </span>
          {cameras.length > 0 && (
            <select value={selected ?? ""} onChange={e => setSelected(Number(e.target.value))} className="input" style={{ width:"auto" }}>
              {cameras.map(c => (<option key={c.id} value={c.id}>{bilingualName(c)}</option>))}
            </select>
          )}
        </div>
      </div>

      {cameras.length === 0 ? (
        <div className="card">{t("live.no_camera")}</div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:16 }}>

          {/* Left column */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* Camera feed */}
            <div className="card">
              <div className="label">{t("live.title")}</div>
              <div style={{ aspectRatio:"16/9", width:"100%", overflow:"hidden", borderRadius:"var(--radius)", background:"var(--background)" }}>
                {imageUrl ? (
                  <img src={imageUrl} alt="live" style={{ width:"100%", height:"100%", objectFit:"contain" }}/>
                ) : (
                  <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted-foreground)" }}>
                    {t("common.loading")}
                  </div>
                )}
              </div>

              {focused && (() => {
                const elapsedS = (Date.now()-focused.lastSeenMs)/1000;
                const stale = elapsedS > 0.5;
                return (
                  <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:14 }}>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.track_id")}</span> <span className="font-data" dir="ltr">#{focused.trackId}</span></div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.drone_class")}</span> {classLabel(focused.droneClass)}</div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.confidence")}</span> <span className="font-data">{(focused.confidence*100).toFixed(0)}%</span></div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.speed")}</span> <span className="font-data" dir="ltr">{focused.speedMps.toFixed(1)} m/s</span></div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.direction")}</span> {focused.direction}</div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.nearest_area")}</span> {placeLabel(focused.nearestArea)}</div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.lat")}</span> <span className="font-data" dir="ltr">{focused.lat.toFixed(5)}</span></div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.lon")}</span> <span className="font-data" dir="ltr">{focused.lon.toFixed(5)}</span></div>
                    <div><span className="label" style={{ display:"inline" }}>{t("live.eta")}</span> <span className="font-data" dir="ltr">{focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}</span></div>
                    <div style={{ gridColumn:"span 2", display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
                      <span className="label" style={{ display:"inline" }}>{t("live.threat_level")}</span>
                      {(() => {
                        const dist = focused.lat && focused.lon && focused.nearestArea ? (() => {
                          const a = areas.find(x => x.name === focused.nearestArea);
                          if (!a) return null;
                          const dN = (a.latitude-focused.lat)*111320;
                          const dE = (a.longitude-focused.lon)*111320*Math.cos((focused.lat*Math.PI)/180);
                          return Math.sqrt(dN*dN+dE*dE);
                        })() : null;
                        const tier = threatTier(focused.etaS, dist, focused.droneClass);
                        const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                        return <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>;
                      })()}
                    </div>
                    {stale && (
                      <div style={{ gridColumn:"span 2", marginTop:4, borderRadius:"var(--radius)", background:"oklch(from var(--chart-5) l c h / 0.15)", padding:"6px 10px", fontSize:12, color:"var(--chart-5)" }}>
                        {t("live.out_of_frame", { secs: elapsedS.toFixed(1) })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Weather — 3 separate mini cards */}
            <WeatherPanel camera={cameras.find(c => c.id === selected) ?? null}/>

          </div>

          {/* Map card */}
          <div className="card" style={{ display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
              <div className="label" style={{ marginBottom:0 }}>{t("live.predicted_path")}</div>
              <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:8 }}>
                {[
                  { active:showAreas,     setActive:setShowAreas,     key:"live.toggle_areas",     dot:"var(--primary)" },
                  { active:showCams,      setActive:setShowCams,      key:"live.toggle_cameras",   dot:"var(--primary)" },
                  { active:showIntercept, setActive:setShowIntercept, key:"live.toggle_intercept", dot:"var(--chart-3)" },
                ].map(({ active, setActive, key, dot }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActive(v => !v)}
                    style={{
                      display:"inline-flex", alignItems:"center", gap:7,
                      padding:"6px 12px", borderRadius:"var(--radius)",
                      border:`1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                      background: active ? "oklch(from var(--primary) l c h / 0.12)" : "transparent",
                      color: active ? "var(--foreground)" : "var(--muted-foreground)",
                      fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                      transition:"all .14s",
                    }}
                  >
                    <span style={{ width:8, height:8, borderRadius:"50%", background:dot, flexShrink:0 }} aria-hidden/>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height:420, width:"100%" }}>
              <DroneMap
                center={focused ? [focused.lat, focused.lon] : [24.7136, 46.6753]}
                zoom={focused ? 14 : 6}
                markers={detectionMarkers}
                sensitiveAreas={showAreas ? sensitive : []}
                cameras={showCams ? cameraMarkers : []}
                predictedPath={predictedPath}
                interceptPoint={showIntercept ? interceptForMap : null}
              />
            </div>
          </div>
        </div>
      )}

      {/* Pending approvals */}
      <div className="card">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:12 }}>
          <div className="label" style={{ marginBottom:0 }}>{t("live.pending_approvals")}</div>
        </div>
        {(() => {
          const visiblePending = pending.filter(p => isHostileClass(p.voted_class));
          if (visiblePending.length === 0) {
            return <div style={{ fontSize:14, color:"var(--muted-foreground)" }}>{t("common.no_data")}</div>;
          }
          return (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", fontSize:14, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.14em", color:"var(--muted-foreground)", borderBottom:"1px solid var(--border)" }}>
                    <th style={{ padding:"8px 0", textAlign:"start", fontWeight:800, width:80 }}>{t("live.thumb")}</th>
                    <th style={{ textAlign:"start", fontWeight:800 }}>#</th>
                    <th style={{ textAlign:"start", fontWeight:800 }}>{t("live.drone_class")}</th>
                    <th style={{ textAlign:"start", fontWeight:800 }}>{t("live.nearest_area")}</th>
                    <th style={{ textAlign:"start", fontWeight:800 }}>{t("live.eta")}</th>
                    <th style={{ textAlign:"start", fontWeight:800 }}>{t("live.threat_level")}</th>
                    <th style={{ textAlign:"end", fontWeight:800 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePending.map(p => (
                    <tr key={p.id} style={{ borderBottom:"1px solid var(--border)" }}>
                      <td style={{ padding:"10px 0", textAlign:"start" }}>
                        {p.thumbnail_path ? (
                          <img src={trackThumbUrl(p.id)} alt={`track ${p.track_id}`}
                            style={{ height:48, width:64, borderRadius:6, objectFit:"cover", border:"1px solid var(--border)" }}
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                        ) : (
                          <div style={{ height:48, width:64, borderRadius:6, background:"var(--secondary)", fontSize:11, color:"var(--muted-foreground)", display:"flex", alignItems:"center", justifyContent:"center" }}>—</div>
                        )}
                      </td>
                      <td style={{ textAlign:"start", fontFamily:"monospace" }}><span dir="ltr">#{p.track_id}</span></td>
                      <td style={{ textAlign:"start" }}>{classLabel(p.voted_class)}</td>
                      <td style={{ textAlign:"start" }}>{placeLabel(p.nearest_area)}</td>
                      <td style={{ textAlign:"start", fontFamily:"monospace" }}><span dir="ltr">{p.min_eta_s !== null ? `${p.min_eta_s?.toFixed(1)}s` : "—"}</span></td>
                      <td style={{ textAlign:"start" }}>
                        {(() => {
                          const tier = threatTier(p.min_eta_s, distToNearest(p), p.voted_class, p.alarm_fired_at);
                          const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                          return <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>;
                        })()}
                      </td>
                      <td style={{ textAlign:"end" }}>
                        <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"flex-end", gap:4 }}>
                          <button onClick={() => handleApprove(p, "countered")} className="btn-countered">{t("live.btn_countered")}</button>
                          <button onClick={() => handleApprove(p, "hit")}       className="btn-hit">{t("live.btn_hit")}</button>
                          <button onClick={() => handleReject(p)}               className="btn-reject">{t("common.reject")}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );

  async function handleApprove(p: Track, outcome: "countered" | "hit") {
    await Detections.approve(p.id, outcome).catch(() => {});
    setPending(prev => prev.filter(x => x.id !== p.id));
  }
  async function handleReject(p: Track) {
    await Detections.reject(p.id).catch(() => {});
    setPending(prev => prev.filter(x => x.id !== p.id));
  }
}
