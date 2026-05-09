import { useTranslation } from "react-i18next";
import { AlarmEvent } from "../services/ws";
import { usePlaceLabel, useClassLabel } from "../i18n/places";

interface Props {
  event: AlarmEvent | null;
  onDismiss: () => void;
}

export function AlarmBanner({ event, onDismiss }: Props) {
  const { t } = useTranslation();
  const placeLabel = usePlaceLabel();
  const classLabel = useClassLabel();
  if (!event) return null;
  const eta = event.eta_s !== null ? `${event.eta_s.toFixed(1)}s` : "—";
  return (
    <div
      className="sticky top-0 z-30 w-full overflow-hidden text-white animate-mount"
      style={{
        background: "linear-gradient(90deg, #6b1f25 0%, #c5443c 50%, #6b1f25 100%)",
        boxShadow: "0 6px 24px -8px rgba(197, 68, 60, 0.45)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="status-dot text-white" aria-hidden />
          <div>
            <div className="text-sm font-semibold tracking-wide">{t("alarm.banner")}</div>
            <div className="text-xs opacity-95 tabular">
              <span>{classLabel(event.drone_class)}</span>
              <span className="mx-1.5 opacity-60">→</span>
              <span>{event.nearest_area ? placeLabel(event.nearest_area) : "?"}</span>
              <span className="mx-1.5 opacity-60">·</span>
              <span>ETA <span className="font-data">{eta}</span></span>
              <span className="mx-1.5 opacity-60">·</span>
              <span>{t("alarm.score")} <span className="font-data">{event.score}</span></span>
            </div>
          </div>
        </div>
        <button onClick={onDismiss} className="rounded-md border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/25" aria-label="Dismiss">×</button>
      </div>
      <div className="absolute bottom-0 left-0 h-[2px] w-full opacity-70" style={{ background: "linear-gradient(90deg, transparent 0%, #c89968 50%, transparent 100%)", backgroundSize: "200% 100%", animation: "shimmer 2.4s linear infinite" }} />
    </div>
  );
}
