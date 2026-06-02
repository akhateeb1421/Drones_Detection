import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Analysis, CombinedAttack, RegionStat, TotalCounts, TypeStat, WeekdayPoint } from "../services/api";
import { usePlaceLabel, useTypeLabel } from "../i18n/places";
import { CountUp } from "../components/CountUp";
import { useAlarmsContext } from "../contexts/AlarmsContext";

/* Palette — oklch tokens matching index.css theme exactly */
const P   = "oklch(0.74 0.18 158)";  /* primary emerald */
const G   = "oklch(0.9 0.21 128)";   /* primary-glow lime */
const C3  = "oklch(0.62 0.13 175)";  /* chart-3 teal */
const C4  = "oklch(0.78 0.16 110)";  /* chart-4 yellow */
const C5  = "oklch(0.7 0.22 22)";    /* destructive red */
const C6  = "oklch(0.78 0.18 275)";  /* violet */
const C7  = "oklch(0.80 0.20 55)";   /* amber */
const C8  = "oklch(0.68 0.20 320)";  /* magenta */

const GRAD_PAIRS: [string, string][] = [
  [P,  G],
  [C5, "oklch(0.55 0.20 22)"],
  [C7, "oklch(0.62 0.18 40)"],
  [C6, "oklch(0.58 0.18 270)"],
  [G,  C3],
  [C3, "oklch(0.48 0.12 185)"],
  [C4, "oklch(0.64 0.14 95)"],
  [C8, "oklch(0.52 0.16 315)"],
];

/* Tooltip — glass style from drone_design */
const TT: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--glass-border)",
  borderRadius: 12, fontSize: 12, color: "var(--foreground)",
  padding: "10px 14px",
};
const TTL: React.CSSProperties = { color:"var(--foreground)", fontWeight:700, marginBottom:4 };
const TTI: React.CSSProperties = { color:"var(--muted-foreground)" };
const GRID = { stroke:"var(--border)", strokeDasharray:"4 4" };
const AXIS = { fill:"var(--muted-foreground)", fontSize:11 };

function filterMin<T extends { count: number }>(rows: T[], total: number, key: keyof T): T[] {
  if (!total || !rows.length) return rows;
  const kept: T[] = []; let other = 0;
  for (const r of rows) { if (r.count / total >= 0.01) kept.push(r); else other += r.count; }
  if (other > 0) kept.push({ ...rows[0], [key]:"Other", count:other } as T);
  return kept;
}

/* ──────────────────────────────────────────────────────────────
   KPI CARD — label + big number ONLY.
   Removed: icon, sub text, sparkline, trend text.
   The card is a glass rounded-2xl panel (exact drone_design style).
────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, critical }: {
  label: string;
  value: number | string;
  critical?: boolean;
}) {
  return (
    /* glass rounded-2xl — from drone_design StatCards */
    <div
      className={`glass${critical ? " glow-primary" : ""}`}
      style={{ borderRadius:20, padding:"clamp(18px,2vw,24px)", position:"relative", overflow:"hidden" }}
    >
      {/* Critical dot — top right */}
      {critical && (
        <div style={{ position:"absolute", top:16, right:16, width:8, height:8, borderRadius:"50%", background:"var(--destructive)" }} className="animate-glow-pulse"/>
      )}

      {/* Label — uppercase eyebrow, muted */}
      <p style={{ fontSize:10, fontWeight:600, letterSpacing:"0.15em", textTransform:"uppercase", color:"var(--muted-foreground)", marginBottom:10, margin:0, marginBottom:12 }}>
        {label}
      </p>

      {/* Big number — gradient text when critical, foreground otherwise */}
      <div style={{
        fontSize:"clamp(28px,3.8vw,40px)",
        fontWeight:600,
        fontVariantNumeric:"tabular-nums",
        lineHeight:1,
        ...(critical
          ? { background:"var(--gradient-primary)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }
          : { color:"var(--foreground)" }),
      }}>
        {typeof value === "number" && !isNaN(value)
          ? <CountUp end={value}/>
          : (typeof value === "number" ? "0" : value)}
      </div>
    </div>
  );
}

