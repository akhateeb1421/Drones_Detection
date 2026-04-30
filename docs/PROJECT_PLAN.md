# Drone Defense System — Local Migration Plan

**Project:** Hostile drone detection, tracking, ETA estimation, and attack analytics for sensitive locations in Saudi Arabia.
**Author:** Abdullah (AI Solutions Development Bootcamp capstone).
**Plan generated:** 2026-04-28.

---

## 1. Final architectural decisions

| Concern | Decision |
|---|---|
| Backend | FastAPI (async, WebSockets, auto OpenAPI) |
| Frontend | React + Vite + TypeScript |
| UI language | Bilingual Arabic + English with i18next; RTL when ar |
| Maps | Leaflet + OpenStreetMap via `react-leaflet` |
| Database | PostgreSQL on port 5433 (kept); credentials in `.env` |
| ORM / migrations | SQLAlchemy 2.0 + Alembic |
| Chatbot LLM | Ollama (local), model name in `.env` (`qwen2.5:7b` recommended for Arabic) |
| Detection model | Existing YOLO `best.pt` (6 classes) |
| Tracker | ByteTrack (existing config retained) |
| Inference compute | Laptop CPU (Pi 4 only captures and streams frames) |
| Live frame transport | WebSocket: JPEG bytes + JSON metadata, one channel per camera |
| Pi → Laptop transport | MJPEG over HTTP from each Pi-attached webcam |
| Auth | None for read; shared admin token (`X-Admin-Token` header) for write/approve/reject |
| Deployment | Native dev (`uvicorn` + `npm run dev`) — Docker only as a follow-up |
| Repo layout | Monorepo: `capstone/{backend, frontend, ml, data, docs, scripts}` |
| Predictions | XGBoost (per-region next-30-days) + Prophet (per-region daily forecast) + heuristic baseline |
| Training data | Real CSV (75 rows) + synthetic bootstrap (~3000 rows) tagged `source='synthetic'` |
| Camera config | Lat, lon, heading (azimuth), altitude, FOV — editable in admin UI per camera |
| Sensitive areas | Editable in admin UI; stored in DB |
| Path prediction | Straight-line projection: heading × speed × 60s |
| Approval flow | Snapshot row written to unified `attacks` table on approve |
| Alarm | Red dashboard banner + browser sound; audio asset in frontend |

---

## 2. Folder structure

