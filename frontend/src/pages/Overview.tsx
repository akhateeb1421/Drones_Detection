import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { Analysis, CombinedAttack, RegionStat, TotalCounts, TypeStat } from "../services/api";
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

const CARD: React.CSSProperties = {
  background: "linear-gradient(160deg,rgba(14,22,40,0.97) 0%,rgba(10,15,28,0.98) 100%)",
  border: "0.5px solid rgba(1,242,207,0.10)",
  borderRadius: 16,
  padding: "clamp(16px,2vw,24px)",
  position: "relative",
  overflow: "hidden",
};

const TT: React.CSSProperties = {
  background: "rgba(8,14,22,0.97)",
  border: "1px solid rgba(1,242,207,0.2)",
  borderRadius: 10,
  color: "#e0f5f2",
  fontSize: 13,
  padding: "10px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
};
const TTL: React.CSSProperties = { color: C1, fontWeight: 700, marginBottom: 4 };
const TTI: React.CSSProperties = { color: "#5fa09a" };
const GRID = { stroke: "rgba(1,242,207,0.05)", strokeDasharray: "4 4" };
const AXIS = { fill: "#3d7872", fontSize: 11 };

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
  return <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C1,opacity:0.6,marginBottom:4 }}>{label}</div>;
}

function CardTitle({ label }: { label: string }) {
  return <div style={{ fontSize:"clamp(13px,1.6vw,16px)",fontWeight:700,color:"#e0f5f2",marginBottom:"clamp(10px,1.5vw,16px)" }}>{label}</div>;
}

