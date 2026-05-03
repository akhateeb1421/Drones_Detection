import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { DroneMap } from "../components/DroneMap";

function projectPath(lat: number, lon: number, speed: number, angleDeg: number, seconds = 60): [number, number] {
  const distance = Math.max(speed, 0) * seconds;
  const bearing = (angleDeg * Math.PI) / 180;
  const dN = distance * Math.cos(bearing);
  const dE = distance * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
}

const PREDICT_HORIZON_S = 60;

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
        next.set(d.track_id, {
          trackId: d.track_id,
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

  const sensitive = areas.map((a) => ({ name: a.name, lat: a.latitude, lon: a.longitude }));

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
        label: `#${s.trackId} ${s.droneClass} ${(s.confidence * 100).toFixed(0)}% — last seen ${elapsedS.toFixed(1)}s ago`,
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
          label: `#${s.trackId} predicted at +${elapsedS.toFixed(0)}s (${s.speedMps.toFixed(1)} m/s ${s.direction})`,
          radius: 6,
        });
      }
    });
    return items;
  }, [tracks, tick]);

  const handleApprove = async (track: Track) => {
    await Detections.approve(track.camera_id, track.track_id);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };
  const handleReject = async (track: Track) => {
    await Detections.reject(track.camera_id, track.track_id);
    setPending((cur) => cur.filter((p) => p.id !== track.id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-accent">{t("live.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? "bg-success text-white" : "bg-slate-700 text-slate-300"}`}>
            {connected ? "● live" : "● offline"}
          </span>
          {cameras.length > 0 && (
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="input w-auto"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
                  <div><span className="label inline">{t("live.drone_class")}</span> {focused.droneClass}</div>
                  <div><span className="label inline">{t("live.confidence")}</span> {(focused.confidence * 100).toFixed(0)}%</div>
                  <div><span className="label inline">{t("live.speed")}</span> {focused.speedMps.toFixed(1)} m/s</div>
                  <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
                  <div><span className="label inline">{t("live.nearest_area")}</span> {focused.nearestArea ?? "—"}</div>
                  <div className="col-span-2"><span className="label inline">{t("live.eta")}</span> {focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}</div>
                  {stale && (
                    <div className="col-span-2 mt-1 rounded bg-warning/20 px-2 py-1 text-xs text-warning">
                      Out of frame — predicted from last seen {elapsedS.toFixed(1)}s ago
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
                        name: c.name,
                        lat: c.latitude,
                        lon: c.longitude,
                        heading_deg: c.heading_deg,
                        fov_h_deg: c.fov_h_deg,
                        distance_m: c.assumed_target_distance_m,
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
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2">#</th>
                <th>{t("live.drone_class")}</th>
                <th>{t("live.nearest_area")}</th>
                <th>{t("live.eta")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pending.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">#{p.track_id}</td>
                  <td>{p.voted_class ?? "—"}</td>
                  <td>{p.nearest_area ?? "—"}</td>
                  <td>{p.min_eta_s !== null ? `${p.min_eta_s?.toFixed(1)}s` : "—"}</td>
                  <td className="space-x-2 text-right">
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
