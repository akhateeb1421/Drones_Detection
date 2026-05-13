import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cameras, Camera } from "../../services/api";
import { LocationPicker } from "../../components/LocationPicker";
import { useBilingualName } from "../../i18n/places";

const C1 = "#01F2CF";
const DANGER = "#f87171";

const blank: Omit<Camera, "id" | "created_at"> = {
  name: "", name_ar: "", stream_url: "",
  latitude: 24.7136, longitude: 46.6753,
  heading_deg: 0, altitude_m: 10,
  fov_h_deg: 82.6, fov_v_deg: 52,
  sensor_w_px: 1280, assumed_target_distance_m: 500,
  enabled: true,
};

/* ── shared styles ── */
// Theme-aware — CSS variables swap on html.light. 1px border + drop
// shadow so panels visibly float above the deeper light page bg.
const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 16, padding: "clamp(18px,2.2vw,26px)",
  position: "relative", overflow: "hidden", marginBottom: 16,
  boxShadow: "0 8px 24px -12px rgba(0,0,0,0.25),0 2px 6px -2px rgba(0,0,0,0.12)",
};
const cardShine: React.CSSProperties = {
  position:"absolute", top:0, left:0, right:0, height:1,
  background:"linear-gradient(90deg,transparent,rgba(1,242,207,0.16),transparent)",
  pointerEvents:"none",
};
const labelStyle: React.CSSProperties = {
  // Theme-aware muted token — bright cyan at 65% was invisible on the
  // white card in light mode.
  display:"block", fontSize:10, fontWeight:700, letterSpacing:"0.14em",
  textTransform:"uppercase", color:"var(--text-muted)", marginBottom:6,
};
const inputStyle: React.CSSProperties = {
  width:"100%", padding:"11px 14px", borderRadius:11,
  // Theme-aware so the input bg flips in light mode; otherwise the
  // dark text-primary color sits on a dark navy bg = invisible inputs.
  background:"var(--bg-elevated)", border:"0.5px solid var(--border-medium)",
  color:"var(--text-primary)", fontSize:14, fontFamily:"inherit",
  outline:"none", transition:"border-color 0.15s",
};

function FormInput({ label, value, onChange, type="text", placeholder="", required=false }: {
  label:string; value:string|number; onChange:(v:any)=>void;
  type?:string; placeholder?:string; required?:boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: DANGER, marginInlineStart: 4 }}>*</span>}
      </label>
      <input
        type={type} value={value} placeholder={placeholder} required={required}
        onChange={e => onChange(type==="number" ? Number(e.target.value) : e.target.value)}
        style={inputStyle}
        onFocus={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.48)";e.currentTarget.style.boxShadow="0 0 0 3px rgba(1,242,207,0.09)"}}
        onBlur={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.14)";e.currentTarget.style.boxShadow="none"}}
      />
    </div>
  );
}