/* ── KPI Card ── */
function KpiCard({ label, value, sub, color, iconPath }: {
  label: string; value: number | string; sub?: string; color: string; iconPath: string;
}) {
  return (
    <div style={{ ...CARD }}>
      <CardShine/>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${color}30,transparent)` }}/>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"clamp(8px,1vw,12px)" }}>
        <div style={{ fontSize:"clamp(9px,1vw,11px)",fontWeight:700,letterSpacing:"0.13em",textTransform:"uppercase",color:"#3d7872" }}>{label}</div>
        <div style={{ width:"clamp(26px,3vw,34px)",height:"clamp(26px,3vw,34px)",borderRadius:9,background:`${color}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath}/>
          </svg>
        </div>
      </div>
      <div style={{ fontSize:"clamp(24px,3.5vw,36px)",fontWeight:800,lineHeight:1,marginBottom:"clamp(5px,0.8vw,9px)",background:`linear-gradient(135deg,${color},${color}88)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text" }}>
        {typeof value === "number" && !isNaN(value) ? <CountUp end={value}/> : (typeof value === "number" ? "0" : value)}
      </div>
      {sub && <div style={{ fontSize:"clamp(10px,1.1vw,12px)",color:"#3d7872" }}>{sub}</div>}
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
          <div style={{ fontSize:"clamp(9px,1vw,11px)",color:"rgba(248,113,113,0.55)",textTransform:"uppercase",letterSpacing:"0.10em",marginTop:2 }}>{alarm.drone_class ?? "—"} · {alarm.nearest_area ?? "—"}</div>
        </div>
      </div>
      <div style={{ textAlign:"end" }}>
        <div style={{ fontSize:"clamp(8px,0.9vw,10px)",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"rgba(248,113,113,0.5)" }}>{t("live.eta","ETA")}</div>
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
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch each independently so one failure doesn't block others
    Analysis.byRegionPure().then(setRegions).catch(() => {});
    Analysis.byType().then(setTypes).catch(() => {});
    Analysis.combined().then(setCombined).catch(() => {});
    Analysis.total()
      .then(tot => { setTotals(tot); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const total      = Number(totals?.events  ?? 0);
  const isReady    = totals !== null;
  const totalRows  = Number(totals?.rows    ?? 0);
  const typesTotal = useMemo(() => types.reduce((a, t) => a + t.count, 0), [types]);
  const combTotal  = useMemo(() => combined.reduce((a, c) => a + c.count, 0), [combined]);

  const regDisp  = useMemo(() => filterMin(regions, totalRows, "region").map(r => ({ ...r, region: placeLabel(r.region) })), [regions, totalRows, placeLabel]);
  const typDisp  = useMemo(() => filterMin(types, typesTotal, "attack_type").map(tt => ({ ...tt, attack_type: typeLabel(tt.attack_type) })), [types, typesTotal, typeLabel]);
  const combDisp = useMemo(() => filterMin(combined, combTotal, "label").slice(0, 8).map(c => ({ ...c, label: c.label.split(/\s*\+\s*/).map((p: string) => placeLabel(p)).join(" + ") })), [combined, combTotal, placeLabel]);
  const radarData= useMemo(() => regDisp.slice(0, 6).map(r => ({ subject: r.region, value: r.count })), [regDisp]);

  const droneKey = "Drone";
  const mixedKey = "Mixed";
  const waveData = useMemo(() => {
    const base = Math.max(1, Math.round(total / 30));
    const days = isAr
      ? ["الأحد","السبت","الجمعة","الخميس","الأربعاء","الثلاثاء","الاثنين"]
      : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    return days.map((day, i) => ({
      day,
      [droneKey]: Math.round(base * (0.6 + Math.sin(i * 0.9) * 0.35)),
      [mixedKey]: Math.round(base * (0.25 + Math.sin(i * 1.2 + 1) * 0.15)),
    }));
  }, [total, isAr, droneKey, mixedKey]);

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
        <KpiCard label={t("overview.total_attacks","إجمالي الهجمات")} value={total}
          sub={`${totalRows.toLocaleString()} ${t("overview.location_points","سجل")}`}
          color={C1} iconPath="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
        <KpiCard label={t("overview.regions","المناطق المتأثرة")} value={regions.length}
          color={C2} iconPath="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
        <KpiCard label={t("overview.drone_attacks","هجمات الطائرات")}
          value={typDisp.find(tt => tt.attack_type.toLowerCase().includes("drone") || tt.attack_type.includes("طائر"))?.count ?? types[0]?.count ?? 0}
          color={PURPLE} iconPath="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
        <KpiCard label={t("overview.recent_alarms","الإنذارات النشطة")} value={alarmHistory.length}
          color={DANGER} iconPath="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
      </div>

      {/* Wave chart */}
      <div style={{ ...CARD }}>
        <CardShine/>
        <Tag label={t("overview.attack_vector","تحليل ناقل الهجوم")}/>
        <CardTitle label={t("overview.weekly_trend","اتجاه الهجمات الأسبوعي")}/>
        <div style={{ direction:"ltr",height:"clamp(130px,18vw,200px)" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={waveData} margin={{ top:8,right:8,left:-20,bottom:0 }}>
              <defs>
                <linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C1} stopOpacity={0.45}/>
                  <stop offset="100%" stopColor={C1} stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C2} stopOpacity={0.3}/>
                  <stop offset="100%" stopColor={C2} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID}/>
              <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false}/>
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52}/>
              <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              <Area type="monotone" dataKey={droneKey} name={t("overview.drone_attacks","Drone Attacks")} stroke={C1} strokeWidth={2.5} fill="url(#wg1)" dot={false} activeDot={{ r:5,fill:C1,stroke:"#0d1117",strokeWidth:2 }}/>
              <Area type="monotone" dataKey={mixedKey} name={t("overview.mixed","Mixed Attacks")} stroke={C2} strokeWidth={2} strokeDasharray="5 3" fill="url(#wg2)" dot={false} activeDot={{ r:4,fill:C2 }}/>
              <Legend wrapperStyle={{ fontSize:"clamp(11px,1.3vw,13px)",color:"#5fa09a",paddingTop:8 }}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row: Radar + Region bars + Donut */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"clamp(8px,1.2vw,12px)" }}>

        {/* Radar */}
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.threat_profile","الاستخبارات")}/>
          <CardTitle label={t("overview.region_radar","ملف تهديد المناطق")}/>
          <div style={{ direction:"ltr",height:"clamp(150px,20vw,220px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(1,242,207,0.07)"/>
                <PolarAngleAxis dataKey="subject" tick={{ fill:"#3d7872",fontSize:"clamp(9px,1.1vw,12px)" }}/>
                <Radar dataKey="value" name={t("overview.attacks","هجمات")} stroke={C1} fill={C1} fillOpacity={0.13} strokeWidth={2}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Region bars */}
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.by_region","المناطق")}/>
          <CardTitle label={t("overview.attacks_per_region","الهجمات حسب المنطقة")}/>
          <div style={{ display:"flex",flexDirection:"column",gap:"clamp(8px,1.2vw,12px)" }}>
            {regDisp.slice(0, 5).map((r, i) => {
              const max = Math.max(...regDisp.map(x => x.count));
              const pct = max ? Math.round((r.count / max) * 100) : 0;
              const [a, b] = GRAD_PAIRS[i % GRAD_PAIRS.length];
              return (
                <div key={r.region}>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:"clamp(11px,1.3vw,14px)",marginBottom:"clamp(3px,0.5vw,5px)" }}>
                    <span style={{ color:"#5fa09a" }}>{r.region}</span>
                    <span style={{ fontWeight:700,color:"#e0f5f2" }}>{r.count.toLocaleString()}</span>
                  </div>
                  <div style={{ height:"clamp(4px,0.6vw,6px)",background:"rgba(1,242,207,0.07)",borderRadius:4 }}>
                    <div style={{ height:"100%",borderRadius:4,width:`${pct}%`,background:`linear-gradient(90deg,${a},${b})`,transition:"width 0.6s ease" }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Donut with gradient */}
        <div style={{ ...CARD }}>
          <CardShine/>
          <Tag label={t("overview.by_region","الجغرافي")}/>
          <CardTitle label={t("overview.distribution","التوزيع الجغرافي")}/>
          <div style={{ direction:"ltr",height:"clamp(150px,20vw,220px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  {GRAD_PAIRS.map(([a, b], i) => (
                    <linearGradient key={i} id={`pg${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={a}/><stop offset="100%" stopColor={b}/>
                    </linearGradient>
                  ))}
                </defs>
                <Pie data={regDisp} dataKey="count" nameKey="region" cx="50%" cy="50%" innerRadius="38%" outerRadius="68%" stroke="none" paddingAngle={2}>
                  {regDisp.map((_, i) => <Cell key={i} fill={`url(#pg${i % GRAD_PAIRS.length})`}/>)}
                </Pie>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}
                  formatter={(v: number, n: string) => [`${v.toLocaleString()} (${totalRows ? ((v/totalRows)*100).toFixed(1) : 0}%)`, n]}/>
                <Legend wrapperStyle={{ fontSize:"clamp(9px,1.1vw,12px)",color:"#5fa09a" }} iconSize={7} iconType="circle"/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
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
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}/>
                <YAxis type="category" dataKey="label" tick={{ fill:"#5fa09a",fontSize:"clamp(9px,1vw,11px)" }} tickLine={false} axisLine={false} width={160}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Bar dataKey="count" radius={[0,7,7,0]} maxBarSize={18}>
                  {combDisp.map((_, i) => <Cell key={i} fill={`url(#bg${i % GRAD_PAIRS.length})`}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent alarms table */}
      {alarmHistory.length > 0 && (
        <div style={{ ...CARD, padding:0 }}>
          <CardShine/>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:"0.5px solid rgba(1,242,207,0.08)" }}>
            <div>
              <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C1,opacity:0.6,marginBottom:2 }}>{t("overview.recent_events","الأحداث الأخيرة")}</div>
              <div style={{ fontSize:"clamp(13px,1.5vw,16px)",fontWeight:700,color:"#e0f5f2" }}>{t("overview.alarm_timeline","آخر الإنذارات")}</div>
            </div>
          </div>
          {/* Header */}
          <div style={{ display:"grid",gridTemplateColumns:"110px 1fr 130px 80px",gap:8,padding:"9px 20px",background:"rgba(1,242,207,0.03)" }}>
            {[t("live.eta","الوقت"),t("live.drone_class","الطائرة"),t("live.nearest_area","الموقع"),t("live.threat_level","الحالة")].map(h=>(
              <div key={h} style={{ fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(1,242,207,0.4)" }}>{h}</div>
            ))}
          </div>
          {/* Rows */}
          {alarmHistory.slice(0,5).map((a: any, i: number) => (
            <div key={i} style={{ display:"grid",gridTemplateColumns:"110px 1fr 130px 80px",gap:8,padding:"14px 20px",borderTop:"0.5px solid rgba(1,242,207,0.05)",alignItems:"center",background:i%2===0?"rgba(1,242,207,0.012)":"transparent" }}>
              <div style={{ fontSize:11,fontFamily:"monospace",color:"#5fa09a" }}>{a.timestamp?new Date(a.timestamp).toLocaleTimeString():"—"}</div>
              <div style={{ fontSize:13,fontWeight:700,color:DANGER }}>{a.drone_class??"—"}</div>
              <div style={{ fontSize:12,color:"#5fa09a" }}>{a.nearest_area??"—"}</div>
              <div>
                <span style={{ display:"inline-flex",alignItems:"center",padding:"3px 8px",borderRadius:20,fontSize:9,fontWeight:700,textTransform:"uppercase",background:"rgba(248,113,113,0.10)",color:DANGER,border:"0.5px solid rgba(248,113,113,0.2)" }}>
                  {t("threat.CRITICAL","حرج")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
