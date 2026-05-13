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

/* ── Weather panel ──────────────────────────────────────────────────
 * Live current-weather readout pulled from Open-Meteo (keyless, free)
 * for the selected camera's coordinates. Surfaces a detection-quality
 * verdict so the operator can tell at a glance whether visibility is
 * good enough to trust EO frames. Brand palette: mint→teal→sky.
 * ─────────────────────────────────────────────────────────────────── */

/** Map WMO weather codes to a label key + an emoji glyph. The label
 *  key resolves through i18n so we get Arabic/English copy for free. */
function wmoCondition(code: number, isDay: boolean): { key: string; glyph: string } {
  if (code === 0) return { key: "clear", glyph: isDay ? "☀" : "🌙" };
  if (code === 1) return { key: "mostly_clear", glyph: isDay ? "🌤" : "🌙" };
  if (code === 2) return { key: "partly_cloudy", glyph: "⛅" };
  if (code === 3) return { key: "cloudy", glyph: "☁" };
  if (code === 45 || code === 48) return { key: "fog", glyph: "🌫" };
  if (code >= 51 && code <= 57) return { key: "drizzle", glyph: "🌦" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { key: "rain", glyph: "🌧" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: "snow", glyph: "❄" };
  if (code >= 95 && code <= 99) return { key: "storm", glyph: "⛈" };
  return { key: "unknown", glyph: "" };
}

/** Detection-quality verdict — drives the colored status pill + footer. */
function detectionStatus(code: number, windKmh: number): "optimal" | "degraded" | "poor" {
  // Storm / heavy rain / snow / fog / very strong wind → poor visibility
  if ([45, 48, 95, 96, 99, 71, 73, 75, 77, 65, 67, 82, 86].includes(code) || windKmh >= 35) return "poor";
  // Light precip, overcast, or moderate wind → degraded but still usable
  if ([3, 51, 53, 55, 56, 57, 61, 63, 66, 80, 81, 85].includes(code) || windKmh >= 20) return "degraded";
  return "optimal";
}

type Weather = { tempC: number; windKmh: number; code: number; isDay: boolean };

function WeatherPanel({ camera }: { camera: Camera | null }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const bilingualName = useBilingualName();
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Re-fetch whenever the operator selects a different camera. Open-Meteo
  // refreshes its `current_weather` block once per ~15 min, so we don't
  // poll — one fetch per camera switch is plenty.
  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    setW(null); setErr(null);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${camera.latitude}` +
      `&longitude=${camera.longitude}&current_weather=true` +
      `&windspeed_unit=kmh&temperature_unit=celsius`;
    fetch(url)
      .then((r) => r.json())
      .then((d: any) => {
        if (cancelled) return;
        const cw = d?.current_weather;
        if (!cw) throw new Error("no_data");
        setW({
          tempC: Number(cw.temperature),
          windKmh: Number(cw.windspeed),
          code: Number(cw.weathercode),
          isDay: cw.is_day === 1 || cw.is_day === true,
        });
      })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [camera?.id]);

  if (!camera) return null;

  // Brand tones used for background tints, borders, and tile hairlines.
  // All TEXT inside the panel uses INK so the copy reads as one tone.
  // INK flips with the theme: deep teal-black on light cards, pure
  // white on dark cards so the copy stays readable against the navy
  // gradient.
  const C_MINT = "#01F2CF";
  const C_SKY  = "#03B3DA";
  const C_WARN = "#fbbf24";
  const C_DANG = "#f87171";
  const INK    = theme === "dark" ? "#ffffff" : "#0b2422";

  const cond = w ? wmoCondition(w.code, w.isDay) : null;
  const status = w ? detectionStatus(w.code, w.windKmh) : null;
  const statusColor =
    status === "optimal"  ? C_MINT :
    status === "degraded" ? C_WARN :
    status === "poor"     ? C_DANG : C_MINT;

  // Camera label — use the bilingual helper so the chip reads the
  // Arabic `name_ar` when the UI is in Arabic and the row provides one,
  // and falls back to the English `name` otherwise. We avoid forcing
  // upper-case because Arabic has no letter case.
  const camChip = bilingualName(camera);

  return (
    <div className="card" style={{ padding: "clamp(14px,1.8vw,18px)" }}>
      {/* Header row — WEATHER · <camera> on the right, condition glyph on the far right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Status pill on the left — chrome (bg/border) keeps the
              brand status color so the pill still reads as a verdict,
              but the text itself is INK (#0b2422). */}
          {status && (
            <span
              className="badge"
              style={{
                background: `${statusColor}1F`,
                color: INK,
                border: `0.5px solid ${statusColor}55`,
                textTransform: "uppercase",
                letterSpacing: "0.10em",
                fontSize: 11,
              }}
            >
              {t(`live.weather_status_${status}`)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: INK, textTransform: "uppercase" }}>
          <span>{t("live.weather")}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{camChip}</span>
          {cond && <span style={{ fontSize: 18, marginInlineStart: 4 }} aria-hidden>{cond.glyph}</span>}
        </div>
      </div>

      {/* Three metric tiles */}
      {err ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: INK, fontSize: 13 }}>
          {t("common.error")}
        </div>
      ) : !w ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: INK, fontSize: 13 }}>
          {t("common.loading")}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <WTile
            label={t("live.weather_wind")}
            value={`${Math.round(w.windKmh)} km/h`}
            accent={C_SKY}
          />
          <WTile
            label={t("live.weather_temp")}
            value={`${Math.round(w.tempC)}°C`}
            accent={C_MINT}
          />
          <WTile
            label={t("live.weather_condition")}
            value={`${t(`live.weather_cond_${cond?.key ?? "unknown"}`)} ${cond?.glyph ?? ""}`.trim()}
            accent={statusColor}
          />
        </div>
      )}

      {/* Detection-quality footer strip — chrome uses the status color
          (subtle tint + border), text is INK (#0b2422). */}
      {w && status && (
        <div
          style={{
            marginTop: 10,
            padding: "9px 14px",
            borderRadius: 12,
            background: `${statusColor}12`,
            border: `0.5px solid ${statusColor}33`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            color: INK,
            fontWeight: 600,
          }}
        >
          <span>{t(`live.weather_caption_${status}`)}</span>
          <span aria-hidden>{status === "optimal" ? "✓" : status === "degraded" ? "!" : "✗"}</span>
        </div>
      )}
    </div>
  );
}

/** Single metric tile inside the weather panel — label on top, big value below. */
function WTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  // Theme-aware text color so the tile copy is readable on both the
  // navy dark card and the white light card. Mirrors INK in the parent.
  const { theme } = useTheme();
  const ink = theme === "dark" ? "#ffffff" : "#0b2422";
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "0.5px solid var(--border-subtle)",
        borderRadius: 12,
        padding: "12px 14px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }} aria-hidden />
      <div style={{ fontSize: 10, fontWeight: 700, color: ink, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: "clamp(14px,1.6vw,17px)", fontWeight: 800, color: ink }} dir="ltr">
        {value}
      </div>
    </div>
  );
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

  // Pick the most recent HOSTILE track to drive the "details" panel +
  // map focus. Birds/airplanes/helicopters are filtered out — this is a
  // counter-drone display, so the focused track must be a real threat.
  const focused: Snapshot | null = useMemo(() => {
    const hostile = Array.from(tracks.values()).filter((s) => isHostileClass(s.droneClass));
    if (hostile.length === 0) return null;
    return hostile.reduce<Snapshot>((acc, s) => (s.lastSeenMs > acc.lastSeenMs ? s : acc), hostile[0]);
  }, [tracks]);

  // `focused` is already hostile by construction. The flag is kept for
  // clarity at the call sites that previously used it as a guard.
  const focusedIsHostile = focused != null;

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
      // Counter-drone display: skip birds, airplanes, helicopters, and
      // anything else that isn't a hostile drone. Otherwise the map and
      // its predicted-position dots end up cluttered with non-threats.
      if (!isHostileClass(s.droneClass)) return;
      const elapsedS = (now - s.lastSeenMs) / 1000;
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
          // Predicted-now ghost dot — amber. Distinct from the sky-cyan
          // predicted path line, the purple intercept marker, and the
          // mint friendly assets. Amber reads as "where the drone is
          // RIGHT NOW (extrapolated)" — a warning-tier indicator.
          color: "#fbbf24",
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
                interceptPoint={showIntercept ? interceptForMap : null}
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
          const visiblePending = pending.filter((p) => isHostileClass(p.voted_class));
          if (visiblePending.length === 0) {
            return <div className="text-sm text-muted">{t("common.no_data")}</div>;
          }
          return (
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
              {visiblePending.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-start">
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
