import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { BrandLogo } from "./BrandLogo";

/**
 * Full-screen sign-in gate. Every user — operator and admin alike — signs
 * in with a username + password; the server decides the role. Replaces
 * the old model where the dashboard was open to everyone and "admin" was
 * a client-side toggle guarded only by a shared token.
 */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const isAr = i18n.language === "ar";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t("auth.credentials_required", "Username and password are required."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch {
      setError(t("auth.invalid_credentials", "Invalid username or password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(1200px 600px at 50% -10%, rgba(0,202,127,0.10), transparent), #050806",
        fontFamily: isAr ? "'Tajawal', system-ui, sans-serif" : "'Inter', system-ui, sans-serif",
        padding: 16,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');`}</style>
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "rgba(12,20,15,0.92)",
          border: "1px solid rgba(0,202,127,0.14)",
          borderRadius: 18,
          padding: "34px 30px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ flexShrink: 0 }}>
            <BrandLogo size={44} />
          </div>
          <div>
            <div
              style={{
                fontSize: 22, fontWeight: 800, lineHeight: 1.1,
                background: "linear-gradient(90deg,#00ca7f,#b5f745)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}
            >
              رقيب
            </div>
            <div style={{ fontSize: 11, color: "rgba(235,245,240,0.75)", marginTop: 1 }}>
              {isAr ? "منظومة الدفاع ضد المسيّرات" : "Counter-UAS Defense System"}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: "#f2f7f4" }}>
          {t("auth.login_title", "Sign in")}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(0,202,127,0.65)" }}>
            {t("auth.username", "Username")}
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            dir="ltr"
            style={{
              background: "rgba(5,8,6,0.8)", border: "0.5px solid rgba(0,202,127,0.2)",
              borderRadius: 11, padding: "11px 14px", color: "var(--foreground)", fontSize: 14, fontFamily: "inherit",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(0,202,127,0.65)" }}>
            {t("auth.password", "Password")}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            style={{
              background: "rgba(5,8,6,0.8)", border: "0.5px solid rgba(0,202,127,0.2)",
              borderRadius: 11, padding: "11px 14px", color: "var(--foreground)", fontSize: 14, fontFamily: "inherit",
            }}
          />
        </label>

        {error && (
          <div style={{ fontSize: 13, color: "#ff6266" }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 4,
            background: "linear-gradient(135deg,#00ca7f,#b5f745)",
            color: "#020a05", fontWeight: 700, border: "none", borderRadius: 11,
            padding: "12px 20px", cursor: busy ? "wait" : "pointer",
            fontSize: 14, fontFamily: "inherit", opacity: busy ? 0.7 : 1,
            boxShadow: "0 0 0 1px rgba(0,202,127,0.25), 0 4px 16px -4px rgba(0,202,127,0.3)",
          }}
        >
          {busy ? t("common.loading", "...") : t("auth.sign_in", "Sign in")}
        </button>
      </form>
    </div>
  );
}
