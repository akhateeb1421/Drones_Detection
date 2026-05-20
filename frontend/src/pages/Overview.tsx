import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { Analysis, CombinedAttack, RegionStat, TotalCounts, TypeStat, WeekdayPoint } from "../services/api";
import { usePlaceLabel, useTypeLabel } from "../i18n/places";
import { CountUp } from "../components/CountUp";
import { useAlarmsContext } from "../contexts/AlarmsContext";

/* ── System palette ── */
const C1 = "#01F2CF";
const C2 = "#03DA9A";
const C3 = "#03B3DA";
const DANGER = "#f87171";
const WARN = "#fbbf24";
const PURPLE = "#a78bfa";

const GRAD_PAIRS = [
  [C1, C3], [DANGER, "#dc2626"], [WARN, "#d97706"],
  [PURPLE, "#7c3aed"], [C2, "#059669"], ["#60a5fa", "#2563eb"],
  ["#fb923c", "#ea580c"], ["#34d399", "#059669"],
];

// Theme-aware via CSS variables — index.css defines :root and html.light
// variants so the dark/light toggle actually flips the surface tones.
// 1px border + drop shadow makes every box read as a floating panel
// against the deeper light-mode page bg.
const CARD: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 16,
  padding: "clamp(16px,2vw,24px)",
  position: "relative",
  overflow: "hidden",
  boxShadow: "0 8px 24px -12px rgba(0,0,0,0.25),0 2px 6px -2px rgba(0,0,0,0.12)",
};

const TT: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-medium)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "10px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
};
// Tooltip title was bright brand cyan on a light tooltip bg in light
// mode (~1.4:1). Use --text-primary so it reads in both modes.
const TTL: React.CSSProperties = { color: "var(--text-primary)", fontWeight: 700, marginBottom: 4 };
const TTI: React.CSSProperties = { color: "var(--text-muted)" };
// Axis tick labels need to read on white cards in light mode — the
// faint token sits at ~2.6:1 on white. Use --text-muted (~5:1 on white,
// ~4.4:1 on dark card). GRID stroke kept as low-alpha brand cyan
// because the html.light .recharts-cartesian-grid line override in
// index.css upgrades it for light mode.
const GRID = { stroke: "rgba(1,242,207,0.05)", strokeDasharray: "4 4" };
const AXIS = { fill: "var(--text-muted)", fontSize: 11 };

function filterMin<T extends { count: number }>(rows: T[], total: number, key: keyof T): T[] {
  if (!total || !rows.length) return rows;
  const kept: T[] = []; let other = 0;
  for (const r of rows) { if (r.count / total >= 0.01) kept.push(r); else other += r.count; }
  if (other > 0) kept.push({ ...rows[0], [key]: "Other", count: other } as T);
  return kept;
}

function CardShine() {
  return <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:"linear-gradient(90deg,transparent,rgba(1,242,207,0.16),transparent)",pointerEvents:"none" }}/>;
}

function Tag({ label }: { label: string }) {
  // Use --text-muted instead of brand cyan at 60% opacity, which was
  // invisible on light cards. Same uppercase eyebrow style otherwise.
  return <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:4 }}>{label}</div>;
}

function CardTitle({ label }: { label: string }) {
  return <div style={{ fontSize:"clamp(13px,1.6vw,16px)",fontWeight:700,color:"var(--text-primary)",marginBottom:"clamp(10px,1.5vw,16px)" }}>{label}</div>;
}

// InteractiveDonut removed per request — Geographic Distribution
// chart is no longer on the Overview page. Region info still shows
// in the Radar (left of the type chart) and on the History page.

