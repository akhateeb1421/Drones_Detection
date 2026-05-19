import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Attacks, Attack } from "../services/api";
import { DroneMap } from "../components/DroneMap";
import { usePlaceLabel, useTypeLabel } from "../i18n/places";

export function HistoryMap() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const typeLabel  = useTypeLabel();
  const [searchParams] = useSearchParams();
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [region,     setRegion]     = useState(() => searchParams.get("region") ?? "");
  const [attackType, setAttackType] = useState("");
  const [data,       setData]       = useState<Attack[]>([]);
  const [loading,    setLoading]    = useState(false);

  const fetchData = () => {
    setLoading(true);
    Attacks.list({
      date_from:   from   || undefined,
      date_to:     to     || undefined,
      region:      region || undefined,
      attack_type: attackType || undefined,
    }).then(setData).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regions = useMemo(() => {
    const s = new Set(data.map(d => d.region).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [data]);

  const types = useMemo(() => {
    const s = new Set(data.map(d => d.attack_type).filter(Boolean));
    return Array.from(s).sort();
  }, [data]);

  /*
    PIN COLORS — now use CSS custom property tokens instead of
    hardcoded hex values (#03DA9A / #ff4757).
    DroneMap.tsx resolves "var(--primary)" and "var(--destructive)"
    to the actual computed color at render time.
  */
  const markers = data.map(a => ({
    id:     a.id,
    lat:    a.latitude,
    lon:    a.longitude,
    /* Missiles → destructive red, everything else → primary emerald */
    color:  a.attack_type.includes("missile") ? "var(--destructive)" : "var(--primary)",
    label:  `${typeLabel(a.attack_type)} · ${a.region ? placeLabel(a.region) : ""} · ${a.occurred_at.slice(0, 10)}`,
    radius: 5,
  }));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <h1 style={{ fontSize:"clamp(18px,2.2vw,24px)", fontWeight:700, color:"var(--foreground)", margin:0 }}>
        {t("history.title")}
      </h1>

      {/* Filters */}
      <div className="glass" style={{ borderRadius:20, padding:"clamp(16px,2vw,22px)", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12 }}>
        <div>
          <div className="label">{t("history.date_from")}</div>
          <input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD"
            value={from} onChange={e => setFrom(e.target.value)} className="input"/>
        </div>
        <div>
          <div className="label">{t("history.date_to")}</div>
          <input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD"
            value={to} onChange={e => setTo(e.target.value)} className="input"/>
        </div>
        <div>
          <div className="label">{t("history.region")}</div>
          <select value={region} onChange={e => setRegion(e.target.value)} className="input">
            <option value="">{t("common.all")}</option>
            {regions.map(r => <option key={r} value={r}>{placeLabel(r)}</option>)}
          </select>
        </div>
        <div>
          <div className="label">{t("history.attack_type")}</div>
          <select value={attackType} onChange={e => setAttackType(e.target.value)} className="input">
            <option value="">{t("common.all")}</option>
            {types.map(tt => <option key={tt} value={tt}>{typeLabel(tt)}</option>)}
          </select>
        </div>
        <div>
          <div className="label" aria-hidden style={{ visibility:"hidden" }}>&nbsp;</div>
          <button onClick={fetchData} className="btn-primary" style={{ width:"100%" }}>
            {t("common.search")}
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="glass" style={{ borderRadius:20, padding:"clamp(16px,2vw,20px)" }}>
        <div className="label">{t("history.results")} ({data.length})</div>
        <div style={{ height:520, width:"100%", borderRadius:12, overflow:"hidden" }}>
          {loading ? (
            <div style={{ display:"flex", height:"100%", alignItems:"center", justifyContent:"center", color:"var(--muted-foreground)" }}>
              {t("common.loading")}
            </div>
          ) : (
            <DroneMap markers={markers}/>
          )}
        </div>
      </div>
    </div>
  );
}
