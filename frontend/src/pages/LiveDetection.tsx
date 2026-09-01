import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera, Detections, Track, Areas, Area, trackThumbUrl } from "../services/api";
import { useLiveStream } from "../hooks/useLiveStream";
import { useTrackStore, Snapshot } from "../hooks/useTrackStore";
import { useAlarmsContext } from "../contexts/AlarmsContext";
import { DroneMap } from "../components/DroneMap";
import { WeatherPanel } from "../components/WeatherPanel";
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
//
// IMPORTANT: include every spelling the YOLO model can emit. The current
// model exports Bird / shahed_136 / orlan / Airplane / Helicopter / dji
// — so `shahed_136`, `orlan`, and `dji` are the hostile labels. Older
// spellings are kept so legacy training runs still match.
const HOSTILE_CLASSES = new Set([
  "shahed",
  "shahed_136",
  "shahed-136",
  "shahed136",
  "orlan",
  "orlan-10",
  "orlan10",
  "orlan_10",
  "dji",
  "drone",
]);

/** True if the class name is one of the hostile drone types we render
 *  on the live map and queue for human approval. Birds, airplanes,
 *  helicopters, and unknown labels are filtered out. */
function isHostileClass(cls: string | null | undefined): boolean {
  return HOSTILE_CLASSES.has(String(cls ?? "").toLowerCase().trim());
}

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

  // Pending approvals are polled. Previously the first fetch ran only
  // after 5s, so a freshly-detected drone would appear to "flash and
  // disappear" — the alarm banner and the focused track would update
  // instantly off the WebSocket stream while the pending table sat
  // empty until the first poll landed. Two changes:
  //   1. Fetch once on mount so the table is populated immediately.
  //   2. Poll faster (2 s) so newly-created tracks surface within ~1 s
  //      of the alarm rather than waiting the full 5 s window.
  // We also guard against a flaky response transiently emptying the
  // local list — if the server returns [] but we had rows a moment ago,
  // we keep showing them for one more cycle so a single failed/empty
  // response doesn't make the table flash. Confirmed empty after two
  // consecutive empties.
  useEffect(() => {
    let cancelled = false;
    let emptyHits = 0;
    const fetchOnce = () => {
      Detections.pendingTracks()
        .then((rows) => {
          if (cancelled) return;
          if (rows.length === 0) {
            emptyHits++;
            // Only clear after we've seen two empties in a row. Avoids
            // a single hiccup wiping the table for the operator.
            if (emptyHits >= 2) setPending([]);
            return;
          }
          emptyHits = 0;
          setPending(rows);
        })
        .catch(() => { /* swallow — never wipe local state on error */ });
    };
    fetchOnce();                             // immediate
    const i = setInterval(fetchOnce, 2000);  // every 2 s
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const { imageUrl, meta, connected } = useLiveStream(selected);

  // Persist the most recent detection per track. Backed by the
  // module-level store (useTrackStore) keyed on the selected camera so
  // the tracked drones — and the predicted-path line drawn from them —
  // survive navigating away from this page and back. Component-local
  // useState reset to an empty Map on every remount, which is what made
  // the predicted line vanish when the operator switched dashboard tabs.
  const [tracks, setTracks] = useTrackStore(selected);

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
          speedStdMps: d.speed_std_mps,
          headingStdDeg: d.heading_std_deg,
          positionSource: d.position_source,
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

  // ─── Track lifetime ────────────────────────────────────────────────
  // Tracks live in the module-level store (useTrackStore), so they survive
  // navigating between dashboard sections — that's what fixed the original
  // "predicted line vanishes when I switch sections" bug.
  //
  // Expiry is pure WALL-CLOCK and lazy: a track (and everything tied to it —
  // line, intercept point, both map dots, details panel) is shown only
  // while `Date.now() - lastSeenMs < PREDICT_HORIZON_S`, evaluated in the
  // `useMemo`s below and re-checked every `tick` (200 ms). We deliberately
  // do NOT pause or rewind that clock while the section is hidden: the
  // predicted-now ghost dot must keep advancing along the line in real
  // time, so when you return it sits at the LIVE predicted position rather
  // than frozen where you left it (and it never replays "from the start").
  // A track that genuinely goes PREDICT_HORIZON_S without a detection clears
  // completely and stays cleared until a fresh detection arrives.

  // Pick the most recent NON-EXPIRED HOSTILE track to drive the details
  // panel + map focus. Birds/airplanes/helicopters are filtered out — this
  // is a counter-drone display. The `tick` dependency re-evaluates expiry
  // over time so the focused track (and everything derived from it) clears
  // ~200 ms after it crosses the horizon.
  const focused: Snapshot | null = useMemo(() => {
    const now = Date.now();
    const hostile = Array.from(tracks.values()).filter(
      (s) => isHostileClass(s.droneClass) && now - s.lastSeenMs < PREDICT_HORIZON_S * 1000,
    );
    if (hostile.length === 0) return null;
    return hostile.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), hostile[0]);
  }, [tracks, tick]);

  // `focused` is already hostile by construction. The flag is kept for
  // clarity at the call sites that previously used it as a guard.
  const focusedIsHostile = focused != null;

  const predictedPath = useMemo(() => {
    if (!focused || !focusedIsHostile) return null;
    const end = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg, PREDICT_HORIZON_S);
    return [[focused.lat, focused.lon] as [number, number], end];
  }, [focused, focusedIsHostile]);

  // Uncertainty cone: the Kalman filter reports a 1-sigma heading error;
  // fan the predicted path out by ±sigma so the operator sees an honest
  // "somewhere in this wedge" instead of a false-precision single line.
  // Clamped to [4°, 45°] — below 4° the cone is invisible, above 45° the
  // heading is meaningless and the wedge would swallow the map.
  const predictedCone = useMemo<[number, number][] | null>(() => {
    if (!focused || !focusedIsHostile || focused.speedMps < 0.5) return null;
    const sigma = Math.min(Math.max(focused.headingStdDeg ?? 25, 4), 45);
    if (sigma >= 45) return null;
    // Outer edge reaches slightly farther than the centre line when the
    // speed itself is uncertain.
    const dist = (focused.speedMps + (focused.speedStdMps ?? 0)) * PREDICT_HORIZON_S;
    const seconds = dist / Math.max(focused.speedMps, 0.1);
    const left = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg - sigma, seconds);
    const right = projectPath(focused.lat, focused.lon, focused.speedMps, focused.angleDeg + sigma, seconds);
    return [[focused.lat, focused.lon], left, right];
  }, [focused, focusedIsHostile]);

  // Auto-zoom: when a hostile drone is being tracked, fit the map to the
  // detecting camera + the drone + the end of the predicted path. This
  // gives the operator a tight regional view of "where the threat is,
  // where it came from, where it's headed" without forcing a manual
  // pan/zoom every time an alarm fires.
  //
  // The detecting camera is the currently-selected one because the
  // `focused` snapshot is fed by the WebSocket stream of `selected`.
  // (Cross-camera handoffs collapse onto the original track via the
  // backend's link_root_camera_id, but the live preview always shows
  // whichever camera the operator has open.) DroneMap fits these
  // points with padding and a maxZoom cap, so we won't zoom past
  // street level even when the drone is right on top of the camera.
  const focusBounds = useMemo<[number, number][] | null>(() => {
    if (!focused || !focusedIsHostile) return null;
    const cam = cameras.find((c) => c.id === selected);
    if (!cam) return null;
    const pts: [number, number][] = [
      [cam.latitude, cam.longitude],
      [focused.lat, focused.lon],
    ];
    if (predictedPath && predictedPath.length >= 2) {
      // predictedPath[1] is the projected end point PREDICT_HORIZON_S
      // seconds ahead. Including it ensures the map keeps the full
      // dashed path visible after fitBounds.
      pts.push(predictedPath[1] as [number, number]);
    }
    return pts;
  }, [focused, focusedIsHostile, cameras, selected, predictedPath]);

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
      // Counter-drone display: skip birds, airplanes, helicopters, and
      // anything else that isn't a hostile drone. Otherwise the map and
      // its predicted-position dots end up cluttered with non-threats.
      if (!isHostileClass(s.droneClass)) return;
      const elapsedS = (now - s.lastSeenMs) / 1000;
      // Track lost (no detection for the full horizon) — drop ALL of its
      // markers so the map clears in step with the predicted line, the
      // intercept point, and the focused-details panel.
      if (elapsedS > PREDICT_HORIZON_S) return;
      const isStale = elapsedS > 0.5;
      // Brand triad palette: crimson stays for Shahed-class threats so
      // the operator can spot them at a glance; non-Shahed hostiles use
      // primary cyan, the same accent color the rest of the dashboard
      // chrome uses. Reads consistently against the dark map tiles.
      const baseColor = String(s.droneClass ?? "").toLowerCase().includes("shahed") ? "#ff4757" : "#01F2CF";

      // Last confirmed sighting (solid)
      items.push({
        id: `seen-${s.trackId}`,
        lat: s.lat,
        lon: s.lon,
        color: baseColor,
        label: `#${s.trackId} ${s.droneClass} ${(s.confidence * 100).toFixed(0)}% — last seen ${elapsedS.toFixed(1)}s ago`,
        radius: 8,
      });

      // Animated predicted-now ghost dot — slides along the predicted
      // path as the track ages (only while stale, i.e. between live
      // sightings). Bounded by the horizon check above, so it never
      // extrapolates beyond the end of the predicted-path line.
      if (isStale && s.speedMps > 0.1) {
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
          // Predicted-now ghost dot — amber. Distinct from the sky-cyan
          // predicted path line, the purple intercept marker, and the
          // mint friendly assets. Amber reads as "where the drone is
          // RIGHT NOW (extrapolated)" — a warning-tier indicator.
          color: "#fbbf24",
          label: `#${s.trackId} predicted at +${elapsedS.toFixed(0)}s (${(s.speedMps * 3.6).toFixed(0)} km/h ${s.direction})`,
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
    return { label: "—", cls: "badge-muted" };
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
        <h1 className="text-xl font-semibold">{t("live.title")}</h1>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? "bg-success text-white" : "badge-muted"}`}>
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
          {/* Left column — camera feed + focused-detection details, with
              a live Weather panel pinned underneath so the operator can
              see at a glance whether visibility is good for the EO frame. */}
          <div className="flex flex-col gap-4">
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
                  <div><span className="label inline">{t("live.speed")}</span> <span className="font-data" dir="ltr">{(focused.speedMps * 3.6).toFixed(0)} km/h</span></div>
                  <div><span className="label inline">{t("live.direction")}</span> {focused.direction}</div>
                  <div><span className="label inline">{t("live.nearest_area")}</span> {placeLabel(focused.nearestArea)}</div>
                  <div><span className="label inline">{t("live.lat")}</span> <span className="font-data" dir="ltr">{focused.lat.toFixed(5)}</span></div>
                  <div><span className="label inline">{t("live.lon")}</span> <span className="font-data" dir="ltr">{focused.lon.toFixed(5)}</span></div>
                  <div><span className="label inline">{t("live.eta")}</span> <span className="font-data" dir="ltr">{focused.etaS !== null ? `${focused.etaS.toFixed(1)}s` : "—"}</span></div>
                  {focused.positionSource === "triangulated" && (
                    <div className="col-span-2">
                      <span className="badge badge-accent">{t("live.triangulated", "Position: two-camera triangulated fix")}</span>
                    </div>
                  )}
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
          {/* Weather panel — Open-Meteo readout for the selected camera. */}
          <WeatherPanel camera={cameras.find((c) => c.id === selected) ?? null} />
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
                      : "border-slate-700 bg-slate-900/50 text-muted hover:text-slate-200",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#03DA9A" }} aria-hidden />
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
                      : "border-slate-700 bg-slate-900/50 text-muted hover:text-slate-200",
                  ].join(" ")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "#03DA9A" }} aria-hidden />
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
                      : "border-slate-700 bg-slate-900/50 text-muted hover:text-slate-200",
                  ].join(" ")}
                >
                  {/* Match the purple intercept marker on the map so
                      the legend dot and the map dot agree. */}
                  <span className="h-2 w-2 rounded-full" style={{ background: "#a78bfa" }} aria-hidden />
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
                predictedCone={predictedCone}
                interceptPoint={showIntercept ? interceptForMap : null}
                focusBounds={focusBounds}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="label">{t("live.pending_approvals")}</div>
        </div>
        {/* Pending approvals shows ONLY hostile classes (DJI, Shahed,
            Orlan, generic drone). Birds, airplanes, helicopters never
            warrant operator review — they can't fire an alarm anyway
            (see alarms.HOSTILE_CLASSES) so they're filtered out of the
            queue entirely. Any new hostile track surfaces immediately
            because backend/pipeline.py writes every new track with
            status="pending" the first frame it sees it, regardless of
            whether the threat-score gate fired an alarm. */}
        {(() => {
          // Sort by track_id ascending so the queue reads 1, 2, 3, 4, 5…
          // instead of the recency order the backend returns (it orders
          // by last_seen_at, so a re-detected track floats to the top and
          // the # column jumps around). Tiebreak on camera_id for
          // cross-camera track_id collisions.
          const visiblePending = pending
            .filter((p) => isHostileClass(p.voted_class))
            .sort((a, b) => a.track_id - b.track_id || a.camera_id - b.camera_id);
          if (visiblePending.length === 0) {
            return <div className="text-sm text-muted">{t("common.no_data")}</div>;
          }
          return (
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 w-20 text-start">{t("live.thumb")}</th>
                <th className="text-start min-w-[180px]">{t("live.description", "Description")}</th>
                <th className="text-start">#</th>
                <th className="text-start">{t("live.drone_class")}</th>
                <th className="text-start">{t("live.nearest_area")}</th>
                <th className="text-start">{t("live.eta")}</th>
                <th className="text-start">{t("live.threat_level")}</th>
                <th className="text-end"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visiblePending.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-start">
                    {/* The img is keyed by thumbnail_path so a fresh
                        file (atomic rename happened on the backend)
                        forces a brand-new <img> with no stale DOM
                        state. We DO NOT use an onError that mutates
                        style.display directly — React doesn\'t know
                        about that DOM mutation, so the element would
                        stay invisible forever even when subsequent
                        polls had a valid file. Instead, if the path
                        is null (server already verified file is
                        missing in the API), we render the placeholder
                        dash. Native broken-image icon is the worst-
                        case if the file vanishes between API response
                        and browser fetch — still visible, no permanent
                        hidden state. */}
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
                  {/* Moondream2 VLM caption of the thumbnail. May be
                      null/empty for a few seconds after a track first
                      appears while background inference runs; we show
                      a subtle placeholder in that case so the column
                      width doesn't jump around. */}
                  <td className="text-start text-xs text-slate-300 align-middle" style={{ maxWidth: 280 }}>
                    {p.description
                      ? <span style={{ display: "inline-block", lineHeight: 1.35 }}>{p.description}</span>
                      : <span className="text-muted italic">{t("live.description_loading", "...")}</span>}
                  </td>
                  <td className="text-start font-data"><span dir="ltr">#{p.track_id}</span></td>
                  <td className="text-start">{classLabel(p.voted_class)}</td>
                  <td className="text-start">{placeLabel(p.nearest_area)}</td>
                  <td className="text-start font-data"><span dir="ltr">{p.min_eta_s !== null ? `${p.min_eta_s?.toFixed(1)}s` : "—"}</span></td>
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
          );
        })()}
      </div>
    </div>
  );
}
