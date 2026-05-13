import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRole } from "../contexts/RoleContext";
import { Admin } from "../services/api";

/**
 * Sign-In flow that lives in the sidebar bottom (mirror position of
 * the Sign-Out button). Clicking opens a small inline form below the
 * button where the operator types the admin token. The token is
 * validated against /admin/check BEFORE the role is switched — a
 * wrong token never enters localStorage, so the next write doesn't
 * silently 401.
 */
export function AdminSignInButton() {
  const { t, i18n } = useTranslation();
  const { setRole } = useRole();
  const isAr = i18n.language === "ar";
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = token.trim();
    if (!candidate) { setError(t("auth.token_required")); return; }
    setBusy(true);
    setError(null);
    const ok = await Admin.check(candidate);
    setBusy(false);
    if (!ok) {
      setError(t("auth.token_invalid", "Token rejected — check the value and try again."));
      return;
    }
    localStorage.setItem("admin_token", candidate);
    setRole("admin");
    setOpen(false);
    setToken("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Sign-in button — same shape as the gradient red Sign-Out
          button used in admin mode, but tinted with the brand accent
          so the operator can tell the two states apart at a glance. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 11,
          background: "linear-gradient(135deg,#01F2CF,#03DA9A 50%,#03B3DA)",
          color: "#0a1410", fontSize: isAr ? 14 : 13, fontWeight: 700,
          border: "none", cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H2.25"/>
        </svg>
        {t("auth.sign_in_admin")}
      </button>

      {open && (
        <form
          onSubmit={submit}
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 11, padding: 12,
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div className="label" style={{ margin: 0 }}>{t("admin.token_label")}</div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="input"
            style={{ padding: "8px 10px", fontSize: 13 }}
            autoFocus
            dir="ltr"
          />
          {error && <div className="text-xs" style={{ color: "var(--text-danger,#dc2626)" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button type="button" onClick={() => setOpen(false)}
              className="btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }}
              disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="submit"
              className="btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}
              disabled={busy}>
              {busy ? t("common.loading","...") : t("auth.sign_in")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
