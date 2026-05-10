import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DroneViewer } from "../components/DroneViewer";

type DroneId = "shahed" | "orlan";
interface DroneSpec { id: DroneId; modelUrl?: string; embedUrl?: string; keyBase: string; }

const DRONES: DroneSpec[] = [
  { id: "shahed", embedUrl: "https://sketchfab.com/models/3f4f8742fe044c4cb1bf20ca4caf56ef/embed", keyBase: "drones.shahed" },
  { id: "orlan",  embedUrl: "https://sketchfab.com/models/f0f9e877c22443abad0126da0aefd080/embed", keyBase: "drones.orlan" },
];

const SPEC_ROWS = [
  { key: "role", labelKey: "drones.spec.role" },
  { key: "origin", labelKey: "drones.spec.origin" },
  { key: "first_used", labelKey: "drones.spec.first_used" },
  { key: "speed", labelKey: "drones.spec.speed" },
  { key: "range", labelKey: "drones.spec.range" },
  { key: "wingspan", labelKey: "drones.spec.wingspan" },
  { key: "payload", labelKey: "drones.spec.payload" },
  { key: "counter", labelKey: "drones.spec.counter" },
];

export function Drones() {
  const { t } = useTranslation();
  const [active, setActive] = useState<DroneId>("shahed");
  const drone = DRONES.find((d) => d.id === active)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold gradient-text">{t("drones.title")}</h1>
        <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
          {DRONES.map((d) => {
            const isActive = d.id === active;
            return (
              <button key={d.id} onClick={() => setActive(d.id)}
                className={["px-4 py-2 text-sm transition-colors", isActive ? "bg-accent text-black font-semibold" : "text-slate-300 hover:bg-slate-800"].join(" ")}>
                {t(`${d.keyBase}.name`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="card md:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">{t(`${drone.keyBase}.name`)}</div>
              <div className="text-xs text-muted">{t(`${drone.keyBase}.tagline`)}</div>
            </div>
            <div className="text-xs uppercase tracking-wide text-muted">{t("drones.viewer_hint")}</div>
          </div>
          <DroneViewer modelKey={drone.id} modelUrl={drone.modelUrl} embedUrl={drone.embedUrl} />
        </div>

        <div className="card md:col-span-2">
          <div className="mb-2 text-lg font-semibold">{t("drones.specs")}</div>
          <dl className="divide-y divide-slate-800">
            {SPEC_ROWS.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-3 py-2 text-sm">
                <dt className="w-1/3 shrink-0 text-muted">{t(row.labelKey)}</dt>
                <dd className="flex-1 text-end text-slate-200" dir="auto">
                  {t(`${drone.keyBase}.values.${row.key}`)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 rounded-md bg-slate-800 p-3 text-xs text-slate-200 leading-relaxed">
            {t(`${drone.keyBase}.summary`)}
          </div>
        </div>
      </div>
    </div>
  );
}
