import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Attacks, Attack } from "../services/api";
import { DroneMap } from "../components/DroneMap";
import { usePlaceLabel, useTypeLabel } from "../i18n/places";

export function HistoryMap() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const typeLabel = useTypeLabel();
  const [searchParams] = useSearchParams();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Pre-fill region from ?region=... so Overview pie click-through lands here
  // with the right filter already applied.
  const [region, setRegion] = useState(() => searchParams.get("region") ?? "");
  const [attackType, setAttackType] = useState("");
  const [data, setData] = useState<Attack[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = () => {
    setLoading(true);
    Attacks.list({
      date_from: from || undefined,
      date_to: to || undefined,
      region: region || undefined,
      attack_type: attackType || undefined,
    }).then(setData).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regions = useMemo(() => {
    const s = new Set(data.map((d) => d.region).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [data]);
  const types = useMemo(() => {
    const s = new Set(data.map((d) => d.attack_type).filter(Boolean));
    return Array.from(s).sort();
  }, [data]);

  const markers = data.map((a) => ({
    id: a.id,
    lat: a.latitude,
    lon: a.longitude,
    // Mint for drone strikes, crimson for missile attacks — semantic and distinct.
    color: a.attack_type.includes("missile") ? "#ff6266" : "#00ca7f",
    label: `${typeLabel(a.attack_type)} · ${a.region ? placeLabel(a.region) : ""} · ${a.occurred_at.slice(0, 10)}`,
    radius: 5,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("history.title")}</h1>
      <div className="card grid grid-cols-1 gap-3 md:grid-cols-5">
        <div>
          <div className="label">{t("history.date_from")}</div>
          <input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </div>
        <div>
          <div className="label">{t("history.date_to")}</div>
          <input type="text" inputMode="numeric" dir="ltr" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </div>
        <div>
          <div className="label">{t("history.region")}</div>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="input">
            <option value="">{t("common.all")}</option>
            {regions.map((r) => <option key={r} value={r}>{placeLabel(r)}</option>)}
          </select>
        </div>
        <div>
          <div className="label">{t("history.attack_type")}</div>
          <select value={attackType} onChange={(e) => setAttackType(e.target.value)} className="input">
            <option value="">{t("common.all")}</option>
            {types.map((tt) => <option key={tt} value={tt}>{typeLabel(tt)}</option>)}
          </select>
        </div>
        <div>
          {/* Invisible label spacer so the search button aligns with
              the inputs above. Without this the button sat ~14 px
              lower because the other cells reserve label height. */}
          <div className="label" aria-hidden style={{ visibility: "hidden" }}>&nbsp;</div>
          <button onClick={fetchData} className="btn-primary w-full">{t("common.search")}</button>
        </div>
      </div>
      <div className="card">
        <div className="label">{t("history.results")} ({data.length})</div>
        <div className="h-[520px] w-full">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted">{t("common.loading")}</div>
          ) : (
            <DroneMap markers={markers} />
          )}
        </div>
      </div>
    </div>
  );
}
