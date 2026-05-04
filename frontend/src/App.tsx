import { NavLink, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "./components/LanguageToggle";
import { AlarmBanner } from "./components/AlarmBanner";
import { useAlarms } from "./hooks/useAlarms";
import { Overview } from "./pages/Overview";
import { LiveDetection } from "./pages/LiveDetection";
import { HistoryMap } from "./pages/HistoryMap";
import { Analysis } from "./pages/Analysis";
import { Chatbot } from "./pages/Chatbot";
import { CameraPlacementPage } from "./pages/CameraPlacement";
import { CamerasAdmin } from "./pages/admin/Cameras";
import { AreasAdmin } from "./pages/admin/Areas";

function navClass({ isActive }: { isActive: boolean }) {
  return [
    "block px-3 py-2 rounded-md text-sm",
    isActive ? "bg-accent text-black font-semibold" : "text-slate-300 hover:bg-slate-800",
  ].join(" ");
}

export default function App() {
  const { t } = useTranslation();
  const { latest, dismiss } = useAlarms();
  return (
    <div className="min-h-screen flex flex-col">
      <AlarmBanner event={latest} onDismiss={dismiss} />
      <header className="border-b border-slate-800 bg-panel">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-lg font-bold text-accent">{t("app.title")}</div>
            <div className="text-xs text-muted">{t("app.subtitle")}</div>
          </div>
          <LanguageToggle />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-4 px-4 py-4">
        <aside className="w-56 flex-shrink-0 space-y-1">
          <NavLink to="/" end className={navClass}>{t("nav.overview")}</NavLink>
          <NavLink to="/live" className={navClass}>{t("nav.live")}</NavLink>
          <NavLink to="/history" className={navClass}>{t("nav.history")}</NavLink>
          <NavLink to="/analysis" className={navClass}>{t("nav.analysis")}</NavLink>
          <NavLink to="/placement" className={navClass}>{t("nav.placement")}</NavLink>
          <NavLink to="/chatbot" className={navClass}>{t("nav.chatbot")}</NavLink>
          <div className="mt-4 px-3 text-xs uppercase text-slate-500">{t("nav.admin")}</div>
          <NavLink to="/admin/cameras" className={navClass}>{t("nav.cameras")}</NavLink>
          <NavLink to="/admin/areas" className={navClass}>{t("nav.areas")}</NavLink>
        </aside>
        <main className="flex-1 min-w-0">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/live" element={<LiveDetection />} />
            <Route path="/history" element={<HistoryMap />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/placement" element={<CameraPlacementPage />} />
            <Route path="/chatbot" element={<Chatbot />} />
            <Route path="/admin/cameras" element={<CamerasAdmin />} />
            <Route path="/admin/areas" element={<AreasAdmin />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
