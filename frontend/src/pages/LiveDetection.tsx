import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area, trackThumbUrl } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { useAlarmsContext } from "../contexts/AlarmsContext";
import { DroneMap } from "../components/DroneMap";
import { usePlaceLabel, useClassLabel, useBilingualName } from "../i18n/places";

function projectPath(lat: number, lon: number, speed: number, angleDeg: number, seconds = 60): [number, number] {
  const distance = Math.max(speed, 0) * seconds;
  const bearing = (angleDeg * Math.PI) / 180;
  const dN = distance * Math.cos(bearing);
  const dE = distance * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
}

const PREDICT_HORIZON_S = 60;

// Mirror of backend HOSTILE_CLASSES (alarms.py). Threat tier and alarm system
// must agree: CRITICAL/HIGH only escalates for hostile classes.
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

  useEffect(() => {
    Cameras.list().then((cs) => {
      setCameras(cs);
      setSelected(cs[0]?.id ?? null);
    });
    Areas.list().then(setAreas);
  }, []);

  useEffect(() => {
    const i = setInterval(() => Detections.pendingTracks().then(setPending).catch(() => {}), 5000);
    return () => clearInterval(i);
  }, []);

  const { imageUrl, meta, connected } = useLiveStream(selected);
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
        prev.forEach((ts, id) => {
          if (ts >= cutoff) next.set(id, ts);
        });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const [tracks, setTracks] = useState<Map<number, Snapshot>>(new Map());
  const [showAreas, setShowAreas] = useState(true);
  const [showCams, setShowCams] = useState(false);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const dets = meta?.detections;
    if (!dets || dets.length === 0) return;
    setTracks((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const d of dets) {
        const key = d.linked_track_id ?? d.track_id;
        next.set(key, {
          trackId: key,
          droneClass: d.drone_class,
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
        if (d.linked_track_id != null && d.track_id !== key) {
          next.delete(d.track_id);
        }
      }
      return next;
    });
  }, [meta]);

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

  const focused: Snapshot | null = useMemo(() => {
    const all = Array.from(tracks.values());
    if (all.length === 0) return null;
    return all.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), all[0]);
  }, [tracks]);

  const predictedPath = useMemo(() => {
    if (!focused) return null;
    const end = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, PREDICT_HORIZON_S);
    return [[focused.lat, focused.lon] as [number, number], end];
  }, [focused]);

  const localizeAreaName = (name: string | null): string => {
    if (!name) return "—";
    const row = areas.find((a) => a.name === name);
    if (row) return bilingualName(row);
    return placeLabel(name);
  };

  const sensitive = areas.map((a) => ({ name: bilingualName(a), lat: a.latitude, lon: a.longitude }));

  const detectionMarkers = useMemo(() => {
    const items: { id: string; lat: number; lon: number; color: string; label: string; radius: number }[] = [];
    const now = Date.now();
    tracks.forEach((s) => {
      const elapsedS = (now - s.lastSeenMs) / 1000;
      const isStale = elapsedS > 0.5;
      const baseColor = s.droneClass.toLowerCase().includes("shahed") ? "#e94560" : "#38bdf8";
      items.push({
        id: `seen-${s.trackId}`,
        lat: s.lat,
        lon: s.lon,
        color: baseColor,
        label: t("live.marker_seen", {
          id: s.trackId,
          cls: classLabel(s.droneClass),
          pct: (s.confidence * 100).toFixed(0),
          secs: elapsedS.toFixed(1),
        }),
        radius: 8,
      });
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
          color: "#f5a623",
          label: t("live.marker_predicted", {
            id: s.trackId,
            secs: elapsedS.toFixed(0),
            speed: s.speedMps.toFixed(1),
            dir: s.direction,
          }),
          radius: 6,
        });
      }
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, tick]);

  const handleApprove = async (track: Track) => {
    await Detections.approve(track.camera_id, track.track_id);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };
  const handleReject = async (track: Track) => {
    await Detections.reject(track.camera_id, track.track_id);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };

  function threatTier(
    etaS: number | null,
    distM: number | null,
    droneClass: string | null,
  ): { label: string; cls: string } {
    const cls_l = (droneClass ?? "").toLowerCase();
    const isHostile = HOSTILE_CLASSES.has(cls_l);
    if (!isHostile) {
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
    const dN = (a.latitude - p.last_lat) * 111320;
    const dE = (a.longitude - p.last_lon) * 111320 * Math.cos((p.last_lat * Math.PI) / 180);
    return Math.sqrt(dN * dN + dE * dE);
  }

  // Reconciliation: when the pending-approvals list contains a CRITICAL row
  // and (a) the backend has already stamped alarm_fired_at on the track but
  // (b) this browser session hasn't been notified yet, synthesize an alarm
  // event so the banner+sound fire — closing the gap between the persisted
  // CRITICAL badge and the ephemeral WS event.
  const notifiedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const p of pending) {
      const tier = threatTier(p.min_eta_s, distToNearest(p), p.voted_class);
      if (tier.label !== "CRITICAL" && tier.label !== "HIGH") continue;
      if (notifiedRef.current.has(p.id)) continue;
      // Only re-fire when the backend agrees the alarm was warranted.
      if (!p.alarm_fired_at) continue;
      notifiedRef.current.add(p.id);
      alarms.push({
        camera_id: p.camera_id,
        track_id: p.track_id,
        drone_class: p.voted_class ?? "drone",
        confidence: p.max_confidence ?? 0,
        lat: p.last_lat ?? 0,
        lon: p.last_lon ?? 0,
        nearest_area: p.nearest_area,
        eta_s: p.min_eta_s,
        score: tier.label === "CRITICAL" ? 90 : 70,
        reasons: ["pending_review"],
        ts: p.alarm_fired_at,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, areas]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-accent">{t("live.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? "bg-success text-white" : "bg-slate-700 text-slate-300"}`}>
            {connected ? t("live.online") : t("live.offline")}
          </span>
          {cameras.length > 0 && (
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="input w-auto"
            >
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
                  <div><span className="label inline">{t("live.track_id")}</span> #{focused.trackId}</div>
                  <div><span className="label inline">{t("live.drone_class")}</span> {classLabel(focused.droneClass)}</div>
                  <div><span className="label inline">{t("live.confidence")}</span> {(focused.confidence * 100).toFixed(0)}%</div>
                  <div><span className="label inline">{t("live.speed")}</span> {focused.speedMps.toFixed(1)} m/s</div>
                  <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
                  <div><span className="label inline">{t("live.nearest_area")}</span> {localizeAreaName(focused.nearestArea)}</div>
                  <div className="col-span-2"><span className="label inline">{t("live.eta")}</span> {focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}</div>
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
            <div className="flex items-center justify-between mb-2">
              <div className="label">{t("live.predicted_path")}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAreas((v) => !v)}
                  className={showAreas ? "btn-primary" : "btn-ghost"}
                >
                  {showAreas ? "● " : "○ "}{t("live.toggle_areas")}
                </button>
                <button
                  onClick={() => setShowCams((v) => !v)}
                  className={showCams ? "btn-primary" : "btn-ghost"}
                >
                  {showCams ? "● " : "○ "}{t("live.toggle_cameras")}
                </button>
              </div>
            </div>
            <div className="h-[420px] w-full">
              <DroneMap
                center={focused ? [focused.lat, focused.lon] : [24.7136, 46.6753]}
                zoom={focused ? 14 : 6}
                markers={detectionMarkers}
                sensitiveAreas={showAreas ? sensitive : []}
                cameras={
                  showCams
                    ? cameras.map((c) => ({
                        id: c.id,
                        name: bilingualName(c),
                        lat: c.latitude,
                        lon: c.longitude,
                        heading_deg: c.heading_deg,
                        fov_h_deg: c.fov_h_deg,
                        distance_m: c.assumed_target_distance_m,
                        threatActive: threatCamMap.has(c.id),
                      }))
                    : []
                }
                predictedPath={predictedPath}
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
            <thead className="text-xs uppercase text-slate-400">
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
                  <td className="py-2 text-start">
                    {p.thumbnail_path ? (
                      <img
                        src={trackThumbUrl(p.id)}
                        alt={`track ${p.track_id}`}
                        className="h-12 w-16 rounded object-cover border border-slate-700"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="h-12 w-16 rounded bg-slate-800 text-xs text-muted flex items-center justify-center">
                        —
                      </div>
                    )}
                  </td>
                  <td className="text-start"><span dir="ltr">#{p.track_id}</span></td>
                  <td className="text-start">{classLabel(p.voted_class)}</td>
                  <td className="text-start">{localizeAreaName(p.nearest_area)}</td>
                  <td className="text-start"><span dir="ltr">{p.min_eta_s !== null ? `${p.min_eta_s?.toFixed(1)}s` : "—"}</span></td>
                  <td className="text-start">
                    {(() => {
                      const tier = threatTier(p.min_eta_s, distToNearest(p), p.voted_class);
                      const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                      return (
                        <span className="flex items-center gap-1">
                          <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>
                          {p.alarm_fired_at && (tier.label === "CRITICAL" || tier.label === "HIGH") && (
                            <span title="alarm fired" className="text-danger">🚨</span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="space-x-2 text-end">
                    <button onClick={() => handleApprove(p)} className="btn-primary">{t("common.approve")}</button>
                    <button onClick={() => handleReject(p)} className="btn-danger">{t("common.reject")}</button>
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
