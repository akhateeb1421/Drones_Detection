import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useRole } from "./RoleContext";

export type ChatTurn = { role: "user" | "assistant"; content: string };

type ChatbotApi = {
  history: ChatTurn[];
  setHistory: React.Dispatch<React.SetStateAction<ChatTurn[]>>;
  clear: () => void;
};

const ChatbotContext = createContext<ChatbotApi | null>(null);

const storageKey = (userRole: string) => `chatbot_history_${userRole}`;

function load(userRole: string): ChatTurn[] {
  try {
    const raw = localStorage.getItem(storageKey(userRole));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((m) => m && typeof m.content === "string");
  } catch {
    // ignore corrupted storage
  }
  return [];
}

export function ChatbotProvider({ children }: { children: ReactNode }) {
  const { role } = useRole();
  // Each role has its own chat history. Switching roles swaps the visible
  // conversation; the other role's transcript is preserved on disk.
  const [history, setHistory] = useState<ChatTurn[]>(() => load(role));

  // When the role changes, switch the in-memory list to the stored history
  // for that role.
  useEffect(() => {
    setHistory(load(role));
  }, [role]);

  // Persist whenever history changes (but only for the current role's bucket).
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(role), JSON.stringify(history));
    } catch {
      // quota errors etc. — non-fatal
    }
  }, [history, role]);

  const clear = () => setHistory([]);

  return (
    <ChatbotContext.Provider value={{ history, setHistory, clear }}>
      {children}
    </ChatbotContext.Provider>
  );
}

export function useChatbot(): ChatbotApi {
  const ctx = useContext(ChatbotContext);
  if (!ctx) throw new Error("useChatbot must be used inside <ChatbotProvider>");
  return ctx;
}
