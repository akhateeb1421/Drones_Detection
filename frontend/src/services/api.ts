import axios, { AxiosRequestConfig } from "axios";

const baseURL = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export const api = axios.create({
  baseURL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) {
    config.headers["X-Admin-Token"] = token;
  }
  return config;
});

export type Attack = {
  id: number;
  occurred_at: string;
  attack_type: string;
  target_location: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  source: string;
  drone_class: string | null;
  confidence: number | null;
  speed_mps: number | null;
  direction: string | null;
  nearest_area: string | null;
  eta_s: number | null;
};

export type Track = {
  id: number;
  camera_id: number;
  track_id: number;
  first_seen_at: string;
  last_seen_at: string;
  voted_class: string | null;
  max_confidence: number | null;
  max_speed_mps: number | null;
  min_eta_s: number | null;
  nearest_area: string | null;
  last_lat: number | null;
  last_lon: number | null;
  status: string;
  reviewed_at: string | null;
  thumbnail_path: string | null;
  alarm_fired_at: string | null;
};

export function trackThumbUrl(trackDbId: number): string {
  return `${baseURL}/detections/tracks/${trackDbId}/thumb`;
}

export type Camera = {
  id: number;
  name: string;
  name_ar?: string | null;
  stream_url: string;
  latitude: number;
  longitude: number;
  heading_deg: number;
  altitude_m: number;
  fov_h_deg: number;
  fov_v_deg: number;
  sensor_w_px: number;
  assumed_target_distance_m: number;
  enabled: boolean;
  created_at: string;
};

export type Area = {
  id: number;
  name: string;
  name_ar?: string | null;
  latitude: number;
  longitude: number;
  priority: number;
  created_at: string;
};

export type RegionRisk = {
  region: string;
  risk_probability: number;
  horizon_days: number;
  method: string;
};

export type ForecastPoint = {
  region: string;
  forecast_date: string;
  expected_count: number;
  lower: number;
  upper: number;
};

export type TimelinePoint = { period: string; count: number };
export type RegionStat = { region: string; count: number };
export type TypeStat = { attack_type: string; count: number };

export const Attacks = {
  list: (params: Record<string, string | undefined> = {}) =>
    api.get<Attack[]>("/attacks", { params }).then((r) => r.data),
};

export const Detections = {
  pendingTracks: () =>
    api.get<Track[]>("/detections/tracks", { params: { status: "pending" } }).then((r) => r.data),
  approve: (cameraId: number, trackId: number) =>
    api.post(`/detections/${cameraId}/${trackId}/approve`).then((r) => r.data),
  reject: (cameraId: number, trackId: number) =>
    api.post(`/detections/${cameraId}/${trackId}/reject`).then((r) => r.data),
};

export const Cameras = {
  list: () => api.get<Camera[]>("/cameras").then((r) => r.data),
  create: (body: Omit<Camera, "id" | "created_at">) =>
    api.post<Camera>("/cameras", body).then((r) => r.data),
  update: (id: number, body: Partial<Camera>) =>
    api.patch<Camera>(`/cameras/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/cameras/${id}`).then((r) => r.data),
};

export const Areas = {
  list: () => api.get<Area[]>("/areas").then((r) => r.data),
  create: (body: Omit<Area, "id" | "created_at">) => api.post<Area>("/areas", body).then((r) => r.data),
  update: (id: number, body: Partial<Area>) =>
    api.patch<Area>(`/areas/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete(`/areas/${id}`).then((r) => r.data),
};

export type TotalCounts = {
  events: number;
  rows: number;
  rows_historical: number;
  rows_synthetic: number;
  rows_live: number;
};

export type CombinedAttack = { label: string; count: number };

export const Analysis = {
  total: () => api.get<TotalCounts>("/analysis/total").then((r) => r.data),
  byRegion: () => api.get<RegionStat[]>("/analysis/by-region").then((r) => r.data),
  byRegionPure: () => api.get<RegionStat[]>("/analysis/by-region-pure").then((r) => r.data),
  combined: () => api.get<CombinedAttack[]>("/analysis/combined").then((r) => r.data),
  byType: () => api.get<TypeStat[]>("/analysis/by-type").then((r) => r.data),
  timeline: (params: Record<string, string | undefined> = {}) =>
    api.get<TimelinePoint[]>("/analysis/timeline", { params }).then((r) => r.data),
};

export type CameraPlacement = {
  kind: "area" | "forward";
  name: string;
  for_area: string;
  lat: number;
  lon: number;
  heading_deg: number;
  heading_label: string;
  fov_h_deg: number;
  assumed_target_distance_m: number;
  covers_attacks: number;
  spread_deg: number;
  top_threat_region: string;
  top_threat_region_count: number;
  scope: string;
  rationale: string;
};

export const Predictions = {
  risk: (config?: AxiosRequestConfig) => api.get<RegionRisk[]>("/predict/risk", config).then((r) => r.data),
  forecast: (params: Record<string, string | undefined> = {}) =>
    api.get<ForecastPoint[]>("/predict/forecast", { params }).then((r) => r.data),
  cameraPlacements: (params: Record<string, string | undefined> = {}) =>
    api.get<CameraPlacement[]>("/predict/camera-placements", { params }).then((r) => r.data),
};

const CHAT_TIMEOUT_MS = 5 * 60 * 1000;

export const Chat = {
  ask: (message: string, history: { role: string; content: string }[], language: string) =>
    api
      .post<{ answer: string; model: string }>(
        "/chat",
        { message, history, language },
        { timeout: CHAT_TIMEOUT_MS },
      )
      .then((r) => r.data),
};
