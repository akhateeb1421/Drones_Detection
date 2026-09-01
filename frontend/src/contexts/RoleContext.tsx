import { ReactNode } from "react";
import { useAuth } from "./AuthContext";

export type Role = "admin" | "viewer";

type RoleApi = {
  role: Role;
};

/**
 * Thin compatibility wrapper over AuthContext.
 *
 * Historically the role lived in localStorage and could be flipped by the
 * client at will. It is now DERIVED from the server-verified session:
 * an admin account maps to "admin", everything else to "viewer". There is
 * deliberately no setRole — the only way to change roles is to sign in
 * with a different account.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  // State lives in AuthContext; nothing to provide here anymore. Kept so
  // existing <RoleProvider> wrapping in App.tsx stays harmless.
  return <>{children}</>;
}

export function useRole(): RoleApi {
  const { user } = useAuth();
  return { role: user?.role === "admin" ? "admin" : "viewer" };
}
