import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area } from "../services/api";
import { DroneMap } from "../components/DroneMap";
import { useClassLabel, useBilingualName, usePlaceLabel } from "../i18n/places";
import { SAUDI_POPULATED_AREAS } from "../data/saudiPopulatedAreas";

const WS_URL = "ws://localhost:8000/ws/video";
const PREDICT_HORIZON_S = 60;

function projectPath(lat: number, lon: number, speed: number, angleDeg: number, seconds = 60): [number, number] {
  const distance = Math.max(speed, 0) * seconds;
  const bearing = (angleDeg * Math.PI) / 180;
  const dN = distance * Math.cos(bearing);
  const dE = distance * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
}

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

export function VideoDetection() {
  const { t } = useTranslation();
  const classLabel = useClassLabel();
  const bilingualName = useBilingualName();
  const placeLabel = usePlaceLabel();

  const [areas, setAreas] = useState<Area[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tracks, setTracks] = useState<Map<number, Snapshot>>(new Map());
  const [showAreas, setShowAreas] = useState(true);
  const [tick, setTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    Areas.list().then(setAreas);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(i);
  }, []);

  // Stale track cleanup
  useEffect(() => {
    const i = setInterval(() => {
      setTracks((prev) => {
        const cutoff = Date.now() - PREDICT_HORIZON_S * 1000;
        const next = new Map<number, Snapshot>();
        prev.forEach((snap, id) => { if (snap.lastSeenMs >= cutoff) next.set(id, snap); });
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const connect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => { setConnected(true); setPlaying(true); };
    ws.onclose = () => { setConnected(false); setPlaying(false); };

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        // JPEG frame
        const blob = new Blob([evt.data], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setImageUrl(url);
      } else {
        // JSON metadata
        try {
          const meta = JSON.parse(evt.data);
          if (meta.type === "frame" && meta.detections) {
            const now = Date.now();
            setTracks((prev) => {
              const next = new Map(prev);
              for (const d of meta.detections) {
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
          }
        } catch (_) {}
      }
    };
  };

  const disconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setPlaying(false);
  };

  useEffect(() => () => { wsRef.current?.close(); }, []);

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
        lat: s.lat, lon: s.lon,
        color: baseColor,
        label: `#${s.trackId} ${classLabel(s.droneClass)} ${(s.confidence * 100).toFixed(0)}%`,
        radius: 8,
      });
      if (isStale && elapsedS <= PREDICT_HORIZON_S && s.speedMps > 0.1) {
        const distance = s.speedMps * elapsedS;
        const bearing = (s.angleDeg * Math.PI) / 180;
        const lat = s.lat + distance * Math.cos(bearing) / 111320;
        const lon = s.lon + distance * Math.sin(bearing) / (111320 * Math.cos((s.lat * Math.PI) / 180));
        items.push({ id: `pred-${s.trackId}`, lat, lon, color: "#f5a623", label: `#${s.trackId} predicted`, radius: 6 });
      }
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, tick]);

  const localizeAreaName = (name: string | null): string => {
    if (!name) return "—";
    const row = areas.find((a) => a.name === name);
    if (row) return bilingualName(row);
    return placeLabel(name);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-accent">{t("video.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? "bg-success text-white" : "bg-slate-700 text-slate-300"}`}>
            {connected ? t("live.online") : t("live.offline")}
          </span>
          {!playing ? (
            <button className="btn-primary" onClick={connect}>{t("video.play")}</button>
          ) : (
            <button className="btn-danger" onClick={disconnect}>{t("video.stop")}</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="label">{t("video.preview")}</div>
          <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
            {imageUrl ? (
              <img src={imageUrl} alt="video" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted">
                {playing ? t("common.loading") : t("video.press_play")}
              </div>
            )}
          </div>

          {focused && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="label inline">{t("live.track_id")}</span> #{focused.trackId}</div>
              <div><span className="label inline">{t("live.drone_class")}</span> {classLabel(focused.droneClass)}</div>
              <div><span className="label inline">{t("live.confidence")}</span> {(focused.confidence * 100).toFixed(0)}%</div>
              <div><span className="label inline">{t("live.speed")}</span> {focused.speedMps.toFixed(1)} m/s</div>
              <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
              <div><span className="label inline">{t("live.nearest_area")}</span> {localizeAreaName(focused.nearestArea)}</div>
              <div className="col-span-2">
                <span className="label inline">{t("live.eta")}</span>{" "}
                {focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="card flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="label">{t("live.predicted_path")}</div>
            <button onClick={() => setShowAreas((v) => !v)} className={showAreas ? "btn-primary" : "btn-ghost"}>
              {showAreas ? "● " : "○ "}{t("live.toggle_areas")}
            </button>
          </div>
          <div className="h-[420px] w-full">
            <DroneMap
              center={focused ? [focused.lat, focused.lon] : [24.7136, 46.6753]}
              zoom={focused ? 14 : 6}
              markers={detectionMarkers}
              sensitiveAreas={showAreas ? sensitive : []}
              cameras={[]}
              predictedPath={predictedPath}
              interceptPoint={null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}