import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";

interface Props {
  modelUrl?: string;
  embedUrl?: string;
  modelKey: string;
  autoRotate?: boolean;
}

export function DroneViewer({ modelUrl, embedUrl, modelKey }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (embedUrl || !modelUrl) return;
    let alive = true;
    setMissing(false);
    fetch(modelUrl, { method: "HEAD" })
      .then((r) => { if (alive && !r.ok) setMissing(true); })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [modelUrl, embedUrl]);

  const bg = theme === "light" ? "#e8edf2" : "#0e1a14";

  if (embedUrl) {
    const base = embedUrl.split("?")[0];
    const params = new URLSearchParams({
      autostart: "1", ui_infos: "0", ui_watermark_link: "0", ui_watermark: "0",
      ui_stop: "0", ui_inspector: "0", ui_settings: "0", ui_vr: "0",
      ui_help: "0", ui_hint: "0", transparent: "0",
    });
    const src = `${base}?${params.toString()}`;
    return (
      <div key={modelKey} className="relative h-[420px] w-full overflow-hidden rounded-md border border-slate-800" style={{ background: bg }}>
        <iframe title={modelKey} src={src} allow="autoplay; fullscreen; xr-spatial-tracking" allowFullScreen className="h-full w-full border-0" />
      </div>
    );
  }

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-md border border-slate-800 flex items-center justify-center" style={{ background: bg }}>
      <div className="text-sm text-muted text-center px-4">
        {missing ? t("drones.placeholder_hint") : t("common.loading")}
      </div>
    </div>
  );
}
