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
  { key: "role",       labelKey: "drones.spec.role" },
  { key: "origin",     labelKey: "drones.spec.origin" },
  { key: "first_used", labelKey: "drones.spec.first_used" },
  { key: "speed",      labelKey: "drones.spec.speed" },
  { key: "range",      labelKey: "drones.spec.range" },
  { key: "wingspan",   labelKey: "drones.spec.wingspan" },
  { key: "payload",    labelKey: "drones.spec.payload" },
  { key: "counter",    labelKey: "drones.spec.counter" },
];

export function Drones() {
  const { t } = useTranslation();
  const [active, setActive] = useState<DroneId>("shahed");
  const drone = DRONES.find((d) => d.id === active)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">{t("drones.title")}</h1>

        {/* Drone selector — .ts-selector glass pill from index.css */}
        <div className="ts-selector">
          {DRONES.map((d) => (
            <button
              key={d.id}
              onClick={() => setActive(d.id)}
              className={d.id === active ? "active" : ""}
            >
              {t(`${d.keyBase}.name`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {/* 3D viewer card */}
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

        {/* Specs card */}
        <div className="card md:col-span-2">
          <div className="mb-2 text-lg font-semibold">{t("drones.specs")}</div>
          <dl style={{ borderTop: "1px solid var(--border)" }}>
            {SPEC_ROWS.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  gap: 12, padding: "8px 0", fontSize: 13,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <dt style={{ color: "var(--muted-foreground)", width: "33%", flexShrink: 0 }}>
                  {t(row.labelKey)}
                </dt>
                <dd style={{ flex: 1, textAlign: "end", color: "var(--foreground)" }} dir="auto">
                  {t(`${drone.keyBase}.values.${row.key}`)}
                </dd>
              </div>
            ))}
          </dl>
          <div style={{
            marginTop: 12, borderRadius: "var(--radius)", padding: 12, fontSize: 12, lineHeight: 1.7,
            background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)",
          }}>
            {t(`${drone.keyBase}.summary`)}
          </div>
        </div>
      </div>
    </div>
  );
}
