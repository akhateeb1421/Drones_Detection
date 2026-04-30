import { useEffect, useRef, useState } from "react";
import { DetectionMeta, liveStreamUrl } from "../services/ws";

/**
 * Connects to /ws/live/{cameraId} which alternates binary JPEG frames with a
 * JSON metadata frame. Returns the most recent JPEG (as a Blob URL) plus the
 * most recent metadata payload.
 */
export function useLiveStream(cameraId: number | null) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<DetectionMeta | null>(null);
  const [connected, setConnected] = useState(false);
  const lastBlobRef = useRef<string | null>(null);

  useEffect(() => {
    if (cameraId === null) {
      setImageUrl(null);
      setMeta(null);
      setConnected(false);
      return;
    }

    const ws = new WebSocket(liveStreamUrl(cameraId));
    ws.binaryType = "blob";

    let pendingBlob: Blob | null = null;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (evt) => {
      if (evt.data instanceof Blob) {
        pendingBlob = evt.data;
      } else {
        try {
          const parsed: DetectionMeta = JSON.parse(evt.data);
          if (pendingBlob) {
            const url = URL.createObjectURL(pendingBlob);
            if (lastBlobRef.current) URL.revokeObjectURL(lastBlobRef.current);
            lastBlobRef.current = url;
            setImageUrl(url);
            pendingBlob = null;
          }
          setMeta(parsed);
        } catch {
          // ignore malformed JSON
        }
      }
    };

    return () => {
      ws.close();
      if (lastBlobRef.current) {
        URL.revokeObjectURL(lastBlobRef.current);
        lastBlobRef.current = null;
      }
    };
  }, [cameraId]);

  return { imageUrl, meta, connected };
}
