import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chat, ChatBackend } from "../services/api";
import { useRole } from "../contexts/RoleContext";
import { useChatbot } from "../contexts/ChatbotContext";

const BACKEND_KEY = "chatbot_backend";

function loadBackend(): ChatBackend {
  const v = localStorage.getItem(BACKEND_KEY);
  return v === "api" ? "api" : "local";
}

export function Chatbot() {
  const { t, i18n } = useTranslation();
  const { role } = useRole();
  const { history, setHistory, clear } = useChatbot();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState<ChatBackend>(loadBackend);

  // Persist the chosen backend so it sticks across reloads.
  useEffect(() => {
    localStorage.setItem(BACKEND_KEY, backend);
  }, [backend]);

  // Auto-scroll the message list to the latest reply whenever the history
  // changes or while we're waiting for a response.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, busy]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setHistory((h) => [...h, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await Chat.ask(message, history, i18n.language, role, backend);
      setHistory((h) => [...h, { role: "assistant", content: res.answer }]);
    } catch (e) {
      setHistory((h) => [...h, { role: "assistant", content: `${t("common.error")}: ${e}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold gradient-text">{t("chatbot.title")}</h1>
          <BackendToggle value={backend} onChange={setBackend} disabled={busy} t={t} />
        </div>
        <button onClick={clear} className="btn-ghost">{t("chatbot.clear")}</button>
      </div>
      <div className="text-xs text-muted">
        {backend === "api" ? t("chatbot.api_hint") : t("chatbot.local_hint")}
      </div>
      <div className="card flex h-[60vh] flex-col">
        <div className="scrollbar-thin flex-1 overflow-y-auto pr-2">
          {history.length === 0 && <div className="text-sm text-muted">{t("common.no_data")}</div>}
          <div className="space-y-3">
            {history.map((m, i) => (
              <div
                key={i}
                className={[
                  "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user" ? "ms-auto bg-accent2 text-white" : "bg-slate-800 text-slate-100",
                ].join(" ")}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="text-xs text-muted">{t("common.loading")}</div>}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("chatbot.placeholder")}
            className="input flex-1"
            disabled={busy}
          />
          <button onClick={send} disabled={busy} className="btn-primary">{t("chatbot.send")}</button>
        </div>
      </div>
    </div>
  );
}

// Compact pill toggle that lets the user pick the API or Local chat
// backend. The active option uses the gradient accent; the inactive one
// is muted. Disabled while a reply is in flight.
function BackendToggle({
  value,
  onChange,
  disabled,
  t,
}: {
  value: ChatBackend;
  onChange: (b: ChatBackend) => void;
  disabled: boolean;
  // Loose any-typed t to keep the file from importing TFunction generics.
  t: (k: string) => string;
}) {
  const base =
    "px-3 py-1 text-xs font-semibold rounded-full transition-colors duration-150";
  return (
    <div
      role="tablist"
      aria-label="chatbot backend"
      className="inline-flex gap-1 rounded-full border border-accent/25 bg-panel-2/40 p-1"
    >
      <button
        role="tab"
        aria-selected={value === "api"}
        disabled={disabled}
        onClick={() => onChange("api")}
        className={[
          base,
          value === "api"
            ? "gradient-accent text-bg shadow-sm"
            : "text-muted hover:text-white",
          disabled ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
        title={t("chatbot.api_hint")}
      >
        {t("chatbot.api")}
      </button>
      <button
        role="tab"
        aria-selected={value === "local"}
        disabled={disabled}
        onClick={() => onChange("local")}
        className={[
          base,
          value === "local"
            ? "gradient-accent text-bg shadow-sm"
            : "text-muted hover:text-white",
          disabled ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
        title={t("chatbot.local_hint")}
      >
        {t("chatbot.local")}
      </button>
    </div>
  );
}
