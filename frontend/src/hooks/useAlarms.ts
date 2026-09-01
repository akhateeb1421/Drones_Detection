import { useEffect, useRef, useState } from "react";
import { AlarmEvent, alarmsUrl } from "../services/ws";

const ALARM_AUDIO_SRC = "/alarm.mp3";

export function useAlarms() {
  const [latest, setLatest] = useState<AlarmEvent | null>(null);
  const [history, setHistory] = useState<AlarmEvent[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio(ALARM_AUDIO_SRC);
    audioRef.current.volume = 0.7;
  }, []);

  // Per-drone audio cooldown. The backend already throttles per track, but
  // multiple tracks / cameras can still overlap; without client dedup the
  // siren replays on every WebSocket message. We key on (camera, track)
  // and re-alert early only on ESCALATION — the ETA collapsing (drone got
  // much closer) is information the operator must hear again immediately.
  const lastAlertRef = useRef<Map<string, { ts: number; etaS: number | null }>>(new Map());
  const COOLDOWN_MS = 10_000;

  useEffect(() => {
    const ws = new WebSocket(alarmsUrl());
    ws.onmessage = (evt) => {
      try {
        const event: AlarmEvent = JSON.parse(evt.data);
        setLatest(event);
        setHistory((prev) => [event, ...prev].slice(0, 50));

        const key = `${event.camera_id}:${event.track_id}`;
        const prev = lastAlertRef.current.get(key);
        const now = Date.now();
        const escalated =
          prev != null &&
          event.eta_s != null &&
          (prev.etaS == null || event.eta_s < prev.etaS * 0.5 || event.eta_s < 30);
        const shouldPlay = prev == null || now - prev.ts >= COOLDOWN_MS || escalated;
        if (shouldPlay) {
          lastAlertRef.current.set(key, { ts: now, etaS: event.eta_s });
          audioRef.current?.play().catch(() => {
            // browsers may block autoplay until user gesture; we ignore.
          });
        } else {
          // Keep the freshest ETA so escalation compares against it.
          lastAlertRef.current.set(key, { ts: prev.ts, etaS: event.eta_s });
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, []);

  return { latest, history, dismiss: () => setLatest(null) };
}
