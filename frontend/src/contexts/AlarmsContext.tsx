import { createContext, ReactNode, useContext } from "react";
import { useAlarms } from "../hooks/useAlarms";
import { AlarmEvent } from "../services/ws";

type AlarmsApi = {
  latest: AlarmEvent | null;
  history: AlarmEvent[];
  dismiss: () => void;
  // push intentionally omitted — alarms come from WebSocket
};

const AlarmsContext = createContext<AlarmsApi | null>(null);

export function AlarmsProvider({ children }: { children: ReactNode }) {
  const api = useAlarms();
  return <AlarmsContext.Provider value={api}>{children}</AlarmsContext.Provider>;
}

export function useAlarmsContext(): AlarmsApi {
  const ctx = useContext(AlarmsContext);
  if (!ctx) {
    throw new Error("useAlarmsContext must be used inside <AlarmsProvider>");
  }
  return ctx;
}
