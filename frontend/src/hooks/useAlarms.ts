import { useCallback, useEffect, useRef, useState } from "react";
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

  // Internal: fold one alarm event into state and play the sound.
  const ingest = useCallback((event: AlarmEvent) => {
    setLatest(event);
    setHistory((prev) => [event, ...prev].slice(0, 50));
    audioRef.current?.play().catch(() => {
      // browsers may block autoplay until user gesture; we ignore.
    });
  }, []);

  useEffect(() => {
    const ws = new WebSocket(alarmsUrl());
    ws.onmessage = (evt) => {
      try {
        const event: AlarmEvent = JSON.parse(evt.data);
        ingest(event);
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [ingest]);

  // Public: synthesize an alarm event from another data source (e.g. a
  // CRITICAL pending-approvals row whose original WS event was missed).
  // Caller is responsible for de-duplication.
  const push = useCallback(
    (event: AlarmEvent) => {
      ingest(event);
    },
    [ingest],
  );

  return { latest, history, dismiss: () => setLatest(null), push };
}
