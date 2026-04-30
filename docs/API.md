# API Reference

The FastAPI backend auto-generates this at runtime — go to
`http://localhost:8000/docs` for an interactive Swagger UI.

This file is a quick-reference summary.

## Authentication

Read endpoints are open. Write/admin endpoints require the
`X-Admin-Token` request header to match `ADMIN_TOKEN` from `backend/.env`.

## Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | none | Liveness probe |

## Attacks (history view)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /attacks | none | List attacks; filters: `date_from`, `date_to`, `region`, `attack_type`, `source`, `limit` |

## Live detections + approval

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /detections | none | List per-frame detection records |
| GET | /detections/tracks | none | List track summaries (filter `status=pending`) |
| POST | /detections/{camera_id}/{track_id}/approve | admin | Snapshot the most recent detection into the `attacks` table; mark the track approved |
| POST | /detections/{camera_id}/{track_id}/reject | admin | Mark the track rejected (no DB write to attacks) |

## Cameras

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /cameras | none | List cameras |
| POST | /cameras | admin | Create |
| PATCH | /cameras/{id} | admin | Update fields |
| DELETE | /cameras/{id} | admin | Delete |

Camera fields: `name, stream_url, latitude, longitude, heading_deg, altitude_m,
fov_h_deg, fov_v_deg, sensor_w_px, assumed_target_distance_m, enabled`.

## Sensitive areas

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /areas | none | List |
| POST | /areas | admin | Create |
| PATCH | /areas/{id} | admin | Update |
| DELETE | /areas/{id} | admin | Delete |

## Analytics

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /analysis/by-region | none | Counts per region |
| GET | /analysis/by-type | none | Counts per attack_type |
| GET | /analysis/timeline | none | Bucketed counts; `granularity=day\|week\|month`, optional `region`, `date_from`, `date_to` |

## Predictions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /predict/risk | none | Probability of ≥1 attack per region in the next H days. Method is `xgboost` if the artifact exists, else `heuristic`. |
| GET | /predict/forecast | none | Prophet daily forecast per region (or all regions if none given) |

## Chatbot

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /chat | none | `{message, history, language}` → answer from local Ollama LLM, with read-only context built from the DB. No tools, no DB writes. |

## WebSocket streams

| Path | Direction | Payload |
|---|---|---|
| /ws/live/{camera_id} | server → client | Alternating binary JPEG and JSON metadata `{type, camera_id, frame_idx, ts, detections[], remote}` |
| /ws/alarms | server → client | JSON alarm events `{camera_id, track_id, drone_class, confidence, lat, lon, nearest_area, eta_s, score, reasons[], ts}` |

## Threat scoring

`backend/app/services/alarms.py` adds points for:

- hostile class (shahed, orlan-10): +40
- confidence ≥ `THREAT_CONF_THRESHOLD`: +25
- speed > 5 m/s: +10
- ETA < `THREAT_ETA_SECONDS` AND a known nearest area: +25

Score ≥ 60 fires an alarm event. Capped at 100.
