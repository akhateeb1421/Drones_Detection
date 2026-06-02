import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera } from "../services/api";
import { useBilingualName } from "../i18n/places";

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

export function WeatherPanel({ camera }: { camera: Camera | null }) {
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
        setW({ tempC: Number(cw.temperature), windKmh: Number(cw.windspeed), code: Number(cw.weathercode), isDay: cw.is_day === 1 || cw.is_day === true });
      })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [camera?.id]);

  if (!camera) return null;

  const cond   = w ? wmoCondition(w.code, w.isDay) : null;
  const status = w ? detectionStatus(w.code, w.windKmh) : null;
  const statusColor =
    status === "optimal"  ? "var(--primary)" :
    status === "degraded" ? "var(--chart-5)" :
    status === "poor"     ? "var(--destructive)" : "var(--primary)";

  if (err) return <div className="card" style={{ fontSize:13, color:"var(--muted-foreground)", textAlign:"center" }}>{t("common.error")}</div>;
  if (!w)  return <div className="card" style={{ fontSize:13, color:"var(--muted-foreground)", textAlign:"center" }}>{t("common.loading")}</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div className="label" style={{ marginBottom:0 }}>
          {t("live.weather")} · {bilingualName(camera)} {cond ? cond.glyph : ""}
        </div>
        {status && (
          <span style={{
            fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:9999,
            background:`oklch(from ${statusColor} l c h / 0.12)`,
            color:statusColor,
            border:`1px solid oklch(from ${statusColor} l c h / 0.30)`,
            textTransform:"uppercase", letterSpacing:"0.10em",
          }}>
            {t(`live.weather_status_${status}`)}
          </span>
        )}
      </div>

      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_condition")}</span>
          <div className="w-value" style={{ color:statusColor }}>
            {`${t(`live.weather_cond_${cond?.key ?? "unknown"}`)} ${cond?.glyph ?? ""}`.trim()}
          </div>
        </div>
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_temp")}</span>
          <div className="w-value">{Math.round(w.tempC)}°C</div>
        </div>
        <div className="weather-mini-card">
          <span className="w-label">{t("live.weather_wind")}</span>
          <div className="w-value" dir="ltr">{Math.round(w.windKmh)} km/h</div>
        </div>
      </div>

      {status && (
        <div style={{
          padding:"9px 14px", borderRadius:"var(--radius)",
          background:`oklch(from ${statusColor} l c h / 0.08)`,
          border:`1px solid oklch(from ${statusColor} l c h / 0.25)`,
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