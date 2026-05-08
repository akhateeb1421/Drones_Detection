import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

type ThemeApi = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeApi | null>(null);
const STORAGE_KEY = "ui_theme";

function readInitial(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Fall back to OS preference, default to dark for the demo aesthetic.
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
    const html = document.documentElement;
    html.classList.toggle("light", theme === "light");
    html.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const value: ThemeApi = {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
  };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
