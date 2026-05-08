import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";

/**
 * Small circular sun/moon button that flips between dark and light modes.
 * Persists the choice via ThemeContext (localStorage-backed).
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const aria = isDark ? t("theme.switch_to_light") : t("theme.switch_to_dark");
  return (
    <button
      type="button"
      onClick={toggle}
      title={aria}
      aria-label={aria}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-200 hover:bg-slate-800"
    >
      {isDark ? (
        // Sun glyph (means: click to go light)
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="10" r="3.4" />
          <line x1="10" y1="2" x2="10" y2="4" />
          <line x1="10" y1="16" x2="10" y2="18" />
          <line x1="2" y1="10" x2="4" y2="10" />
          <line x1="16" y1="10" x2="18" y2="10" />
          <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
          <line x1="14.4" y1="14.4" x2="15.8" y2="15.8" />
          <line x1="4.2" y1="15.8" x2="5.6" y2="14.4" />
          <line x1="14.4" y1="5.6" x2="15.8" y2="4.2" />
        </svg>
      ) : (
        // Moon glyph (means: click to go dark)
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M14.5 13.5A6 6 0 0 1 7 5.7a.7.7 0 0 0-1-.78A7.5 7.5 0 1 0 15.3 14.5a.7.7 0 0 0-.78-1Z" />
        </svg>
      )}
    </button>
  );
}
