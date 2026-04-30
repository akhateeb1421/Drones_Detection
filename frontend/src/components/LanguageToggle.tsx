import { useTranslation } from "react-i18next";

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const next = i18n.language === "ar" ? "en" : "ar";
  return (
    <button
      onClick={() => i18n.changeLanguage(next)}
      className="btn-ghost"
      aria-label={t("common.language")}
    >
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}
