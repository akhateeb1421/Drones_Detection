import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area, trackThumbUrl } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { useTrackStore, Snapshot } from "../hooks/useTrackStore";
import { DroneMap } from "../components/DroneMap";
import { WeatherPanel } from "../components/WeatherPanel";
import { usePlaceLabel, useClassLabel, useBilingualName } from "../i18n/places";
import { SAUDI_POPULATED_AREAS } from "../data/saudiPopulatedAreas";

/* ── Recorded Clip ──────────────────────────────────────────────────
 * Full feature parity with Live Detection — same per-track snapshot
 * state, predicted-path overlay on the map, intercept-point sampling,
 * weather panel, detection-details card, threat tiers, layer toggles,
 * auto-zoom on hostile detection, and pending-approvals table.
 *
 * Differences from Live Detection (intentional):
 *   • Camera is LOCKED to the "Recorded Clip" Camera (auto-created
 *     on the backend, pointing at the bundled shahed.mp4 demo file).
 *   • Camera dropdown is replaced by a LOCATION dropdown — picking
 *     any other configured camera copies that camera's lat/lon/
 *     heading/FOV onto the recorded clip so the same drone footage
 *     is interpreted as happening at the chosen geographic site.
 *   • Play / Pause toggle freezes the visible feed (operator-only
 *     UX; backend keeps producing detections).
 *   • Pending approvals are scoped to the recorded camera id so we
 *     don't leak in rows from real live cameras.
 * ─────────────────────────────────────────────────────────────────── */

function projectPath(lat: number, lon: number, speed: number, angleDeg: number, seconds = 60): [number, number] {
  const distance = Math.max(speed, 0) * seconds;
  const bearing = (angleDeg * Math.PI) / 180;
  const dN = distance * Math.cos(bearing);
  const dE = distance * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
}

const PREDICT_HORIZON_S = 60;

