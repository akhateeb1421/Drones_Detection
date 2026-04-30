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
  const detection = meta?.detections?.[0];

  const predictedPath = useMemo(() => {
    if (!detection) return null;
    const end = projectPath(detection.lat, detection.lon, detection.speed_mps, detection.angle_deg, 60);
    return [
      [detection.lat, detection.lon] as [number, number],
      end,
    ];
  }, [detection]);

  const sensitive = areas.map((a) => ({ name: a.name, lat: a.latitude, lon: a.longitude }));
  const detectionMarkers = (meta?.detections ?? []).map((d) => ({
    id: `det-${d.track_id}`,
    lat: d.lat,
    lon: d.lon,
    color: d.drone_class.toLowerCase().includes("shahed") ? "#e94560" : "#38bdf8",
    label: `#${d.track_id} ${d.drone_class} ${(d.confidence * 100).toFixed(0)}%`,
    radius: 8,
  }));

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
            {detection && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><span className="label inline">{t("live.track_id")}</span> #{detection.track_id}</div>
                <div><span className="label inline">{t("live.drone_class")}</span> {detection.drone_class}</div>
                <div><span className="label inline">{t("live.confidence")}</span> {(detection.confidence * 100).toFixed(0)}%</div>
                <div><span className="label inline">{t("live.speed")}</span> {detection.speed_mps.toFixed(1)} m/s</div>
                <div><span className="label inline">{t("live.direction")}</span> {detection.direction}</div>
                <div><span className="label inline">{t("live.nearest_area")}</span> {detection.nearest_area ?? "—"}</div>
                <div className="col-span-2"><span className="label inline">{t("live.eta")}</span> {detection.eta_s !== null ? `${detection.eta_s.toFixed(1)}s` : "—"}</div>
              </div>
            )}
          </div>
          <div className="card flex flex-col">
            <div className="label">{t("live.predicted_path")}</div>
            <div className="h-[420px] w-full">
              <DroneMap
                center={detection ? [detection.lat, detection.lon] : [24.7136, 46.6753]}
                zoom={detection ? 12 : 6}
                markers={detectionMarkers}
                sensitiveAreas={sensitive}
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
