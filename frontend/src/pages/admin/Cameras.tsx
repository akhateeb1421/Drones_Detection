import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera } from "../../services/api";
import { LocationPicker } from "../../components/LocationPicker";
import { useBilingualName } from "../../i18n/places";

const blank: Omit<Camera, "id" | "created_at"> = {
  name: "", name_ar: "", stream_url: "",
  latitude: 24.7136, longitude: 46.6753,
  heading_deg: 0, altitude_m: 10,
  fov_h_deg: 82.6, fov_v_deg: 52,
  sensor_w_px: 1280, assumed_target_distance_m: 500,
  enabled: true,
};

/* Shared inline styles — all colors from var(--*) tokens only */
const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "calc(var(--radius, 0.875rem) + 4px)",
  padding: "clamp(18px,2.2vw,26px)",
  position: "relative", overflow: "hidden", marginBottom: 16,
  boxShadow: "var(--shadow-card)",
};
const cardShine: React.CSSProperties = {
  position: "absolute", top: 0, left: 0, right: 0, height: 1,
  background: "linear-gradient(90deg,transparent,var(--primary-glow),transparent)",
  pointerEvents: "none",
};
/* Label uses var(--primary) to match .label class */
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700,
  letterSpacing: "0.16em", textTransform: "uppercase",
  color: "var(--primary)", opacity: 0.8, marginBottom: 6,
};
/* Input uses var(--*) tokens — matches .input class exactly */
const inputStyle: React.CSSProperties = {
  width: "100%", height: 40, padding: "0 14px",
  borderRadius: "var(--radius, 0.875rem)",
  background: "var(--background)",
  border: "1px solid var(--input)",
  color: "var(--foreground)",
  fontSize: 14, fontFamily: "inherit",
  outline: "none", transition: "border-color 0.14s, box-shadow 0.14s",
  boxSizing: "border-box" as const,
};

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--ring)";
  e.currentTarget.style.boxShadow   = "0 0 0 3px oklch(from var(--ring) l c h / 0.18)";
}
function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "var(--input)";
  e.currentTarget.style.boxShadow   = "none";
}

function FormInput({ label, value, onChange, type = "text", placeholder = "", required = false }: {
  label: string; value: string | number; onChange: (v: any) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: "var(--destructive)", marginInlineStart: 4 }}>*</span>}
      </label>
      <input
        type={type} value={value} placeholder={placeholder} required={required}
        onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
        style={inputStyle}
        onFocus={focusInput}
        onBlur={blurInput}
      />
    </div>
  );
}