// ETA display as minutes:seconds (e.g. 83s -> "1:23", 8s -> "0:08").
function fmtEta(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

const HOSTILE_CLASSES = new Set([
  "shahed", "shahed_136", "shahed-136", "shahed136",
  "orlan", "orlan-10", "orlan10", "orlan_10",
  "dji", "drone",
]);
function isHostileClass(cls: string | null | undefined): boolean {
  return HOSTILE_CLASSES.has(String(cls ?? "").toLowerCase().trim());
}

export function RecordedClip() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const classLabel = useClassLabel();
  const bilingualName = useBilingualName();

  const [recorded, setRecorded] = useState<Camera | null>(null);
  const [allCams, setAllCams] = useState<Camera[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [pending, setPending] = useState<Track[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Last-applied location id, used so the dropdown shows the chosen
  // entry instead of permanently snapping back to the placeholder.
  // Initialised when the recorded camera loads: we match its lat/lon
  // to one of the other cameras (if any) so the operator sees which
  // site the clip currently mirrors.
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");

  // Layer toggles — mirror Live Detection so the operator can hide
  // sensitive markers, camera cones, or the intercept point.
  const [showAreas, setShowAreas] = useState(true);
  const [showCams, setShowCams] = useState(true);
  const [showIntercept, setShowIntercept] = useState(true);

  // Bootstrap: recorded camera (auto-created), all cameras (for the
  // location dropdown), sensitive areas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rec, cams, ar] = await Promise.all([
          Cameras.recorded(),
          Cameras.list(),
          Areas.list(),
        ]);
        if (cancelled) return;
        setRecorded(rec);
        setAllCams(cams);
        setAreas(ar);
        // If the recorded clip's current geo matches one of the other
        // cameras (within ~1m), show that camera as the selected
        // location. Otherwise leave the dropdown on the placeholder.
        const match = cams.find(
          (c) =>
            c.id !== rec.id &&
            Math.abs(c.latitude - rec.latitude) < 1e-5 &&
            Math.abs(c.longitude - rec.longitude) < 1e-5,
        );
        if (match) setSelectedLocation(match.id);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { imageUrl, meta, connected } = useLiveStream(recorded?.id ?? null);

  // Pending approvals poll, scoped to the recorded camera. Same 2 s
  // cadence as Live Detection so a freshly-detected drone surfaces
  // within one polling cycle.
  useEffect(() => {
    if (!recorded) return;
    let cancelled = false;
    const fetchOnce = () => {
      Detections.pendingTracks()
        .then((rows) => {
          if (cancelled) return;
          setPending(rows.filter((r) => r.camera_id === recorded.id));
        })
        .catch(() => { /* swallow */ });
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [recorded?.id]);

  // Pause / resume the backend worker. The local `paused` state mirrors
  // the backend state so the UI and the actual pipeline stay in sync.
  // On error we revert the optimistic UI flip so the operator isn't
  // stuck with a misleading button label.
  const handlePauseToggle = async () => {
    if (!recorded) return;
    const next = !paused;
    setPaused(next);
    try {
      if (next) {
        await Cameras.pause(recorded.id);
      } else {
        await Cameras.resume(recorded.id);
      }
    } catch (e) {
      setPaused(!next);
      setErr(String(e));
    }
  };

  // On mount, read the worker's actual pause state from the backend
  // and reflect it in the local UI. This is what makes the pause
  // PERSIST across tab close + reopen, page reload, and tab switches
  // that incidentally remount the component. Previously we forced the
  // worker to resume on mount, which had the side-effect of "always
  // start playing" — which is exactly the bug the operator reported
  // when they came back to a paused clip and it was running again.
  useEffect(() => {
    const id = recorded?.id;
    if (id == null) return;
    Cameras.state(id)
      .then((s) => setPaused(s.paused))
      .catch(() => { /* leave local state as-is on error */ });
  }, [recorded?.id]);

  // Apply a different camera's geo to the recorded clip + remember
  // which one we picked so the dropdown reflects the current state.
  const handleLocationChange = async (camId: number) => {
    if (!recorded || camId === recorded.id) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await Cameras.copyGeo(camId);
      setRecorded(updated);
      setSelectedLocation(camId);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (track: Track, outcome: "countered" | "hit") => {
    try {
      await Detections.approve(track.camera_id, track.track_id, outcome);
      setPending((cur) => cur.filter((p) => p.id !== track.id));
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleReject = async (track: Track) => {
    try {
      await Detections.reject(track.camera_id, track.track_id);
      setPending((cur) => cur.filter((p) => p.id !== track.id));
    } catch (e) {
      setErr(String(e));
    }
  };

  /* ───────── per-track snapshot state — mirrors LiveDetection ─── */
  // Backed by the module-level store (useTrackStore) so the tracked
  // drones — and therefore the predicted-path line — survive navigating
  // away from this page and back. Component-local useState reset to an
  // empty Map on every remount, which is what made the line vanish.
  const [tracks, setTracks] = useTrackStore(recorded?.id ?? null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(i);
  }, []);

  // Running mean of speed PER track, used only by the video-box speed
  // readout (the user asked that box to show the average, not the live
  // instantaneous value). Keyed by the same merged track key. Startup
  // frames where the velocity window hasn't filled report ~0 speed, so we
  // only fold in samples above a small floor to keep the mean honest. The
  // map persists across renders via a ref; the map+predicted line keep
  // using the instantaneous speedMps from the snapshot, untouched.
  const speedAccRef = useRef<Map<number, { sum: number; count: number }>>(new Map());
  // Running mean of ETA PER track, same idea as the speed average above —
  // shown only in the video-box ETA readout. The threat-tier badge and the
  // pending table keep using the live / min ETA, untouched.
  const etaAccRef = useRef<Map<number, { sum: number; count: number }>>(new Map());

  // Update per-track snapshots from every incoming WS frame's detections.
  useEffect(() => {
    const dets = meta?.detections;
    if (!dets || dets.length === 0) return;
    setTracks((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const d of dets) {
        const key = d.linked_track_id ?? d.track_id;
        if (typeof d.speed_mps === "number" && d.speed_mps > 0.1) {
          const acc = speedAccRef.current.get(key) ?? { sum: 0, count: 0 };
          acc.sum += d.speed_mps;
          acc.count += 1;
          speedAccRef.current.set(key, acc);
        }
        if (typeof d.eta_s === "number" && isFinite(d.eta_s) && d.eta_s > 0) {
          const acc = etaAccRef.current.get(key) ?? { sum: 0, count: 0 };
          acc.sum += d.eta_s;
          acc.count += 1;
          etaAccRef.current.set(key, acc);
        }
        next.set(key, {
          trackId: key,
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
        if (d.linked_track_id != null && d.track_id !== key) {
          next.delete(d.track_id);
        }
      }
      return next;
    });
  }, [meta]);

  // ─── Track lifetime ────────────────────────────────────────────────
  // Tracks live in the module-level store (useTrackStore) so they survive
  // navigating between sections. Expiry is pure WALL-CLOCK and lazy: a
  // track (and its line, intercept point, map dots, details panel) shows
  // only while `Date.now() - lastSeenMs < PREDICT_HORIZON_S`, re-checked
  // every `tick`. The clock is never paused/rewound while the section is
  // hidden, so the predicted-now ghost dot keeps advancing along the line
  // in real time — on return it's at the LIVE position, not frozen. A
  // track that goes PREDICT_HORIZON_S without a detection clears and stays
  // cleared until a fresh detection arrives. See LiveDetection.tsx for the
  // full rationale.

  // Most-recent NON-EXPIRED hostile track drives the details panel + focus.
  const focused: Snapshot | null = useMemo(() => {
    const now = Date.now();
    const hostile = Array.from(tracks.values()).filter(
      (s) => isHostileClass(s.droneClass) && now - s.lastSeenMs < PREDICT_HORIZON_S * 1000,
    );
    if (hostile.length === 0) return null;
    return hostile.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), hostile[0]);
  }, [tracks, tick]);

  // Average speed (m/s) of the focused track over its tracked lifetime —
  // shown ONLY in the video-box readout below. Falls back to the live
  // instantaneous value before enough samples accumulate.
  const focusedAvgSpeedMps = useMemo(() => {
    if (!focused) return 0;
    const acc = speedAccRef.current.get(focused.trackId);
    return acc && acc.count > 0 ? acc.sum / acc.count : focused.speedMps;
  }, [focused, tick]);

  // Average ETA (seconds) of the focused track — shown ONLY in the
  // video-box readout. Falls back to the live ETA before samples accrue.
  const focusedAvgEtaS = useMemo(() => {
    if (!focused) return null;
    const acc = etaAccRef.current.get(focused.trackId);
    return acc && acc.count > 0 ? acc.sum / acc.count : focused.etaS;
  }, [focused, tick]);

  const focusedIsHostile = focused != null;

  const predictedPath = useMemo(() => {
    if (!focused || !focusedIsHostile) return null;
    const end = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, PREDICT_HORIZON_S);
    return [[focused.lat, focused.lon] as [number, number], end];
  }, [focused, focusedIsHostile]);

  /* ───────── suggested intercept point — sampled along the path ── */
  const SAFETY_THRESHOLD_M = 800;
  const SAFETY_BUFFER_S = 5;
  const interceptPoint = useMemo(() => {
    if (!focused || !focusedIsHostile || focused.speedMps < 0.5) return null;
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
      if (clearance >= SAFETY_THRESHOLD_M) { best = { lat, lon, t: tSec, clearance }; break; }
      if (best == null || clearance > best.clearance) best = { lat, lon, t: tSec, clearance };
    }
    if (!best) return null;
    return {
      lat: best.lat, lon: best.lon, t: best.t,
      km: best.clearance / 1000,
      safe: best.clearance >= SAFETY_THRESHOLD_M,
    };
  }, [focused, focusedIsHostile, areas]);

  /* ───────── map marker plumbing ────────────────────────────────── */

  const sensitive = areas.map((a) => ({ name: bilingualName(a), lat: a.latitude, lon: a.longitude }));

  const detectionMarkers = useMemo(() => {
    const items: { id: string; lat: number; lon: number; color: string; label: string; radius: number }[] = [];
    const now = Date.now();
    tracks.forEach((s) => {
      if (!isHostileClass(s.droneClass)) return;
      const elapsedS = (now - s.lastSeenMs) / 1000;
      // Track lost — drop ALL of its markers so the map clears in step
      // with the predicted line, intercept point, and details panel.
      if (elapsedS > PREDICT_HORIZON_S) return;
      const isStale = elapsedS > 0.5;
      const baseColor = String(s.droneClass ?? "").toLowerCase().includes("shahed") ? "#ff4757" : "#01F2CF";
      items.push({
        id: `seen-${s.trackId}`,
        lat: s.lat, lon: s.lon, color: baseColor,
        label: `#${s.trackId} ${s.droneClass} ${(s.confidence * 100).toFixed(0)}% — last seen ${elapsedS.toFixed(1)}s ago`,
        radius: 8,
      });
      // Predicted-now ghost dot — slides along the predicted path while
      // the track is stale (between live sightings). Bounded by the
      // horizon check above, so it never runs past the line's end.
      if (isStale && s.speedMps > 0.1) {
        const distance = s.speedMps * elapsedS;
        const bearing = (s.angleDeg * Math.PI) / 180;
        const dN = distance * Math.cos(bearing);
        const dE = distance * Math.sin(bearing);
        const lat = s.lat + dN / 111320;
        const lon = s.lon + dE / (111320 * Math.cos((s.lat * Math.PI) / 180));
        items.push({
          id: `pred-${s.trackId}`,
          lat, lon, color: "#fbbf24",
          label: `#${s.trackId} predicted at +${elapsedS.toFixed(0)}s (${(s.speedMps * 3.6).toFixed(0)} km/h ${s.direction})`,
          radius: 6,
        });
      }
    });
    return items;
  }, [tracks, tick]);

  // The recorded clip displays as a single camera marker. Heading /
  // FOV / range come from whichever real camera's geo was copied in.
  const cameraMarkers = useMemo(
    () =>
      recorded
        ? [{
            id: recorded.id,
            name: bilingualName(recorded),
            lat: recorded.latitude,
            lon: recorded.longitude,
            heading_deg: recorded.heading_deg,
            fov_h_deg: recorded.fov_h_deg,
            distance_m: recorded.assumed_target_distance_m ?? 1500,
            threatActive: focused != null,
          }]
        : [],
    [recorded, focused, bilingualName],
  );

  const interceptForMap = interceptPoint
    ? interceptPoint.safe
      ? {
          lat: interceptPoint.lat,
          lon: interceptPoint.lon,
          label: t("live.intercept_label", { secs: interceptPoint.t.toFixed(0), km: interceptPoint.km.toFixed(1) }),
        }
      : { lat: interceptPoint.lat, lon: interceptPoint.lon, label: t("live.intercept_unsafe") }
    : null;

  // Auto-zoom bounds: when a hostile drone is tracked, fit the map to
  // the recorded camera + the drone + the predicted-path endpoint.
  const focusBounds = useMemo<[number, number][] | null>(() => {
    if (!focused || !focusedIsHostile || !recorded) return null;
    const pts: [number, number][] = [
      [recorded.latitude, recorded.longitude],
      [focused.lat, focused.lon],
    ];
    if (predictedPath && predictedPath.length >= 2) {
      pts.push(predictedPath[1] as [number, number]);
    }
    return pts;
  }, [focused, focusedIsHostile, recorded, predictedPath]);

  /* ───────── threat tier (mirror of LiveDetection) ──────────────── */

  function threatTier(
    etaS: number | null,
    distM: number | null,
    droneClass: string | null,
    alarmFiredAt?: string | null,
  ): { label: string; cls: string } {
    if (alarmFiredAt) {
      const firedMs = new Date(alarmFiredAt).getTime();
      if (!Number.isNaN(firedMs) && Date.now() - firedMs < 60_000) {
        return { label: "CRITICAL", cls: "bg-danger text-white" };
      }
    }
    const cls_l = (droneClass ?? "").toLowerCase();
    const isHostile = HOSTILE_CLASSES.has(cls_l);
    if (!isHostile) return { label: "LOW", cls: "bg-success text-white" };
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
    return { label: "—", cls: "badge-muted" };
  }

  function distToNearest(p: Track): number | null {
    if (!p.last_lat || !p.last_lon || !p.nearest_area) return null;
    const a = areas.find((x) => x.name === p.nearest_area);
    if (!a) return null;
    const dN = (a.latitude - p.last_lat) * 111320;
    const dE = (a.longitude - p.last_lon) * 111320 * Math.cos((p.last_lat * Math.PI) / 180);
    return Math.sqrt(dN * dN + dE * dE);
  }

  // Filter pending to hostile classes only (same UX rule as Live), then
  // sort by track_id ascending so the queue reads 1, 2, 3, 4, 5… instead
  // of the recency order the backend returns (it orders by last_seen_at,
  // so a re-detected track floats to the top and the # column jumps
  // around). Tiebreak on camera_id so cross-camera track_id collisions
  // stay grouped deterministically.
  const visiblePending = useMemo(
    () =>
      pending
        .filter((p) => isHostileClass(p.voted_class))
        .sort((a, b) => a.track_id - b.track_id || a.camera_id - b.camera_id),
    [pending],
  );

  return (
    <div className="space-y-4">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", direction:"ltr" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className={`badge ${connected ? "bg-success text-white" : "badge-muted"}`}>
            {connected ? t("live.online", "● live") : t("live.offline", "● offline")}
          </span>
          {allCams.length > 0 && recorded && (
            <select
              className="input w-auto"
              value={selectedLocation}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                const id = Number(raw);
                if (!Number.isNaN(id)) handleLocationChange(id);
              }}
              disabled={busy}
            >
              <option value="" disabled>{t("recorded.select_location", "اختر موقعاً")}</option>
              {allCams.filter((c) => c.id !== recorded.id).map((c) => (
                <option key={c.id} value={c.id}>{bilingualName(c)}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handlePauseToggle}
            className={`btn ${paused ? "btn-primary" : "btn-ghost"}`}
          >
            {paused ? t("recorded.resume", "تشغيل") : t("recorded.pause", "إيقاف")}
          </button>
        </div>
        <h1 className="text-xl font-semibold" style={{ direction:"rtl" }}>
          {t("nav.recorded", "مقطع مسجل")}
        </h1>
      </div>

      {err && <div className="card text-danger">{err}</div>}

      {!recorded ? (
        <div className="card">{t("common.loading", "جارٍ التحميل...")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left column — video feed + focused-detection details +
              weather panel — same layout as Live Detection. */}
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="label">{t("recorded.video", "الفيديو")}</div>
              <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                {!paused && imageUrl ? (
                  <img src={imageUrl} alt="recorded" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted">
                    {paused
                      ? t("recorded.paused", "متوقف")
                      : t("common.loading", "جارٍ التحميل...")}
                  </div>
                )}
              </div>
              {/* Focused-detection details. Falls back to camera geo
                  when there's no live track. */}
              {focused ? (() => {
                const elapsedS = (Date.now() - focused.lastSeenMs) / 1000;
                const stale = elapsedS > 0.5;
                return (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><span className="label inline">{t("live.track_id")}</span> <span className="font-data" dir="ltr">#{focused.trackId}</span></div>
                    <div><span className="label inline">{t("live.drone_class")}</span> {classLabel(focused.droneClass)}</div>
                    <div><span className="label inline">{t("live.confidence")}</span> <span className="font-data">{(focused.confidence * 100).toFixed(0)}%</span></div>
                    <div><span className="label inline">{t("live.speed")}</span> <span className="font-data" dir="ltr">{(focusedAvgSpeedMps * 3.6).toFixed(0)} km/h</span></div>
                    <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
                    <div><span className="label inline">{t("live.nearest_area")}</span> {placeLabel(focused.nearestArea)}</div>
                    <div><span className="label inline">{t("live.lat")}</span> <span className="font-data" dir="ltr">{focused.lat.toFixed(5)}</span></div>
                    <div><span className="label inline">{t("live.lon")}</span> <span className="font-data" dir="ltr">{focused.lon.toFixed(5)}</span></div>
                    <div><span className="label inline">{t("live.eta")}</span> <span className="font-data" dir="ltr">{fmtEta(focusedAvgEtaS)}</span></div>
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
              })() : (
                // No active hostile track — fall back to camera info so
                // the operator at least sees the configured geo.
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="label inline">{t("recorded.location", "الموقع")}</span> {bilingualName(recorded)}</div>
                  <div><span className="label inline">{t("live.cam_heading", "heading")}</span> <span className="font-data" dir="ltr">{recorded.heading_deg}°</span></div>
                  <div><span className="label inline">{t("live.lat", "Latitude")}</span> <span className="font-data" dir="ltr">{recorded.latitude.toFixed(5)}</span></div>
                  <div><span className="label inline">{t("live.lon", "Longitude")}</span> <span className="font-data" dir="ltr">{recorded.longitude.toFixed(5)}</span></div>
                  <div className="col-span-2 text-xs text-muted">
                    {meta?.detections?.length ?? 0} {t("recorded.detections", "كشف نشط")}
                  </div>
                </div>
              )}
            </div>
            {/* Weather panel — Open-Meteo readout for the recorded
                camera's current geo. Updates when the operator picks
                a new location from the dropdown. */}
            <WeatherPanel camera={recorded} />
          </div>

          {/* Right column — map with predicted path, intercept point,
              layer toggles, and the same auto-zoom behavior as Live. */}
          <div className="card flex flex-col">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="label !mb-0">{t("live.predicted_path")}</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAreas((v) => !v)}
                  aria-pressed={showAreas}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150"
                  style={{
                    borderColor: showAreas ? "var(--primary)" : "var(--border)",
                    background: showAreas ? "oklch(from var(--primary) l c h / 0.15)" : "transparent",
                    color: "var(--foreground)",
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#03DA9A" }} aria-hidden />
                  {t("live.toggle_areas")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCams((v) => !v)}
                  aria-pressed={showCams}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150"
                  style={{
                    borderColor: showCams ? "var(--primary)" : "var(--border)",
                    background: showCams ? "oklch(from var(--primary) l c h / 0.15)" : "transparent",
                    color: "var(--foreground)",
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#03DA9A" }} aria-hidden />
                  {t("live.toggle_cameras")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowIntercept((v) => !v)}
                  aria-pressed={showIntercept}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150"
                  style={{
                    borderColor: showIntercept ? "var(--primary)" : "var(--border)",
                    background: showIntercept ? "oklch(from var(--primary) l c h / 0.15)" : "transparent",
                    color: "var(--foreground)",
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#a78bfa" }} aria-hidden />
                  {t("live.toggle_intercept")}
                </button>
              </div>
            </div>
            <div className="h-[420px] w-full">
              <DroneMap
                center={focused ? [focused.lat, focused.lon] : [recorded.latitude, recorded.longitude]}
                zoom={focused ? 14 : 11}
                markers={detectionMarkers}
                sensitiveAreas={showAreas ? sensitive : []}
                cameras={showCams ? cameraMarkers : []}
                predictedPath={predictedPath}
                interceptPoint={showIntercept ? interceptForMap : null}
                focusBounds={focusBounds}
              />
            </div>
          </div>
        </div>
      )}

      {/* Pending approvals — same triage table as Live Detection,
          scoped to the recorded clip's detections. */}
      <div className="card">
        <div className="label">{t("live.pending_approvals", "كشوفات في انتظار المراجعة")}</div>
        {visiblePending.length === 0 ? (
          <div className="text-sm text-muted">{t("common.no_data", "No data available")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 w-20 text-start">{t("live.thumb", "Frame")}</th>
                <th className="text-start min-w-[180px]">{t("live.description", "Description")}</th>
                <th className="text-start">#</th>
                <th className="text-start">{t("live.drone_class", "Drone class")}</th>
                <th className="text-start">{t("live.nearest_area", "Nearest area")}</th>
                <th className="text-start">{t("live.eta", "ETA")}</th>
                <th className="text-start">{t("live.threat_level")}</th>
                <th className="text-end"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visiblePending.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-start">
                    {p.thumbnail_path ? (
                      <img
                        key={p.thumbnail_path}
                        src={trackThumbUrl(p.id)}
                        alt={`track ${p.track_id}`}
                        className="h-12 w-16 rounded object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="h-12 w-16 rounded bg-slate-800 text-xs text-muted flex items-center justify-center">—</div>
                    )}
                  </td>
                  <td className="text-start text-xs text-slate-300 align-middle" style={{ maxWidth: 280 }}>
                    {p.description ? (
                      <span style={{ display: "inline-block", lineHeight: 1.35 }}>{p.description}</span>
                    ) : (
                      <span className="text-muted italic">{t("live.description_loading", "...")}</span>
                    )}
                  </td>
                  <td className="text-start font-data"><span dir="ltr">#{p.track_id}</span></td>
                  <td className="text-start">{classLabel(p.voted_class)}</td>
                  <td className="text-start">{placeLabel(p.nearest_area)}</td>
                  <td className="text-start font-data">
                    <span dir="ltr">
                      {(() => {
                        // Match the video-box ETA: use the same per-track
                        // running average while the track is live; fall back
                        // to the persisted ETA for historical rows.
                        const acc = etaAccRef.current.get(p.track_id);
                        const v = acc && acc.count > 0 ? acc.sum / acc.count : p.min_eta_s;
                        return fmtEta(v);
                      })()}
                    </span>
                  </td>
                  <td className="text-start">
                    {(() => {
                      const tier = threatTier(p.min_eta_s, distToNearest(p), p.voted_class, p.alarm_fired_at);
                      const lbl = tier.label === "—" ? "—" : t(`threat.${tier.label}`, { defaultValue: tier.label });
                      return <span className={`badge ${tier.cls} font-semibold`}>{lbl}</span>;
                    })()}
                  </td>
                  <td className="text-end">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => handleApprove(p, "countered")} className="btn-primary text-xs">
                        {t("live.btn_countered", "Countered")}
                      </button>
                      <button onClick={() => handleApprove(p, "hit")} className="btn-warning text-xs">
                        {t("live.btn_hit", "Hit target")}
                      </button>
                      <button onClick={() => handleReject(p)} className="btn-danger text-xs">
                        {t("common.reject", "Reject")}
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
