import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type Role = "admin" | "viewer";

type RoleApi = {
  role: Role;
  setRole: (r: Role) => void;
};

const RoleContext = createContext<RoleApi | null>(null);
const STORAGE_KEY = "user_role";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "admin" ? "admin" : "viewer";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, role);
  }, [role]);

  return (
    <RoleContext.Provider value={{ role, setRole: setRoleState }}>{children}</RoleContext.Provider>
  );
}

export function useRole(): RoleApi {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
