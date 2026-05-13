import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Areas, Area } from "../../services/api";
import { usePlaceLabel, useBilingualName } from "../../i18n/places";
import { LocationPicker } from "../../components/LocationPicker";

const blank: Omit<Area, "id" | "created_at"> = {
  name: "",
  name_ar: "",
  latitude: 24.7136,
  longitude: 46.6753,
  priority: 1,
};

export function AreasAdmin() {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const bilingualName = useBilingualName();
  const [items, setItems] = useState<Area[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  // null = creating new; number = editing that row.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => Areas.list().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const startEdit = (a: Area) => {
    setEditingId(a.id);
    setDraft({
      name: a.name,
      name_ar: a.name_ar ?? "",
      latitude: a.latitude,
      longitude: a.longitude,
      priority: a.priority,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ ...blank });
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Required-field guard. HTML `required` already blocks an empty
    // submit but doesn't catch whitespace-only ("   ") and can be
    // bypassed via DevTools, so we re-check here. Backend now
    // enforces the same rule via Pydantic min_length=1 + strip.
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setError(t("admin.fields.name_required", "Name is required."));
      return;
    }

    try {
      // Backend treats empty Arabic name as null. Strip both names so
      // a stray space doesn't become the canonical value.
      const payload = {
        ...draft,
        name: trimmedName,
        name_ar: draft.name_ar?.trim() || null,
      };
      if (editingId !== null) {
        await Areas.update(editingId, payload);
        setEditingId(null);
      } else {
        await Areas.create(payload);
      }
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
      if (editingId === id) cancelEdit();
      load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("admin.areas_title")}</h1>
      {error && <div className="card text-danger">{error}</div>}

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <div className="label">
            {t("admin.fields.name_en")}
            <span style={{ color: "#f87171", marginInlineStart: 4 }}>*</span>
          </div>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div>
          <div className="label">{t("admin.fields.name_ar")}</div>
          <input className="input" dir="rtl" value={draft.name_ar ?? ""} onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} />
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
        <div className="md:col-span-3 flex items-end gap-2">
          <button type="button" onClick={() => setShowMap((v) => !v)} className="btn-ghost">
            {showMap ? t("admin.fields.hide_map") : t("admin.fields.show_map")}
          </button>
          {editingId !== null && (
            <button type="button" onClick={cancelEdit} className="btn-ghost">
              {t("common.cancel")}
            </button>
          )}
          <button type="submit" className="btn-primary">
            {editingId !== null ? t("common.save","Save changes") : t("common.add")}
          </button>
        </div>
        {showMap && (
          <div className="md:col-span-4">
            <div className="text-xs text-muted mb-1">{t("admin.fields.pick_hint")}</div>
            <LocationPicker
              lat={draft.latitude}
              lon={draft.longitude}
              onChange={(lat, lon) => setDraft({ ...draft, latitude: lat, longitude: lon })}
            />
          </div>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-start text-xs uppercase text-slate-400">
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
                <td className="py-2 text-start font-data"><span dir="ltr">{a.id}</span></td>
                <td className="text-start">{a.name_ar ? bilingualName(a) : placeLabel(a.name)}</td>
                <td className="text-start font-data whitespace-nowrap"><span dir="ltr">{a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}</span></td>
                <td className="text-start font-data"><span dir="ltr">{a.priority}</span></td>
                <td className="text-end">
                  <div style={{ display:"inline-flex", gap:6 }}>
                    <button onClick={() => startEdit(a)} className="btn-primary text-xs">
                      {t("common.edit","Edit")}
                    </button>
                    <button onClick={() => remove(a.id)} className="btn-danger">
                      {t("common.delete")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
