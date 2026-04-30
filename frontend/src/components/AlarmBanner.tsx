import { useTranslation } from "react-i18next";
import { AlarmEvent } from "../services/ws";

interface Props {
  event: AlarmEvent | null;
  onDismiss: () => void;
}

export function AlarmBanner({ event, onDismiss }: Props) {
  const { t } = useTranslation();
  if (!event) return null;
  const eta = event.eta_s !== null ? `${event.eta_s.toFixed(1)}s` : "—";
  return (
    <div className="sticky top-0 z-30 w-full bg-danger px-4 py-3 text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t("alarm.banner")}</div>
          <div className="text-xs opacity-90">
            {event.drone_class} → {event.nearest_area ?? "?"} · ETA {eta} ·{" "}
            {t("alarm.score")} {event.score}
          </div>
        </div>
        <button onClick={onDismiss} className="rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30">
          ×
        </button>
      </div>
    </div>
  );
}