/* Alert banner */
function AlertBanner({ alarm }: { alarm: any }) {
  const { t } = useTranslation();
  return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,padding:"14px 20px",borderRadius:16,background:"oklch(0.7 0.22 22 / 0.08)",border:"0.5px solid oklch(0.7 0.22 22 / 0.35)",animation:"ap 2s ease-in-out infinite" }}>
      <style>{`@keyframes ap{0%,100%{border-color:oklch(.7 .22 22/.35)}50%{box-shadow:0 0 0 6px oklch(.7 .22 22/.05),0 0 28px oklch(.7 .22 22/.15);border-color:oklch(.7 .22 22/.65)}}`}</style>
      <div style={{ display:"flex",alignItems:"center",gap:12 }}>
        <div style={{ width:36,height:36,borderRadius:10,background:"oklch(0.7 0.22 22 / 0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize:13,fontWeight:800,color:"var(--destructive)",textTransform:"uppercase",letterSpacing:"0.04em" }}>{t("overview.critical_threat","Critical Threat Detected")}</div>
          <div style={{ fontSize:11,color:"var(--destructive)",opacity:.7,textTransform:"uppercase",letterSpacing:"0.10em",marginTop:2 }}>{alarm.drone_class??"—"} · {alarm.nearest_area??"—"}</div>
        </div>
      </div>
      <div style={{ textAlign:"end" }}>
        <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--destructive)",opacity:.6 }}>ETA</div>
        <div style={{ fontSize:"clamp(20px,2.8vw,28px)",fontWeight:800,color:"var(--destructive)",fontFamily:"monospace",lineHeight:1,marginTop:2 }}>
          {alarm.eta_s!=null?`${Math.floor(alarm.eta_s)}s`:"—"}
        </div>
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────── */
export function Overview() {
  const { t, i18n } = useTranslation();
  const placeLabel = usePlaceLabel();
  const typeLabel  = useTypeLabel();
  const { history: alarmHistory } = useAlarmsContext();

  const [regions,         setRegions]         = useState<RegionStat[]>([]);
  const [types,           setTypes]           = useState<TypeStat[]>([]);
  const [totals,          setTotals]          = useState<TotalCounts | null>(null);
  const [combined,        setCombined]        = useState<CombinedAttack[]>([]);
  const [weekly,          setWeekly]          = useState<WeekdayPoint[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);

  useEffect(() => {
    setLoading(true);
    Analysis.byRegionPure().then(setRegions).catch(()=>{});
    Analysis.byType().then(setTypes).catch(()=>{});
    Analysis.combined().then(setCombined).catch(()=>{});
    Analysis.byWeekday().then(rows => {
      setWeekly(rows);
      const found = new Set<string>();
      for (const row of rows)
        for (const k of Object.keys(row))
          if (k!=="day"&&k!=="day_index") found.add(k);
      setSelectedRegions(found);
    }).catch(()=>{});
    Analysis.total()
      .then(tot => { setTotals(tot); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const totalRows  = Number(totals?.rows ?? 0);
  const typesTotal = useMemo(() => types.reduce((a,tt) => a+tt.count, 0), [types]);
  const combTotal  = useMemo(() => combined.reduce((a,c) => a+c.count, 0), [combined]);

  const regDisp   = useMemo(() => filterMin(regions,totalRows,"region").map(r=>({...r,region:placeLabel(r.region)})), [regions,totalRows,placeLabel]);
  const typDisp   = useMemo(() => filterMin(types,typesTotal,"attack_type").filter(tt => !tt.attack_type.toLowerCase().includes("mixed")).map(tt=>({...tt,attack_type:typeLabel(tt.attack_type)})),[types,typesTotal,typeLabel]);
  const combDisp  = useMemo(() => filterMin(combined,combTotal,"label").slice(0,8).map(c=>({...c,label:c.label.split(/\s*\+\s*/).map((p:string)=>placeLabel(p)).join(" + ")})), [combined,combTotal,placeLabel]);
  const radarData = useMemo(() => regDisp.slice(0,6).map(r=>({subject:r.region,value:r.count})), [regDisp]);

  const weeklyRegions = useMemo(() => {
    const tot:Record<string,number>={};
    for (const row of weekly)
      for (const [k,v] of Object.entries(row)) {
        if(k==="day"||k==="day_index") continue;
        tot[k]=(tot[k]??0)+(typeof v==="number"?v:0);
      }
    return Object.entries(tot).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
  }, [weekly]);

  const weekData = useMemo(() => weekly.map(row => ({
    ...row, day: t(`days.${row.day}`, row.day as string),
  })), [weekly, t]);

  const toggleRegion = (r: string) => {
    setSelectedRegions(prev => {
      const next = new Set(prev ?? []);
      if(next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  /* Y-axis max — clean nice number, never shows "00" */
  const barMax = useMemo(() => {
    if (!types.length) return 10;
    const raw = Math.max(...types.map(tt=>tt.count), 1);
    const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = raw/mag<1.5 ? mag/5 : raw/mag<3 ? mag/2 : raw/mag<7 ? mag : mag*2;
    const nStep = Math.max(1, Math.ceil(step));
    return Math.ceil(raw/nStep)*nStep;
  }, [types]);

  if (error) return (
    <div className="glass" style={{ borderRadius:20, padding:24, color:"var(--destructive)" }}>{error}</div>
  );
  if (loading) return (
    <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
      {[1,2,3].map(i=><div key={i} className="glass" style={{ borderRadius:20,height:110,animation:"shimmer 1.5s ease-in-out infinite" }}/>)}
      <style>{`@keyframes shimmer{0%,100%{opacity:.4}50%{opacity:.8}}`}</style>
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }} data-mount>

      {alarmHistory.length>0 && <AlertBanner alarm={alarmHistory[0]}/>}

      {/* ── KPI row — glass rounded-2xl, label + number ONLY ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:16 }}>
        <KpiCard label={t("overview.total_attacks","إجمالي الهجمات")} value={totalRows} critical/>
        <KpiCard label={t("overview.regions","المناطق المتأثرة")} value={regions.length}/>
        <KpiCard label={t("overview.drone_attacks","هجمات الطائرات")}
          value={typDisp.find(tt=>tt.attack_type.toLowerCase().includes("drone")||tt.attack_type.includes("طائر"))?.count??types[0]?.count??0}/>
        <KpiCard label={t("overview.recent_alarms","الإنذارات النشطة")} value={alarmHistory.length}/>
      </div>

      {/* ── Weekly trend — glass rounded-3xl */}
      <div className="glass" style={{ borderRadius:24, padding:"clamp(20px,2.5vw,28px)" }}>
        <p style={{ fontSize:10,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"var(--primary)",marginBottom:4 }}>
          {t("overview.attack_vector","ATTACK VECTOR ANALYSIS")}
        </p>
        <h3 style={{ fontSize:"clamp(16px,1.8vw,20px)",fontWeight:600,margin:"0 0 14px 0" }}>
          {t("overview.weekly_trend","نمط الهجمات الأسبوعي")}
        </h3>

        {/* Chip toggles */}
        {weeklyRegions.length>0 && (
          <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginBottom:14 }}>
            {weeklyRegions.map((r,i) => {
              const isActive = selectedRegions?.has(r) ?? false;
              const [a,b]    = GRAD_PAIRS[i%GRAD_PAIRS.length];
              return (
                <button key={r} type="button" onClick={()=>toggleRegion(r)}
                  style={{
                    padding:"5px 13px", borderRadius:20, border:`1.5px solid ${a}`,
                    cursor:"pointer", fontFamily:"inherit",
                    fontSize:"clamp(11px,1.1vw,13px)", fontWeight:700, transition:"all .18s",
                    background: isActive ? `linear-gradient(135deg,${a},${b})` : "transparent",
                    color: isActive ? "var(--primary-foreground)" : a,
                    boxShadow: isActive ? `0 0 12px ${a}55` : "none",
                    transform: isActive ? "scale(1.04)" : "scale(1)",
                  }}
                >{placeLabel(r)}</button>
              );
            })}
          </div>
        )}

        <div style={{ height:"clamp(190px,22vw,270px)", marginInlineStart:-16, direction:"ltr" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekData} margin={{ top:8,right:8,left:0,bottom:0 }}>
              <defs>
                {weeklyRegions.map((r,i) => {
                  const [a] = GRAD_PAIRS[i%GRAD_PAIRS.length];
                  return (
                    <linearGradient key={`wg${i}`} id={`wg${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={a} stopOpacity={0.50}/>
                      <stop offset="100%" stopColor={a} stopOpacity={0}/>
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid {...GRID} vertical={false}/>
              <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tick={AXIS} tickLine={false} axisLine={false}/>
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tick={AXIS} tickLine={false} axisLine={false} width={48} allowDecimals={false}/>
              <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              {weeklyRegions.filter(r=>selectedRegions?.has(r)).map(r => {
                const idx = weeklyRegions.indexOf(r);
                const [a] = GRAD_PAIRS[idx%GRAD_PAIRS.length];
                return (
                  <Area key={r} type="monotone" dataKey={r} name={placeLabel(r)}
                    stroke={a} strokeWidth={2.5} fill={`url(#wg${idx})`}
                    dot={false} activeDot={{ r:5,fill:a,stroke:"var(--background)",strokeWidth:2 }}
                    isAnimationActive animationDuration={500}/>
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Radar + Bar row ── */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(265px,1fr))",gap:16 }}>

        {/* Radar */}
        <div className="glass" style={{ borderRadius:24, padding:"clamp(18px,2.2vw,26px)", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute",top:"50%",left:"50%",width:200,height:200,transform:"translate(-50%,-50%)",borderRadius:"50%",background:"var(--gradient-glow)",opacity:.35,pointerEvents:"none" }}/>
          <div style={{ position:"relative" }}>
            <p style={{ fontSize:10,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"var(--primary)",marginBottom:4 }}>
              {t("overview.threat_profile","THREAT PROFILE")}
            </p>
            <h3 style={{ fontSize:"clamp(15px,1.8vw,20px)",fontWeight:600,marginBottom:14 }}>
              {t("overview.region_radar","ملف تهديد المناطق")}
            </h3>
          </div>
          <div style={{ height:"clamp(150px,20vw,220px)", direction:"ltr" }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="var(--border)"/>
                <PolarAngleAxis dataKey="subject" tick={{ fill:"var(--muted-foreground)",fontSize:"clamp(9px,1.1vw,12px)" }}/>
                <Radar dataKey="value" stroke={P} fill={P} fillOpacity={0.18} strokeWidth={2}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar chart — Y-axis fixed */}
        <div className="glass" style={{ borderRadius:24, padding:"clamp(18px,2.2vw,26px)" }}>
          <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:14 }}>
            <div>
              <p style={{ fontSize:10,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"var(--primary)",marginBottom:4 }}>
                {t("overview.by_type","ATTACKS BY TYPE")}
              </p>
              <h3 style={{ fontSize:"clamp(15px,1.8vw,20px)",fontWeight:600,margin:0 }}>
                {t("overview.by_type","أنواع الهجمات")}
              </h3>
            </div>
            {/* Colored chip badges for bar legend */}
            <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
            {types.filter(tt=>!tt.attack_type.toLowerCase().includes("mixed")).map((tt,i) => {
                const [a,b] = GRAD_PAIRS[i%GRAD_PAIRS.length];
                return (
                  <span key={i} style={{ padding:"4px 12px",borderRadius:20,background:`linear-gradient(135deg,${a},${b})`,color:"var(--primary-foreground)",fontSize:"clamp(10px,1vw,12px)",fontWeight:700,boxShadow:`0 0 8px ${a}44` }}>
                    {typeLabel(tt.attack_type)}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ height:"clamp(150px,20vw,220px)", direction:"ltr" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={types.filter(tt=>!tt.attack_type.toLowerCase().includes("mixed")).map(tt=>({...tt,attack_type:typeLabel(tt.attack_type)}))}
                margin={{ top:8,right:8,left:-22,bottom:0 }}
              >
                <defs>
                  {GRAD_PAIRS.map(([a,b],i)=>(
                    <linearGradient key={`tbg${i}`} id={`tbg${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%"   stopColor={a} stopOpacity={1}/>
                      <stop offset="100%" stopColor={b} stopOpacity={0.55}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID} vertical={false}/>
                <XAxis dataKey="attack_type" tick={{fill:"var(--muted-foreground)",fontSize:"clamp(9px,1vw,11px)"}} tickLine={false} axisLine={false} interval={0}/>
                {/* Y-axis: explicit domain, tickCount=5, formatter → real numbers, never "00" */}
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44}
                  domain={[0, barMax]} tickCount={5} tickFormatter={(v:number)=>v.toLocaleString()}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}
                  formatter={(v:number)=>[v.toLocaleString(),t("overview.attacks","Attacks")]}/>
                <Bar dataKey="count" radius={[7,7,0,0]} maxBarSize={60}>
                  {types.map((_,i)=><Cell key={i} fill={`url(#tbg${i%GRAD_PAIRS.length})`}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Combined horizontal bar ── */}
      {combDisp.length>0 && (
        <div className="glass" style={{ borderRadius:24, padding:"clamp(18px,2.2vw,26px)" }}>
          <p style={{ fontSize:10,fontWeight:600,letterSpacing:"0.15em",textTransform:"uppercase",color:"var(--primary)",marginBottom:4 }}>
            {t("overview.combined","مشترك")}
          </p>
          <h3 style={{ fontSize:"clamp(15px,1.8vw,20px)",fontWeight:600,marginBottom:14 }}>
            {t("overview.combined_attacks_today","الهجمات المشتركة")}
          </h3>
          <div style={{ height:"clamp(160px,22vw,250px)", direction:"ltr" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={combDisp} layout="vertical" margin={{ top:0,right:48,left:0,bottom:0 }}>
                <defs>
                  {GRAD_PAIRS.map(([a,b],i)=>(
                    <linearGradient key={i} id={`bg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%"   stopColor={a} stopOpacity={1}/>
                      <stop offset="100%" stopColor={b} stopOpacity={0.55}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID} horizontal={false}/>
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}
                  domain={[0,(max:number)=>Math.max(1,Math.ceil(max))]}
                  allowDecimals={false} tickFormatter={(v:number)=>v.toLocaleString()}/>
                <YAxis type="category" dataKey="label" tick={{fill:"var(--muted-foreground)",fontSize:"clamp(9px,1vw,11px)"}} tickLine={false} axisLine={false} width={160}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Bar dataKey="count" radius={[0,7,7,0]} maxBarSize={18}>
                  {combDisp.map((_,i)=><Cell key={i} fill={`url(#bg${i%GRAD_PAIRS.length})`}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
