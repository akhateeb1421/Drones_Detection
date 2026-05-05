import { useTranslation } from "react-i18next";

/**
 * Returns a function that localizes a place / class / type / compass label.
 * Falls back to the original raw string when the key isn't translated in
 * the active language. We check `i18n.exists` instead of relying on
 * defaultValue because i18next's fallbackLng would otherwise pull a value
 * from another language and override our fallback.
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

/**
 * Picks the right name from a record that carries both English (`name`) and
 * Arabic (`name_ar`) versions. In Arabic mode prefer name_ar (falling back to
 * name when missing); in any other language use name. Then runs the result
 * through the static places dictionary so historical region/place strings
 * still translate even when no row-level Arabic name was provided.
 */
export function useBilingualName() {
  const { i18n } = useTranslation();
  const placeLabel = usePlaceLabel();
  return (row: { name: string; name_ar?: string | null } | null | undefined): string => {
    if (!row) return "—";
    if (i18n.language === "ar" && row.name_ar && row.name_ar.trim()) {
      return row.name_ar;
    }
    if (i18n.language !== "ar") return row.name;
    // Arabic mode but no row-level name_ar — fall back to dictionary lookup
    return placeLabel(row.name);
  };
}
