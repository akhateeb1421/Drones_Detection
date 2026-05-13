import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid, Legend, Line, LineChart, Area, AreaChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from "recharts";
import { Analysis as AnalysisAPI, Predictions, ForecastPoint, TimelinePoint } from "../services/api";
import { usePlaceLabel } from "../i18n/places";

const C1 = "#01F2CF";
const C2 = "#03DA9A";
const C3 = "#03B3DA";
const DANGER = "#f87171";
const WARN = "#fbbf24";
const PURPLE = "#a78bfa";

const REGION_COLORS = [C1, DANGER, C3, WARN, PURPLE, C2, "#60a5fa", "#fb923c"];

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
  borderRadius: 10, color: "#e0f5f2",
  fontSize: 13, padding: "10px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
};
const TTL: React.CSSProperties = { color: C1, fontWeight: 700, marginBottom: 4 };
const TTI: React.CSSProperties = { color: "#5fa09a" };
const GRID = { stroke: "rgba(1,242,207,0.05)", strokeDasharray: "4 4" };
const AXIS = { fill: "#3d7872", fontSize: 11 };

function CardShine() {
  return <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:"linear-gradient(90deg,transparent,rgba(1,242,207,0.16),transparent)",pointerEvents:"none" }}/>;
}
function Tag({ label }: { label: string }) {
  return <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C1,opacity:0.6,marginBottom:4 }}>{label}</div>;
}
function CardTitle({ label, sub }: { label:string; sub?:string }) {
  return (
    <div style={{ marginBottom:"clamp(12px,1.5vw,18px)" }}>
      <div style={{ fontSize:"clamp(13px,1.6vw,16px)",fontWeight:700,color:"#e0f5f2" }}>{label}</div>
      {sub && <div style={{ fontSize:12,color:"#3d7872",marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function isoDay(s: string): string {
  if (!s) return "";
  const i = s.indexOf("T");
  return i > 0 ? s.slice(0, i) : s.slice(0, 10);
}

/* Format timeline dates nicely */
function fmtMonth(s: string): string {
  const d = new Date(isoDay(s));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("ar-SA-u-nu-latn", { year:"2-digit", month:"short" });
}

export function Analysis() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const placeLabel = usePlaceLabel();

  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    AnalysisAPI.timeline({ granularity: "month" })
      .then(setTimeline)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Predictions.forecast({ days: String(horizon) })
      .then(setForecast)
      .catch(e => setError(String(e)));
  }, [horizon]);

  /* Format timeline for chart */
  const tlData = useMemo(() =>
    timeline.map(p => ({ ...p, _date: fmtMonth(p.date ?? p.month ?? "") }))
  , [timeline]);

  /* Format forecast — get unique regions */
  const regions = useMemo(() => {
    const s = new Set<string>();
    forecast.forEach(p => s.add(p.region));
    return [...s];
  }, [forecast]);

  const fcData = useMemo(() => {
    const byDate: Record<string, any> = {};
    forecast.forEach(p => {
      const d = isoDay(p.date ?? "");
      if (!byDate[d]) byDate[d] = { date: d };
      byDate[d][placeLabel(p.region)] = p.predicted_count ?? p.count;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [forecast, placeLabel]);

  if (error) return <div style={{ ...CARD, color: DANGER, fontSize:14 }}><CardShine/>{error}</div>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"clamp(10px,1.5vw,16px)" }} data-mount>

      {/* Page header + horizon control */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
        <div>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C1,opacity:0.6,marginBottom:4 }}>{t("nav.analysis","الاستخبارات")}</div>
          <h1 style={{ fontSize:"clamp(18px,2.5vw,24px)",fontWeight:800,color:"#e0f5f2",margin:0 }}>{t("analysis.title","التحليلات")}</h1>
        </div>
        {/* Horizon selector */}
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ fontSize:12,color:"#5fa09a" }}>{t("analysis.horizon_days","أيام التوقع")}</div>
          <div style={{ display:"flex",gap:3,padding:3,background:"rgba(1,242,207,0.05)",border:"0.5px solid rgba(1,242,207,0.10)",borderRadius:10 }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setHorizon(d)}
                style={{ padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all 0.15s",
                  background: horizon===d ? `linear-gradient(135deg,${C1},${C3})` : "transparent",
                  color: horizon===d ? "#0a1410" : "#5fa09a",
                }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ ...CARD }}>
        <CardShine/>
        <Tag label={t("analysis.historical","تاريخي")}/>
        <CardTitle label={t("analysis.timeline","السلسلة الزمنية")} sub={t("analysis.timeline_sub","إجمالي الهجمات الشهرية")}/>
        {loading ? (
          <div style={{ height:200,display:"flex",alignItems:"center",justifyContent:"center",color:"#3d7872",fontSize:13 }}>
            {t("common.loading","جارٍ التحميل...")}
          </div>
        ) : (
          <div style={{ direction:"ltr",height:"clamp(160px,22vw,260px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tlData} margin={{ top:8,right:8,left:-10,bottom:0 }}>
                <defs>
                  <linearGradient id="tg1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C1} stopOpacity={0.4}/>
                    <stop offset="100%" stopColor={C1} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="_date" tick={AXIS} tickLine={false} axisLine={false}
                  angle={-30} textAnchor="end" height={48} interval="preserveStartEnd"/>
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Area type="monotone" dataKey="count" name={t("analysis.attacks","الهجمات")}
                  stroke={C1} strokeWidth={2.5} fill="url(#tg1)"
                  dot={false} activeDot={{ r:5,fill:C1,stroke:"#0d1117",strokeWidth:2 }}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Forecast */}
      <div style={{ ...CARD }}>
        <CardShine/>
        <Tag label={t("analysis.forecast","توقع")}/>
        <CardTitle
          label={t("analysis.attack_forecast","توقعات الهجمات")}
          sub={`${t("analysis.next","الـ")} ${horizon} ${t("analysis.days","يوم القادمة")}`}
        />
        {fcData.length === 0 ? (
          <div style={{ height:200,display:"flex",alignItems:"center",justifyContent:"center",color:"#3d7872",fontSize:13 }}>
            {t("common.loading","جارٍ التحميل...")}
          </div>
        ) : (
          <div style={{ direction:"ltr",height:"clamp(180px,24vw,300px)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fcData} margin={{ top:8,right:8,left:-10,bottom:0 }}>
                <CartesianGrid {...GRID}/>
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false}
                  angle={-30} textAnchor="end" height={48} interval={Math.floor(fcData.length / 7)}/>
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36}/>
                <Tooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTI}/>
                <Legend wrapperStyle={{ fontSize:"clamp(10px,1.2vw,13px)",color:"#5fa09a",paddingTop:8 }}/>
                {regions.map((r, i) => (
                  <Line key={r} type="monotone" dataKey={placeLabel(r)}
                    stroke={REGION_COLORS[i % REGION_COLORS.length]}
                    strokeWidth={2} dot={false}
                    activeDot={{ r:4 }}/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
