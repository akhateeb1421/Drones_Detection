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

  useEffect(() => {
    const ws = new WebSocket(alarmsUrl());
    ws.onmessage = (evt) => {
      try {
        const event: AlarmEvent = JSON.parse(evt.data);
        setLatest(event);
        setHistory((prev) => [event, ...prev].slice(0, 50));
        audioRef.current?.play().catch(() => {
          // browsers may block autoplay until user gesture; we ignore.
        });
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, []);

  return { latest, history, dismiss: () => setLatest(null) };
}
