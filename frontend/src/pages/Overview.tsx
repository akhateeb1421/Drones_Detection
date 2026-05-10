import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, Legend, LabelList, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from "recharts";
import { Analysis, CombinedAttack, RegionStat, TotalCounts, TypeStat } from "../services/api";
import { usePlaceLabel, useTypeLabel, useClassLabel } from "../i18n/places";
import { CountUp } from "../components/CountUp";
import { useAlarmsContext } from "../contexts/AlarmsContext";

// ZeBeyond categorical palette: mint leads, then a tuned mid-rotation that
// stays distinguishable on the green base. Each stop is a different *hue*,
// not a different shade of mint.
// ZeBeyond categorical palette: the three gradient stops lead, then a
// tuned mid-rotation. Each stop is a different *hue*.
const COLORS = [
  "#01F2CF",  // cyan — gradient start
  "#03DA9A",  // mint — gradient mid
  "#03B3DA",  // sky  — gradient end
  "#f5a623",  // amber
  "#ff4757",  // crimson (danger)
  "#a78bfa",  // plum
  "#fb923c",  // pumpkin
  "#facc15",  // sunflower
  "#f472b6",  // rose
  "#7dd17a",  // sage
];

const LTR_STYLE: React.CSSProperties = { direction: "ltr" };
const TOOLTIP_STYLE = {
  background: "#1c302c",
  border: "1px solid rgba(3,218,154,0.4)",
  borderRadius: 8,
  color: "#e7ecdf",
  boxShadow: "0 16px 40px -16px rgba(0,0,0,0.7)",
} as const;
const TOOLTIP_LABEL_STYLE = { color: "#03DA9A", fontWeight: 600 } as const;
const TOOLTIP_ITEM_STYLE = { color: "#e7ecdf" } as const;

function filterMinPercent<T extends { count: number }>(rows: T[], total: number, minPct = 0.01, labelKey: keyof T): T[] {
  if (!total || rows.length === 0) return rows;
  const kept: T[] = [];
  let other = 0;
  for (const r of rows) {
    if (r.count / total >= minPct) kept.push(r);
    else other += r.count;
  }
  if (other > 0) kept.push({ ...rows[0], [labelKey]: "Other", count: other } as T);
  return kept;
}