```
capstone/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                         # FastAPI app + router include + CORS
│   │   ├── core/
│   │   │   ├── config.py                   # Pydantic Settings (.env loader)
│   │   │   ├── security.py                 # admin-token dependency
│   │   │   ├── db.py                       # SQLAlchemy engine + session
│   │   │   └── logging.py
│   │   ├── api/
│   │   │   ├── deps.py
│   │   │   ├── attacks.py                  # GET /attacks (filtered)
│   │   │   ├── detections.py               # GET /detections, POST approve/reject
│   │   │   ├── cameras.py                  # CRUD cameras (admin)
│   │   │   ├── areas.py                    # CRUD sensitive areas (admin)
│   │   │   ├── predictions.py              # GET /predict/risk, /predict/forecast
│   │   │   ├── analysis.py                 # GET /analysis/regions, /analysis/types
│   │   │   ├── chatbot.py                  # POST /chat
│   │   │   └── stream.py                   # WS /ws/live/{camera_id}
│   │   ├── models/                         # SQLAlchemy ORM
│   │   │   ├── attack.py
│   │   │   ├── detection.py
│   │   │   ├── track.py
│   │   │   ├── camera.py
│   │   │   └── sensitive_area.py
│   │   ├── schemas/                        # Pydantic I/O
│   │   ├── services/
│   │   │   ├── inference.py                # YOLO + ByteTrack wrapper
│   │   │   ├── geo.py                      # px → lat/lon w/ camera heading
│   │   │   ├── eta.py                      # ETA + nearest area
│   │   │   ├── path.py                     # straight-line projection
│   │   │   ├── synthetic.py                # synthetic-data generator
│   │   │   ├── forecaster.py               # Prophet wrapper
│   │   │   ├── classifier.py               # XGBoost wrapper
│   │   │   ├── chatbot.py                  # Ollama client + RAG context builder
│   │   │   └── alarms.py
│   │   ├── streaming/
│   │   │   ├── pi_client.py                # pulls MJPEG from each Pi cam URL
│   │   │   └── frame_bus.py                # in-memory pub/sub between workers and WS
│   │   └── workers/
│   │       └── pipeline.py                 # capture → infer → track → broadcast
│   ├── alembic/                            # migrations
│   ├── seed/
│   │   ├── load_history_csv.py             # import existing CSV → DB (source='historical')
│   │   └── generate_synthetic.py           # bootstrap synthetic rows
│   ├── tests/
│   ├── pyproject.toml                      # poetry / pip
│   ├── .env.example
│   └── README.md
├── frontend/
│   ├── public/
│   │   └── alarm.mp3
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── i18n/
│   │   │   ├── index.ts                    # i18next config
│   │   │   ├── ar.json
│   │   │   └── en.json
│   │   ├── pages/
│   │   │   ├── Overview.tsx
│   │   │   ├── LiveDetection.tsx
│   │   │   ├── HistoryMap.tsx
│   │   │   ├── Analysis.tsx
│   │   │   ├── Chatbot.tsx
│   │   │   └── admin/
│   │   │       ├── Cameras.tsx
│   │   │       └── Areas.tsx
│   │   ├── components/
│   │   │   ├── AlarmBanner.tsx
│   │   │   ├── DetectionStream.tsx         # canvas drawing boxes from WS
│   │   │   ├── DroneMap.tsx
│   │   │   ├── PredictedPath.tsx
│   │   │   ├── ApprovalPanel.tsx
│   │   │   ├── LanguageToggle.tsx
│   │   │   └── ThemeProvider.tsx
│   │   ├── hooks/
│   │   │   ├── useLiveStream.ts            # WS hook
│   │   │   └── useAlarms.ts
│   │   ├── services/
│   │   │   ├── api.ts                      # axios client
│   │   │   └── ws.ts                       # WebSocket helper
│   │   └── types/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── .env.example
├── ml/
│   ├── notebooks/                          # exploratory only
│   ├── train_classifier.py                 # XGBoost on attacks
│   ├── train_forecaster.py                 # Prophet per region
│   ├── evaluate.py
│   ├── artifacts/                          # *.joblib, prophet pickles
│   └── shared/
│       └── feature_engineering.py
├── data/
│   ├── raw/
│   │   ├── final_processed_history.csv     # the 75-row real dataset
│   │   └── sdb_log_full.json
│   ├── processed/
│   └── synthetic/
├── scripts/
│   ├── pi_streamer.py                      # runs on the Raspberry Pi
│   ├── start_dev.ps1                       # boots backend + frontend
│   └── reset_db.ps1
├── docs/
│   ├── PROJECT_PLAN.md                     # this document
│   ├── DB_SCHEMA.md
│   ├── API.md
│   └── SETUP.md
├── models/
│   └── best.pt                             # the YOLO weights (moved from capstone root)
├── .gitignore
└── README.md
```

The existing files (`enhanced_drone_defense_complete.py`, `improved_dashboard_v2.py`, `main.py`, the notebooks) stay where they are as **reference material**. Logic from them is migrated into the new structure rather than imported, so we end up with one clean codebase.

---

## 3. Database schema (PostgreSQL)

Five tables. All timestamps `TIMESTAMPTZ`. All geographic coordinates `DECIMAL(10,7)` for lat / `DECIMAL(11,7)` for lon (PostGIS optional, not required for capstone).

