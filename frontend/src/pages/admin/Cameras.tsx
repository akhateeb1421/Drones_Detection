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
const cardStyle: React.CSSProperties = {
  background: "linear-gradient(160deg,rgba(14,22,40,0.97) 0%,rgba(10,15,28,0.98) 100%)",
  border: "0.5px solid rgba(1,242,207,0.10)",
  borderRadius: 16, padding: "clamp(18px,2.2vw,26px)",
  position: "relative", overflow: "hidden", marginBottom: 16,
};
const cardShine: React.CSSProperties = {
  position:"absolute", top:0, left:0, right:0, height:1,
  background:"linear-gradient(90deg,transparent,rgba(1,242,207,0.16),transparent)",
  pointerEvents:"none",
};
const labelStyle: React.CSSProperties = {
  display:"block", fontSize:10, fontWeight:700, letterSpacing:"0.14em",
  textTransform:"uppercase", color:C1, opacity:0.65, marginBottom:6,
};
const inputStyle: React.CSSProperties = {
  width:"100%", padding:"11px 14px", borderRadius:11,
  background:"rgba(8,14,26,0.8)", border:"0.5px solid rgba(1,242,207,0.14)",
  color:"#e0f5f2", fontSize:14, fontFamily:"inherit",
  outline:"none", transition:"border-color 0.15s",
};

function FormInput({ label, value, onChange, type="text", placeholder="" }: {
  label:string; value:string|number; onChange:(v:any)=>void;
  type?:string; placeholder?:string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(type==="number" ? Number(e.target.value) : e.target.value)}
        style={inputStyle}
        onFocus={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.48)";e.currentTarget.style.boxShadow="0 0 0 3px rgba(1,242,207,0.09)"}}
        onBlur={e=>{e.currentTarget.style.borderColor="rgba(1,242,207,0.14)";e.currentTarget.style.boxShadow="none"}}
      />
    </div>
  );
}

/* ── Column widths for the table ── */
const COL = "40px 90px 1fr 180px 80px 90px 80px";

