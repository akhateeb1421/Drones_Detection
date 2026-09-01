import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Auth, setAuthToken } from "../services/api";

export type AuthUser = { username: string; role: "admin" | "operator" };

type AuthApi = {
  user: AuthUser | null;
  /** True while the stored token is being validated on first load. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthApi | null>(null);
const TOKEN_KEY = "auth_token";

/**
 * Server-verified authentication state.
 *
 * The old model kept a client-chosen role in localStorage ("user_role"),
 * which the backend trusted for the chatbot — meaning any operator could
 * claim admin. Now the role comes from /auth/login and is re-validated on
 * every mount via /auth/me; the backend independently enforces it on every
 * endpoint, so the client state is purely cosmetic.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Validate any stored token once on mount.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    Auth.me()
      .then((me) => setUser({ username: me.username, role: me.role as AuthUser["role"] }))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Global 401 handler: the api layer dispatches this event when any
  // request comes back unauthenticated (expired token, revoked account).
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken(null);
      setUser(null);
    };
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await Auth.login(username, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser({ username: res.username, role: res.role as AuthUser["role"] });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
