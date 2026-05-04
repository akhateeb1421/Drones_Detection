import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area, CameraPlacement, Predictions } from "../services/api";
import { DroneMap, CameraMarker } from "../components/DroneMap";

export function CameraPlacementPage() {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<CameraPlacement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [radiusKm, setRadiusKm] = useState(300);
  const [fovHDeg, setFovHDeg] = useState(82.6);
  const [rangeM, setRangeM] = useState(5000);
  const [nClusters, setNClusters] = useState(4);
  const [forwardOffset, setForwardOffset] = useState(0.3);
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

  // Two camera marker sets so we can color them differently. The DroneMap
  // component supports a `cameras` array — area/forward markers go through
  // the same renderer but we tag forward ones with `threatActive: true` to
  // get the orange/red treatment, which we hijack as the "forward" color.
  const cameraMarkers: CameraMarker[] = useMemo(
    () =>
      suggestions.map((s, i) => ({
        id: i,
        name: `${s.kind === "forward" ? "FWD: " : ""}${s.name}`,
        lat: s.lat,
        lon: s.lon,
        heading_deg: s.heading_deg,
        fov_h_deg: s.fov_h_deg,
        distance_m: s.assumed_target_distance_m,
        threatActive: s.kind === "forward",
      })),
    [suggestions]
  );

  const sensitive = areas.map((a) => ({ name: a.name, lat: a.latitude, lon: a.longitude }));

  const areaCount = suggestions.filter((s) => s.kind === "area").length;
  const fwdCount = suggestions.filter((s) => s.kind === "forward").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-accent">{t("placement.title")}</h1>
        <div className="text-xs text-muted">
          <span className="inline-block rounded-full bg-success/30 px-2 py-0.5 mr-2 text-success">● area</span>
          <span className="inline-block rounded-full bg-danger/30 px-2 py-0.5 text-danger">● forward</span>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 md:grid-cols-6">
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
              {areaCount} area · {fwdCount} forward
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
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2">{t("placement.name")}</th>
                  <th>{t("placement.heading")}</th>
                  <th>{t("placement.attacks")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {suggestions.map((s) => (
                  <tr key={s.name}>
                    <td className="py-2 align-top">
                      <span className={`badge mr-1 ${s.kind === "forward" ? "bg-danger/30 text-danger" : "bg-success/30 text-success"}`}>
                        {s.kind}
                      </span>
                      <span className="font-medium">{s.name}</span>
                      <div className="text-xs text-muted">
                        {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="font-semibold">
                        {s.heading_deg}° <span className="text-accent">{s.heading_label}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {s.kind === "forward" ? `~${s.spread_deg} km cluster` : `±${s.spread_deg}° spread`}
                      </div>
                    </td>
                    <td className="align-top">
                      <div>{s.covers_attacks}</div>
                      <div className="text-xs text-muted">{s.top_threat_region}</div>
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
                  {s.kind}
                </span>
                <span className="font-medium text-accent">{s.name}</span>
                <span className="text-muted"> — {s.rationale}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