export function CamerasAdmin() {
  const { t } = useTranslation();
  const bilingualName = useBilingualName();
  const [items, setItems] = useState<Camera[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [token, setToken] = useState(localStorage.getItem("admin_token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);

  const load = () => Cameras.list().then(setItems).catch(e => setError(String(e)));
  useEffect(() => { load(); }, []);

  const setField = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      const payload = { ...draft, name_ar: draft.name_ar || null };
      await Cameras.create(payload as Omit<Camera, "id" | "created_at">);
      setDraft({ ...blank }); load();
    } catch (e: unknown) { setError(String((e as Error)?.message ?? e)); }
  };

  const remove = async (id: number) => {
    if (!confirm(t("common.confirm_delete","Are you sure?"))) return;
    try { await Cameras.delete(id); load(); }
    catch (e: unknown) { setError(String(e)); }
  };

  return (
    <div data-mount>
      {/* Page title */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:C1,opacity:0.6,marginBottom:4 }}>
          {t("nav.admin","Administration")}
        </div>
        <h1 style={{ fontSize:"clamp(18px,2.5vw,24px)",fontWeight:800,color:"#e0f5f2",margin:0 }}>
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
        <div style={{ fontSize:12,color:"#3d7872",marginTop:6 }}>
          {t("admin.token_note","Stored locally and sent as X-Admin-Token on writes.")}
        </div>
      </div>

      {/* Add camera form */}
      <div style={cardStyle}>
        <div style={cardShine}/>
        <form onSubmit={submit}>
          {/* Name row */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14 }}>
            <FormInput label={t("cameras.name_en","Name (English)")} value={draft.name} onChange={v=>setField("name",v)} placeholder="backcam"/>
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
            <div style={{ fontSize:13,color:"#5fa09a" }}>{t("cameras.pick_on_map","Pick on map")}</div>
            <button type="button" onClick={()=>setShowMap(v=>!v)}
              style={{ padding:"8px 14px",borderRadius:10,background:"rgba(1,242,207,0.07)",border:"0.5px solid rgba(1,242,207,0.18)",color:"#e0f5f2",fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
              {showMap ? t("cameras.hide_map","Hide map") : t("cameras.show_map","Show map")}
            </button>
          </div>

          {showMap && (
            <div style={{ height:320,borderRadius:12,overflow:"hidden",marginBottom:14,border:"0.5px solid rgba(1,242,207,0.10)" }}>
              <LocationPicker lat={draft.latitude} lon={draft.longitude}
                onChange={(lat,lon)=>setDraft(d=>({...d,latitude:lat,longitude:lon}))}/>
            </div>
          )}

          <div style={{ fontSize:12,color:"#3d7872",marginBottom:14 }}>
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
              <span style={{ fontSize:14,color:"#e0f5f2" }}>{t("cameras.enabled","Enabled")}</span>
            </label>
            <button type="submit"
              style={{ padding:"11px 24px",borderRadius:11,background:`linear-gradient(135deg,${C1},#03DA9A)`,color:"#0a1410",fontWeight:700,fontSize:14,border:"none",cursor:"pointer",fontFamily:"inherit",boxShadow:"0 0 14px rgba(1,242,207,0.25)" }}>
              {t("cameras.add","Add Camera")}
            </button>
          </div>
        </form>
      </div>

      {/* Cameras table */}
      {items.length > 0 && (
        <div style={{ ...cardStyle, padding:0, overflow:"hidden" }}>
          <div style={cardShine}/>

          {/* Header */}
          <div style={{ display:"grid", gridTemplateColumns:COL, gap:0, padding:"12px 20px", background:"rgba(1,242,207,0.04)", borderBottom:"0.5px solid rgba(1,242,207,0.08)", alignItems:"center" }}>
            {["#", t("cameras.col_name","Name"), t("cameras.col_stream","Stream"), t("cameras.col_latlon","Lat / Lon"), t("cameras.col_heading","Heading"), t("cameras.col_enabled","Active"), ""].map((h,i)=>(
              <div key={i} style={{ fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(1,242,207,0.45)",paddingInlineEnd:8 }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          {items.map((cam, idx) => (
            <div key={cam.id}
              style={{ display:"grid", gridTemplateColumns:COL, gap:0, padding:"16px 20px", alignItems:"center", borderBottom: idx < items.length-1 ? "0.5px solid rgba(1,242,207,0.05)" : "none", background: idx%2===0 ? "rgba(1,242,207,0.015)" : "transparent", transition:"background 0.1s" }}
              onMouseEnter={e=>(e.currentTarget.style.background="rgba(1,242,207,0.03)")}
              onMouseLeave={e=>(e.currentTarget.style.background=idx%2===0?"rgba(1,242,207,0.015)":"transparent")}
            >
              <div style={{ fontSize:13,fontFamily:"monospace",color:"#5fa09a",fontWeight:600 }}>{cam.id}</div>
              <div style={{ fontSize:14,fontWeight:700,color:"#e0f5f2",paddingInlineEnd:8 }}>{bilingualName(cam)}</div>
              <div style={{ fontSize:12,color:"#5fa09a",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingInlineEnd:8 }}>{cam.stream_url}</div>
              <div style={{ fontSize:13,fontFamily:"monospace",color:"#8ec8c1",direction:"ltr",paddingInlineEnd:8 }}>
                {cam.latitude.toFixed(4)}, {cam.longitude.toFixed(4)}
              </div>
              <div style={{ fontSize:13,fontFamily:"monospace",color:"#8ec8c1" }}>
                {cam.heading_deg}°
              </div>
              <div>
                <span style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                  background: cam.enabled ? "rgba(1,242,207,0.10)" : "rgba(95,160,154,0.08)",
                  color: cam.enabled ? C1 : "#5fa09a",
                  border: `0.5px solid ${cam.enabled ? "rgba(1,242,207,0.22)" : "rgba(95,160,154,0.18)"}`,
                }}>
                  {cam.enabled ? "✓" : "✗"} {cam.enabled ? t("cameras.active","Active") : t("cameras.inactive","Off")}
                </span>
              </div>
              <div style={{ display:"flex",justifyContent:"flex-end" }}>
                <button onClick={() => remove(cam.id)}
                  style={{ padding:"8px 14px",borderRadius:10,background:"linear-gradient(135deg,#f87171,#dc2626)",color:"#fff",fontWeight:700,fontSize:13,border:"none",cursor:"pointer",fontFamily:"inherit" }}>
                  {t("common.delete","Delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
