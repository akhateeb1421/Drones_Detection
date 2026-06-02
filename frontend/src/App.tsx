import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./components/LanguageToggle";
import { AlarmBanner } from "./components/AlarmBanner";
import { ThemeToggle } from "./components/ThemeToggle";
import { AdminSignInButton } from "./components/AdminSignInButton";
import { AlarmsProvider, useAlarmsContext } from "./contexts/AlarmsContext";
import { RoleProvider, useRole } from "./contexts/RoleContext";
import { ChatbotProvider } from "./contexts/ChatbotContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
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
import { RecordedClip } from "./pages/RecordedClip";

/* ── Nav tabs — all original preserved ─────────────────────── */
const NAV_MAIN = [
  { to:"/",        end:true,  key:"nav.overview", d:"M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
  { to:"/live",    end:false, key:"nav.live",     d:"M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" },
  { to:"/recorded", end:false, key:"nav.recorded", d:"M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75.125v-5.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v5.25M6 18.375V9.75m0 0A2.25 2.25 0 0 1 8.25 7.5h7.5A2.25 2.25 0 0 1 18 9.75m-12 0v8.625m12-8.625v8.625m0 0c0 .621-.504 1.125-1.125 1.125h-1.5m-9.75 0h9.75" },
  { to:"/history", end:false, key:"nav.history",  d:"M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
];
const NAV_INTEL = [
  { to:"/analysis", end:false, key:"nav.analysis", d:"M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" },
  { to:"/drones",   end:false, key:"nav.drones",   d:"M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" },
  { to:"/chatbot",  end:false, key:"nav.chatbot",  d:"M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" },
  { to:"/about",    end:false, key:"nav.about",    d:"M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" },
];
const NAV_ADMIN = [
  { to:"/placement",     key:"nav.placement", d:"M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" },
  { to:"/admin/cameras", key:"nav.cameras",   d:"M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" },
  { to:"/admin/areas",   key:"nav.areas",     d:"M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c-.317-.159-.69-.159-1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" },
];

/* Page titles — NO supertitle (AEGIS ORBIT removed) */
const PAGE_MAP: Record<string, { ar: string; en: string }> = {
  "/":              { ar:"لوحة التحكم",       en:"Overview" },
  "/live":          { ar:"الكشف المباشر",     en:"Live Detection" },
  "/recorded": { ar:"مقطع مسجل", en:"Recorded Clip" },
  "/history":       { ar:"خريطة الهجمات",    en:"History Map" },
  "/analysis":      { ar:"التحليلات",         en:"Analysis" },
  "/drones":        { ar:"المسيّرات",         en:"Drones" },
  "/chatbot":       { ar:"سند",               en:"Chatbot" },
  "/about":         { ar:"نبذة",              en:"About" },
  "/placement":     { ar:"اقتراح المواقع",    en:"Camera Placement" },
  "/admin/cameras": { ar:"الكاميرات",         en:"Cameras" },
  "/admin/areas":   { ar:"المناطق الحساسة",   en:"Sensitive Areas" },
};

function SvgIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden style={{ flexShrink:0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d}/>
    </svg>
  );
}
function navClass({ isActive }: { isActive: boolean }) { return isActive ? "nav-item active" : "nav-item"; }
function NavDivider() { return <div className="sidebar-divider"/>; }

function Banner() {
  const { latest, dismiss } = useAlarmsContext();
  return <AlarmBanner event={latest} onDismiss={dismiss}/>;
}
function AdminOnly({ children }: { children: JSX.Element }) {
  const { role } = useRole();
  const { t } = useTranslation();
  if (role !== "admin") return (
    <div className="glass" style={{ borderRadius:20, padding:48, textAlign:"center", color:"var(--muted-foreground)" }}>
      {t("auth.admin_only")}
    </div>
  );
  return children;
}
function Chevron({ expanded, rtl }: { expanded: boolean; rtl: boolean }) {
  const deg = rtl ? (expanded ? 0 : 180) : (expanded ? 180 : 0);
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      style={{ transition:"transform 260ms", transform:`rotate(${deg}deg)`, flexShrink:0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
    </svg>
  );
}

/* Live dot */
const LIVE_CSS = `
  @keyframes livePing{0%,100%{transform:scale(.8);opacity:.5}50%{transform:scale(2.4);opacity:0}}
  .live-ping{position:absolute;width:12px;height:12px;border-radius:50%;background:var(--destructive);opacity:.3;animation:livePing 1.8s ease-in-out infinite}
  .live-dot{width:6px;height:6px;border-radius:50%;background:var(--destructive);box-shadow:0 0 8px var(--destructive);z-index:1;position:relative}
`;

/* TopBar — NO "AEGIS ORBIT" supertitle, just title + live dot + role pills + theme toggle */
function TopBar({ isAr, t }: { isAr: boolean; t: (k:string, fb?:string)=>string }) {
  const { role, setRole } = useRole();
  const { theme, toggle } = useTheme();
  const isAdmin = role === "admin";
  const location = useLocation();
  const info = PAGE_MAP[location.pathname] ?? PAGE_MAP["/"];

  return (
    <div className="page-title-row">
      {/* Left: title + live dot only — NO supertitle */}
      <div className="page-title">
        <span>{isAr ? info.ar : info.en}</span>
        <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center", width:12, height:12, flexShrink:0 }}>
          <span className="live-ping"/><span className="live-dot"/>
        </div>
      </div>

      {/* Right: role pills + theme toggle */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <div className="role-pill-container">
          <button className={`role-pill ${!isAdmin ? "role-pill-active" : "role-pill-inactive"}`} onClick={() => setRole("viewer")}>
            {t("auth.role_viewer","Operator")}
          </button>
          <button className={`role-pill ${isAdmin ? "role-pill-active" : "role-pill-inactive"}`} onClick={() => setRole("admin")}>
            {t("auth.role_admin","Admin")}
          </button>
        </div>
        <button
          onClick={toggle} aria-label="Toggle theme"
          style={{ width:38, height:38, borderRadius:"50%", background:"var(--glass)", backdropFilter:"blur(20px)", border:"1px solid var(--glass-border)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"var(--muted-foreground)", transition:"color .14s", flexShrink:0 }}
          onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color="var(--primary)"}
          onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color="var(--muted-foreground)"}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="3.4"/>
              <line x1="10" y1="1.6" x2="10" y2="3.4"/><line x1="10" y1="16.6" x2="10" y2="18.4"/>
              <line x1="1.6" y1="10" x2="3.4" y2="10"/><line x1="16.6" y1="10" x2="18.4" y2="10"/>
              <line x1="3.7" y1="3.7" x2="4.9" y2="4.9"/><line x1="15.1" y1="15.1" x2="16.3" y2="16.3"/>
              <line x1="3.7" y1="16.3" x2="4.9" y2="15.1"/><line x1="15.1" y1="4.9" x2="16.3" y2="3.7"/>
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
              <path d="M14.5 13.5A6 6 0 0 1 7 5.7a.7.7 0 0 0-1-.78A7.5 7.5 0 1 0 15.3 14.5a.7.7 0 0 0-.78-1Z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { t, i18n } = useTranslation();
  const { role, setRole } = useRole();
  const isAdmin = role === "admin";
  const isAr    = i18n.language === "ar";
  const [expanded, setExpanded] = useState(false);
  const sidebarW = expanded ? 210 : 80;
  const margin   = 24;
  const handleSignOut = () => { localStorage.removeItem("admin_token"); setRole("viewer"); };

  return (
    <div style={{ minHeight:"100vh", position:"relative", direction: isAr ? "rtl" : "ltr", backgroundColor:"var(--background)", color:"var(--foreground)", overflowX:"hidden" }}>
      <style>{`
        body { font-family: ${isAr?"'Tajawal'":"'Inter'"}, ui-sans-serif, system-ui, sans-serif; }
        .recharts-cartesian-axis-tick text { font-family: ${isAr?"'Tajawal'":"'Inter'"}, system-ui, sans-serif !important; }
        ${LIVE_CSS}
      `}</style>

      {/* Ambient glow layers */}
      <div style={{ pointerEvents:"none", position:"absolute", inset:0, opacity:0.6, overflow:"hidden" }}>
        <div className="glow-layer-1"/>
        <div className="glow-layer-2"/>
      </div>

      <Banner/>

      {/*
        SIDEBAR — glass rounded-3xl (24px), fixed position
        Collapsed: 80px wide, icons perfectly centered (44×44px squares)
        Expanded:  210px wide, icons + labels left-aligned

        RTL: right side via [dir="rtl"] .sidebar CSS rule

        FOOTER ORDER (top→bottom):
          Sign-out / Sign-in
          Language
          Theme
          [LAST] Expand/Collapse chevron
      */}
      <aside className="sidebar glass" data-expanded={String(expanded)}>

        {/* Logo + optional brand text */}
        <div style={{ display:"flex", alignItems:"center", gap:10, padding: expanded ? "0 16px" : "0", marginBottom:32, flexShrink:0, justifyContent: expanded ? "flex-start" : "center" }}>
        <div className="sidebar-logo glow-primary" style={{ flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
          </svg>
        </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">رقيب</div>
            <div className="sidebar-brand-sub">{isAr ? "الدفاع ضد المسيّرات" : "Counter-UAS"}</div>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="sidebar-nav">
          {NAV_MAIN.map(({ to, end, key, d }) => (
            <NavLink key={to} to={to} end={end} className={navClass} title={!expanded ? t(key) : undefined}>
              <SvgIcon d={d}/><span className="nav-label">{t(key)}</span>
            </NavLink>
          ))}
          <NavDivider/>
          {NAV_INTEL.map(({ to, key, d }) => (
            <NavLink key={to} to={to} className={navClass} title={!expanded ? t(key) : undefined}>
              <SvgIcon d={d}/><span className="nav-label">{t(key)}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <NavDivider/>
              {NAV_ADMIN.map(({ to, key, d }) => (
                <NavLink key={to} to={to} className={navClass} title={!expanded ? t(key) : undefined}>
                  <SvgIcon d={d}/><span className="nav-label">{t(key)}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div style={{ borderTop:"1px solid var(--border)", width:"100%" }}>
          <div style={{ padding:"10px 0 6px", display:"flex", flexDirection:"column", alignItems: expanded ? "stretch" : "center", gap:6, paddingInline: expanded ? 12 : 0 }}>
            {/* 1. Sign-out or Sign-in */}
            {isAdmin ? (
              <button
                onClick={handleSignOut} title={t("auth.sign_out")}
                className="sidebar-ctrl"
                style={{ background:"linear-gradient(135deg, var(--destructive), oklch(0.55 0.20 22))", color:"var(--destructive-foreground)", border:"none", fontFamily:"inherit" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} style={{ flexShrink:0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
                </svg>
                <span className="sidebar-ctrl-label">{t("auth.sign_out")}</span>
              </button>
            ) : (
              /* compact=true → icon-only button when collapsed */
              <AdminSignInButton compact={!expanded}/>
            )}
            {/* 2. Language */}
            <LanguageToggle/>
            {/* 3. Theme */}
            <ThemeToggle/>
          </div>
          {/* 4. Chevron — ABSOLUTE LAST */}
          <div className="sidebar-toggle-row">
            <button className="sidebar-toggle-btn" onClick={() => setExpanded(v => !v)}
              title={expanded ? t("nav.collapse","Collapse") : t("nav.expand","Expand")}>
              <Chevron expanded={expanded} rtl={isAr}/>
            </button>
          </div>
        </div>
      </aside>

      {/* Main workspace */}
      <main style={{
        position:"relative", minHeight:"100vh",
        paddingInlineStart: `${sidebarW + margin * 2}px`,
        paddingInlineEnd: 32, paddingTop: 40, paddingBottom: 40,
        transition:"padding-inline-start 280ms cubic-bezier(0.22,1,0.36,1)",
        boxSizing:"border-box",
      }}>
        <div style={{ maxWidth:1400, margin:"0 auto" }}>
          <TopBar isAr={isAr} t={t}/>
          <Routes>
            <Route path="/"              element={<Overview/>}/>
            <Route path="/live"          element={<LiveDetection/>}/>
            <Route path="/recorded" element={<RecordedClip/>}/>
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
        </div>
      </main>
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