export function CamerasAdmin() {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const [items,     setItems]     = useState<Camera[]>([]);
  const [draft,     setDraft]     = useState({ ...blank });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [token,     setToken]     = useState(localStorage.getItem("admin_token") ?? "");
  const [error,     setError]     = useState<string | null>(null);
  const [showMap,   setShowMap]   = useState(true);

  const load = () => Cameras.list().then(setItems).catch(e => setError(String(e)));
  useEffect(() => { load(); }, []);

  const setField = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const startEdit = (cam: Camera) => {
    setEditingId(cam.id);
    setDraft({
      name: cam.name, name_ar: cam.name_ar ?? "", stream_url: cam.stream_url,
      latitude: cam.latitude, longitude: cam.longitude,
      heading_deg: cam.heading_deg, altitude_m: cam.altitude_m,
      fov_h_deg: cam.fov_h_deg, fov_v_deg: cam.fov_v_deg,
      sensor_w_px: cam.sensor_w_px,
      assumed_target_distance_m: cam.assumed_target_distance_m,
      enabled: cam.enabled,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => { setEditingId(null); setDraft({ ...blank }); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const trimmedName = draft.name.trim();
    if (!trimmedName) { setError(t("cameras.name_required", "Name is required.")); return; }
    try {
      const payload = { ...draft, name: trimmedName, name_ar: draft.name_ar?.trim() || null };
      if (editingId !== null) {
        await Cameras.update(editingId, payload as Partial<Camera>);
        setEditingId(null);
      } else {
        await Cameras.create(payload as Omit<Camera, "id" | "created_at">);
      }
      setDraft({ ...blank }); load();
    } catch (e: unknown) { setError(String((e as Error)?.message ?? e)); }
  };

  const remove = async (id: number) => {
    if (!confirm(t("common.confirm_delete", "Are you sure?"))) return;
    try {
      await Cameras.delete(id);
      if (editingId === id) cancelEdit();
      load();
    } catch (e: unknown) { setError(String(e)); }
  };

  return (
    <div data-mount>
      {/* Page title */}
      <div style={{ marginBottom: 20 }}>
        <div className="label" style={{ marginBottom: 4 }}>
          {t("nav.admin", "Administration")}
        </div>
        <h1 style={{ fontSize: "clamp(18px,2.5vw,24px)", fontWeight: 800, color: "var(--foreground)", margin: 0 }}>
          {t("nav.cameras", "Camera Management")}
        </h1>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: 14, padding: "12px 16px",
          borderRadius: "var(--radius)",
          background: "oklch(from var(--destructive) l c h / 0.08)",
          border: "1px solid oklch(from var(--destructive) l c h / 0.30)",
          color: "var(--destructive)", fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Admin token */}
      <div style={cardStyle}>
        <div style={cardShine}/>
        <label style={labelStyle}>{t("admin.token_label", "Admin Token")}</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="password" value={token}
            onChange={e => { setToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
            style={{ ...inputStyle, flex: 1 }}
            placeholder="••••••••••••"
            onFocus={focusInput}
            onBlur={blurInput}
          />
          {/* Save Token — btn-primary via className, no inline color */}
          <button
            onClick={() => localStorage.setItem("admin_token", token)}
            className="btn-primary"
          >
            {t("admin.save_token", "Save token")}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 6 }}>
          {t("admin.token_note", "Stored locally and sent as X-Admin-Token on writes.")}
        </div>
      </div>

      {/* Camera form */}
      <div style={cardStyle}>
        <div style={cardShine}/>
        <form onSubmit={submit}>
          {/* Name row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            <FormInput label={t("cameras.name_en", "Name (English)")} value={draft.name} onChange={v => setField("name", v)} placeholder="backcam" required/>
            <FormInput label={t("cameras.name_ar", "Name (Arabic)")}  value={draft.name_ar ?? ""} onChange={v => setField("name_ar", v)} placeholder="الكاميرا الخلفية"/>
            <FormInput label={t("cameras.stream_url", "Stream URL")}  value={draft.stream_url} onChange={v => setField("stream_url", v)} placeholder="http://pi.local:8081/stream"/>
          </div>

          {/* Lat/Lon */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <FormInput label={t("cameras.latitude",  "Latitude")}  value={draft.latitude}  onChange={v => setField("latitude", v)}  type="number"/>
            <FormInput label={t("cameras.longitude", "Longitude")} value={draft.longitude} onChange={v => setField("longitude", v)} type="number"/>
          </div>

          {/* Map toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              {t("cameras.pick_on_map", "Pick on map")}
            </div>
            {/* Ghost button — no inline color */}
            <button type="button" onClick={() => setShowMap(v => !v)} className="btn-ghost">
              {showMap ? t("cameras.hide_map", "Hide map") : t("cameras.show_map", "Show map")}
            </button>
          </div>

          {showMap && (
            <div style={{
              height: 320, borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 14,
              border: "1px solid var(--border)",
            }}>
              <LocationPicker
                lat={draft.latitude} lon={draft.longitude}
                onChange={(lat, lon) => setDraft(d => ({ ...d, latitude: lat, longitude: lon }))}
              />
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 14 }}>
            {t("cameras.map_hint", "Click or drag the marker to set coordinates.")}
          </div>

          {/* Technical params */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <FormInput label={t("cameras.heading",  "Heading (deg)")}      value={draft.heading_deg}                onChange={v => setField("heading_deg", v)}                type="number"/>
            <FormInput label={t("cameras.altitude", "Altitude (m)")}       value={draft.altitude_m ?? 10}           onChange={v => setField("altitude_m", v)}                 type="number"/>
            <FormInput label={t("cameras.fov_h",    "Horizontal FOV")}     value={draft.fov_h_deg}                  onChange={v => setField("fov_h_deg", v)}                  type="number"/>
            <FormInput label={t("cameras.fov_v",    "Vertical FOV")}       value={draft.fov_v_deg}                  onChange={v => setField("fov_v_deg", v)}                  type="number"/>
            <FormInput label={t("cameras.sensor_w", "Sensor Width (px)")}  value={draft.sensor_w_px}               onChange={v => setField("sensor_w_px", v)}                type="number"/>
            <FormInput label={t("cameras.distance", "Target Distance (m)")} value={draft.assumed_target_distance_m ?? 500} onChange={v => setField("assumed_target_distance_m", v)} type="number"/>
          </div>

          {/* Enabled + submit */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              {/* accent-color uses --primary via CSS */}
              <input
                type="checkbox" checked={draft.enabled}
                onChange={e => setField("enabled", e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--primary)" }}
              />
              <span style={{ fontSize: 14, color: "var(--foreground)" }}>
                {t("cameras.enabled", "Enabled")}
              </span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              {editingId !== null && (
                <button type="button" onClick={cancelEdit} className="btn-ghost">
                  {t("common.cancel", "Cancel")}
                </button>
              )}
              <button type="submit" className="btn-primary">
                {editingId !== null ? t("common.save", "Save changes") : t("cameras.add", "Add Camera")}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cameras table */}
      {items.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "oklch(from var(--primary) l c h / 0.06)" }}>
                {["#", t("cameras.col_name","Name"), t("cameras.col_stream","Stream"), t("cameras.col_latlon","Lat / Lon"), t("cameras.col_heading","Heading"), t("cameras.col_enabled","Active"), ""].map((h, i) => (
                  <th key={i} style={{
                    padding: "10px 18px", textAlign: i === 6 ? "right" : "left",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: "var(--muted-foreground)",
                    borderBottom: "1px solid var(--border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((cam, idx) => (
                <tr key={cam.id} style={{
                  borderBottom: "1px solid var(--border)",
                  background: idx % 2 === 0 ? "transparent" : "oklch(from var(--primary) l c h / 0.02)",
                }}>
                  <td style={{ padding: "12px 18px", fontFamily: "'JetBrains Mono',monospace" }}><span dir="ltr">{cam.id}</span></td>
                  <td style={{ padding: "12px 18px", fontWeight: 600, color: "var(--foreground)" }}>{bilingualName(cam)}</td>
                  <td style={{ padding: "12px 18px", fontFamily: "'JetBrains Mono',monospace", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span dir="ltr">{cam.stream_url}</span></td>
                  <td style={{ padding: "12px 18px", fontFamily: "'JetBrains Mono',monospace" }}><span dir="ltr">{cam.latitude.toFixed(4)}, {cam.longitude.toFixed(4)}</span></td>
                  <td style={{ padding: "12px 18px", fontFamily: "'JetBrains Mono',monospace" }}><span dir="ltr">{cam.heading_deg}°</span></td>
                  <td style={{ padding: "12px 18px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: "9999px", fontSize: 11, fontWeight: 700,
                      background: cam.enabled
                        ? "oklch(from var(--primary) l c h / 0.12)"
                        : "oklch(from var(--muted-foreground) l c h / 0.10)",
                      color: cam.enabled ? "var(--primary)" : "var(--muted-foreground)",
                      border: cam.enabled
                        ? "1px solid oklch(from var(--primary) l c h / 0.25)"
                        : "1px solid oklch(from var(--muted-foreground) l c h / 0.18)",
                    }}>
                      {cam.enabled ? "✓" : "✗"} {cam.enabled ? t("cameras.active","Active") : t("cameras.inactive","Off")}
                    </span>
                  </td>
                  <td style={{ padding: "12px 18px", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <button onClick={() => startEdit(cam)} className="btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                        {t("common.edit","Edit")}
                      </button>
                      <button onClick={() => remove(cam.id)} className="btn-danger" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                        {t("common.delete","Delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
