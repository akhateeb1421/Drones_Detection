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
  const { role }    = useRole();
  const { history, setHistory, clear } = useChatbot();
  const [draft,   setDraft]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [backend, setBackend] = useState<ChatBackend>(loadBackend);

  useEffect(() => { localStorage.setItem(BACKEND_KEY, backend); }, [backend]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth", block:"end" });
  }, [history, busy]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    setHistory(h => [...h, { role:"user", content:message }]);
    setBusy(true);
    try {
      const res = await Chat.ask(message, history, i18n.language, role, backend);
      setHistory(h => [...h, { role:"assistant", content:res.answer }]);
    } catch (e) {
      setHistory(h => [...h, { role:"assistant", content:`${t("common.error")}: ${e}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, height:"calc(100vh - 110px)" }} data-mount>

      {/* Page header */}
      <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:12, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <h1 style={{ fontSize:"clamp(18px,2.5vw,26px)", fontWeight:800, color:"var(--foreground)", margin:0 }}>
            {t("chatbot.title")}
          </h1>
          <BackendToggle value={backend} onChange={setBackend} disabled={busy} t={t}/>
        </div>
        <button onClick={clear} className="btn-ghost">{t("chatbot.clear")}</button>
      </div>

      <div style={{ fontSize:12, color:"var(--muted-foreground)", flexShrink:0 }}>
        {backend === "api" ? t("chatbot.api_hint") : t("chatbot.local_hint")}
      </div>

      {/*
        UNIFIED CHAT WINDOW — single glassmorphic card.
        All messages flow in one vertical sequential feed.
        direction: ltr forces layout so user → right, assistant → left
        regardless of app language (Arabic or English).
      */}
      <div className="card" style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>

        {/* Message feed */}
        <div
          className="scrollbar-thin"
          style={{ flex:1, overflowY:"auto", padding:"4px 4px 4px 0" }}
        >
          {history.length === 0 && (
            <div style={{ fontSize:14, color:"var(--muted-foreground)", padding:"24px 0", textAlign:"center" }}>
              {t("common.no_data")}
            </div>
          )}

          {/* force direction:ltr so flex-end always means "right" */}
          <div style={{ display:"flex", flexDirection:"column", gap:14, direction:"ltr" }}>
            {history.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={i}
                  style={{
                    /*
                      USER → RIGHT side, always.
                      Wide roomy dark-glass bubble — NOT a small pill.
                      Matches the reference: large, comfortable, dark green semi-transparent.
                    */
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    /*
                      max-width 72% so the bubble is wide / roomy,
                      not squished — matches the reference screenshot.
                    */
                    maxWidth: "72%",
                    minWidth: 120,

                    /* Shape — highly rounded like in reference */
                    borderRadius: isUser
                      ? "18px 18px 4px 18px"     /* USER: flat bottom-right corner */
                      : "18px 18px 18px 4px",     /* BOT:  flat bottom-left corner */

                    /* Padding — generous internal space, not squished */
                    padding: "14px 18px",

                    fontSize: 14,
                    lineHeight: 1.62,
                    whiteSpace: "pre-wrap",

                    ...(isUser ? {
                      /*
                        USER bubble — dark green semi-transparent glass,
                        NOT a bright neon gradient pill.
                        Matches the reference: wide, roomy, dark background,
                        sharp white text.
                      */
                      background: "var(--gradient-primary)",
                      backdropFilter: "blur(16px)",
                      border: "1px solid oklch(0.74 0.18 158 / 0.35)",
                      color: "var(--primary-foreground)",
                      fontWeight: 500,
                      boxShadow: "0 4px 20px -4px oklch(0.74 0.18 158 / 0.22)",
                    } : {
                      /*
                        SYSTEM/BOT bubble — slightly lighter dark glass, LEFT side.
                        System errors (Ollama, torch) also here.
                      */
                      background: "var(--card)",
                      backdropFilter: "blur(16px)",
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                      fontWeight: 400,
                    }),
                  }}
                >
                  {m.content}
                </div>
              );
            })}
            {busy && (
              <div style={{
                alignSelf: "flex-start",
                padding: "12px 18px",
                borderRadius: "18px 18px 18px 4px",
                background: "oklch(0.18 0.015 163 / 0.60)",
                backdropFilter: "blur(16px)",
                border: "1px solid oklch(0.74 0.18 158 / 0.12)",
                fontSize: 13, color: "var(--muted-foreground)",
              }}>
                {t("common.loading")} …
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        </div>

        {/* Input row — matches reference: pill input + round send button */}
        <div style={{ marginTop:14, display:"flex", gap:10, flexShrink:0 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={t("chatbot.placeholder")}
            className="input"
            style={{ flex:1, height:48, borderRadius:24, paddingInline:20 }}
            disabled={busy}
          />
          {/* Round send button — gradient green circle like in reference */}
          <button
            onClick={send}
            disabled={busy}
            title={t("chatbot.send")}
            style={{
              width:48, height:48, borderRadius:"50%",
              background: "var(--gradient-primary)",
              boxShadow: "var(--shadow-glow)",
              border: "none", cursor: busy ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: busy ? 0.6 : 1, transition: "filter .14s, opacity .14s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = ""; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="oklch(0.10 0.02 163)" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* Glass pill backend toggle */
function BackendToggle({ value, onChange, disabled, t }: {
  value: ChatBackend; onChange: (b: ChatBackend) => void;
  disabled: boolean; t: (k: string) => string;
}) {
  const OPTIONS: { key: ChatBackend; labelKey: string; hintKey: string }[] = [
    { key:"api",   labelKey:"chatbot.api",   hintKey:"chatbot.api_hint" },
    { key:"local", labelKey:"chatbot.local", hintKey:"chatbot.local_hint" },
  ];
  return (
    <div className="ts-selector" role="tablist" aria-label="chatbot backend">
      {OPTIONS.map(o => {
        const isActive = value === o.key;
        return (
          <button
            key={o.key} role="tab" aria-selected={isActive}
            disabled={disabled} onClick={() => onChange(o.key)}
            title={t(o.hintKey)} className={isActive ? "active" : ""}
            style={{ opacity:disabled ? 0.6 : 1, cursor:disabled ? "not-allowed" : "pointer" }}
          >
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
