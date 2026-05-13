import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./components/LanguageToggle";
import { AlarmBanner } from "./components/AlarmBanner";
import { RoleToggle } from "./components/RoleToggle";
import { ThemeToggle } from "./components/ThemeToggle";
import { AlarmsProvider, useAlarmsContext } from "./contexts/AlarmsContext";
import { RoleProvider, useRole } from "./contexts/RoleContext";
import { ChatbotProvider } from "./contexts/ChatbotContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Overview } from "./pages/Overview";
import { LiveDetection } from "./pages/LiveDetection";
import { HistoryMap } from "./pages/HistoryMap";
import { Analysis } from "./pages/Analysis";
import { Chatbot } from "./pages/Chatbot";
import { Drones } from "./pages/Drones";
import { CameraPlacementPage } from "./pages/CameraPlacement";
import { CamerasAdmin } from "./pages/admin/Cameras";
import { AreasAdmin } from "./pages/admin/Areas";
import { About } from "./pages/About";

/* ── Brand: teal-cyan glowing palette ── */
const C1     = "#01F2CF";   // primary teal
const C2     = "#03DA9A";   // mid
const C3     = "#03B3DA";   // blue-teal
const DANGER = "#f87171";
const BORDER = "rgba(1,242,207,0.12)";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-item active" : "nav-item";
}
function Banner() {
  const { latest, dismiss } = useAlarmsContext();
  return <AlarmBanner event={latest} onDismiss={dismiss} />;
}
function AdminOnly({ children }: { children: JSX.Element }) {
  const { role } = useRole();
  const { t } = useTranslation();
  if (role !== "admin") return (
    <div style={{ background:"rgba(13,21,40,0.95)", border:`0.5px solid ${BORDER}`, borderRadius:14, padding:48, textAlign:"center", color:"#5fa09a", fontSize:15 }}>
      {t("auth.admin_only")}
    </div>
  );
  return children;
}

