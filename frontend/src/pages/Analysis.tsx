import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Analysis as AnalysisAPI, Predictions, ForecastPoint, TimelinePoint } from "../services/api";
import { usePlaceLabel } from "../i18n/places";

const LTR_STYLE: React.CSSProperties = { direction: "ltr" };

const TOOLTIP_STYLE = {
  background: "#0e1a14",
  border: "1px solid rgba(3,218,154,0.4)",
  borderRadius: 8,
  color: "#e7ecdf",
  boxShadow: "0 16px 40px -16px rgba(0,0,0,0.7)",
} as const;
const TOOLTIP_LABEL_STYLE = { color: "#03DA9A", fontWeight: 600 } as const;
const TOOLTIP_ITEM_STYLE = { color: "#e7ecdf" } as const;

const REGION_COLORS = ["#01F2CF", "#03DA9A", "#03B3DA", "#f5a623", "#ff4757", "#a78bfa", "#fb923c", "#facc15"];

function isoDay(s: string): string {
  if (!s) return "";
  const i = s.indexOf("T");
  return i > 0 ? s.slice(0, i) : s.slice(0, 10);
}

export function Analysis() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [horizon, setHorizon] = useState(30);

  useEffect(() => { AnalysisAPI.timeline({ granularity: "month" }).then(setTimeline); }, []);
  useEffect(() => { Predictions.forecast({ days: String(horizon) }).then(setForecast); }, [horizon]);

  const forecastWide = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const regionSet = new Set<string>();
    for (const p of forecast) {
      const d = isoDay(p.forecast_date);
      if (!byDate[d]) byDate[d] = { date: 0 } as any;
      (byDate[d] as any).date = d;
      (byDate[d] as any)[p.region] = Number(p.expected_count.toFixed(2));
      regionSet.add(p.region);
    }
    const rows = Object.values(byDate).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    return { rows, regions: Array.from(regionSet) };
  }, [forecast]);

  const timelineFmt = useMemo(() => timeline.map((tp) => ({ ...tp, period: isoDay(tp.period) })), [timeline]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold gradient-text">{t("analysis.title")}</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="label">{t("analysis.horizon")}</span>
          <input type="number" min={7} max={120} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="input w-24" />
        </label>
      </div>

      <div className="card">
        <div className="label">{t("analysis.timeline")}</div>
        <div className="h-72 w-full" style={LTR_STYLE}>
          <ResponsiveContainer>
            <LineChart data={timelineFmt} margin={{ top: 16, right: 24, bottom: 8, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(3,218,154,0.10)" />
              <XAxis dataKey="period" stroke="#a8b3a9" tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} />
              <YAxis stroke="#a8b3a9" width={48} tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#e7ecdf" }} formatter={(value: string) => <span style={{ color: "#e7ecdf" }}>{value}</span>} />
              <Line type="monotone" dataKey="count" name={t("analysis.count")} stroke="#03DA9A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <div className="label">{t("analysis.forecast")}</div>
          <div className="text-xs text-muted">{t("analysis.forecast_help", { days: horizon })}</div>
        </div>
        <div className="h-96 w-full" style={LTR_STYLE}>
          {forecastWide.rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted text-sm">{t("common.no_data")}</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={forecastWide.rows} margin={{ top: 16, right: 24, bottom: 8, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(3,218,154,0.10)" />
                <XAxis dataKey="date" stroke="#a8b3a9" tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} minTickGap={24} />
                <YAxis stroke="#a8b3a9" width={48} tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} allowDecimals={true} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(value: number, name: string) => [Number(value).toFixed(2), name]} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#e7ecdf" }} formatter={(value: string) => <span style={{ color: "#e7ecdf" }}>{value}</span>} />
                {forecastWide.regions.map((region, i) => (
                  <Line key={region} type="monotone" dataKey={region} name={placeLabel(region)} stroke={REGION_COLORS[i % REGION_COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