export function Overview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const placeLabel = usePlaceLabel();
  const typeLabel = useTypeLabel();
  const classLabel = useClassLabel();
  const { history: alarmHistory } = useAlarmsContext();
  const [regions, setRegions] = useState<RegionStat[]>([]);
  const [types, setTypes] = useState<TypeStat[]>([]);
  const [totals, setTotals] = useState<TotalCounts | null>(null);
  const [combined, setCombined] = useState<CombinedAttack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  useEffect(() => {
    Promise.all([Analysis.byRegionPure(), Analysis.byType(), Analysis.total(), Analysis.combined()])
      .then(([r, ty, tot, cmb]) => { setRegions(r); setTypes(ty); setTotals(tot); setCombined(cmb); })
      .catch((e) => setError(String(e)));
  }, []);

  const total = totals ? totals.events : regions.reduce((acc, r) => acc + r.count, 0);
  const regionsAffected = regions.length;
  const totalRows = totals?.rows ?? regions.reduce((acc, r) => acc + r.count, 0);

  const regionsTrim = useMemo(() => filterMinPercent(regions, totalRows, 0.01, "region"), [regions, totalRows]);
  const typesTotal = useMemo(() => types.reduce((a, t) => a + t.count, 0), [types]);
  const typesTrim = useMemo(() => filterMinPercent(types, typesTotal, 0.01, "attack_type"), [types, typesTotal]);
  const combinedTotal = useMemo(() => combined.reduce((a, c) => a + c.count, 0), [combined]);
  const combinedTrim = useMemo(() => filterMinPercent(combined, combinedTotal, 0.01, "label"), [combined, combinedTotal]);

  const regionsTrimDisp = useMemo(() => regionsTrim.map((r) => ({ ...r, region: placeLabel(r.region) })), [regionsTrim, placeLabel]);
  const typesTrimDisp = useMemo(() => typesTrim.map((tt) => ({ ...tt, attack_type: tt.attack_type === "Other" ? placeLabel("Other") : typeLabel(tt.attack_type) })), [typesTrim, typeLabel, placeLabel]);
  const combinedTrimDisp = useMemo(() => combinedTrim.map((c) => ({ ...c, label: c.label === "Other" ? placeLabel("Other") : c.label.split(/\s*\+\s*/).map((part) => placeLabel(part)).join(" + ") })), [combinedTrim, placeLabel]);

  if (error) return <div className="card text-danger">{error}</div>;

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="#1c302c" strokeWidth={2} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 9} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.45} />
      </g>
    );
  };

  const renderPct = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, index } = props;
    if (!percent || percent < 0.04) return null;
    if (index === activeIndex) return null;
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text x={x} y={y} fill="#082522" textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.2 }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const activeRegion = activeIndex >= 0 ? regionsTrim[activeIndex] : null;
  const activeRegionDisp = activeRegion ? placeLabel(activeRegion.region) : null;
  const activePct = activeRegion && totalRows ? (activeRegion.count / totalRows) * 100 : 0;

  return (
    <div className="space-y-4" data-mount>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          <span className="gradient-text">{t("nav.overview")}</span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted font-data">
          <span className="status-dot text-success" style={{ background: "currentColor" }} />
          <span>SYNC</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="label">{t("overview.total_attacks")}</div>
          <div className="metric gradient-text-drift text-5xl leading-none">
            <CountUp value={total} />
          </div>
          {totals && total !== totalRows && (
            <div className="mt-2 text-xs text-muted">{t("overview.points_events", { rows: totalRows, events: total })}</div>
          )}
        </div>
        <div className="card">
          <div className="label">{t("overview.regions")}</div>
          <div className="metric gradient-text-drift text-5xl leading-none">
            <CountUp value={regionsAffected} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="label">{t("overview.by_region")}</div>
            <div className="text-sm font-medium" style={{ minHeight: "1.25rem" }}>
              {activeRegion ? (
                <>
                  <span className="text-slate-200">{activeRegionDisp}</span>
                  <span className="text-accent ml-2 font-semibold tabular">
                    {activeRegion.count} ({activePct.toFixed(1)}%)
                  </span>
                </>
              ) : (
                <span className="text-muted text-xs">{t("overview.hover_hint")}</span>
              )}
            </div>
          </div>
          <div className="h-72 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 16, right: 16, bottom: 8, left: 16 }}>
                <Pie
                  data={regionsTrimDisp} dataKey="count" nameKey="region" cx="50%" cy="48%" outerRadius="68%" innerRadius="40%" paddingAngle={1} label={renderPct} labelLine={false}
                  isAnimationActive={true} animationDuration={800} animationEasing="ease-out"
                  activeIndex={activeIndex >= 0 ? activeIndex : undefined} activeShape={renderActiveShape}
                  onMouseEnter={(_d, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(-1)}
                  // Click-to-drill: jump to History pre-filtered by region.
                  // Uses the un-localized region key from the original row so
                  // the History dropdown matches even when the pie label is
                  // showing the localized version.
                  onClick={(_d, i) => {
                    const r = regionsTrim[i];
                    if (r?.region) navigate(`/history?region=${encodeURIComponent(r.region)}`);
                  }}
                  cursor="pointer"
                >
                  {regionsTrimDisp.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#1c302c" strokeWidth={1.5} />))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(value: number, _name: string, p: { payload?: RegionStat }) => [
                    `${value} (${totalRows ? ((value / totalRows) * 100).toFixed(1) : 0}%)`,
                    p.payload?.region ?? "",
                  ]} />
                <Legend verticalAlign="bottom" height={48} wrapperStyle={{ fontSize: 12, color: "#e7ecdf" }} formatter={(value: string) => <span style={{ color: "#e7ecdf" }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="label">{t("overview.by_type")}</div>
          <div className="h-80 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <BarChart data={typesTrimDisp} margin={{ top: 24, right: 24, bottom: 8, left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(3,218,154,0.10)" />
                <XAxis dataKey="attack_type" stroke="#a8b3a9" tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} />
                <YAxis stroke="#a8b3a9" width={56} tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(3,218,154,0.10)" }} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                <Bar dataKey="count" fill="#03DA9A" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={700} animationEasing="ease-out">
                  <LabelList dataKey="count" position="top" fill="#e7ecdf" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="label">{t("overview.combined")}</div>
        {combinedTrimDisp.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{t("common.no_data")}</div>
        ) : (
          <div className="h-80 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <BarChart data={combinedTrimDisp} layout="vertical" margin={{ top: 16, right: 56, bottom: 8, left: 200 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(3,218,154,0.10)" />
                <XAxis type="number" stroke="#a8b3a9" tick={{ fill: "#b9c4bb", fontSize: 12 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" stroke="#a8b3a9" width={196} tick={{ fill: "#b9c4bb", fontSize: 11 }} tickLine={{ stroke: "#4a5650" }} axisLine={{ stroke: "#4a5650" }} />
                <Tooltip cursor={{ fill: "rgba(245,166,35,0.12)" }} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                <Bar dataKey="count" fill="#f5a623" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={700} animationEasing="ease-out">
                  <LabelList dataKey="count" position="right" fill="#e7ecdf" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Recent Threats — last few alarms from the WebSocket. The history
          comes from AlarmsContext at the app shell, so the same data drives
          the banner up top and this list. */}
      <div className="card">
        <div className="label">{t("overview.recent_threats")}</div>
        {alarmHistory.length === 0 ? (
          <div className="text-sm text-muted py-2">{t("common.no_data")}</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {alarmHistory.slice(0, 6).map((a, i) => (
              <li key={`${a.track_id}-${i}`} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="status-dot text-danger" style={{ background: "currentColor" }} />
                  <div className="truncate">
                    <span className="font-medium">{classLabel(a.drone_class)}</span>
                    <span className="mx-1.5 text-muted">→</span>
                    <span>{a.nearest_area ? placeLabel(a.nearest_area) : "—"}</span>
                  </div>
                </div>
                <div className="text-xs text-muted font-data shrink-0" dir="ltr">
                  {a.eta_s !== null ? `ETA ${a.eta_s.toFixed(1)}s` : "—"}
                  <span className="mx-2 opacity-50">·</span>
                  {t("alarm.score")} {a.score}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
