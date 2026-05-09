import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area, trackThumbUrl } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { useAlarmsContext } from "../contexts/AlarmsContext";
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

// How long we keep extrapolating after the last real detection (seconds).
// After this we drop the predicted marker — confidence has decayed too far.
const PREDICT_HORIZON_S = 60;

// Mirror of backend HOSTILE_CLASSES (alarms.py). Module scope so it's
// available to anything inside the component without TDZ issues. The
// threat tier and the alarm system must agree: if a track shows
// CRITICAL/HIGH the alarm should also be firing. Non-hostile classes
// (bird, airplane, helicopter, unknown) cap at LOW regardless of
// ETA/distance — they're not threats even when geometrically close.
const HOSTILE_CLASSES = new Set([
  "shahed",
  "orlan-10",
  "orlan10",
  "orlan_10",
  "dji",
  "drone",
]);

type Snapshot = {
  trackId: number;
  droneClass: string;
  lat: number;
  lon: number;
  speedMps: number;
  angleDeg: number;
  direction: string;
  confidence: number;
  nearestArea: string | null;
  etaS: number | null;
  // wall-clock time (ms) of the LAST real detection for this track
  lastSeenMs: number;
};

export function LiveDetection() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const classLabel = useClassLabel();
  const bilingualName = useBilingualName();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<Track[]>([]);
  // Layer toggles — operator can hide sensitive markers, camera FOV cones,
  // or the suggested intercept point if any of them clutter the live view.
  const [showAreas, setShowAreas] = useState(true);
  const [showCams, setShowCams] = useState(true);
  const [showIntercept, setShowIntercept] = useState(true);

  useEffect(() => {
    Cameras.list().then((cs) => {
      setCameras(cs);
      setSelected(cs[0]?.id ?? null);
    });
    Areas.list().then(setAreas);
  }, []);

  // When an alarm fires we mark the camera red on the map for 30 seconds.
  // The map is the single most-glanced surface during a live scene, so the
  // operator can spot which camera is producing the threat without reading
  // labels.
  const alarms = useAlarmsContext();
  const [threatCamMap, setThreatCamMap] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    if (!alarms.latest) return;
    const camId = alarms.latest.camera_id;
    setThreatCamMap((prev) => new Map(prev).set(camId, Date.now()));
  }, [alarms.latest]);
  useEffect(() => {
    const i = setInterval(() => {
      setThreatCamMap((prev) => {
        const cutoff = Date.now() - 30_000;
        const next = new Map<number, number>();
        prev.forEach((ts, id) => { if (ts >= cutoff) next.set(id, ts); });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => Detections.pendingTracks().then(setPending).catch(() => {}), 5000);
    return () => clearInterval(i);
  }, []);

  const { imageUrl, meta, connected } = useLiveStream(selected);

  // Persist the most recent detection per track. We don't drop it when the
  // drone leaves the camera frame — instead we keep extrapolating its
  // position from the last known speed + heading.
  const [tracks, setTracks] = useState<Map<number, Snapshot>>(new Map());

  // Tick every 200 ms so the predicted marker animates smoothly.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(i);
  }, []);

  // Whenever a fresh frame arrives, update each visible track's snapshot.
  useEffect(() => {
    const dets = meta?.detections;
    if (!dets || dets.length === 0) return;
    setTracks((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const d of dets) {
        // Cross-camera link: when a new sighting is matched to an earlier
        // track on a different camera, the backend tags the detection with
        // linked_track_id (the original track's id). Use that as the merge
        // key so both cameras' detections collapse into one logical drone,
        // the lastSeenMs resets, and the predicted-path line keeps drawing
        // from the latest position.
        const key = d.linked_track_id ?? d.track_id;
        next.set(key, {
          trackId: key,
          // Coerce to string at the boundary — a new YOLO model can emit a
          // class as null or with an unexpected name. The map / threat / UI
          // code downstream treats droneClass as a string.
          droneClass: String(d.drone_class ?? "unknown"),
          lat: d.lat,
          lon: d.lon,
          speedMps: d.speed_mps,
          angleDeg: d.angle_deg,
          direction: d.direction,
          confidence: d.confidence,
          nearestArea: d.nearest_area,
          etaS: d.eta_s,
          lastSeenMs: now,
        });
        // If this is a re-acquisition on a new camera, drop any duplicate
        // entry under the *new* track_id so we don't render two markers.
        if (d.linked_track_id != null && d.track_id !== key) {
          next.delete(d.track_id);
        }
      }
      return next;
    });
  }, [meta]);

  // Forget tracks we haven't seen in PREDICT_HORIZON_S seconds.
  useEffect(() => {
    const i = setInterval(() => {
      setTracks((prev) => {
        const cutoff = Date.now() - PREDICT_HORIZON_S * 1000;
        const next = new Map<number, Snapshot>();
        prev.forEach((snap, id) => {
          if (snap.lastSeenMs >= cutoff) next.set(id, snap);
        });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Pick the most recent track to drive the "details" panel + map focus.
  const focused: Snapshot | null = useMemo(() => {
    const all = Array.from(tracks.values());
    if (all.length === 0) return null;
    return all.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), all[0]);
  }, [tracks]);

  // 60-second straight-line prediction from the last-known position.
  // Trajectory + intercept logic only runs for hostile drone classes —
  // birds, airplanes, helicopters, and "unknown" detections shouldn't
  // produce an aim line on the operator map. HOSTILE_CLASSES is the same
  // set the alarm pipeline uses, so the on-screen prediction can never
  // disagree with whether an alarm fired.
  // Defensive: a new YOLO model can emit class names we didn't seed in the
  // frontend (or, in pathological cases, null/undefined). Coerce to string
  // before .toLowerCase() so a single rogue detection doesn't tear down
  // the whole React tree.
  const focusedIsHostile = focused != null
    && HOSTILE_CLASSES.has(String(focused.droneClass ?? "").toLowerCase().trim());

  const predictedPath = useMemo(() => {
    if (!focused || !focusedIsHostile) return null;
    const end = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, PREDICT_HORIZON_S);
    return [[focused.lat, focused.lon] as [number, number], end];
  }, [focused, focusedIsHostile]);

  // --- Suggested intercept point ---
  // Sample the predicted trajectory at fixed lookahead steps. For each
  // candidate compute the minimum clearance from:
  //   (a) operator-marked sensitive areas (point hazards)
  //   (b) baseline Saudi populated areas (city discs — measured to the
  //       *edge* of each disc so urban sprawl is treated as off-limits)
  // Pick the EARLIEST candidate whose clearance >= threshold AND that
  // fires at least SAFETY_BUFFER_S before impact. If none qualifies, the
  // best-clearance candidate is returned with `safe=false` so the UI can
  // surface "no safe intercept window".
  const SAFETY_THRESHOLD_M = 800;
  const SAFETY_BUFFER_S = 5;
  const interceptPoint = useMemo(() => {
    if (!focused || !focusedIsHostile || focused.speedMps < 0.5) return null;

    // Equirectangular distance approximation — fine over the few-km spans
    // a hostile drone covers in 30 s.
    const distM = (latA: number, lonA: number, latB: number, lonB: number) => {
      const dN = (latB - latA) * 111320;
      const dE = (lonB - lonA) * 111320 * Math.cos((latA * Math.PI) / 180);
      return Math.sqrt(dN * dN + dE * dE);
    };

    const samples = [5, 8, 12, 16, 22, 30];
    const etaCap = focused.etaS != null ? focused.etaS - SAFETY_BUFFER_S : Infinity;

    type Candidate = { lat: number; lon: number; t: number; clearance: number };
    let best: Candidate | null = null;

    for (const tSec of samples) {
      if (tSec > etaCap) break;
      const [lat, lon] = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, tSec);
      let clearance = Infinity;
      for (const a of areas) {
        const d = distM(lat, lon, a.latitude, a.longitude);
        if (d < clearance) clearance = d;
      }
      for (const p of SAUDI_POPULATED_AREAS) {
        const d = distM(lat, lon, p.lat, p.lon) - p.radius_km * 1000;
        const eff = Math.max(0, d);
        if (eff < clearance) clearance = eff;
      }
      if (clearance >= SAFETY_THRESHOLD_M) {
        best = { lat, lon, t: tSec, clearance };
        break;
      }
      if (best == null || clearance > best.clearance) {
        best = { lat, lon, t: tSec, clearance };
      }
    }

    if (!best) return null;
    return {
      lat: best.lat,
      lon: best.lon,
      t: best.t,
      km: best.clearance / 1000,
      safe: best.clearance >= SAFETY_THRESHOLD_M,
    };
  }, [focused, focusedIsHostile, areas]);

  // Build markers: one solid "last seen" marker per track + one animated
  // "predicted now" marker that slides along the projected line as time passes.
  // Use the bilingual name so Arabic UI shows Arabic area names where the
  // admin recorded them.
  const sensitive = areas.map((a) => ({ name: bilingualName(a), lat: a.latitude, lon: a.longitude }));
  const detectionMarkers = useMemo(() => {
    const items: { id: string; lat: number; lon: number; color: string; label: string; radius: number }[] = [];
    const now = Date.now();
    tracks.forEach((s) => {
      const elapsedS = (now - s.lastSeenMs) / 1000;
      const isStale = elapsedS > 0.5;
      // Luxe palette: oxblood crimson for Shahed-class hostiles, copper
      // for everything else. Matches the historical map and chart language.
      const baseColor = String(s.droneClass ?? "").toLowerCase().includes("shahed") ? "#c5443c" : "#c89968";

      // Last confirmed sighting (solid)
      items.push({
        id: `seen-${s.trackId}`,
        lat: s.lat,
        lon: s.lon,
        color: baseColor,
        label: `#${s.trackId} ${s.droneClass} ${(s.confidence * 100).toFixed(0)}% — last seen ${elapsedS.toFixed(1)}s ago`,
        radius: 8,
      });

      // Animated predicted-now position (only when extrapolating)
      if (isStale && elapsedS <= PREDICT_HORIZON_S && s.speedMps > 0.1) {
        const distance = s.speedMps * elapsedS;
        const bearing = (s.angleDeg * Math.PI) / 180;
        const dN = distance * Math.cos(bearing);
        const dE = distance * Math.sin(bearing);
        const lat = s.lat + dN / 111320;
        const lon = s.lon + dE / (111320 * Math.cos((s.lat * Math.PI) / 180));
        items.push({
          id: `pred-${s.trackId}`,
          lat,
          lon,
          color: "#d9a05c",
          label: `#${s.trackId} predicted at +${elapsedS.toFixed(0)}s (${s.speedMps.toFixed(1)} m/s ${s.direction})`,
          radius: 6,
        });
      }
    });
    return items;
  }, [tracks, tick]);

  // Camera markers for the live map. `threatActive` flips a camera's pin
  // and FOV cone red the moment its alarm fires — see threatCamMap above.
  const cameraMarkers = useMemo(
    () =>
      cameras.map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.latitude,
        lon: c.longitude,
        heading_deg: c.heading_deg,
        fov_h_deg: c.fov_h_deg,
        distance_m: c.assumed_target_distance_m ?? 1500,
        threatActive: threatCamMap.has(c.id),
      })),
    [cameras, threatCamMap],
  );

  // Intercept point shaped for DroneMap. interceptPoint is computed earlier
  // (only when a hostile drone is in flight); the label string mirrors the
  // popup wording the operator expects on the suggested counter-attack point.
  const interceptForMap = interceptPoint
    ? interceptPoint.safe
      ? {
          lat: interceptPoint.lat,
          lon: interceptPoint.lon,
          label: t("live.intercept_label", {
            secs: interceptPoint.t.toFixed(0),
            km: interceptPoint.km.toFixed(1),
          }),
        }
      : { lat: interceptPoint.lat, lon: interceptPoint.lon, label: t("live.intercept_unsafe") }
    : null;

  // Approve carries an outcome — "countered" if a counter-measure took the
  // drone down, "hit" if the drone reached its target. The backend stores
  // it on the track row so analytics can compute counter-attack success
  // rate over time. Reject is for false positives (bird, airplane, etc).
  const handleApprove = async (track: Track, outcome: "countered" | "hit") => {
    await Detections.approve(track.camera_id, track.track_id, outcome);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };
  const handleReject = async (track: Track) => {
    await Detections.reject(track.camera_id, track.track_id);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };

  // Threat tier from ETA (seconds). Falls back to distance from last_lat/lon
  // to the matching sensitive area when ETA isn't known.
  //
  // Reconciliation: if the backend already stamped `alarm_fired_at` on the
  // track, force CRITICAL regardless of the current ETA/distance. Otherwise
  // a track that's still alarmed could degrade to LOW once the drone drifts
  // away — the operator would see a contradicting badge while the audible
  // alarm is still ringing.
  function threatTier(
    etaS: number | null,
    distM: number | null,
    droneClass: string | null,
    alarmFiredAt?: string | null,
  ): { label: string; cls: string } {
    if (alarmFiredAt) {
      const firedMs = new Date(alarmFiredAt).getTime();
      // Hold CRITICAL for 60 s after the alarm fires — long enough to ride
      // through tracker noise without latching forever.
      if (!Number.isNaN(firedMs) && Date.now() - firedMs < 60_000) {
        return { label: "CRITICAL", cls: "bg-danger text-white" };
      }
    }
    const cls_l = (droneClass ?? "").toLowerCase();
    const isHostile = HOSTILE_CLASSES.has(cls_l);
    if (!isHostile) {
      // Visually "safe" — matches the backend's no-alarm verdict.
      return { label: "LOW", cls: "bg-success text-white" };
    }
    if (etaS != null) {
      if (etaS < 30) return { label: "CRITICAL", cls: "bg-danger text-white" };
      if (etaS < 60) return { label: "HIGH", cls: "bg-warning text-black" };
      if (etaS < 180) return { label: "MEDIUM", cls: "bg-yellow-500 text-black" };
      return { label: "LOW", cls: "bg-success text-white" };
    }
    if (distM != null) {
      if (distM < 500) return { label: "CRITICAL", cls: "bg-danger text-white" };
      if (distM < 2000) return { label: "HIGH", cls: "bg-warning text-black" };
      if (distM < 10000) return { label: "MEDIUM", cls: "bg-yellow-500 text-black" };
      return { label: "LOW", cls: "bg-success text-white" };
    }
    return { label: "—", cls: "bg-slate-700 text-slate-300" };
  }

  function distToNearest(p: Track): number | null {
    if (!p.last_lat || !p.last_lon || !p.nearest_area) return null;
    const a = areas.find((x) => x.name === p.nearest_area);
    if (!a) return null;
    // Equirectangular approximation in meters.
    const dN = (a.latitude - p.last_lat) * 111320;
    const dE = (a.longitude - p.last_lon) * 111320 * Math.cos((p.last_lat * Math.PI) / 180);
    return Math.sqrt(dN * dN + dE * dE);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-accent">{t("live.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? "bg-success text-white" : "bg-slate-700 text-slate-300"}`}>
            {connected ? t("live.online") : t("live.offline")}
          </span>
          {cameras.length > 0 && (
            <select value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))} className="input w-auto">
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{bilingualName(c)}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {cameras.length === 0 ? (
        <div className="card">{t("live.no_camera")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="label">{t("live.title")}</div>
            <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
              {imageUrl ? (
                <img src={imageUrl} alt="live" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">{t("common.loading")}</div>
              )}
            </div>
            {focused && (() => {
              const elapsedS = (Date.now() - focused.lastSeenMs) / 1000;
              const stale = elapsedS > 0.5;
              return (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="label inline">{t("live.track_id")}</span> <span className="font-data" dir="ltr">#{focused.trackId}</span></div>
                  <div><span className="label inline">{t("live.drone_class")}</span> {classLabel(focused.droneClass)}</div>
                  <div><span className="label inline">{t("live.confidence")}</span> <span className="font-data">{(focused.confidence * 100).toFixed(0)}%</span></div>
                  <div><span className="label inline">{t("live.speed")}</span> <span className="font-data" dir="ltr">{focused.speedMps.toFixed(1)} m/s</span></div>
                  <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
                  <div><span className="label inline">{t("live.nearest_area")}</span> {placeLabel(focused.nearestArea)}</div>
                  <div><span className="label inline">{t("live.lat")}</span> <span className="font-data" dir="ltr">{focused.lat.toFixed(5)}</span></div>
                  <div><span className="label inline">{t("live.lon")}</span> <span className="font-data" dir="ltr">{focused.lon.toFixed(5)}</span></div>
                  <div><span className="label inline">{t("live.eta")}</span> <span className="font-data" dir="ltr">{focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}</span></div>
                  <div className="col-span-2 mt-1 flex items-center gap-2">
                    <span className="label inline">{t("live.threat_level")}</span>
                    {(() => {
                      const dist = focused.lat && focused.lon && focused.nearestArea
                        ? (() => {
                            const a = areas.find((x) => x.name === focused.nearestArea);
                            if (!a) return null;
                            const dN = (a.latitude - focused.lat) * 111320;
                            const dE = (a.longitude - focused.lon) * 111320 * Math.cos((focused.lat * Math.PI) / 180);
                            return Math.sqrt(dN * dN + dE * dE);
                          })()
                        : null;
                      const tier = threatTier(focused.etaS, dist, focused.droneClass);
                      const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                      return <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>;
                    })()}
                  </div>
                  {stale && (
                    <div className="col-span-2 mt-1 rounded bg-warning/20 px-2 py-1 text-xs text-warning">
                      {t("live.out_of_frame", { secs: elapsedS.toFixed(1) })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="card flex flex-col">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="label !mb-0">{t("live.predicted_path")}</div>
              {/* Layer toggle buttons. Active state fills with the layer's
                  semantic color; inactive shows a ghost outline. The little
                  color dot on the leading edge tells the operator at a glance
                  which legend entry is which (copper for sensitive areas,
                  muted teal for cameras, mint teal for intercept). */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAreas((v) => !v)}
                  aria-pressed={showAreas}
                  className={[
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                    showAreas
                      ? "border-accent/60 bg-accent/15 text-slate-100"
                      : "border-slate-700 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#c89968" }} aria-hidden />
                  {t("live.toggle_areas")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCams((v) => !v)}
                  aria-pressed={showCams}
                  className={[
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                    showCams
                      ? "border-accent/60 bg-accent/15 text-slate-100"
                      : "border-slate-700 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#6ea892" }} aria-hidden />
                  {t("live.toggle_cameras")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowIntercept((v) => !v)}
                  aria-pressed={showIntercept}
                  className={[
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                    showIntercept
                      ? "border-accent/60 bg-accent/15 text-slate-100"
                      : "border-slate-700 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#6ea892" }} aria-hidden />
                  {t("live.toggle_intercept")}
                </button>
              </div>
            </div>
            <div className="h-[420px] w-full">
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

      <div className="card">
        <div className="label">{t("live.pending_approvals")}</div>
        {pending.length === 0 ? (
          <div className="text-sm text-muted">{t("common.no_data")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 w-20 text-start">{t("live.thumb")}</th>
                <th className="text-start">#</th>
                <th className="text-start">{t("live.drone_class")}</th>
                <th className="text-start">{t("live.nearest_area")}</th>
                <th className="text-start">{t("live.eta")}</th>
                <th className="text-start">{t("live.threat_level")}</th>
                <th className="text-end"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pending.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">
                    {p.thumbnail_path ? (
                      <img
                        src={trackThumbUrl(p.id)}
                        alt={`track ${p.track_id}`}
                        className="h-12 w-16 rounded object-cover border border-slate-700"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="h-12 w-16 rounded bg-slate-800 text-xs text-muted flex items-center justify-center">—</div>
                    )}
                  </td>
                  <td className="text-start font-data" dir="ltr">#{p.track_id}</td>
                  <td className="text-start">{classLabel(p.voted_class)}</td>
                  <td className="text-start">{placeLabel(p.nearest_area)}</td>
                  <td className="text-start font-data" dir="ltr">{p.min_eta_s !== null ? `${p.min_eta_s?.toFixed(1)}s` : "—"}</td>
                  <td className="text-start">
                    {(() => {
                      const tier = threatTier(p.min_eta_s, distToNearest(p), p.voted_class, p.alarm_fired_at);
                      const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                      return <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>;
                    })()}
                  </td>
                  <td className="space-x-2 text-end">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => handleApprove(p, "countered")} className="btn-primary text-xs">
                        {t("live.btn_countered")}
                      </button>
                      <button onClick={() => handleApprove(p, "hit")} className="btn-warning text-xs">
                        {t("live.btn_hit")}
                      </button>
                      <button onClick={() => handleReject(p)} className="btn-danger text-xs">
                        {t("common.reject")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