### 3.1 `attacks` (the unified table — replaces `attack_history`)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| occurred_at | TIMESTAMPTZ NOT NULL | |
| attack_type | VARCHAR(64) NOT NULL | normalized: 'drone' / 'ballistic_missile' / 'cruise_missile' / 'mixed' |
| target_location | VARCHAR(255) | |
| region | VARCHAR(128) | |
| latitude | DECIMAL(10,7) NOT NULL | |
| longitude | DECIMAL(11,7) NOT NULL | |
| source | VARCHAR(16) NOT NULL | 'historical' \| 'synthetic' \| 'live' |
| drone_class | VARCHAR(32) | from YOLO classes when source='live' |
| confidence | REAL | live only |
| speed_mps | REAL | live only |
| direction | VARCHAR(8) | live only |
| nearest_area | VARCHAR(64) | live only |
| eta_s | REAL | live only |
| approved_by | VARCHAR(64) | who approved (e.g. 'admin') |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### 3.2 `detections` (every YOLO frame for every track — append-only)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| camera_id | INT FK cameras(id) | |
| track_id | INT NOT NULL | clean sequential id (your existing logic) |
| frame_idx | INT | |
| drone_class | VARCHAR(32) | majority-vote class |
| confidence | REAL | |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(11,7) | |
| speed_mps | REAL | |
| direction | VARCHAR(8) | |
| angle_deg | REAL | |
| nearest_area | VARCHAR(64) | |
| dist_m | REAL | |
| eta_s | REAL | NULL when infinite |
| bbox_x1, y1, x2, y2 | INT | |
| captured_at | TIMESTAMPTZ DEFAULT now() | |

Indexed on `(camera_id, track_id, frame_idx)` and on `captured_at`.

### 3.3 `tracks` (one row per tracked object — pending admin decision)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| camera_id | INT FK | |
| track_id | INT | |
| first_seen_at, last_seen_at | TIMESTAMPTZ | |
| voted_class | VARCHAR(32) | |
| max_confidence | REAL | |
| max_speed_mps | REAL | |
| min_eta_s | REAL | |
| nearest_area | VARCHAR(64) | |
| status | VARCHAR(16) | 'pending' \| 'approved' \| 'rejected' |
| reviewed_at | TIMESTAMPTZ | |

Unique on `(camera_id, track_id)`.

### 3.4 `cameras`

| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(64) | e.g. 'CAM-Pi-01' |
| stream_url | VARCHAR(255) | the MJPEG URL exposed by `pi_streamer.py` |
| latitude | DECIMAL(10,7) | mounting position |
| longitude | DECIMAL(11,7) | |
| heading_deg | REAL | 0=N, 90=E, 180=S, 270=W |
| altitude_m | REAL | camera height above ground |
| fov_h_deg | REAL | horizontal FOV |
| fov_v_deg | REAL | vertical FOV |
| sensor_w_px | INT | width of input frames |
| assumed_target_distance_m | REAL | for demo-grade geo projection |
| enabled | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### 3.5 `sensitive_areas`

| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(64) UNIQUE | |
| latitude | DECIMAL(10,7) | |
| longitude | DECIMAL(11,7) | |
| priority | SMALLINT DEFAULT 1 | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

Seeded with the 5 areas you currently hardcode (Area-A through Area-E).

### 3.6 `model_predictions` (cache for ML output)

| column | type | notes |
|---|---|---|
| id | BIGSERIAL PK | |
| generated_at | TIMESTAMPTZ DEFAULT now() | |
| region | VARCHAR(128) | |
| target_location | VARCHAR(255) NULL | |
| horizon_days | SMALLINT | |
| risk_probability | REAL | |
| forecast_count | REAL | from Prophet |
| model_version | VARCHAR(32) | |

---

## 4. FastAPI endpoints