const NAV_MAIN = [
  { to:"/",         end:true,  key:"nav.overview",  d:"M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
  { to:"/live",     end:false, key:"nav.live",      d:"M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" },
  { to:"/history",  end:false, key:"nav.history",   d:"M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
];
const NAV_INTEL = [
  { to:"/analysis", end:false, key:"nav.analysis",  d:"M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" },
  { to:"/drones",   end:false, key:"nav.drones",    d:"M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" },
  { to:"/chatbot",  end:false, key:"nav.chatbot",   d:"M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" },
  { to:"/about",    end:false, key:"nav.about",     d:"M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" },
];
const NAV_ADMIN = [
  { to:"/placement",     key:"nav.placement", d:"M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" },
  { to:"/admin/cameras", key:"nav.cameras",   d:"M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" },
  { to:"/admin/areas",   key:"nav.areas",     d:"M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg style={{ width:16, height:16, flexShrink:0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d}/>
    </svg>
  );
}
function SbLabel({ label }: { label: string }) {
  return <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.18em", textTransform:"uppercase", color:"rgba(1,242,207,0.3)", padding:"14px 10px 5px" }}>{label}</div>;
}

function Shell() {
  const { t, i18n } = useTranslation();
  const { role, setRole } = useRole();
  const isAdmin = role === "admin";
  const isAr = i18n.language === "ar";

  const handleSignOut = () => { localStorage.removeItem("admin_token"); setRole("viewer"); };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", background:"#0d1117", color:"#e0f5f2", direction:isAr?"rtl":"ltr" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;background:#0d1117}
        body{font-family:${isAr?"'Tajawal'":"'Inter'"},system-ui,sans-serif}

        /* ── Nav ── */
        .nav-item{
          display:flex;align-items:center;gap:9px;
          padding:10px 12px;border-radius:11px;
          font-size:${isAr?"14px":"13px"};color:rgba(224,245,242,0.5);
          margin-bottom:2px;cursor:pointer;text-decoration:none;
          transition:all .15s;line-height:1.3;
        }
        .nav-item:hover{background:rgba(1,242,207,0.05);color:#e0f5f2}
        .nav-item.active{
          background:linear-gradient(135deg,rgba(1,242,207,0.13),rgba(3,179,218,0.07));
          color:#01F2CF;font-weight:700;
          box-shadow:inset 0 1px 0 rgba(1,242,207,0.08);
          ${isAr?"border-right:2.5px solid #01F2CF":"border-left:2.5px solid #01F2CF"};
        }

        /* ── Cards ── */
        .card{
          background:rgba(18,32,29,0.96);
          border:0.5px solid rgba(1,242,207,0.10);
          border-radius:16px;
          padding:clamp(16px,2.2vw,24px);
          position:relative;overflow:hidden;
        }
        .card::after{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(1,242,207,0.18),transparent);
          pointer-events:none;
        }

        /* ── Inputs ── */
        .input{
          background:rgba(10,20,17,0.8);
          border:0.5px solid rgba(1,242,207,0.14);
          border-radius:11px;padding:11px 14px;
          color:#e0f5f2;
          font-size:${isAr?"15px":"14px"};
          width:100%;font-family:inherit;
        }
        .input:focus{outline:none;border-color:rgba(1,242,207,0.48);box-shadow:0 0 0 3px rgba(1,242,207,0.09)}
        .input::placeholder{color:rgba(1,242,207,0.28)}
        select.input option{background:#131f1c;color:#e0f5f2}

        /* ── Buttons ── */
        .btn-primary{
          background:linear-gradient(135deg,#01F2CF,#03DA9A 50%,#03B3DA);
          color:#0a1410;font-weight:700;border:none;border-radius:11px;
          padding:10px 20px;cursor:pointer;
          font-size:${isAr?"15px":"14px"};font-family:inherit;
          box-shadow:0 0 0 1px rgba(1,242,207,0.25),0 4px 16px -4px rgba(1,242,207,0.3);
          transition:all .15s;
        }
        .btn-primary:hover{filter:brightness(1.07);box-shadow:0 0 20px rgba(1,242,207,0.25)}

        .btn-danger{
          background:linear-gradient(135deg,#f87171,#dc2626);
          color:#fff;font-weight:700;border:none;border-radius:11px;
          padding:10px 20px;cursor:pointer;
          font-size:${isAr?"15px":"14px"};font-family:inherit;
          box-shadow:0 0 0 1px rgba(248,113,113,0.25);
        }
        .btn-warning{
          background:linear-gradient(135deg,#fbbf24,#d97706);
          color:#0a1410;font-weight:700;border:none;border-radius:11px;
          padding:10px 20px;cursor:pointer;
          font-size:${isAr?"15px":"14px"};font-family:inherit;
        }
        .btn-ghost{
          background:rgba(1,242,207,0.06);
          border:0.5px solid rgba(1,242,207,0.18);
          color:#e0f5f2;border-radius:11px;
          padding:10px 20px;cursor:pointer;
          font-size:${isAr?"15px":"14px"};font-family:inherit;
        }
        .btn-ghost:hover{background:rgba(1,242,207,0.10);border-color:rgba(1,242,207,0.35);color:#01F2CF}

        /* Countered = gradient teal, Hit Target = dark important */
        .btn-countered{
          background:linear-gradient(135deg,#01F2CF,#03DA9A);
          color:#0a1410;font-weight:800;border:none;border-radius:11px;
          padding:9px 16px;cursor:pointer;
          font-size:${isAr?"14px":"13px"};font-family:inherit;
          box-shadow:0 0 12px rgba(1,242,207,0.25);
        }
        .btn-hit{
          background:linear-gradient(135deg,#1a2a26,#0d1a16);
          color:#fbbf24;font-weight:800;border:1.5px solid rgba(251,191,36,0.4);
          border-radius:11px;padding:9px 16px;cursor:pointer;
          font-size:${isAr?"14px":"13px"};font-family:inherit;
          box-shadow:0 0 10px rgba(251,191,36,0.12);
        }
        .btn-reject{
          background:linear-gradient(135deg,#f87171,#dc2626);
          color:#fff;font-weight:700;border:none;border-radius:11px;
          padding:9px 16px;cursor:pointer;
          font-size:${isAr?"14px":"13px"};font-family:inherit;
        }

        /* ── Labels / Badges ── */
        .label{
          display:block;
          font-size:${isAr?"10px":"9px"};font-weight:700;
          letter-spacing:0.14em;text-transform:uppercase;
          color:#01F2CF;opacity:0.65;margin-bottom:8px;
        }
        .badge{display:inline-flex;align-items:center;border-radius:20px;padding:4px 10px;font-size:${isAr?"12px":"11px"};font-weight:700}
        .badge-accent{background:rgba(1,242,207,0.10);color:#01F2CF;border:0.5px solid rgba(1,242,207,0.22)}
        .badge-danger{background:rgba(248,113,113,0.10);color:#f87171;border:0.5px solid rgba(248,113,113,0.22)}
        .badge-warning{background:rgba(251,191,36,0.10);color:#fbbf24;border:0.5px solid rgba(251,191,36,0.22)}
        .badge-muted{background:rgba(95,160,154,0.10);color:#5fa09a;border:0.5px solid rgba(95,160,154,0.2)}

        /* ── Utilities ── */
        .text-accent{color:#01F2CF}
        .text-muted{color:#5fa09a}
        .text-danger{color:#f87171}
        .text-warning{color:#fbbf24}
        .text-success{color:#01F2CF}
        .font-data{font-family:'JetBrains Mono',monospace}
        .scrollbar-thin::-webkit-scrollbar{width:4px}
        .scrollbar-thin::-webkit-scrollbar-thumb{background:rgba(1,242,207,0.15);border-radius:4px}
        .divide-slate-800>*+*{border-top:0.5px solid rgba(1,242,207,0.07)}
        .bg-success{background:linear-gradient(135deg,#01F2CF,#03DA9A);color:#0a1410}
        .bg-danger{background:linear-gradient(135deg,#f87171,#dc2626)}
        .bg-warning{background:linear-gradient(135deg,#fbbf24,#d97706)}
        .bg-accent{background:linear-gradient(135deg,#01F2CF,#03B3DA);color:#0a1410}
        .leaflet-container{background:#0f1f1c!important}
        .leaflet-tile{filter:saturate(0.65) brightness(0.8) hue-rotate(140deg)}

        /* Recharts */
        .recharts-cartesian-axis-tick text{
          font-family:${isAr?"'Tajawal'":"'Inter'"},system-ui,sans-serif!important;
          font-size:${isAr?"12px":"11px"}!important;
        }
        .recharts-legend-item-text{
          font-family:${isAr?"'Tajawal'":"'Inter'"},system-ui,sans-serif!important;
          font-size:${isAr?"13px":"12px"}!important;
          color:#5fa09a!important;
        }

        /* Scrollbar */
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(1,242,207,0.12);border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(1,242,207,0.25)}
      `}</style>

      <Banner />

      {/* ── Header ── */}
      <header style={{
        position:"sticky",top:0,zIndex:20,flexShrink:0,
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 24px",height:62,
        background:"rgba(9,13,21,0.97)",backdropFilter:"blur(20px)",
        borderBottom:"0.5px solid rgba(1,242,207,0.10)",
      }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          {/* Logo icon */}
          <div style={{
            width:38,height:38,borderRadius:11,flexShrink:0,
            background:"linear-gradient(135deg,#01F2CF,#03DA9A 50%,#03B3DA)",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 0 20px rgba(1,242,207,0.35)",
          }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a1410" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
            </svg>
          </div>
          {/* Title */}
          <div>
            <div style={{
              fontSize:20,fontWeight:800,lineHeight:1.1,
              background:"linear-gradient(90deg,#01F2CF,#03DA9A 50%,#03B3DA)",
              WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",
            }}>
              رقيب
            </div>
            <div style={{ fontSize:11,color:"rgba(1,242,207,0.4)",letterSpacing:"0.04em",marginTop:1 }}>
              {isAr?"منظومة الدفاع ضد المسيّرات":"Counter-UAS Defense System"}
            </div>
          </div>
          {/* Live dot */}
          <div style={{ position:"relative",display:"flex",alignItems:"center",justifyContent:"center",marginInlineStart:4 }}>
            <style>{`
              @keyframes livePing{0%,100%{transform:scale(0.8);opacity:0.5}50%{transform:scale(2.5);opacity:0}}
              .live-ping{position:absolute;width:18px;height:18px;border-radius:50%;background:rgba(1,242,207,0.2);animation:livePing 1.8s ease-in-out infinite}
              .live-dot{width:8px;height:8px;border-radius:50%;background:#01F2CF;box-shadow:0 0 10px rgba(1,242,207,0.8);z-index:1;position:relative}
            `}</style>
            <span className="live-ping"/>
            <span className="live-dot"/>
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <ThemeToggle/>
          <RoleToggle/>
        </div>
      </header>

      {/* ── Layout ── */}
      <div style={{ display:"flex",flex:1,minHeight:0 }}>

        {/* Sidebar */}
        <aside style={{
          width:188,flexShrink:0,display:"flex",flexDirection:"column",
          background:"#090d15",
          borderInlineEnd:"0.5px solid rgba(1,242,207,0.10)",
          position:"sticky",top:62,height:"calc(100vh - 62px)",overflowY:"auto",
        }}>
          <nav style={{ flex:1,padding:"8px 10px" }}>
            <SbLabel label={isAr?"عام":"General"}/>
            {NAV_MAIN.map(({to,end,key,d})=>(
              <NavLink key={to} to={to} end={end} className={navClass}>
                <NavIcon d={d}/><span>{t(key)}</span>
              </NavLink>
            ))}
            <SbLabel label={isAr?"الاستخبارات":"Intelligence"}/>
            {NAV_INTEL.map(({to,key,d})=>(
              <NavLink key={to} to={to} className={navClass}>
                <NavIcon d={d}/><span>{t(key)}</span>
              </NavLink>
            ))}
            {isAdmin&&(
              <>
                <SbLabel label={isAr?"الإدارة":"Administration"}/>
                {NAV_ADMIN.map(({to,key,d})=>(
                  <NavLink key={to} to={to} className={navClass}>
                    <NavIcon d={d}/><span>{t(key)}</span>
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          {/* Bottom controls */}
          <div style={{ padding:"12px 10px 16px",borderTop:"0.5px solid rgba(1,242,207,0.10)",display:"flex",flexDirection:"column",gap:8 }}>
            <LanguageToggle/>
            {isAdmin&&(
              <button onClick={handleSignOut} style={{
                width:"100%",padding:"10px 12px",borderRadius:11,
                background:"linear-gradient(135deg,#f87171,#dc2626)",
                color:"#fff",fontSize:isAr?14:13,fontWeight:700,
                border:"none",cursor:"pointer",fontFamily:"inherit",
                display:"flex",alignItems:"center",justifyContent:"center",gap:7,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
                </svg>
                {t("auth.sign_out")}
              </button>
            )}
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex:1,minWidth:0,overflowY:"auto",padding:"clamp(18px,2.5vw,30px)" }}>
          <Routes>
            <Route path="/"              element={<Overview/>}/>
            <Route path="/live"          element={<LiveDetection/>}/>
            <Route path="/history"       element={<HistoryMap/>}/>
            <Route path="/analysis"      element={<Analysis/>}/>
            <Route path="/drones"        element={<Drones/>}/>
            <Route path="/placement"     element={<AdminOnly><CameraPlacementPage/></AdminOnly>}/>
            <Route path="/chatbot"       element={<Chatbot/>}/>
            <Route path="/about"         element={<About/>}/>
            <Route path="/admin/cameras" element={<AdminOnly><CamerasAdmin/></AdminOnly>}/>
            <Route path="/admin/areas"   element={<AdminOnly><AreasAdmin/></AdminOnly>}/>
            <Route path="*"             element={<Navigate to="/" replace/>}/>
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RoleProvider>
        <AlarmsProvider>
          <ChatbotProvider>
            <Shell/>
          </ChatbotProvider>
        </AlarmsProvider>
      </RoleProvider>
    </ThemeProvider>
  );
}
