import { useTranslation } from "react-i18next";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";

  const toggle = () => {
    const next = isAr ? "en" : "ar";
    i18n.changeLanguage(next);
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = next;
  };

  return (
    <button
      onClick={toggle}
      style={{
        width:"100%",
        padding:"10px 12px",
        borderRadius:11,
        background:"rgba(1,242,207,0.07)",
        border:"0.5px solid rgba(1,242,207,0.18)",
        color:"#e0f5f2",
        fontSize: isAr ? 14 : 13,
        fontWeight:700,
        cursor:"pointer",
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        gap:7,
        fontFamily:"inherit",
        letterSpacing:"0.02em",
        transition:"all 0.15s",
      }}
      onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(1,242,207,0.12)";(e.currentTarget as HTMLButtonElement).style.color="#01F2CF"}}
      onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(1,242,207,0.07)";(e.currentTarget as HTMLButtonElement).style.color="#e0f5f2"}}
    >
      {/* Earth icon — no Japanese characters */}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#01F2CF" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
      </svg>
      {isAr ? "English" : "العربية"}
    </button>
  );
}
