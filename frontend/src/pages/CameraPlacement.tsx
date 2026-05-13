import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Predictions, CameraPlacement, Areas, Area } from "../services/api";
import { DroneMap, CameraMarker, SensitiveMarker } from "../components/DroneMap";
import { useBilingualName, usePlaceLabel } from "../i18n/places";

/**
 * Suggested camera placements & headings.
 *
 * Pulls /predict/camera-placements and renders both:
 *   • per-area "early warning" cameras pushed forward along the historical
 *     threat axis, and
 *   • per-hotspot "forward observation" cameras between a sensitive area
 *     and an attack-density cluster.
 *
 * Each suggestion gets a rationale paragraph (the backend ships it ready
 * to render in either language). Operator can tweak radius/FOV/range/
 * cluster count from the controls and recompute on demand.
 */

const DEFAULTS = {
  radius_km: 300,
  fov_h_deg: 82.6,
  assumed_target_distance_m: 5000,
  n_clusters: 4,
  forward_offset: 0.30,
  early_warning_km: 15,
};

export function CameraPlacementPage() {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const placeLabel = usePlaceLabel();

  const [params, setParams] = useState({ ...DEFAULTS });
  const [draft, setDraft] = useState({ ...DEFAULTS });
  const [items, setItems] = useState<CameraPlacement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sensitive areas once for the basemap context.
  useEffect(() => {
    Areas.list().then(setAreas).catch(() => {});
  }, []);

  const fetchSuggestions = (p: typeof DEFAULTS) => {
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {
      radius_km: String(p.radius_km),
      fov_h_deg: String(p.fov_h_deg),
      assumed_target_distance_m: String(p.assumed_target_distance_m),
      n_clusters: String(p.n_clusters),
      forward_offset: String(p.forward_offset),
      early_warning_km: String(p.early_warning_km),
    };
    Predictions.cameraPlacements(query)
      .then(setItems)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  // First load on mount.
  useEffect(() => {
    fetchSuggestions(DEFAULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recompute = () => {
    setParams(draft);
    fetchSuggestions(draft);
  };

  // Map markers for sensitive areas (so the operator sees what's being
  // protected) plus the suggested cameras as FOV cones.
  const sensitiveMarkers: SensitiveMarker[] = useMemo(
    () =>
      areas.map((a) => ({
        name: bilingualName(a),
        lat: a.latitude,
        lon: a.longitude,
      })),
    [areas, bilingualName],
  );

  const cameraMarkers: CameraMarker[] = useMemo(
    () =>
      items.map((s, i) => ({
        id: i,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        heading_deg: s.heading_deg,
        fov_h_deg: s.fov_h_deg,
        distance_m: s.assumed_target_distance_m,
        threatActive: false,
      })),
    [items],
  );

  const counts = useMemo(() => {
    let area = 0;
    let forward = 0;
    for (const s of items) {
      if (s.kind === "area") area++;
      else if (s.kind === "forward") forward++;
    }
    return { area, forward };
  }, [items]);

  const center: [number, number] = items[0]
    ? [items[0].lat, items[0].lon]
    : areas[0]
    ? [areas[0].latitude, areas[0].longitude]
    : [24.7136, 46.6753];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">{t("placement.title")}</h1>
        <div className="text-xs text-muted">
          {t("placement.summary_counts", { area: counts.area, forward: counts.forward })}
        </div>
      </div>

      {/* Controls */}
      <div className="card grid grid-cols-2 md:grid-cols-6 gap-3">
        <div>
          <div className="label">{t("placement.radius")} (km)</div>
          <input type="number" className="input" value={draft.radius_km}
            onChange={(e) => setDraft({ ...draft, radius_km: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("placement.fov")}</div>
          <input type="number" className="input" value={draft.fov_h_deg}
            onChange={(e) => setDraft({ ...draft, fov_h_deg: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("placement.range")} (m)</div>
          <input type="number" className="input" value={draft.assumed_target_distance_m}
            onChange={(e) => setDraft({ ...draft, assumed_target_distance_m: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("placement.clusters")}</div>
          <input type="number" className="input" value={draft.n_clusters}
            onChange={(e) => setDraft({ ...draft, n_clusters: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("placement.forward")}</div>
          <input type="number" step="0.05" className="input" value={draft.forward_offset}
            onChange={(e) => setDraft({ ...draft, forward_offset: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("placement.early_warning")} (km)</div>
          <input type="number" className="input" value={draft.early_warning_km}
            onChange={(e) => setDraft({ ...draft, early_warning_km: Number(e.target.value) })} />
        </div>
        <div className="col-span-2 md:col-span-6 flex items-center justify-end gap-2">
          {loading && <span className="text-xs text-muted">{t("common.loading")}</span>}
          <button onClick={recompute} className="btn-primary">{t("placement.recompute")}</button>
        </div>
      </div>

      {error && <div className="card text-danger">{error}</div>}

      {/* Map */}
      <div className="card">
        <div className="label">{t("placement.map")}</div>
        <div className="h-[520px] w-full">
          <DroneMap
            center={center}
            zoom={6}
            cameras={cameraMarkers}
            sensitiveAreas={sensitiveMarkers}
          />
        </div>
      </div>

      {/* Suggestions list */}
      <div className="card overflow-x-auto">
        <div className="label">{t("placement.suggestions")}</div>
        {items.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{t("common.no_data")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="text-start py-2">{t("placement.name")}</th>
                <th className="text-start">{t("placement.heading")}</th>
                <th className="text-start">{t("placement.details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((s, i) => {
                const km = (params.radius_km).toFixed(0);
                const secs = ((params.early_warning_km * 1000) / 30).toFixed(0);
                const scopeLabel =
                  s.scope === "global"
                    ? t("placement.scope_global")
                    : t("placement.scope_radius", { km });
                const rationale = s.kind === "area"
                  ? t("placement.rationale_area", {
                      area: placeLabel(s.for_area),
                      km: params.early_warning_km,
                      deg: s.heading_deg,
                      dir: t(`compass.${s.heading_label}`, { defaultValue: s.heading_label }),
                      secs,
                      count: s.covers_attacks,
                      scope: scopeLabel,
                      top: placeLabel(s.top_threat_region),
                      topCount: s.top_threat_region_count,
                      spread: s.spread_deg,
                    })
                  : t("placement.rationale_forward", {
                      area: placeLabel(s.for_area),
                      km: (params.assumed_target_distance_m / 1000).toFixed(1),
                      lat: s.lat.toFixed(3),
                      lon: s.lon.toFixed(3),
                      count: s.covers_attacks,
                      top: placeLabel(s.top_threat_region),
                      topCount: s.top_threat_region_count,
                      deg: s.heading_deg,
                      dir: t(`compass.${s.heading_label}`, { defaultValue: s.heading_label }),
                      spread: s.spread_deg,
                    });
                return (
                  <tr key={i} className="align-top">
                    <td className="text-start py-2 pe-3">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted">
                        {s.kind === "area" ? t("placement.kind_area") : t("placement.kind_forward")}
                      </div>
                    </td>
                    <td className="text-start pe-3 whitespace-nowrap">
                      {/* Only the digit string needs LTR override; the
                          compass-direction label is translated text
                          and follows the parent direction (RTL in ar). */}
                      <span className="font-data" dir="ltr">{s.heading_deg}°</span>
                      <span className="text-muted text-xs ms-1">
                        {t(`compass.${s.heading_label}`, { defaultValue: s.heading_label })}
                      </span>
                    </td>
                    <td className="text-start text-xs leading-relaxed">{rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
