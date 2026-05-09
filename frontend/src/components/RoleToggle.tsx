import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRole } from "../contexts/RoleContext";

/**
 * Role switcher in the header. Switching to "admin" requires the admin token.
 * The token already gates write endpoints on the backend; here it also
 * controls what the dashboard renders client-side.
 *
 * Note: this is a usability gate, not a security boundary — anyone with the
 * admin token can claim the admin role. Real auth would replace this.
 */
export function RoleToggle() {
  const { t } = useTranslation();
  const { role, setRole } = useRole();
  const [showLogin, setShowLogin] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError(t("auth.token_required"));
      return;
    }
    localStorage.setItem("admin_token", token.trim());
    setRole("admin");
    setShowLogin(false);
    setToken("");
    setError(null);
  };

  const logout = () => {
    localStorage.removeItem("admin_token");
    setRole("viewer");
  };

  if (role === "admin") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="badge bg-accent text-black font-semibold">{t("auth.role_admin")}</span>
        <button onClick={logout} className="btn-ghost text-xs">
          {t("auth.sign_out")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 text-xs">
        <span className="badge bg-slate-700 text-slate-200">{t("auth.role_viewer")}</span>
        <button onClick={() => setShowLogin((v) => !v)} className="btn-ghost text-xs">
          {t("auth.sign_in_admin")}
        </button>
      </div>
      {showLogin && (
        <form
          onSubmit={submit}
          className="absolute end-0 top-full z-40 mt-2 w-72 rounded-md border border-slate-700 bg-panel p-3 shadow-lg"
        >
          <div className="label mb-1">{t("admin.token_label")}</div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="input w-full"
            autoFocus
            dir="ltr"
          />
          {error && <div className="mt-1 text-xs text-danger">{error}</div>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowLogin(false)} className="btn-ghost text-xs">
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary text-xs">
              {t("auth.sign_in")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
