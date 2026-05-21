import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Legend, Line, LineChart, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Analysis as AnalysisAPI, Predictions, ForecastPoint, TimelinePoint } from "../services/api";
import { usePlaceLabel } from "../i18n/places";

/* Chart colours — direct var() references to styles.css chart tokens */
const CHART_COLORS = ["var(--chart-1)","var(--chart-5)","var(--chart-3)","var(--chart-4)","var(--chart-2)","var(--chart-3)"];

const CARD: React.CSSProperties = {
  background:"var(--card)", border:"1px solid var(--border)",
  borderRadius:"calc(var(--radius) + 4px)",
  padding:"clamp(16px,2vw,24px)", position:"relative", overflow:"hidden",
  boxShadow:"var(--shadow-card)", color:"var(--card-foreground)",
};
const TT: React.CSSProperties = {
  background:"var(--popover)", border:"1px solid var(--border)",
  borderRadius:"var(--radius)", color:"var(--popover-foreground)",
  fontSize:13, padding:"10px 14px",
  backdropFilter:"blur(16px)", boxShadow:"var(--shadow-card)",
};
const TTL: React.CSSProperties = { color:"var(--foreground)", fontWeight:700, marginBottom:4 };
const TTI: React.CSSProperties = { color:"var(--muted-foreground)" };
const GRID = { stroke:"var(--border)", strokeDasharray:"4 4" };
const AXIS = { fill:"var(--muted-foreground)", fontSize:11 };

function CardShine() {
  return (
    <div style={{
      position:"absolute", top:0, left:0, right:0, height:1,
      background:"linear-gradient(90deg,transparent,var(--primary-glow),transparent)",
      pointerEvents:"none",
    }}/>
  );
}

function isoDay(s:string):string { if(!s)return""; const i=s.indexOf("T"); return i>0?s.slice(0,i):s.slice(0,10); }
function fmtMonth(s:string,locale:string):string { const d=new Date(isoDay(s)); if(isNaN(d.getTime()))return s; return d.toLocaleDateString(locale,{year:"2-digit",month:"short"}); }

const HORIZONS = [
  {value:7,label:"7"},{value:14,label:"14"},{value:30,label:"30"},
  {value:60,label:"60"},{value:90,label:"90"},
  {value:365,labelKey:"analysis.year_label",defaultLabel:"سنة"},
];

export function Analysis() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const placeLabel = usePlaceLabel();

  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [horizon,  setHorizon]  = useState(30);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string|null>(null);

  useEffect(() => {
    setLoading(true);
    AnalysisAPI.timeline({ granularity:"month" })
      .then(setTimeline).catch(e=>setError(String(e))).finally(()=>setLoading(false));
  }, []);

  useEffect(() => {
    Predictions.forecast({ days:String(horizon) }).then(setForecast).catch(e=>setError(String(e)));
  }, [horizon]);

  const monthLocale = isAr ? "ar-SA-u-nu-latn" : "en-US";
  const tlData = useMemo(() => timeline.map(p=>({...p,_date:fmtMonth(p.date??p.month??"",monthLocale)})),[timeline,monthLocale]);
  const regions = useMemo(() => { const s=new Set<string>(); forecast.forEach(p=>s.add(p.region)); return[...s]; },[forecast]);
  const fcData = useMemo(() => {
    const by:Record<string,any>={};
    forecast.forEach(p=>{ const d=isoDay(p.date??""); if(!by[d])by[d]={date:d}; by[d][placeLabel(p.region)]=p.predicted_count??p.count; });
    return Object.values(by).sort((a,b)=>a.date.localeCompare(b.date));
  },[forecast,placeLabel]);

  if (error) return <div style={{...CARD,color:"var(--destructive)",fontSize:14}}><CardShine/>{error}</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"clamp(10px,1.5vw,16px)" }} data-mount>

      {/* Header + horizon selector */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div>
          <div className="label">{t("nav.analysis","الاستخبارات")}</div>
          <h1 style={{ fontSize:"clamp(18px,2.5vw,24px)", fontWeight:800, color:"var(--foreground)", margin:0 }}>
            {t("analysis.title","التحليلات")}
          </h1>
        </div>

        {/* .ts-selector — glass pill group from index.css */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:12, fontWeight:600, color:"var(--muted-foreground)" }}>
            {t("analysis.horizon_days","أيام التوقع")}
          </span>
          <div className="ts-selector">
            {HORIZONS.map(({value,label,labelKey,defaultLabel})=>{
              const active = horizon===value;
              const text = labelKey ? t(labelKey,defaultLabel) : label;
              return (
                <button key={value} onClick={()=>setHorizon(value)} className={active?"active":""}
                  title={value===365?t("analysis.year_horizon","سنة كاملة"):`${value} ${t("analysis.days","يوم")}`}>
                  {text}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={CARD}>
        <CardShine/>
        <div className="label">{t("analysis.historical","تاريخي")}</div>
        <div style={{ marginBottom:"clamp(12px,1.5vw,18px)" }}>
          <div style={{ fontSize:"clamp(13px,1.6vw,16px)", fontWeight:700, color:"var(--foreground)" }}>{t("analysis.timeline","السلسلة الزمنية")}</div>
          <div style={{ fontSize:12, color:"var(--muted-foreground)", marginTop:3 }}>{t("analysis.timeline_sub","إجمالي الهجمات الشهرية")}</div>
        </div>
        {loading ? (
          <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted-foreground)", fontSize:13 }}>
            {t("common.loading","جارٍ التحميل...")}
          </div>
        ) : (
          <div style={{ direction:"ltr", height:"clamp(160px,22vw,260px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tlData} margin={{top:8,right:8,left:-10,bottom:0}}>
                <defs>
                  <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--chart-1)" stopOpacity={0.45}/>
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="_date" tick={AXIS} tickLine={false} axisLine={false} angle={-30} textAnchor="end" height={48} interval="preserveStartEnd"/>
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Area type="monotone" dataKey="count" name={t("analysis.attacks","الهجمات")}
                  stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#aGrad)"
                  dot={false} activeDot={{r:5,fill:"var(--chart-1)",stroke:"var(--card)",strokeWidth:2}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Forecast */}
      <div style={CARD}>
        <CardShine/>
        <div className="label">{t("analysis.forecast","توقع")}</div>
        <div style={{ marginBottom:"clamp(12px,1.5vw,18px)" }}>
          <div style={{ fontSize:"clamp(13px,1.6vw,16px)", fontWeight:700, color:"var(--foreground)" }}>{t("analysis.attack_forecast","توقعات الهجمات")}</div>
          <div style={{ fontSize:12, color:"var(--muted-foreground)", marginTop:3 }}>{`${t("analysis.next","الـ")} ${horizon} ${t("analysis.days","يوم القادمة")}`}</div>
        </div>
        {fcData.length === 0 ? (
          <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted-foreground)", fontSize:13 }}>
            {t("common.loading","جارٍ التحميل...")}
          </div>
        ) : (
          <div style={{ direction:"ltr", height:"clamp(180px,24vw,300px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fcData} margin={{top:8,right:8,left:-10,bottom:0}}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} angle={-30} textAnchor="end" height={48} interval={Math.floor(fcData.length/7)}/>
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Legend wrapperStyle={{fontSize:"clamp(10px,1.2vw,13px)",color:"var(--muted-foreground)",paddingTop:8}}/>
                {regions.map((r,i)=>(
                  <Line key={r} type="monotone" dataKey={placeLabel(r)}
                    stroke={CHART_COLORS[i%CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{r:4}}/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
