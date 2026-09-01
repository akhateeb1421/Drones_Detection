import { useTranslation } from "react-i18next";
import { AlarmEvent } from "../services/ws";
import { usePlaceLabel, useClassLabel } from "../i18n/places";

interface Props { event: AlarmEvent | null; onDismiss: () => void; }

export function AlarmBanner({ event, onDismiss }: Props) {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const classLabel = useClassLabel();
  if (!event) return null;
  const eta = event.eta_s !== null ? `${event.eta_s.toFixed(1)}s` : "—";

  return (
    <div className="alarm-banner">
      <div className="alarm-banner-inner">
        <div style={{
          maxWidth:1400, margin:"0 auto",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:16, padding:"11px 20px",
        }}>
          {/* Left */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {/* Pulsing alarm beacon */}
            <div style={{ position:"relative", width:18, height:18, flexShrink:0 }}>
              <style>{`
                @keyframes alarmPing{0%,100%{transform:scale(.8);opacity:.5}50%{transform:scale(2.2);opacity:0}}
                .alarm-ping{position:absolute;width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.30);animation:alarmPing 1.4s ease-in-out infinite}
                .alarm-dot2{width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 12px rgba(239,68,68,0.90);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
              `}</style>
              <span className="alarm-ping"/>
              <span className="alarm-dot2"/>
            </div>
            {/* Icon */}
            <div style={{ width:36,height:36,borderRadius:9,background:"rgba(239,68,68,0.18)",border:"0.5px solid rgba(239,68,68,0.35)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
              </svg>
            </div>
            {/* Text */}
            <div>
              <div style={{ fontSize:13,fontWeight:800,color:"#fca5a5",letterSpacing:"0.04em",textTransform:"uppercase",marginBottom:3 }}>
                {t("alarm.banner")}
              </div>
              <div style={{ fontSize:12,color:"rgba(252,165,165,0.85)",display:"flex",alignItems:"center",gap:6,fontVariantNumeric:"tabular-nums" }}>
                <span style={{ fontWeight:700 }}>{classLabel(event.drone_class)}</span>
                <span style={{ opacity:0.5 }}>→</span>
                <span>{event.nearest_area ? placeLabel(event.nearest_area) : "?"}</span>
                <span style={{ opacity:0.5 }}>·</span>
                <span>ETA <span style={{ fontFamily:"monospace",fontWeight:700,color:"#fca5a5" }}>{eta}</span></span>
                <span style={{ opacity:0.5 }}>·</span>
                <span>{t("alarm.score")} <span style={{ fontFamily:"monospace",fontWeight:700 }}>{event.score}</span></span>
              </div>
            </div>
          </div>
          {/* Right: large ETA + dismiss */}
          <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0 }}>
            <div style={{ textAlign:"end" }}>
              <div style={{ fontSize:9,fontWeight:700,letterSpacing:"0.18em",textTransform:"uppercase",color:"rgba(252,165,165,0.65)",marginBottom:2 }}>ETA</div>
              <div style={{ fontSize:26,fontWeight:800,lineHeight:1,fontFamily:"monospace",color:"#fca5a5",textShadow:"0 0 20px rgba(239,68,68,0.65)" }}>{eta}</div>
            </div>
            <button
              onClick={onDismiss} aria-label="Dismiss"
              style={{ padding:"7px 16px",borderRadius:8,background:"rgba(239,68,68,0.18)",border:"0.5px solid rgba(239,68,68,0.35)",color:"#fca5a5",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"background 0.14s" }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background="rgba(239,68,68,0.30)"}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background="rgba(239,68,68,0.18)"}
            >✕</button>
          </div>
        </div>
        {/* Scanning shimmer line */}
        <div className="alarm-shimmer"/>
      </div>
    </div>
  );
}
