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
          <h1 className="text-xl font-semibold">{t("chatbot.title")}</h1>
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
                className="max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap"
                style={
                  m.role === "user"
                    ? {
                        // User bubble — bright cyan→sky gradient, dark
                        // text. Eye-catching, leading-edge anchored.
                        marginInlineStart: "auto",
                        background: "linear-gradient(135deg,#01F2CF,#03B3DA)",
                        color: "#0a1410",
                        fontWeight: 600,
                        border: "1px solid var(--border-medium)",
                      }
                    : {
                        // Assistant bubble — also a LIGHT box in both
                        // modes, but a calmer pearl mint-tinted off-
                        // white instead of a saturated brand gradient.
                        // Reads as light against the dark chat card,
                        // and as slightly tinted against the white
                        // light-mode card. Always dark text on top.
                        background:
                          "linear-gradient(135deg, #e8f5f1 0%, #d4e8e2 100%)",
                        color: "#0b2422",
                        border: "1px solid rgba(11,36,34,0.10)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                      }
                }
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

// Pill-group toggle matching the Analysis horizon selector design.
// Subtle outer track, gradient pill on the active option, muted text
// on inactive. Same shape and behavior on both Drones-types and here.
function BackendToggle({
  value,
  onChange,
  disabled,
  t,
}: {
  value: ChatBackend;
  onChange: (b: ChatBackend) => void;
  disabled: boolean;
  t: (k: string) => string;
}) {
  const OPTIONS: { key: ChatBackend; labelKey: string; hintKey: string }[] = [
    { key: "api",   labelKey: "chatbot.api",   hintKey: "chatbot.api_hint" },
    { key: "local", labelKey: "chatbot.local", hintKey: "chatbot.local_hint" },
  ];
  return (
    <div
      role="tablist"
      aria-label="chatbot backend"
      style={{
        display: "flex", gap: 3, padding: 3,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
      }}
    >
      {OPTIONS.map((o) => {
        const isActive = value === o.key;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            onClick={() => onChange(o.key)}
            title={t(o.hintKey)}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
              fontFamily: "inherit", fontSize: 12, fontWeight: 700,
              transition: "all 0.15s",
              background: isActive
                ? "linear-gradient(135deg,#01F2CF,#03B3DA)"
                : "transparent",
              color: isActive ? "#0a1410" : "var(--text-muted)",
            }}
          >
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
