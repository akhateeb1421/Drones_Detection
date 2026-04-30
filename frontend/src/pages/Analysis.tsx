import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Analysis as AnalysisAPI, Predictions, RegionRisk, ForecastPoint, TimelinePoint } from "../services/api";

export function Analysis() {
  const { t } = useTranslation();
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [risk, setRisk] = useState<RegionRisk[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [horizon, setHorizon] = useState(30);

  useEffect(() => {
    AnalysisAPI.timeline({ granularity: "month" }).then(setTimeline);
  }, []);

  useEffect(() => {
    Predictions.risk({ params: { horizon_days: horizon } }).then(setRisk);
    Predictions.forecast({ days: String(horizon) }).then(setForecast);
  }, [horizon]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-accent">{t("analysis.title")}</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="label">{t("analysis.horizon")}</span>
          <input
            type="number"
            min={7}
            max={120}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="input w-24"
          />
        </label>
      </div>

      <div className="card">
        <div className="label">{t("analysis.timeline")}</div>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={timeline}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="period" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="label">{t("analysis.risk")}</div>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={risk}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="region" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" domain={[0, 1]} />
                <Tooltip />
                <Bar dataKey="risk_probability" fill="#e94560" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-muted">
            {risk.length > 0 && `Method: ${risk[0].method}`}
          </div>
        </div>
        <div className="card">
          <div className="label">{t("analysis.forecast")}</div>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <LineChart data={forecast}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="forecast_date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="expected_count" stroke="#22c55e" dot={false} />
                <Line type="monotone" dataKey="upper" stroke="#22c55e" strokeDasharray="3 3" dot={false} />
                <Line type="monotone" dataKey="lower" stroke="#22c55e" strokeDasharray="3 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
