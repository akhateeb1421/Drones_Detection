import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chat } from "../services/api";
import { useRole } from "../contexts/RoleContext";
import { useChatbot } from "../contexts/ChatbotContext";

export function Chatbot() {
  const { t, i18n } = useTranslation();
  const { role } = useRole();
  const { history, setHistory, clear } = useChatbot();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
      const res = await Chat.ask(message, history, i18n.language, role);
      setHistory((h) => [...h, { role: "assistant", content: res.answer }]);
    } catch (e) {
      setHistory((h) => [...h, { role: "assistant", content: `${t("common.error")}: ${e}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-accent">{t("chatbot.title")}</h1>
        <button onClick={clear} className="btn-ghost">{t("chatbot.clear")}</button>
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
