import { useTranslation } from "react-i18next";

/**
 * Returns a function that localizes a place / class / type label.
 * Falls back to the original English string when the key isn't translated.
 *
 * Important: i18next normally falls back to the configured `fallbackLng`
 * when a key is missing in the active language. With `places` we want the
 * opposite — if Arabic doesn't define a key we'd rather show the raw English
 * DB value than the English translation. So we check for existence first.
 */
export function usePlaceLabel() {
  const { t, i18n } = useTranslation();
  return (name: string | null | undefined): string => {
    if (name == null || name === "") return "—";
    const key = `places.${name}`;
    if (i18n.exists(key, { lng: i18n.language })) {
      return t(key);
    }
    return name;
  };
}

export function useTypeLabel() {
  const { t, i18n } = useTranslation();
  return (name: string | null | undefined): string => {
    if (name == null || name === "") return "—";
    const key = `types.${name}`;
    if (i18n.exists(key, { lng: i18n.language })) {
      return t(key);
    }
    return name;
  };
}

export function useClassLabel() {
  const { t, i18n } = useTranslation();
  return (name: string | null | undefined): string => {
    if (name == null || name === "") return "—";
    const key = `drone_class.${name.toLowerCase()}`;
    if (i18n.exists(key, { lng: i18n.language })) {
      return t(key);
    }
    return name;
  };
}

/**
 * Returns a function that picks the right side of a bilingual record.
 * Cameras and sensitive-areas carry a primary `name` (English) and an
 * optional `name_ar` (Arabic). When the UI is in Arabic and the record
 * has an Arabic name, use it; otherwise fall back to `name`.
 */
export function useBilingualName() {
  const { i18n } = useTranslation();
  return (row: { name: string; name_ar?: string | null }): string => {
    if (i18n.language === "ar" && row.name_ar) return row.name_ar;
    return row.name;
  };
}

export function useCompassLabel() {
  const { t, i18n } = useTranslation();
  return (label: string | null | undefined): string => {
    if (label == null || label === "") return "";
    const key = `compass.${label}`;
    if (i18n.exists(key, { lng: i18n.language })) {
      return t(key);
    }
    return label;
  };
}
