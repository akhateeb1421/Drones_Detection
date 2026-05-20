import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A per-track snapshot of the most recent detection state. Shared by
 * LiveDetection and RecordedClip so both pages agree on the shape.
 */
export type Snapshot = {
  trackId: number;
  droneClass: string;
  lat: number;
  lon: number;
  speedMps: number;
  angleDeg: number;
  direction: string;
  confidence: number;
  nearestArea: string | null;
  etaS: number | null;
  lastSeenMs: number;
};

/* ── Persistent per-camera track store ──────────────────────────────────
 *
 * THE BUG THIS FIXES: the predicted-path line vanished whenever the
 * operator navigated away from the Live Detection / Recorded Clip page
 * (e.g. clicked another sidebar tab) and came back. React Router
 * unmounts the page component on navigation, which reset the page's
 * component-local `tracks` useState back to an empty Map. On return the
 * drone hadn't been re-detected yet, so `focused` was null, so
 * `predictedPath` was null, so no line was drawn until a fresh detection
 * arrived.
 *
 * THE FIX: keep the tracks in a module-level store that lives OUTSIDE
 * React's component lifecycle. Mounting/unmounting the page no longer
 * touches the data — when the operator returns, the tracks are still
 * there and the predicted line draws immediately. The store is keyed by
 * camera ID so each camera (and the recorded-clip camera) keeps its own
 * independent set.
 *
 * A tiny subscribe/emit layer lets components re-render when their
 * camera's store changes, mirroring a normal useState updater so the
 * call sites need almost no change: `const [tracks, setTracks] =
 * useTrackStore(cameraId)`.
 * ─────────────────────────────────────────────────────────────────── */

const stores = new Map<number, Map<number, Snapshot>>();
const subscribers = new Map<number, Set<() => void>>();
// Stable empty map for the "no camera selected yet" case so we don't
// hand back a fresh reference every render (which would thrash useMemo).
const EMPTY: Map<number, Snapshot> = new Map();

function storeFor(cameraId: number): Map<number, Snapshot> {
  let s = stores.get(cameraId);
  if (!s) {
    s = new Map();
    stores.set(cameraId, s);
  }
  return s;
}

function emit(cameraId: number): void {
  subscribers.get(cameraId)?.forEach((cb) => cb());
}

/**
 * Returns `[tracks, setTracks]` for the given camera, backed by the
 * module-level store so the data survives component unmount/remount.
 * `setTracks` takes a reducer `(prev) => next`, exactly like a useState
 * setter, so existing call sites work unchanged.
 */
export function useTrackStore(cameraId: number | null) {
  const [, bump] = useState(0);
  // Keep the latest cameraId in a ref so `setTracks` can stay referentially
  // stable (empty deps) yet always write to the currently-selected camera.
  const camRef = useRef(cameraId);
  camRef.current = cameraId;

  // Subscribe this component to its camera's store so external updates
  // (and updates from other mounts of the same camera) trigger a re-render.
  useEffect(() => {
    if (cameraId == null) return;
    const cb = () => bump((n) => n + 1);
    let set = subscribers.get(cameraId);
    if (!set) {
      set = new Set();
      subscribers.set(cameraId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }, [cameraId]);

  const tracks = cameraId != null ? storeFor(cameraId) : EMPTY;

  const setTracks = useCallback(
    (updater: (prev: Map<number, Snapshot>) => Map<number, Snapshot>) => {
      const cid = camRef.current;
      if (cid == null) return;
      const next = updater(storeFor(cid));
      stores.set(cid, next);
      emit(cid);
    },
    [],
  );

  return [tracks, setTracks] as const;
}