```
GET    /health
# attacks (history view)
GET    /attacks?from=&to=&region=&attack_type=&source=
# detections + approval flow
GET    /detections?status=pending
POST   /detections/{track_id}/approve     [admin token]
POST   /detections/{track_id}/reject      [admin token]
# cameras (admin)
GET    /cameras
POST   /cameras                            [admin token]
PATCH  /cameras/{id}                       [admin token]
DELETE /cameras/{id}                       [admin token]
# sensitive areas (admin)
GET    /areas
POST   /areas                              [admin token]
PATCH  /areas/{id}                         [admin token]
DELETE /areas/{id}                         [admin token]
# analytics
GET    /analysis/by-region
GET    /analysis/by-type
GET    /analysis/timeline?region=
# predictions
GET    /predict/risk?horizon_days=30
GET    /predict/forecast?region=&days=30
# chatbot
POST   /chat                              { message: string, history?: [] }
# live stream
WS     /ws/live/{camera_id}               # JPEG frame + detections JSON
WS     /ws/alarms                         # threat events
```

The frontend hits REST for everything except the live video and alarm channels, which are WebSockets so React can react instantly.

---

## 5. Pixel-to-lat/lon with camera heading

Replacing your current "downward camera" math with one that respects each camera's mounted bearing.

```python
def pixel_to_world(cx, cy, frame_w, frame_h, cam):
    # angular offset of the pixel from the optical axis
    az_offset_deg = ((cx - frame_w/2) / frame_w) * cam.fov_h_deg
    el_offset_deg = ((cy - frame_h/2) / frame_h) * cam.fov_v_deg

    # actual world bearing the pixel points to
    target_bearing_deg = (cam.heading_deg + az_offset_deg) % 360

    # demo-grade range estimate: configurable assumed distance
    # (real systems use stereo, lidar, or known target size — out of scope)
    horizontal_dist_m = cam.assumed_target_distance_m

    bearing_rad = math.radians(target_bearing_deg)
    dN = horizontal_dist_m * math.cos(bearing_rad)
    dE = horizontal_dist_m * math.sin(bearing_rad)

    lat = float(cam.latitude)  + dN / 111320
    lon = float(cam.longitude) + dE / (111320 * math.cos(math.radians(float(cam.latitude))))
    return lat, lon
```

Range is a configurable constant per camera until you ever wire in a depth sensor. This is good enough to draw plausible markers and ETAs on the map for the demo, and the assumption is documented in `docs/SETUP.md` so reviewers see it upfront.

---

## 6. Synthetic data generation

We bootstrap from your 75 real Saudi records and emit ~3000 synthetic ones tagged `source='synthetic'`. The generator preserves the joint distribution of region, attack_type, target_location, and adds realistic temporal noise.

**Algorithm (in `backend/seed/generate_synthetic.py`):**

1. **Normalize** real `attack_type` strings → 4 canonical classes: `drone`, `ballistic_missile`, `cruise_missile`, `mixed`.
2. **Learn distributions:**
   - `P(region)` — multinomial over the 6 regions in real data.
   - `P(attack_type | region)` — conditional multinomial.
   - `P(target_location | region)` — conditional multinomial.
   - `daily_intensity(date)` — fit a simple Poisson with day-of-week and month seasonality from real timestamps.
3. **Sample dates** spanning the same range your real data covers, plus 12 months forward, using the seasonal Poisson process. Inject occasional "burst days" (multiple incidents per day) drawn from real burst statistics — your raw data already shows these (e.g. 2026-03-07).
4. **For each sampled incident:** draw region → attack_type → target_location → take that location's known lat/lon and add Gaussian jitter (σ ≈ 0.05° ≈ 5 km) so geographic spread looks natural.
5. **Tag** every row `source='synthetic'`. Real rows stay `source='historical'`. Live, accepted rows enter as `source='live'`.

**Train/eval policy:** ML models train on `historical + synthetic + live`; **evaluation metrics** are reported on real-only holdout to keep the demo honest. Documented in `ml/evaluate.py`.

---

## 7. Real-time pipeline (Pi → Laptop → React)

