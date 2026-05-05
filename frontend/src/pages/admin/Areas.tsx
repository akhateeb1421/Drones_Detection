import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area } from "../../services/api";
import { useBilingualName } from "../../i18n/places";

const blank: Omit<Area, "id" | "created_at"> = {
  name: "",
  name_ar: "",
  latitude: 24.7136,
  longitude: 46.6753,
  priority: 1,
};

export function AreasAdmin() {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const [items, setItems] = useState<Area[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [error, setError] = useState<string | null>(null);

  const load = () => Areas.list().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...draft, name_ar: draft.name_ar || null };
      await Areas.create(payload as Omit<Area, "id" | "created_at">);
      setDraft({ ...blank });
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("common.delete_confirm"))) return;
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
          <div className="label">{t("admin.fields.name_en")}</div>
          <input className="input" lang="en" dir="ltr" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div>
          <div className="label">{t("admin.fields.name_ar")}</div>
          <input className="input" lang="ar" dir="rtl" value={draft.name_ar ?? ""} onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} />
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
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 text-start">#</th>
              <th className="text-start">{t("admin.table.name")}</th>
              <th className="text-start">{t("admin.table.lat_lon")}</th>
              <th className="text-start">{t("admin.table.priority")}</th>
              <th className="text-end"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((a) => (
              <tr key={a.id}>
                <td className="py-2 text-start"><span dir="ltr">{a.id}</span></td>
                <td className="text-start">{bilingualName(a)}</td>
                <td className="text-start"><span dir="ltr">{a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}</span></td>
                <td className="text-start"><span dir="ltr">{a.priority}</span></td>
                <td className="text-end"><button onClick={() => remove(a.id)} className="btn-danger">{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
