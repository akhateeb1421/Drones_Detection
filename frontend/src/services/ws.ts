import { getAuthToken } from "./api";

const wsBase = import.meta.env.VITE_WS_BASE ?? "ws://localhost:8000";

/** Append the session token — both WS endpoints now require auth and
 *  close unauthenticated sockets with code 4401. */
function withToken(url: string): string {
  const token = getAuthToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

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
    // Kalman 1-sigma uncertainties (new). Used to draw the widening
    // prediction cone on the live map.
    speed_std_mps?: number;
    heading_std_deg?: number;
    // "triangulated" when two linked cameras produced a measured fix
    // instead of the single-camera assumed-distance estimate.
    position_source?: string;
    bearing_from_cam_deg?: number;
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
  return withToken(`${wsBase}/ws/live/${cameraId}`);
}

export function alarmsUrl(): string {
  return withToken(`${wsBase}/ws/alarms`);
}