/* ── KPI Card ── */
function KpiCard({ label, value, sub, color, iconPath }: {
  label: string; value: number | string; sub?: string; color: string; iconPath: string;
}) {
  return (
    <div style={{ ...CARD }}>
      <CardShine/>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${color}30,transparent)` }}/>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"clamp(8px,1vw,12px)" }}>
        <div style={{ fontSize:"clamp(9px,1vw,11px)",fontWeight:700,letterSpacing:"0.13em",textTransform:"uppercase",color:"var(--text-muted)" }}>{label}</div>
        <div style={{ width:"clamp(26px,3vw,34px)",height:"clamp(26px,3vw,34px)",borderRadius:9,background:`${color}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath}/>
          </svg>
        </div>
      </div>
      {/* Earlier the gradient ended at `${color}88` (semi-transparent),
          which faded to near-white on light cards — half the digit
          disappeared. Solid color end keeps the number readable in
          both modes. */}
      <div style={{ fontSize:"clamp(24px,3.5vw,36px)",fontWeight:800,lineHeight:1,marginBottom:"clamp(5px,0.8vw,9px)",background:`linear-gradient(135deg,${color},${color})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text" }}>
        {typeof value === "number" && !isNaN(value) ? <CountUp end={value}/> : (typeof value === "number" ? "0" : value)}
      </div>
      {sub && <div style={{ fontSize:"clamp(10px,1.1vw,12px)",color:"var(--text-faint)" }}>{sub}</div>}
    </div>
  );
}

/* ── Alert banner ── */
function AlertBanner({ alarm }: { alarm: any }) {
  const { t } = useTranslation();
  return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,padding:"clamp(11px,1.5vw,15px) clamp(14px,2vw,20px)",borderRadius:14,background:"rgba(248,113,113,0.07)",border:"0.5px solid rgba(248,113,113,0.35)",animation:"ap 2s ease-in-out infinite" }}>
      <style>{`@keyframes ap{0%,100%{box-shadow:none;border-color:rgba(248,113,113,.35)}50%{box-shadow:0 0 0 6px rgba(248,113,113,.05),0 0 28px rgba(248,113,113,.15);border-color:rgba(248,113,113,.65)}}`}</style>
      <div style={{ display:"flex",alignItems:"center",gap:12 }}>
        <div style={{ width:36,height:36,borderRadius:10,background:"rgba(248,113,113,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={DANGER} strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize:"clamp(12px,1.4vw,14px)",fontWeight:800,color:DANGER,textTransform:"uppercase",letterSpacing:"0.04em" }}>{t("overview.critical_threat","Critical Threat Detected")}</div>
          <div style={{ fontSize:"clamp(9px,1vw,11px)",color:"#dc2626",textTransform:"uppercase",letterSpacing:"0.10em",marginTop:2 }}>{alarm.drone_class ?? "—"} · {alarm.nearest_area ?? "—"}</div>
        </div>
      </div>
      <div style={{ textAlign:"end" }}>
        <div style={{ fontSize:"clamp(8px,0.9vw,10px)",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"#dc2626" }}>{t("live.eta","ETA")}</div>
        <div style={{ fontSize:"clamp(20px,2.8vw,28px)",fontWeight:800,color:DANGER,fontFamily:"monospace",lineHeight:1,marginTop:2 }}>
          {alarm.eta_s != null ? `${Math.floor(alarm.eta_s)}s` : "—"}
        </div>
      </div>
    </div>
  );
}

export function Overview() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const placeLabel = usePlaceLabel();
  const typeLabel  = useTypeLabel();
  const { history: alarmHistory } = useAlarmsContext();

  const [regions,  setRegions]  = useState<RegionStat[]>([]);
  const [types,    setTypes]    = useState<TypeStat[]>([]);
  const [totals,   setTotals]   = useState<TotalCounts | null>(null);
  const [combined, setCombined] = useState<CombinedAttack[]>([]);
  const [weekly,   setWeekly]   = useState<WeekdayPoint[]>([]);
  // Set of region keys currently plotted in the Weekly Trend chart.
  // null = "first fetch hasn't returned yet, default to all regions on
  // arrival"; an empty set = explicit "show nothing".
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch each independently so one failure doesn't block others
    Analysis.byRegionPure().then(setRegions).catch(() => {});
    Analysis.byType().then(setTypes).catch(() => {});
    Analysis.combined().then(setCombined).catch(() => {});
    Analysis.byWeekday().then(rows => {
      setWeekly(rows);
      // Default-select every region present in the response so the
      // chart starts populated. Users uncheck cities they don't care
      // about via the chip toggles above the chart.
      const found = new Set<string>();
      for (const row of rows) {
        for (const k of Object.keys(row)) {
          if (k !== "day" && k !== "day_index") found.add(k);
        }
      }
      setSelectedRegions(found);
    }).catch(() => {});
    Analysis.total()
      .then(tot => { setTotals(tot); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  // Total Attacks = rows (one row per logical attack), same unit as
  // /analysis/by-type and /analysis/by-region. Earlier we used
  // `events` (distinct source+timestamp), but that's a different unit
  // — it could be smaller than the per-type counts because a single
  // event expands into multiple rows when it hits multiple locations.
  // Keeping all KPI numbers in the same unit avoids "Drone Attacks
  // exceeds Total Attacks" weirdness.
  const totalRows  = Number(totals?.rows    ?? 0);
  const total      = totalRows;
  const isReady    = totals !== null;
  const typesTotal = useMemo(() => types.reduce((a, t) => a + t.count, 0), [types]);
  const combTotal  = useMemo(() => combined.reduce((a, c) => a + c.count, 0), [combined]);

  const regDisp  = useMemo(() => filterMin(regions, totalRows, "region").map(r => ({ ...r, region: placeLabel(r.region) })), [regions, totalRows, placeLabel]);
  const typDisp  = useMemo(() => filterMin(types, typesTotal, "attack_type").map(tt => ({ ...tt, attack_type: typeLabel(tt.attack_type) })), [types, typesTotal, typeLabel]);
  const combDisp = useMemo(() => filterMin(combined, combTotal, "label").slice(0, 8).map(c => ({ ...c, label: c.label.split(/\s*\+\s*/).map((p: string) => placeLabel(p)).join(" + ") })), [combined, combTotal, placeLabel]);
  const radarData= useMemo(() => regDisp.slice(0, 6).map(r => ({ subject: r.region, value: r.count })), [regDisp]);

  // Regions present in the weekly response, sorted by total attacks
  // descending so the biggest threats appear first in the chip row.
  const weeklyRegions = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of weekly) {
      for (const [k, v] of Object.entries(row)) {
        if (k === "day" || k === "day_index") continue;
        totals[k] = (totals[k] ?? 0) + (typeof v === "number" ? v : 0);
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [weekly]);

  // Build the chart-ready data. Translate the English day labels via
  // i18n so Arabic mode reads "الأحد" / "الاثنين" / etc. Keep rows
  // in Sun..Sat order — the backend already returns them that way.
  const weekData = useMemo(() => {
    return weekly.map(row => ({
      ...row,
      day: t(`days.${row.day}`, row.day as string),
    }));
  }, [weekly, t]);

  const toggleRegion = (r: string) => {
    setSelectedRegions(prev => {
      const next = new Set(prev ?? []);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  if (error) return (
    <div style={{ ...CARD, color: DANGER, fontSize: 14 }}><CardShine/>{error}</div>
  );

  if (loading) return (
    <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
      {[1,2,3].map(i => <div key={i} style={{ ...CARD, height:120, animation:"shimmer 1.5s ease-in-out infinite" }}/>)}
      <style>{`@keyframes shimmer{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"clamp(10px,1.5vw,16px)" }} data-mount>

      {/* Alert */}
      {alarmHistory.length > 0 && <AlertBanner alarm={alarmHistory[0]}/>}

      {/* KPI row */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:"clamp(8px,1.2vw,12px)" }}>
        {/* sub-line dropped — it used to show totalRows ("3,116 records")
            which is the row count, while the big number shows the
            distinct-event count. Two different numbers right next to
            each other read like a typo. The hero metric stands alone. */}
        <KpiCard label={t("overview.total_attacks","إجمالي الهجمات")} value={total}
          color={C1} iconPath="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
        <KpiCard label={t("overview.regions","المناطق المتأثرة")} value={regions.length}
          color={C2} iconPath="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
        <KpiCard label={t("overview.drone_attacks","هجمات الطائرات")}
          value={typDisp.find(tt => tt.attack_type.toLowerCase().includes("drone") || tt.attack_type.includes("طائر"))?.count ?? types[0]?.count ?? 0}
          color={PURPLE} iconPath="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
        <KpiCard label={t("overview.recent_alarms","الإنذارات النشطة")} value={alarmHistory.length}
          color={DANGER} iconPath="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
      </div>

      {/* Weekly Attack Trend — REAL data via /analysis/by-weekday, with
          a chip-row at the top that toggles each city on/off. Each
          selected city renders as its own stroked Area; color is taken
          from the GRAD_PAIRS palette by region index (same order as
          the chips). */}
      <div style={{ ...CARD }}>
        <CardShine/>
        <Tag label={t("overview.attack_vector","تحليل ناقل الهجوم")}/>
        <CardTitle label={t("overview.weekly_trend","اتجاه الهجمات الأسبوعي")}/>

        {/* City chip toggles */}
        {weeklyRegions.length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
            {weeklyRegions.map((r, i) => {
              const isActive = selectedRegions?.has(r) ?? false;
              const [a, b] = GRAD_PAIRS[i % GRAD_PAIRS.length];
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRegion(r)}
                  style={{
                    padding:"4px 10px", borderRadius:14, border:"1px solid",
                    cursor:"pointer", fontFamily:"inherit",
                    fontSize:"clamp(10px,1.1vw,12px)", fontWeight:600,
                    transition:"all 0.15s",
                    background: isActive ? `linear-gradient(135deg,${a},${b})` : "transparent",
                    borderColor: isActive ? "transparent" : "var(--border-medium)",
                    color: isActive ? "#0a1410" : "var(--text-muted)",
                  }}
                >
                  {placeLabel(r)}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ direction:"ltr",height:"clamp(180px,22vw,260px)" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekData} margin={{ top:8,right:8,left:-20,bottom:0 }}>
              <defs>
                {weeklyRegions.map((r, i) => {
                  const [a] = GRAD_PAIRS[i % GRAD_PAIRS.length];
                  return (
                    <linearGradient key={`wg${i}`} id={`wg${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={a} stopOpacity={0.45}/>
                      <stop offset="100%" stopColor={a} stopOpacity={0}/>
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false}/>
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} allowDecimals={false}/>
              <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              {weeklyRegions
                .filter(r => selectedRegions?.has(r))
                .map((r) => {
                  const idx = weeklyRegions.indexOf(r);
                  const [a] = GRAD_PAIRS[idx % GRAD_PAIRS.length];
                  return (
                    <Area
                      key={r}
                      type="monotone"
                      dataKey={r}
                      name={placeLabel(r)}
                      stroke={a}
                      strokeWidth={2.2}
                      fill={`url(#wg${idx})`}
                      dot={false}
                      activeDot={{ r:4, fill:a, stroke:"#0d1117", strokeWidth:2 }}
                      isAnimationActive
                      animationDuration={500}
                    />
                  );
                })}
              <Legend wrapperStyle={{ fontSize:"clamp(11px,1.3vw,13px)",color:"var(--text-muted)",paddingTop:8 }}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row: Radar | Attacks-by-Type bars | Donut.
          minmax(260px,1fr) accommodates three columns on wide screens
          and stacks them vertically on narrow viewports. The by-type
          bar chart sits between the geographic donut and the regional
          radar per request. */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"clamp(8px,1.2vw,12px)" }}>

        {/* Radar — Regional Threat Profile */}
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.threat_profile","الاستخبارات")}/>
          <CardTitle label={t("overview.region_radar","ملف تهديد المناطق")}/>
          <div style={{ direction:"ltr",height:"clamp(150px,20vw,220px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(1,242,207,0.07)"/>
                <PolarAngleAxis dataKey="subject" tick={{ fill:"var(--text-muted)",fontSize:"clamp(9px,1.1vw,12px)" }}/>
                <Radar dataKey="value" name={t("overview.attacks","هجمات")} stroke={C1} fill={C1} fillOpacity={0.13} strokeWidth={2}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Attacks-by-Type vertical bars. Uses the same GRAD_PAIRS
            palette as the Combined Attacks chart so the type colors
            stay consistent across the dashboard. Light-mode visibility
            is handled by the html.light .recharts-bar-rectangles
            filter override in index.css. */}
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.by_type","Attacks by Type")}/>
          <CardTitle label={t("overview.by_type","Attacks by Type")}/>
          <div style={{ direction:"ltr",height:"clamp(150px,20vw,220px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              {/* Use the unfiltered `types` (translated through
                  typeLabel) instead of `typDisp` so small types
                  (e.g., the 4 cruise_missile rows before the rebalance)
                  are not collapsed into an "Other" bucket. With three
                  canonical types the bucketing is never useful. */}
              <BarChart
                data={types.map(tt => ({ ...tt, attack_type: typeLabel(tt.attack_type) }))}
                margin={{ top:8, right:8, left:0, bottom:0 }}
              >
                <defs>
                  {GRAD_PAIRS.map(([a, b], i) => (
                    <linearGradient key={`tbg${i}`} id={`tbg${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor={a}/><stop offset="100%" stopColor={b}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID} vertical={false}/>
                <XAxis dataKey="attack_type" tick={{ fill:"var(--text-muted)",fontSize:"clamp(9px,1vw,11px)" }} tickLine={false} axisLine={false} interval={0}/>
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={48} tickFormatter={(v) => Number(v).toLocaleString()}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}
                  formatter={(v: number) => [v.toLocaleString(), t("overview.attacks","Attacks")]}/>
                <Bar dataKey="count" radius={[6,6,0,0]} maxBarSize={56}>
                  {types.map((_, i) => <Cell key={i} fill={`url(#tbg${i % GRAD_PAIRS.length})`}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Geographic-Distribution donut removed per request. The
            region-by-region breakdown is still available via the
            Radar chart (left) and on the History map. */}
      </div>

      {/* Combined horizontal bar */}
      {combDisp.length > 0 && (
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.combined","مشترك")}/>
          <CardTitle label={t("overview.combined_attacks_today","الهجمات المشتركة")}/>
          <div style={{ direction:"ltr",height:"clamp(160px,22vw,240px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={combDisp} layout="vertical" margin={{ top:0,right:48,left:0,bottom:0 }}>
                <defs>
                  {GRAD_PAIRS.map(([a, b], i) => (
                    <linearGradient key={i} id={`bg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={a}/><stop offset="100%" stopColor={b}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID} horizontal={false}/>
                {/* domain pins to dataMax so the axis doesn't pad to 8
                    when the real max is 6; allowDecimals=false keeps
                    ticks on whole-attack counts. */}
                <XAxis
                  type="number"
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, (max: number) => Math.max(1, Math.ceil(max))]}
                  allowDecimals={false}
                />
                <YAxis type="category" dataKey="label" tick={{ fill:"var(--text-muted)",fontSize:"clamp(9px,1vw,11px)" }} tickLine={false} axisLine={false} width={160}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Bar dataKey="count" radius={[0,7,7,0]} maxBarSize={18}>
                  {combDisp.map((_, i) => <Cell key={i} fill={`url(#bg${i % GRAD_PAIRS.length})`}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Events / alarms table removed per request. Live alarms
          still appear in the AlertBanner at the top of the page and on
          the Live Detection page. */}
    </div>
  );
}
