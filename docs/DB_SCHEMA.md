# Database Schema

PostgreSQL 16 on port 5433. Six tables, managed by Alembic
(`backend/alembic/versions/0001_initial.py`).

## attacks (unified history + live)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| occurred_at | TIMESTAMPTZ | indexed |
| attack_type | VARCHAR(64) | normalized: `drone`, `ballistic_missile`, `cruise_missile`, `mixed` |
| target_location | VARCHAR(255) | nullable |
| region | VARCHAR(128) | indexed, nullable |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(11,7) | |
| source | VARCHAR(16) | `historical`, `synthetic`, `live`; indexed |
| drone_class | VARCHAR(32) | live only |
| confidence | REAL | live only |
| speed_mps | REAL | live only |
| direction | VARCHAR(8) | live only |
| nearest_area | VARCHAR(64) | live only |
| eta_s | REAL | live only |
| approved_by | VARCHAR(64) | who approved (e.g. 'admin') |
| created_at | TIMESTAMPTZ | default now() |

## detections (per-frame, append-only)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| camera_id | INT FK cameras(id) | |
| track_id | INT | clean sequential per pipeline |
| frame_idx | INT | |
| drone_class | VARCHAR(32) | majority-vote |
| confidence | REAL | |
| latitude | DECIMAL(10,7) | nullable |
| longitude | DECIMAL(11,7) | nullable |
| speed_mps | REAL | |
| direction | VARCHAR(8) | |
| angle_deg | REAL | |
| nearest_area | VARCHAR(64) | |
| dist_m | REAL | |
| eta_s | REAL | NULL when infinite |
| bbox_x1, y1, x2, y2 | INT | |
| captured_at | TIMESTAMPTZ | indexed |

Composite index `(camera_id, track_id, frame_idx)`.

## tracks (one row per (camera_id, track_id))

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| camera_id | INT FK cameras(id) | |
| track_id | INT | |
| first_seen_at, last_seen_at | TIMESTAMPTZ | |
| voted_class | VARCHAR(32) | |
| max_confidence, max_speed_mps, min_eta_s | REAL | |
| nearest_area | VARCHAR(64) | |
| last_lat, last_lon | REAL | |
| status | VARCHAR(16) | `pending`, `approved`, `rejected`; indexed |
| reviewed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

Unique on `(camera_id, track_id)`.

## cameras

| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(64) UNIQUE | e.g. `CAM-Pi-01` |
| stream_url | VARCHAR(255) | MJPEG endpoint or local path |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(11,7) | |
| heading_deg | REAL | 0=N, 90=E, ... |
| altitude_m | REAL | |
| fov_h_deg | REAL | |
| fov_v_deg | REAL | |
| sensor_w_px | INT | |
| assumed_target_distance_m | REAL | demo-grade range estimate |
| enabled | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

## sensitive_areas

| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(64) UNIQUE | |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(11,7) | |
| priority | SMALLINT | default 1 |
| created_at | TIMESTAMPTZ | |

## model_predictions (cached ML output)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| generated_at | TIMESTAMPTZ | indexed |
| region | VARCHAR(128) | indexed |
| target_location | VARCHAR(255) | nullable |
| horizon_days | SMALLINT | |
| risk_probability | REAL | from XGBoost |
| forecast_count | REAL | from Prophet |
| model_version | VARCHAR(32) | |
