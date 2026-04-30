import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area } from "../../services/api";

const blank: Omit<Area, "id" | "created_at"> = {
  name: "",
  latitude: 24.7136,
  longitude: 46.6753,
  priority: 1,
};

export function AreasAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Area[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [error, setError] = useState<string | null>(null);

  const load = () => Areas.list().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await Areas.create(draft);
      setDraft({ ...blank });
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete?")) return;
    try {
      await Areas.remove(id);
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-accent">{t("admin.areas_title")}</h1>
      {error && <div className="card text-danger">{error}</div>}

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <div className="label">{t("admin.fields.name")}</div>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div>
          <div className="label">{t("admin.fields.lat")}</div>
          <input type="number" step="0.0000001" className="input" value={draft.latitude} onChange={(e) => setDraft({ ...draft, latitude: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("admin.fields.lon")}</div>
          <input type="number" step="0.0000001" className="input" value={draft.longitude} onChange={(e) => setDraft({ ...draft, longitude: Number(e.target.value) })} />
        </div>
        <div>
          <div className="label">{t("admin.fields.priority")}</div>
          <input type="number" className="input" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
        </div>
        <div className="md:col-span-4">
          <button className="btn-primary">{t("common.add")}</button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2">#</th>
              <th>Name</th>
              <th>Lat / Lon</th>
              <th>Priority</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((a) => (
              <tr key={a.id}>
                <td className="py-2">{a.id}</td>
                <td>{a.name}</td>
                <td>{a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}</td>
                <td>{a.priority}</td>
                <td><button onClick={() => remove(a.id)} className="btn-danger">{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
