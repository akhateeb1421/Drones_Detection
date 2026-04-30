import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera } from "../../services/api";

const blank: Omit<Camera, "id" | "created_at"> = {
  name: "",
  stream_url: "",
  latitude: 24.7136,
  longitude: 46.6753,
  heading_deg: 0,
  altitude_m: 10,
  fov_h_deg: 82.6,
  fov_v_deg: 52,
  sensor_w_px: 1280,
  assumed_target_distance_m: 500,
  enabled: true,
};

export function CamerasAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Camera[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [token, setToken] = useState(localStorage.getItem("admin_token") ?? "");
  const [error, setError] = useState<string | null>(null);

  const load = () => Cameras.list().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const setField = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await Cameras.create(draft);
      setDraft({ ...blank });
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete?")) return;
    try {
      await Cameras.remove(id);
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const saveToken = () => {
    localStorage.setItem("admin_token", token);
    alert("Saved");
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-accent">{t("admin.cameras_title")}</h1>

      <div className="card">
        <div className="label">{t("admin.token_label")}</div>
        <div className="flex gap-2">
          <input value={token} onChange={(e) => setToken(e.target.value)} className="input flex-1" type="password" />
          <button onClick={saveToken} className="btn-primary">{t("admin.token_save")}</button>
        </div>
        <div className="mt-1 text-xs text-muted">{t("admin.token_help")}</div>
      </div>

      {error && <div className="card text-danger">{error}</div>}

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <div className="label">{t("admin.fields.name")}</div>
          <input className="input" value={draft.name} onChange={(e) => setField("name", e.target.value)} required />
        </div>
        <div className="md:col-span-2">
          <div className="label">{t("admin.fields.stream_url")}</div>
          <input className="input" value={draft.stream_url} onChange={(e) => setField("stream_url", e.target.value)} placeholder="http://pi.local:8081/stream" required />
        </div>
        <div>
          <div className="label">{t("admin.fields.lat")}</div>
          <input type="number" step="0.0000001" className="input" value={draft.latitude} onChange={(e) => setField("latitude", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.lon")}</div>
          <input type="number" step="0.0000001" className="input" value={draft.longitude} onChange={(e) => setField("longitude", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.heading")}</div>
          <input type="number" step="0.1" className="input" value={draft.heading_deg} onChange={(e) => setField("heading_deg", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.altitude")}</div>
          <input type="number" step="0.1" className="input" value={draft.altitude_m} onChange={(e) => setField("altitude_m", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.fov_h")}</div>
          <input type="number" step="0.1" className="input" value={draft.fov_h_deg} onChange={(e) => setField("fov_h_deg", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.fov_v")}</div>
          <input type="number" step="0.1" className="input" value={draft.fov_v_deg} onChange={(e) => setField("fov_v_deg", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.sensor_w")}</div>
          <input type="number" className="input" value={draft.sensor_w_px} onChange={(e) => setField("sensor_w_px", Number(e.target.value))} />
        </div>
        <div>
          <div className="label">{t("admin.fields.assumed_distance")}</div>
          <input type="number" step="1" className="input" value={draft.assumed_target_distance_m} onChange={(e) => setField("assumed_target_distance_m", Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setField("enabled", e.target.checked)} />
          {t("admin.fields.enabled")}
        </label>
        <div className="md:col-span-3">
          <button className="btn-primary">{t("common.add")}</button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2">#</th>
              <th>Name</th>
              <th>Stream</th>
              <th>Lat / Lon</th>
              <th>Head</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((c) => (
              <tr key={c.id}>
                <td className="py-2">{c.id}</td>
                <td>{c.name}</td>
                <td className="max-w-xs truncate" title={c.stream_url}>{c.stream_url}</td>
                <td>{c.latitude.toFixed(4)}, {c.longitude.toFixed(4)}</td>
                <td>{c.heading_deg}°</td>
                <td>{c.enabled ? "✓" : "—"}</td>
                <td><button onClick={() => remove(c.id)} className="btn-danger">{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
