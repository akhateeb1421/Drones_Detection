const wsBase = import.meta.env.VITE_WS_BASE ?? "ws://localhost:8000";

export type DetectionMeta = {
  type: "frame";
  camera_id: number;
  frame_idx: number;
  ts: string;
  remote: boolean;
  detections: {
    track_id: number;
    drone_class: string;
    confidence: number;
    bbox: [number, number, number, number];
    lat: number;
    lon: number;
    speed_mps: number;
    angle_deg: number;
    direction: string;
    nearest_area: string | null;
    dist_m: number | null;
    eta_s: number | null;
    // Set when this detection has been linked back to a prior track from
    // another camera (cross-camera handoff). The frontend uses these to
    // merge sightings into one logical drone.
    linked_track_id?: number | null;
    link_root_camera_id?: number | null;
  }[];
};

export type AlarmEvent = {
  camera_id: number;
  track_id: number;
  drone_class: string;
  confidence: number;
  lat: number;
  lon: number;
  nearest_area: string | null;
  eta_s: number | null;
  score: number;
  reasons: string[];
  ts: string;
};

export function liveStreamUrl(cameraId: number): string {
  return `${wsBase}/ws/live/${cameraId}`;
}

export function alarmsUrl(): string {
  return `${wsBase}/ws/alarms`;
}
