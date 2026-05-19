import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRole } from "../contexts/RoleContext";
import { Admin } from "../services/api";

interface Props {
  /** When true (sidebar collapsed): show only the login icon, no text */
  compact?: boolean;
}

export function AdminSignInButton({ compact = false }: Props) {
  const { t } = useTranslation();
  const { setRole } = useRole();
  const [open,  setOpen]  = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = token.trim();
    if (!candidate) { setError(t("auth.token_required")); return; }
    setBusy(true); setError(null);
    const ok = await Admin.check(candidate);
    setBusy(false);
    if (!ok) { setError(t("auth.token_invalid", "Token rejected.")); return; }
    localStorage.setItem("admin_token", candidate);
    setRole("admin");
    setOpen(false);
    setToken("");
  };

  const LoginIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} style={{ flexShrink:0 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25"/>
    </svg>
  );

  return (
    <div style={{ position:"relative", display:"flex", flexDirection:"column", gap:6, alignItems: compact ? "center" : "stretch", width: compact ? "auto" : "100%" }}>
      {/*
        Sign-in button.
        compact=true  → 44×44px icon-only square (matches nav items when sidebar collapsed)
        compact=false → full-width pill with icon + text label
      */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t("auth.sign_in_admin")}
        className="sidebar-ctrl"
        style={{
          background: "var(--gradient-primary)",
          color: "var(--primary-foreground)",
          border: "none",
          fontFamily: "inherit",
          boxShadow: "var(--shadow-glow)",
        }}
      >
        <LoginIcon/>
        <span className="sidebar-ctrl-label">{t("auth.sign_in_admin")}</span>
      </button>

      {/* Token popup — floats above the button, doesn't overlap sidebar edge */}
      {open && (
        <div
          style={{
            position: "absolute",
            /* When collapsed, popup opens to the right of the button (away from screen edge) */
            insetInlineStart: compact ? "calc(100% + 10px)" : 0,
            bottom: compact ? 0 : "calc(100% + 8px)",
            width: 240,
            zIndex: 60,
            /* Glass card */
            background: "var(--popover)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border)",
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 8px 40px oklch(0 0 0 / 0.5)",
          }}
        >
          <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {/* Label */}
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--primary)", opacity:0.85 }}>
              {t("admin.token_label")}
            </div>

            {/* Password input */}
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="input"
              style={{ height:38, fontSize:13 }}
              autoFocus
              dir="ltr"
              placeholder="••••••••"
            />

            {/* Error */}
            {error && (
              <div style={{ fontSize:12, color:"var(--destructive)", lineHeight:1.4 }}>{error}</div>
            )}

            {/* Actions */}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button
                type="button"
                onClick={() => { setOpen(false); setToken(""); setError(null); }}
                className="btn-ghost"
                style={{ height:34, padding:"0 12px", fontSize:12 }}
                disabled={busy}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ height:34, padding:"0 14px", fontSize:12 }}
                disabled={busy}
              >
                {busy ? "..." : t("auth.sign_in")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
