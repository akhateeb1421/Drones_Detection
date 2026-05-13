import { useEffect, useState } from "react";

type ToastKind = "info" | "success" | "warning" | "danger";

interface ToastEvent {
  id: number;
  kind: ToastKind;
  message: string;
}

let _push: ((kind: ToastKind, message: string) => void) | null = null;

/**
 * Lightweight toast. No external lib — single mount-point in the app shell,
 * imperative push API. Auto-dismisses after 3 s with a fade-out.
 *
 * Usage: import { toast } from "../components/Toast";
 *        toast.success("Camera saved");
 */
export const toast = {
  info:    (m: string) => _push?.("info", m),
  success: (m: string) => _push?.("success", m),
  warning: (m: string) => _push?.("warning", m),
  danger:  (m: string) => _push?.("danger", m),
};

const KIND_STYLES: Record<ToastKind, { border: string; tint: string }> = {
  info:    { border: "rgba(62,224,164,0.45)", tint: "rgba(62,224,164,0.10)" },
  success: { border: "rgba(62,224,164,0.45)", tint: "rgba(62,224,164,0.10)" },
  warning: { border: "rgba(245,166,35,0.5)",  tint: "rgba(245,166,35,0.10)" },
  danger:  { border: "rgba(255,71,87,0.5)",   tint: "rgba(255,71,87,0.10)" },
};

export function ToastHost() {
  const [items, setItems] = useState<ToastEvent[]>([]);

  useEffect(() => {
    _push = (kind, message) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    };
    return () => { _push = null; };
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-4 end-4 z-[60] flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const s = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className="animate-mount pointer-events-auto rounded-lg px-4 py-2 text-sm backdrop-blur-md"
            style={{
              background: "rgba(14,26,20,0.92)",
              // Toast bg stays dark in both modes, so the text must also
              // stay light. Inline color overrides the index.css light-
              // mode `text-slate-100` rule which would otherwise make
              // the text near-black on the dark bg (1.2:1 — unreadable).
              color: "#e0f5f2",
              border: `1px solid ${s.border}`,
              boxShadow: `0 0 0 1px ${s.tint} inset`,
            }}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
