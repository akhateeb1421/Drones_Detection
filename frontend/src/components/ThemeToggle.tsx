import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label  = isDark ? t("theme.switch_to_light","Switch to light mode") : t("theme.switch_to_dark","Switch to dark mode");
  const Sun = () => (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
      <circle cx="10" cy="10" r="3.4"/>
      <line x1="10" y1="1.6" x2="10" y2="3.4"/>  <line x1="10" y1="16.6" x2="10" y2="18.4"/>
      <line x1="1.6" y1="10" x2="3.4" y2="10"/>  <line x1="16.6" y1="10" x2="18.4" y2="10"/>
      <line x1="3.7" y1="3.7" x2="4.9" y2="4.9"/>  <line x1="15.1" y1="15.1" x2="16.3" y2="16.3"/>
      <line x1="3.7" y1="16.3" x2="4.9" y2="15.1"/> <line x1="15.1" y1="4.9" x2="16.3" y2="3.7"/>
    </svg>
  );
  const Moon = () => (
    <svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor" style={{ flexShrink:0 }}>
      <path d="M14.5 13.5A6 6 0 0 1 7 5.7a.7.7 0 0 0-1-.78A7.5 7.5 0 1 0 15.3 14.5a.7.7 0 0 0-.78-1Z"/>
    </svg>
  );
  return (
    <button type="button" onClick={toggle} title={label} aria-label={label} className="sidebar-ctrl" style={{ fontFamily:"inherit" }}>
      {isDark ? <Sun/> : <Moon/>}
      <span className="sidebar-ctrl-label">{label}</span>
    </button>
  );
}
