import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { ToastHost } from "./components/Toast";

function navClass({ isActive }: { isActive: boolean }) {
  return ["nav-item", isActive ? "active" : ""].join(" ").trim();
}

function Banner() {
  const { latest, dismiss } = useAlarmsContext();
  return <AlarmBanner event={latest} onDismiss={dismiss} />;
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const { role } = useRole();
  const { t } = useTranslation();
  if (role !== "admin") {
    return <div className="card text-warning">{t("auth.admin_only")}</div>;
  }
  return children;
}

// Re-keys the <Routes> tree on every navigation so the route-fade animation
// plays on entry. We pass the AdminOnly wrapper down because it depends on
// the role context inside Shell — keeping it parametric avoids a duplicate
// hook call in this component.
function RoutedPages({ adminOnly }: { adminOnly: (n: JSX.Element) => JSX.Element }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="route-fade">
      <Routes location={location}>
        <Route path="/" element={<Overview />} />
        <Route path="/live" element={<LiveDetection />} />
        <Route path="/history" element={<HistoryMap />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/drones" element={<Drones />} />
        <Route path="/placement" element={adminOnly(<CameraPlacementPage />)} />
        <Route path="/chatbot" element={<Chatbot />} />
        <Route path="/admin/cameras" element={adminOnly(<CamerasAdmin />)} />
        <Route path="/admin/areas" element={adminOnly(<AreasAdmin />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function Shell() {
  const { t } = useTranslation();
  const { role } = useRole();
  const isAdmin = role === "admin";
  return (
    <div className="min-h-screen flex flex-col">
      <Banner />
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-panel">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img src="/logo.svg" alt="" className="h-10 w-10 flex-shrink-0" />
              <span className="status-dot absolute -bottom-0.5 -end-0.5 text-success" style={{ background: "currentColor" }} aria-hidden />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight gradient-text">{t("app.title")}</div>
              <div className="text-xs text-muted">{t("app.subtitle")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RoleToggle />
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-4 px-4 py-4">
        <aside className="w-56 flex-shrink-0 space-y-1">
          <NavLink to="/" end className={navClass}>{t("nav.overview")}</NavLink>
          <NavLink to="/live" className={navClass}>{t("nav.live")}</NavLink>
          <NavLink to="/history" className={navClass}>{t("nav.history")}</NavLink>
          <NavLink to="/analysis" className={navClass}>{t("nav.analysis")}</NavLink>
          <NavLink to="/drones" className={navClass}>{t("nav.drones")}</NavLink>
          {isAdmin && (<NavLink to="/placement" className={navClass}>{t("nav.placement")}</NavLink>)}
          <NavLink to="/chatbot" className={navClass}>{t("nav.chatbot")}</NavLink>
          {isAdmin && (
            <>
              <div className="mt-4 px-3 text-xs uppercase tracking-wider text-slate-500">{t("nav.admin")}</div>
              <NavLink to="/admin/cameras" className={navClass}>{t("nav.cameras")}</NavLink>
              <NavLink to="/admin/areas" className={navClass}>{t("nav.areas")}</NavLink>
            </>
          )}
        </aside>
        <main className="flex-1 min-w-0">
          {/* useLocation().key changes per route — keying on it lets the
              `route-fade` animation play on every navigation. */}
          <RoutedPages adminOnly={(node: JSX.Element) => <AdminOnly>{node}</AdminOnly>} />
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
            <Shell />
            {/* Single mount point for toast notifications anywhere in the app */}
            <ToastHost />
          </ChatbotProvider>
        </AlarmsProvider>
      </RoleProvider>
    </ThemeProvider>
  );
}