export function CamerasAdmin() {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const [items, setItems] = useState<Camera[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  // null = adding a new camera; number = editing the camera with that id.
  // Drives both the submit handler (POST vs PATCH) and the form labels.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [token, setToken] = useState(localStorage.getItem("admin_token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);

  const load = () => Cameras.list().then(setItems).catch(e => setError(String(e)));
  useEffect(() => { load(); }, []);

  const setField = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const startEdit = (cam: Camera) => {
    // Load the row into the form; scroll up so the form is visible.
    setEditingId(cam.id);
    setDraft({
      name: cam.name,
      name_ar: cam.name_ar ?? "",
      stream_url: cam.stream_url,
      latitude: cam.latitude,
      longitude: cam.longitude,
      heading_deg: cam.heading_deg,
      altitude_m: cam.altitude_m,
      fov_h_deg: cam.fov_h_deg,
      fov_v_deg: cam.fov_v_deg,
      sensor_w_px: cam.sensor_w_px,
      assumed_target_distance_m: cam.assumed_target_distance_m,
      enabled: cam.enabled,
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
    e.preventDefault(); setError(null);

    // Required-field guard: a camera without a name shows up as a
    // blank row in every list and is impossible to identify later.
    // Trim whitespace so "   " is also rejected. The backend now
    // enforces the same rule (min_length=1 + strip), but we check
    // here too so the operator gets immediate inline feedback
    // instead of an opaque 422 from the API.
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setError(t("cameras.name_required", "Name is required."));
      return;
    }

    try {
      const payload = {
        ...draft,
        name: trimmedName,
        name_ar: draft.name_ar?.trim() || null,
      };
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
    if (!confirm(t("common.confirm_delete","Are you sure?"))) return;
    try {
      await Cameras.delete(id);
      // If we were editing the deleted row, drop edit state.
      if (editingId === id) cancelEdit();
      load();
    }
    catch (e: unknown) { setError(String(e)); }
  };

  return (
    <div data-mount>
      {/* Page title */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:4 }}>
          {t("nav.admin","Administration")}
        </div>
        <h1 style={{ fontSize:"clamp(18px,2.5vw,24px)",fontWeight:800,color:"var(--text-primary)",margin:0 }}>
          {t("nav.cameras","Camera Management")}
        </h1>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginBottom:14,padding:"12px 16px",borderRadius:12,background:"rgba(248,113,113,0.08)",border:"0.5px solid rgba(248,113,113,0.3)",color:DANGER,fontSize:14 }}>
          {error}
        </div>
      )}

      {/* Admin token */}
      <div style={cardStyle}>
        <div style={cardShine}/>
        <label style={labelStyle}>{t("admin.token_label","Admin Token")}</label>
        <div style={{ display:"flex",gap:10 }}>
          <input
            type="password" value={token}
            onChange={e => { setToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
            style={{ ...inputStyle, flex:1 }}
            placeholder="••••••••••••"
            onFocus={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.48)"}}
            onBlur={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.14)"}}
          />
          <button
            onClick={() => localStorage.setItem("admin_token", token)}
            style={{ padding:"11px 18px",borderRadius:11,background:`linear-gradient(135deg,${C1},#03B3DA)`,color:"#0a1410",fontWeight:700,fontSize:14,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit" }}
          >
            {t("admin.save_token","Save token")}
          </button>
        </div>
        <div style={{ fontSize:12,color:"var(--text-faint)",marginTop:6 }}>
          {t("admin.token_note","Stored locally and sent as X-Admin-Token on writes.")}
        </div>
      </div>

      {/* Add camera form */}
      <div style={cardStyle}>
        <div style={cardShine}/>
        <form onSubmit={submit}>
          {/* Name row */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
            <FormInput label={t("cameras.name_en","Name (English)")} value={draft.name} onChange={v=>setField("name",v)} placeholder="backcam" required/>
            <FormInput label={t("cameras.name_ar","Name (Arabic)")} value={draft.name_ar??""} onChange={v=>setField("name_ar",v)} placeholder="الكاميرا الخلفية"/>
            <FormInput label={t("cameras.stream_url","Stream URL")} value={draft.stream_url} onChange={v=>setField("stream_url",v)} placeholder="http://pi.local:8081/stream"/>
          </div>

          {/* Lat/Lon */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14 }}>
            <FormInput label={t("cameras.latitude","Latitude")} value={draft.latitude} onChange={v=>setField("latitude",v)} type="number"/>
            <FormInput label={t("cameras.longitude","Longitude")} value={draft.longitude} onChange={v=>setField("longitude",v)} type="number"/>
          </div>

          {/* Map toggle */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
            <div style={{ fontSize:13,color:"var(--text-muted)" }}>{t("cameras.pick_on_map","Pick on map")}</div>
            <button type="button" onClick={()=>setShowMap(v=>!v)}
              style={{ padding:"8px 14px",borderRadius:10,background:"rgba(1,242,207,0.07)",border:"0.5px solid rgba(1,242,207,0.18)",color:"var(--text-primary)",fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
              {showMap ? t("cameras.hide_map","Hide map") : t("cameras.show_map","Show map")}
            </button>
          </div>

          {showMap && (
            <div style={{ height:320,borderRadius:12,overflow:"hidden",marginBottom:14,border:"0.5px solid rgba(1,242,207,0.10)" }}>
              <LocationPicker lat={draft.latitude} lon={draft.longitude}
                onChange={(lat,lon)=>setDraft(d=>({...d,latitude:lat,longitude:lon}))}/>
            </div>
          )}

          <div style={{ fontSize:12,color:"var(--text-faint)",marginBottom:14 }}>
            {t("cameras.map_hint","Click or drag the marker to set coordinates.")}
          </div>

          {/* Technical params */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:14 }}>
            <FormInput label={t("cameras.heading","Heading (deg)")} value={draft.heading_deg} onChange={v=>setField("heading_deg",v)} type="number"/>
            <FormInput label={t("cameras.altitude","Altitude (m)")} value={draft.altitude_m??10} onChange={v=>setField("altitude_m",v)} type="number"/>
            <FormInput label={t("cameras.fov_h","Horizontal FOV")} value={draft.fov_h_deg} onChange={v=>setField("fov_h_deg",v)} type="number"/>
            <FormInput label={t("cameras.fov_v","Vertical FOV")} value={draft.fov_v_deg} onChange={v=>setField("fov_v_deg",v)} type="number"/>
            <FormInput label={t("cameras.sensor_w","Sensor Width (px)")} value={draft.sensor_w_px} onChange={v=>setField("sensor_w_px",v)} type="number"/>
            <FormInput label={t("cameras.distance","Target Distance (m)")} value={draft.assumed_target_distance_m??500} onChange={v=>setField("assumed_target_distance_m",v)} type="number"/>
          </div>

          {/* Enabled toggle + submit */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
            <label style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }}>
              <input type="checkbox" checked={draft.enabled} onChange={e=>setField("enabled",e.target.checked)}
                style={{ width:16,height:16,accentColor:C1 }}/>
              <span style={{ fontSize:14,color:"var(--text-primary)" }}>{t("cameras.enabled","Enabled")}</span>
            </label>
            <div style={{ display:"flex",gap:10 }}>
              {editingId !== null && (
                <button type="button" onClick={cancelEdit}
                  style={{ padding:"11px 18px",borderRadius:11,background:"var(--bg-elevated)",color:"var(--text-primary)",fontWeight:700,fontSize:14,border:"1px solid var(--border-medium)",cursor:"pointer",fontFamily:"inherit" }}>
                  {t("common.cancel","Cancel")}
                </button>
              )}
              <button type="submit"
                style={{ padding:"11px 24px",borderRadius:11,background:`linear-gradient(135deg,${C1},#03DA9A)`,color:"#0a1410",fontWeight:700,fontSize:14,border:"none",cursor:"pointer",fontFamily:"inherit",boxShadow:"0 0 14px rgba(1,242,207,0.25)" }}>
                {editingId !== null
                  ? t("common.save","Save changes")
                  : t("cameras.add","Add Camera")}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cameras table — matches the HTML <table> pattern used in
          admin/Areas, LiveDetection pending, and CameraPlacement so
          every list page reads the same. */}
      {items.length > 0 && (
        <div className="card overflow-x-auto" style={{ padding: 0 }}>
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 px-5 text-start">#</th>
                <th className="px-5 text-start">{t("cameras.col_name","Name")}</th>
                <th className="px-5 text-start">{t("cameras.col_stream","Stream")}</th>
                <th className="px-5 text-start">{t("cameras.col_latlon","Lat / Lon")}</th>
                <th className="px-5 text-start">{t("cameras.col_heading","Heading")}</th>
                <th className="px-5 text-start">{t("cameras.col_enabled","Active")}</th>
                <th className="px-5 text-end"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((cam) => (
                <tr key={cam.id}>
                  <td className="py-3 px-5 text-start font-data"><span dir="ltr">{cam.id}</span></td>
                  <td className="px-5 text-start font-semibold">{bilingualName(cam)}</td>
                  <td className="px-5 text-start font-data" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}><span dir="ltr">{cam.stream_url}</span></td>
                  <td className="px-5 text-start font-data"><span dir="ltr">{cam.latitude.toFixed(4)}, {cam.longitude.toFixed(4)}</span></td>
                  <td className="px-5 text-start font-data"><span dir="ltr">{cam.heading_deg}°</span></td>
                  <td className="px-5 text-start">
                    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                      background: cam.enabled ? "rgba(1,242,207,0.10)" : "rgba(95,160,154,0.08)",
                      color: cam.enabled ? C1 : "var(--text-muted)",
                      border: `0.5px solid ${cam.enabled ? "rgba(1,242,207,0.22)" : "rgba(95,160,154,0.18)"}`,
                    }}>
                      {cam.enabled ? "✓" : "✗"} {cam.enabled ? t("cameras.active","Active") : t("cameras.inactive","Off")}
                    </span>
                  </td>
                  <td className="px-5 text-end">
                    <div style={{ display:"inline-flex", gap:6 }}>
                      <button onClick={() => startEdit(cam)}
                        style={{ padding:"8px 14px", borderRadius:10,
                          background: `linear-gradient(135deg,${C1},#03DA9A)`,
                          color:"#0a1410", fontWeight:700, fontSize:13,
                          border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                        {t("common.edit","Edit")}
                      </button>
                      <button onClick={() => remove(cam.id)}
                        style={{ padding:"8px 14px", borderRadius:10,
                          background: `linear-gradient(135deg,${DANGER},#dc2626)`,
                          color:"#ffffff", fontWeight:700, fontSize:13,
                          border:"none", cursor:"pointer", fontFamily:"inherit" }}>
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