1. **Each Pi camera** runs `scripts/pi_streamer.py` which exposes an MJPEG endpoint, e.g. `http://pi.local:8081/cam0`.
2. **Backend `pipeline.py`** spawns one async worker per camera registered in the `cameras` table. Each worker:
   - Pulls frames from the Pi stream.
   - Skips frames if backlog > N (drop-tail) so we never lag behind reality.
   - Runs YOLO + ByteTrack on the latest frame (CPU, target 5–10 fps).
   - Computes per-detection lat/lon (camera-aware), speed, direction, ETA, nearest area.
   - Writes a row to `detections`; upserts the `tracks` summary row.
   - Publishes `(jpeg_bytes, detections_json)` to an in-memory `frame_bus`.
3. **WebSocket `/ws/live/{camera_id}`** subscribes a connected React client to that camera's `frame_bus` topic and streams binary+JSON.
4. **WebSocket `/ws/alarms`** broadcasts a small JSON event whenever a detection crosses a threat threshold (configurable: confidence > 0.6 AND eta_s < 60 AND nearest_area set). React banner + sound react to it.
5. **Approval flow:** the React Live page lists pending tracks (`/detections?status=pending`). Admin clicks Approve → `POST /detections/{track_id}/approve` with the admin token → backend writes a snapshot row to `attacks` and updates the track status. The historical map reflects it on next load.

---

## 8. Migration plan — phased

Each phase has a clear deliverable and is independently testable.

**Phase 0 — Local prerequisites** *(you do once)*
- Install Python 3.11+, Node 20+, PostgreSQL 16, Ollama, ffmpeg.
- `ollama pull qwen2.5:7b` (or your chosen model).

**Phase 1 — Repo skeleton**
- Create the folder structure from §2.
- Move `best.pt` to `models/best.pt`.
- Move existing notebooks into `data/raw/` and `ml/notebooks/` as reference.
- Initialize `backend/pyproject.toml` and `frontend/package.json`.
- Commit the `.env.example` files and a `.gitignore` that excludes `.env`, `models/best.pt`, and `data/synthetic/`.

**Phase 2 — Database**
- Create `history` DB (you already have it). Add the 5 new tables via Alembic migrations.
- Run `seed/load_history_csv.py` to import the 75 rows as `source='historical'`.
- Run `seed/generate_synthetic.py` to add ~3000 `source='synthetic'` rows.
- Seed `cameras` with one mock camera and `sensitive_areas` with Area-A..E.

**Phase 3 — Backend skeleton**
- Wire `core/config.py`, `core/db.py`, `core/security.py` (admin token).
- Stub all REST routes returning fixtures so the frontend can start in parallel.
- Add the `/health` endpoint.

**Phase 4 — Inference pipeline (offline)**
- Port the YOLO + ByteTrack loop from your notebook into `services/inference.py`.
- Replace the hardcoded geo math with the camera-aware version (§5).
- Verify against `data/raw/shahed.mp4` — outputs a `detections` row stream identical in spirit to your existing `sdb_log_full.json`.

**Phase 5 — Live pipeline**
- Implement `streaming/pi_client.py` (MJPEG client) and `workers/pipeline.py`.
- Implement `frame_bus.py` and the WebSocket route.
- Smoke test using `scripts/pi_streamer.py` running locally on the laptop's webcam (the Pi script is the same code with a different binding host).

**Phase 6 — ML pipeline**
- `ml/train_classifier.py`: feature engineering + XGBoost; saves `artifacts/risk_clf.joblib`.
- `ml/train_forecaster.py`: per-region Prophet models; saves `artifacts/prophet_<region>.pkl`.
- Hook them up to `/predict/*` endpoints. Retrain target: nightly cron or a manual `POST /admin/retrain` later.
- Keep the existing heuristic from `enhanced_drone_defense_complete.py` as the fallback returned when no model artifact is available.

