import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera } from "../services/api";
import { useTheme } from "../contexts/ThemeContext";
import { useBilingualName } from "../i18n/places";

/* ── WeatherPanel ───────────────────────────────────────────────────
 * Live current-weather readout pulled from Open-Meteo (keyless, free)
 * for the selected camera's coordinates. Surfaces a detection-quality
 * verdict so the operator can tell at a glance whether visibility is
 * good enough to trust EO frames. Brand palette: mint→teal→sky.
 *
 * Originally defined inline inside LiveDetection.tsx; pulled out here
 * so the RecordedClip page can use the exact same panel without
 * duplicating ~200 lines of weather logic.
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

export function WeatherPanel({ camera }: { camera: Camera | null }) {
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
  }, [camera?.id, camera?.latitude, camera?.longitude]);

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

  const camChip = bilingualName(camera);

  return (
    <div className="card" style={{ padding: "clamp(14px,1.8vw,18px)" }}>
      {/* Header row — WEATHER · <camera> on the right, condition glyph on the far right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <WTile label={t("live.weather_wind")} value={`${Math.round(w.windKmh)} km/h`} accent={C_SKY} />
          <WTile label={t("live.weather_temp")} value={`${Math.round(w.tempC)}°C`} accent={C_MINT} />
          <WTile
            label={t("live.weather_condition")}
            value={`${t(`live.weather_cond_${cond?.key ?? "unknown"}`)} ${cond?.glyph ?? ""}`.trim()}
            accent={statusColor}
          />
        </div>
      )}

      {/* Detection-quality footer strip */}
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
