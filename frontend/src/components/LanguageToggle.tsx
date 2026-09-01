import { useTranslation } from "react-i18next";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const toggle = () => {
    const next = isAr ? "en" : "ar";
    i18n.changeLanguage(next);
    document.documentElement.dir  = next === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = next;
  };
  return (
    <button onClick={toggle} title={isAr ? "English" : "العربية"} className="sidebar-ctrl" style={{ fontFamily:"inherit" }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} style={{ flexShrink:0 }}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
      </svg>
      <span className="sidebar-ctrl-label">{isAr ? "English" : "العربية"}</span>
    </button>
  );
}