**Phase 7 — Chatbot**
- `services/chatbot.py` builds a system prompt from live SDB stats + historical aggregates (mirrors your notebook's `build_system_prompt` but in Arabic+English).
- Calls Ollama at `http://localhost:11434/api/chat` with the configured model.
- Hard rule: the LLM never receives DB-write or alarm-fire tools. Read-only context only.

**Phase 8 — Frontend skeleton**
- Vite + React + TS + Tailwind.
- `i18n/` setup with ar/en JSON; document direction switches via `dir="rtl"` when ar.
- App shell with sidebar: Overview, Live Detection, History Map, Analysis, Chatbot, Admin (Cameras, Areas).

**Phase 9 — Frontend pages**
- *Overview*: stats cards + region pie + type bar (port from your Gradio overview).
- *Live Detection*: `<DetectionStream>` canvas hooked to `/ws/live/{camera_id}` + map with predicted-path line + approve/reject panel.
- *History Map*: Leaflet with date-range, region, attack-type filters; calls `/attacks`.
- *Analysis*: timeline, by-region, by-type, plus risk and forecast views from `/predict/*`.
- *Chatbot*: message thread + send box; calls `/chat`.
- *Admin/Cameras* and *Admin/Areas*: tables + modal forms; admin token entered once and stored in `localStorage`.

**Phase 10 — Alarms**
- Backend evaluator emits to `/ws/alarms` when thresholds cross.
- Frontend `<AlarmBanner>` + `useAlarms` hook plays `public/alarm.mp3` and shows red banner.

**Phase 11 — Polish**
- Loading states, error toasts, empty states.
- Browser-tab favicon flip when alarm active.
- Print-friendly historical map.

**Phase 12 — Documentation**
- `docs/SETUP.md` with step-by-step run-it-on-a-fresh-laptop instructions.
- `docs/API.md` (FastAPI auto-generates this; we link it).
- `docs/DB_SCHEMA.md`.

**Phase 13 — Demo prep**
- Pi 4 image with `pi_streamer.py` autostart.
- Smoke checklist (cameras up, DB seeded, alarm fires on `shahed.mp4`).
- Backup mode: if Pi network drops, demo runs against `data/raw/shahed.mp4` automatically.

---

## 9. Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CPU YOLO too slow with 3 cameras | Fps drops below 2 | Frame-skip + drop-tail queue; show "processing every Nth frame" badge; consider yolo-nano variant |
| Pi 4 network bandwidth limited | Frames stutter | MJPEG with reduced resolution (640x480), JPEG quality 70 |
| Synthetic data leaks into eval | Inflated metrics | All eval scripts hard-filter `source='historical'` |
| Demo-grade geo math gives wrong locations on map | Reviewer asks why | Configurable per-camera `assumed_target_distance_m`, documented limitation in SETUP.md |
| Ollama model weak in Arabic | Chatbot sounds dumb | Default to `qwen2.5:7b`; allow swap; document trade-off |
| Anyone on LAN can hit admin endpoints | DB pollution | Admin token gate; rotated per demo; never committed |
| Lat/lon stored as floats in legacy CSV | Precision loss when re-imported | Stored as DECIMAL in DB; loader uses string parse |
| `Infinity` ETA crashes JSON parsers | Frontend errors | Backend converts `inf` → `null` before serialization |

---

## 10. Decisions still open (cheap to decide later)

- **Retraining trigger:** nightly cron vs. manual button. Defaulting to manual for the capstone.
- **Chat history persistence:** in-memory per session, or stored in DB? Defaulting to in-memory.
- **Alarm sound asset:** I'll use a free CC0 mp3; swap if you have a preferred file.
- **Theme:** dark UI matching your current Gradio look; light theme later.
- **Tests:** smoke + a handful of unit tests for `services/geo.py` and `services/eta.py`. No full coverage — capstone scope.

---

## 11. Next step

Reply **`execute`** and I'll start materializing the project:

1. Create folder skeleton + config files
2. Write the SQLAlchemy models + Alembic initial migration
3. Write the historical loader + synthetic generator
4. Stand up the FastAPI app with stubbed routes
5. Port the YOLO/ByteTrack pipeline into `services/inference.py`
6. Bring up the React skeleton with i18n + sidebar
7. Continue from there phase by phase

Or push back on any of the choices above first.
