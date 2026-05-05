import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area, CameraPlacement, Predictions } from "../services/api";
import { DroneMap, CameraMarker } from "../components/DroneMap";
import { usePlaceLabel, useCompassLabel, useBilingualName } from "../i18n/places";

function localizeSuggestionName(rawName: string, placeLabel: (s: string) => string): string {
  if (rawName.startsWith("CAM-")) {
    return `CAM-${placeLabel(rawName.slice(4))}`;
  }
  if (rawName.startsWith("FWD-")) {
    const m = rawName.match(/^FWD-(.+)-(\d+)$/);
    if (m) return `FWD-${placeLabel(m[1])}-${m[2]}`;
  }
  return rawName;
}

function approxKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dN = (lat2 - lat1) * 111.32;
  const dE = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dN * dN + dE * dE);
}

export function CameraPlacementPage() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const compassLabel = useCompassLabel();
  const bilingualName = useBilingualName();
  const [suggestions, setSuggestions] = useState<CameraPlacement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [radiusKm, setRadiusKm] = useState(300);
  const [fovHDeg, setFovHDeg] = useState(82.6);
  const [rangeM, setRangeM] = useState(5000);
  const [nClusters, setNClusters] = useState(4);
  const [forwardOffset, setForwardOffset] = useState(0.3);
  const [earlyWarningKm, setEarlyWarningKm] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Areas.list().then(setAreas).catch((e) => setError(String(e)));
  }, []);

  const recompute = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await Predictions.cameraPlacements({
        radius_km: String(radiusKm),
        fov_h_deg: String(fovHDeg),
        assumed_target_distance_m: String(rangeM),
        n_clusters: String(nClusters),
        forward_offset: String(forwardOffset),
        early_warning_km: String(earlyWarningKm),
      });
      setSuggestions(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Translate the embedded sensitive-area name. Prefer the row-level name_ar
  // from the loaded `areas` list when in Arabic mode; fall back to the static
  // places dictionary for legacy names.
  const localizeFromRow = (rawName: string): string => {
    const stripped = rawName.startsWith("CAM-")
      ? rawName.slice(4)
      : rawName.startsWith("FWD-")
        ? rawName.replace(/^FWD-/, "").replace(/-\d+$/, "")
        : rawName;
    const row = areas.find((a) => a.name === stripped);
    if (row) {
      const localized = bilingualName(row);
      if (rawName.startsWith("CAM-")) return `CAM-${localized}`;
      if (rawName.startsWith("FWD-")) {
        const m = rawName.match(/^FWD-(.+)-(\d+)$/);
        if (m) return `FWD-${localized}-${m[2]}`;
      }
      return localized;
    }
    return localizeSuggestionName(rawName, placeLabel);
  };

  const cameraMarkers: CameraMarker[] = useMemo(
    () =>
      suggestions.map((s, i) => ({
        id: i,
        name: `${s.kind === "forward" ? "FWD: " : ""}${localizeFromRow(s.name)}`,
        lat: s.lat,
        lon: s.lon,
        heading_deg: s.heading_deg,
        fov_h_deg: s.fov_h_deg,
        distance_m: s.assumed_target_distance_m,
        threatActive: s.kind === "forward",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestions, areas]
  );

  const sensitive = areas.map((a) => ({ name: bilingualName(a), lat: a.latitude, lon: a.longitude }));

  const areaCount = suggestions.filter((s) => s.kind === "area").length;
  const fwdCount = suggestions.filter((s) => s.kind === "forward").length;

  function rationaleFor(s: CameraPlacement): string {
    const homeRow = areas.find((a) => a.name === s.for_area);
    const area = homeRow ? bilingualName(homeRow) : placeLabel(s.for_area);
    const top = placeLabel(s.top_threat_region);
    const dir = compassLabel(s.heading_label);
    const scope =
      s.scope === "global"
        ? t("placement.scope_global")
        : s.scope === "cluster"
          ? t("placement.scope_cluster")
          : t("placement.scope_radius", { km: s.scope.replace(/km$/i, "") });
    if (s.kind === "forward") {
      const km = homeRow ? approxKm(homeRow.latitude, homeRow.longitude, s.lat, s.lon) : 0;
      return t("placement.rationale_forward", {
        area,
        km: km.toFixed(0),
        lat: s.lat.toFixed(3),
        lon: s.lon.toFixed(3),
        count: s.covers_attacks,
        top,
        topCount: s.top_threat_region_count,
        deg: Math.round(s.heading_deg),
        dir,
        spread: Math.round(s.spread_deg),
      });
    }
    return t("placement.rationale_area", {
      area,
      km: Math.round(earlyWarningKm),
      deg: Math.round(s.heading_deg),
      dir,
      secs: Math.round((earlyWarningKm * 1000) / 30),
      count: s.covers_attacks,
      scope,
      top,
      topCount: s.top_threat_region_count,
      spread: Math.round(s.spread_deg),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-accent">{t("placement.title")}</h1>
        <div className="text-xs text-muted">
          <span className="inline-block rounded-full bg-success/30 px-2 py-0.5 mr-2 text-success">● {t("placement.kind_area")}</span>
          <span className="inline-block rounded-full bg-danger/30 px-2 py-0.5 text-danger">● {t("placement.kind_forward")}</span>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 md:grid-cols-7">
        <div>
          <div className="label">{t("placement.radius")} (km)</div>
          <input type="number" min={50} max={2000} step={50} className="input"
            value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("placement.fov")} (°)</div>
          <input type="number" min={10} max={120} step={1} className="input"
            value={fovHDeg} onChange={(e) => setFovHDeg(Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("placement.range")} (m)</div>
          <input type="number" min={100} max={50000} step={500} className="input"
            value={rangeM} onChange={(e) => setRangeM(Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("placement.clusters")}</div>
          <input type="number" min={1} max={10} step={1} className="input"
            value={nClusters} onChange={(e) => setNClusters(Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("placement.forward")} (0–0.9)</div>
          <input type="number" min={0} max={0.9} step={0.05} className="input"
            value={forwardOffset} onChange={(e) => setForwardOffset(Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("placement.early_warning")} (km)</div>
          <input type="number" min={0} max={200} step={5} className="input"
            value={earlyWarningKm} onChange={(e) => setEarlyWarningKm(Number(e.target.value))} />
        </div>
        <div className="flex items-end">
          <button onClick={recompute} disabled={busy} className="btn-primary w-full">
            {busy ? t("common.loading") : t("placement.recompute")}
          </button>
        </div>
      </div>

      {error && <div className="card text-danger">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="label">{t("placement.map")}</div>
            <div className="text-xs text-muted">
              {t("placement.summary_counts", { area: areaCount, forward: fwdCount })}
            </div>
          </div>
          <div className="h-[520px] w-full">
            <DroneMap
              center={
                cameraMarkers[0] ? [cameraMarkers[0].lat, cameraMarkers[0].lon] : [24.7136, 46.6753]
              }
              zoom={cameraMarkers[0] ? 9 : 6}
              cameras={cameraMarkers}
              sensitiveAreas={sensitive}
            />
          </div>
        </div>
        <div className="card overflow-x-auto">
          <div className="label">{t("placement.suggestions")} ({suggestions.length})</div>
          {suggestions.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">{t("common.no_data")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2 text-start">{t("placement.name")}</th>
                  <th className="text-start">{t("placement.heading")}</th>
                  <th className="text-start">{t("placement.attacks")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {suggestions.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2 align-top text-start">
                      <span className={`badge mr-1 ${s.kind === "forward" ? "bg-danger/30 text-danger" : "bg-success/30 text-success"}`}>
                        {s.kind === "forward" ? t("placement.kind_forward") : t("placement.kind_area")}
                      </span>
                      <span className="font-medium">{localizeFromRow(s.name)}</span>
                      <div className="text-xs text-muted"><span dir="ltr">{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</span></div>
                    </td>
                    <td className="align-top text-start">
                      <div className="font-semibold">
                        <span dir="ltr">{s.heading_deg}°</span> <span className="text-accent">{compassLabel(s.heading_label)}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {s.kind === "forward"
                          ? t("placement.spread_cluster", { km: s.spread_deg })
                          : t("placement.spread_deg", { deg: s.spread_deg })}
                      </div>
                    </td>
                    <td className="align-top text-start">
                      <div><span dir="ltr">{s.covers_attacks}</span></div>
                      <div className="text-xs text-muted">{placeLabel(s.top_threat_region)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="label">{t("placement.details")}</div>
        {suggestions.length === 0 ? (
          <div className="text-sm text-muted">{t("common.no_data")}</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {suggestions.map((s) => (
              <li key={s.name}>
                <span className={`badge mr-2 ${s.kind === "forward" ? "bg-danger/30 text-danger" : "bg-success/30 text-success"}`}>
                  {s.kind === "forward" ? t("placement.kind_forward") : t("placement.kind_area")}
                </span>
                <span className="font-medium text-accent">{localizeFromRow(s.name)}</span>
                <span className="text-muted"> — {rationaleFor(s)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
