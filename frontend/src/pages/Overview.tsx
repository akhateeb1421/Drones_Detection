import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Analysis, CombinedAttack, RegionStat, TotalCounts, TypeStat } from "../services/api";

const COLORS = [
  "#0369a1",
  "#e94560",
  "#f5a623",
  "#22c55e",
  "#a855f7",
  "#1abc9c",
  "#e67e22",
  "#3498db",
  "#ec4899",
  "#84cc16",
];

const LTR_STYLE: React.CSSProperties = { direction: "ltr" };

const TOOLTIP_STYLE = {
  background: "#0a0f1e",
  border: "1px solid #1e3a5f",
  borderRadius: 8,
  color: "#e2e8f0",
} as const;
const TOOLTIP_LABEL_STYLE = { color: "#38bdf8", fontWeight: 600 } as const;
const TOOLTIP_ITEM_STYLE = { color: "#e2e8f0" } as const;

function filterMinPercent<T extends { count: number }>(
  rows: T[],
  total: number,
  minPct = 0.01,
  labelKey: keyof T,
): T[] {
  if (!total || rows.length === 0) return rows;
  const kept: T[] = [];
  let other = 0;
  for (const r of rows) {
    if (r.count / total >= minPct) {
      kept.push(r);
    } else {
      other += r.count;
    }
  }
  if (other > 0) {
    kept.push({ ...rows[0], [labelKey]: "Other", count: other } as T);
  }
  return kept;
}

export function Overview() {
  const { t } = useTranslation();
  const [regions, setRegions] = useState<RegionStat[]>([]);
  const [types, setTypes] = useState<TypeStat[]>([]);
  const [totals, setTotals] = useState<TotalCounts | null>(null);
  const [combined, setCombined] = useState<CombinedAttack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  useEffect(() => {
    Promise.all([
      Analysis.byRegionPure(),
      Analysis.byType(),
      Analysis.total(),
      Analysis.combined(),
    ])
      .then(([r, ty, tot, cmb]) => {
        setRegions(r);
        setTypes(ty);
        setTotals(tot);
        setCombined(cmb);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const total = totals ? totals.events : regions.reduce((acc, r) => acc + r.count, 0);
  const regionsAffected = regions.length;
  const totalRows = totals?.rows ?? regions.reduce((acc, r) => acc + r.count, 0);

  const regionsTrim = useMemo(
    () => filterMinPercent(regions, totalRows, 0.01, "region"),
    [regions, totalRows],
  );
  const typesTotal = useMemo(() => types.reduce((a, t) => a + t.count, 0), [types]);
  const typesTrim = useMemo(
    () => filterMinPercent(types, typesTotal, 0.01, "attack_type"),
    [types, typesTotal],
  );
  const combinedTotal = useMemo(() => combined.reduce((a, c) => a + c.count, 0), [combined]);
  const combinedTrim = useMemo(
    () => filterMinPercent(combined, combinedTotal, 0.01, "label"),
    [combined, combinedTotal],
  );

  if (error) return <div className="card text-danger">{error}</div>;

  // Hovered slice grows outward by 6 px; we DON'T draw any text inside the
  // active slice or in the donut hole — the active label is rendered above
  // the chart by the parent component, so it can never be covered.
  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          stroke="#0a0f1e"
          strokeWidth={2}
        />
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={outerRadius + 9}
          outerRadius={outerRadius + 11}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          opacity={0.45}
        />
      </g>
    );
  };

  // Inactive slice labels — flat solid text inside the ring. No stroke
  // outline, just clean white. Slices smaller than 4% drop their label.
  const renderPct = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, index } = props;
    if (!percent || percent < 0.04) return null;
    if (index === activeIndex) return null;
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text
        x={x}
        y={y}
        fill="#ffffff"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontWeight: 600, fontSize: 11, letterSpacing: 0.2 }}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const activeRegion = activeIndex >= 0 ? regionsTrim[activeIndex] : null;
  const activePct = activeRegion && totalRows ? (activeRegion.count / totalRows) * 100 : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-accent">{t("nav.overview")}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="label">{t("overview.total_attacks")}</div>
          <div className="text-3xl font-bold">{total}</div>
          {totals && total !== totalRows && (
            <div className="mt-1 text-xs text-muted">
              {totalRows} location points across {total} events
            </div>
          )}
        </div>
        <div className="card">
          <div className="label">{t("overview.regions")}</div>
          <div className="text-3xl font-bold">{regionsAffected}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="label">{t("overview.by_region")}</div>
            <div className="text-sm font-medium" style={{ minHeight: "1.25rem" }}>
              {activeRegion ? (
                <>
                  <span className="text-slate-200">{activeRegion.region}</span>
                  <span className="text-accent ml-2 font-semibold">
                    {activeRegion.count} ({activePct.toFixed(1)}%)
                  </span>
                </>
              ) : (
                <span className="text-muted text-xs">Hover a slice for details</span>
              )}
            </div>
          </div>
          <div className="h-72 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 16, right: 16, bottom: 8, left: 16 }}>
                <Pie
                  data={regionsTrim}
                  dataKey="count"
                  nameKey="region"
                  cx="50%"
                  cy="48%"
                  outerRadius="68%"
                  innerRadius="40%"
                  paddingAngle={1}
                  label={renderPct}
                  labelLine={false}
                  isAnimationActive={false}
                  activeIndex={activeIndex >= 0 ? activeIndex : undefined}
                  activeShape={renderActiveShape}
                  onMouseEnter={(_d, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(-1)}
                >
                  {regionsTrim.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#0a0f1e" strokeWidth={1.5} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(value: number, _name: string, p: { payload?: RegionStat }) => [
                    `${value} (${totalRows ? ((value / totalRows) * 100).toFixed(1) : 0}%)`,
                    p.payload?.region ?? "",
                  ]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={48}
                  wrapperStyle={{ fontSize: 12, color: "#e2e8f0" }}
                  formatter={(value: string) => <span style={{ color: "#e2e8f0" }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="label">{t("overview.by_type")}</div>
          <div className="h-80 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <BarChart data={typesTrim} margin={{ top: 24, right: 24, bottom: 8, left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="attack_type"
                  stroke="#94a3b8"
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                  tickLine={{ stroke: "#475569" }}
                  axisLine={{ stroke: "#475569" }}
                />
                <YAxis
                  stroke="#94a3b8"
                  width={56}
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                  tickLine={{ stroke: "#475569" }}
                  axisLine={{ stroke: "#475569" }}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(56,189,248,0.12)" }}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Bar dataKey="count" fill="#0369a1" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="count" position="top" fill="#e2e8f0" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="label">{t("overview.combined")}</div>
        {combinedTrim.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{t("common.no_data")}</div>
        ) : (
          <div className="h-80 w-full" style={LTR_STYLE}>
            <ResponsiveContainer>
              <BarChart
                data={combinedTrim}
                layout="vertical"
                margin={{ top: 16, right: 56, bottom: 8, left: 200 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  type="number"
                  stroke="#94a3b8"
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                  tickLine={{ stroke: "#475569" }}
                  axisLine={{ stroke: "#475569" }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke="#94a3b8"
                  width={196}
                  tick={{ fill: "#cbd5e1", fontSize: 11 }}
                  tickLine={{ stroke: "#475569" }}
                  axisLine={{ stroke: "#475569" }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(245,166,35,0.12)" }}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Bar dataKey="count" fill="#f5a623" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" position="right" fill="#e2e8f0" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
