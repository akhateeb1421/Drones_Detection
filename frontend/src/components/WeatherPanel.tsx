import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera } from "../services/api";
import { useBilingualName } from "../i18n/places";

/** Map WMO weather codes to a label key + an emoji glyph. */
function wmoCondition(code: number, isDay: boolean): { key: string; glyph: string } {
  if (code === 0)  return { key:"clear",         glyph: isDay ? "☀" : "🌙" };
  if (code === 1)  return { key:"mostly_clear",  glyph: isDay ? "🌤" : "🌙" };
  if (code === 2)  return { key:"partly_cloudy", glyph: "⛅" };
  if (code === 3)  return { key:"cloudy",        glyph: "☁" };
  if (code === 45 || code === 48) return { key:"fog",     glyph: "🌫" };
  if (code >= 51 && code <= 57)   return { key:"drizzle", glyph: "🌦" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { key:"rain", glyph: "🌧" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key:"snow", glyph: "❄" };
  if (code >= 95 && code <= 99)   return { key:"storm",   glyph: "⛈" };
  return { key:"unknown", glyph: "🌡" };
}

function detectionStatus(code: number, windKmh: number): "optimal" | "degraded" | "poor" {
  if ([45,48,95,96,99,71,73,75,77,65,67,82,86].includes(code) || windKmh >= 35) return "poor";
  if ([3,51,53,55,56,57,61,63,66,80,81,85].includes(code) || windKmh >= 20) return "degraded";
  return "optimal";
}

type Weather = { tempC: number; windKmh: number; code: number; isDay: boolean };

interface Props { camera: Camera | null; }

/**
 * Unified weather card — ALL three metrics (Status, Temp, Wind) in
 * ONE single glassmorphic card with a 3-column grid separated by thin
 * vertical dividers instead of separate isolated boxes.
 */
export function WeatherPanel({ camera }: Props) {
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

  /* Status colors via var(--*) tokens — no hardcoded hex */
  const statusColor =
    status === "optimal"  ? "var(--primary)" :
    status === "degraded" ? "var(--chart-5)" :
    status === "poor"     ? "var(--destructive)" : "var(--primary)";

  const camLabel = bilingualName(camera);

  return (
    /* ONE unified glassmorphic card */
    <div className="weather-unified-card">

      {/* Card header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:14, flexWrap:"wrap", gap:8,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {status && (
            <span style={{
              fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:9999,
              textTransform:"uppercase", letterSpacing:"0.10em",
              background:`oklch(from ${statusColor} l c h / 0.12)`,
              color:statusColor,
              border:`1px solid oklch(from ${statusColor} l c h / 0.28)`,
            }}>
              {t(`live.weather_status_${status}`)}
            </span>
          )}
        </div>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"var(--muted-foreground)", textTransform:"uppercase", display:"flex", alignItems:"center", gap:8 }}>
          <span>{t("live.weather")}</span>
          <span style={{ opacity:0.4 }}>·</span>
          <span>{camLabel}</span>
          {cond && <span style={{ fontSize:18 }} aria-hidden>{cond.glyph}</span>}
        </div>
      </div>

      {/* Body */}
      {err ? (
        <div style={{ padding:"20px 0", textAlign:"center", color:"var(--muted-foreground)", fontSize:13 }}>
          {t("common.error")}
        </div>
      ) : !w ? (
        <div style={{ padding:"20px 0", textAlign:"center", color:"var(--muted-foreground)", fontSize:13 }}>
          {t("common.loading")}
        </div>
      ) : (
        /*
          3-COLUMN GRID inside the single card.
          Separated by thin vertical dividers via .weather-metric-cell + .weather-metric-cell::before
          (see index.css) — not isolated boxes.
        */
        <div className="weather-metrics-grid">
          {/* الحالة — Status/Condition */}
          <div className="weather-metric-cell">
            <span className="weather-metric-label">{t("live.weather_condition")}</span>
            <div className="weather-metric-value" style={{ color:statusColor }}>
              {`${t(`live.weather_cond_${cond?.key ?? "unknown"}`)} ${cond?.glyph ?? ""}`.trim()}
            </div>
          </div>

          {/* الحرارة — Temperature */}
          <div className="weather-metric-cell">
            <span className="weather-metric-label">{t("live.weather_temp")}</span>
            <div className="weather-metric-value" dir="ltr">
              {Math.round(w.tempC)}°C
            </div>
          </div>

          {/* سرعة الرياح — Wind Speed */}
          <div className="weather-metric-cell">
            <span className="weather-metric-label">{t("live.weather_wind")}</span>
            <div className="weather-metric-value" dir="ltr">
              {Math.round(w.windKmh)} <span style={{ fontSize:"0.65em", fontWeight:600, color:"var(--muted-foreground)" }}>km/h</span>
            </div>
          </div>
        </div>
      )}

      {/* Detection quality footer */}
      {w && status && (
        <div style={{
          marginTop:14, padding:"10px 16px", borderRadius:"var(--radius)",
          background:`oklch(from ${statusColor} l c h / 0.08)`,
          border:`1px solid oklch(from ${statusColor} l c h / 0.22)`,
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
