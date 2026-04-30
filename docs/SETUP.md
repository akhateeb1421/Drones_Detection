# Setup Guide

Step-by-step instructions to run the full system on a fresh Windows laptop.

## 0. Prerequisites

Install once:

- **Python 3.11, 3.12, or 3.13.** Prophet wheels sometimes lag a major Python release; if you're on 3.13 install `prophet` as an optional extra (see below) — it's not required for the rest of the system.
- **Node.js 20+** — install from https://nodejs.org/ (LTS). Confirm with `node -v` and `npm -v`.
- **PostgreSQL 16** — listening on port **5433** (matches your existing DB)
- **Ollama** — https://ollama.com/download
- **ffmpeg** (optional, for re-encoding videos)
- A working webcam (for laptop-only demo) or a Raspberry Pi 4 with USB cameras

Then pull a chatbot model:

```powershell
ollama pull qwen2.5:7b
# or, if you prefer Llama and accept weaker Arabic:
# ollama pull llama3.1:8b
```

## 1. Database setup

In `psql` (one-time):

```sql
CREATE DATABASE history;
-- the user 'postgres' is assumed; if you use a different user, update .env.
```

## 2. Backend

```powershell
cd capstone\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e .
# optional: include Prophet for the time-series forecaster
# (skip if it fails to install — heuristic fallback still works)
pip install -e ".[forecast]"

# config
copy .env.example .env
# Open .env in a text editor and set:
#   DB_PASSWORD=<your real postgres password>
#   ADMIN_TOKEN=<long random string>
#   OLLAMA_MODEL=<the model you pulled>

# create tables
alembic upgrade head

# seed historical + synthetic data
python -m seed.load_history_csv
python -m seed.generate_synthetic --n 3000

# train ML (optional — heuristic fallback works without these)
python ..\ml\train_classifier.py
python ..\ml\train_forecaster.py
python ..\ml\evaluate.py     # honest real-only metrics

# run the API
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs to see the auto-generated Swagger UI.

## 3. Frontend

In a separate terminal:

```powershell
cd capstone\frontend
copy .env.example .env
npm install
npm run dev
```

Open http://localhost:5173.

## 4. Admin token

The first time you visit `/admin/cameras`, paste your `ADMIN_TOKEN` into the
field at the top and click Save. It's stored in `localStorage` and sent as
`X-Admin-Token` on every write request. Anyone without the token can still
view all the dashboards (read-only).

## 5. Adding cameras

Two options:

**A. Demo mode (no Pi yet)** — point a Camera at a local video file:

- Stream URL: `..\data\raw\shahed.mp4` (relative to the backend cwd)
- Lat / Lon / Heading: anything sensible. The pipeline will loop the video
  forever so you always have something on screen.

**B. Real mode (Pi 4 + webcams)** — on the Pi run:

```bash
python3 scripts/pi_streamer.py --port 8081 --device 0
python3 scripts/pi_streamer.py --port 8082 --device 1
python3 scripts/pi_streamer.py --port 8083 --device 2
```

Then in the dashboard add three cameras with stream URLs:

- `http://<pi-host>:8081/stream`
- `http://<pi-host>:8082/stream`
- `http://<pi-host>:8083/stream`

Set the per-camera `latitude`, `longitude`, `heading_deg` (azimuth: 0=north,
clockwise) at demo time. The backend's pixel-to-world projection respects this
heading. The `assumed_target_distance_m` is the demo-grade range estimate
(default 500 m); tweak per camera if you know your layout better.

## 6. Sensitive areas

`/admin/areas` lets you add/remove sensitive locations. The seeders pre-load
five (Area-A through Area-E) matching your original notebook constants.

## 7. Live alarms

Live banner + sound fire when a detection has:

- confidence ≥ `THREAT_CONF_THRESHOLD` (default 0.6) AND
- ETA < `THREAT_ETA_SECONDS` (default 60) AND
- a known nearest sensitive area

Drop a CC0 mp3 at `frontend/public/alarm.mp3` for audio. Browsers block
autoplay until the user clicks once on the page.

## 8. Notes / known limitations

- **Pixel-to-lat/lon is demo-grade.** It uses the camera's heading and a fixed
  configured target distance. Real geolocation needs depth from stereo, lidar,
  or known target size — out of scope for the capstone.
- **CPU YOLO with 3 cameras** is the bottleneck. The pipeline skips frames
  (`INFERENCE_FRAME_SKIP`, default 2) and drop-tail-queues new frames. Expect
  ~5 fps per camera on a modern laptop CPU.
- **Synthetic rows** improve ML training. Real-only evaluation (`evaluate.py`)
  reports metrics on the 75 real Saudi records only.
- **No login** by design — admin endpoints are gated by the shared token only.
  Don't expose this beyond your closed demo network.
