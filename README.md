# Drone Defense System

Real-time hostile drone detection, tracking, ETA estimation, and attack analytics for sensitive locations in Saudi Arabia. Capstone project for the AI Solutions Development bootcamp.

## What it does

- Detects drones from one or more live cameras using a YOLO model fine-tuned on 6 classes (Shahed, Orlan-10, DJI, airplane, bird, helicopter).
- Tracks each detected drone with ByteTrack and computes its speed, direction, geographic location, distance to the nearest sensitive area, and estimated time of arrival.
- Raises a dashboard alarm when a hostile drone is heading toward a sensitive area.
- Lets an admin accept or reject each detection; accepted detections are written to the historical attack database.
- Forecasts future attack risk per region using XGBoost + Prophet trained on a mix of real and synthetic Saudi attack data.
- Exposes a chatbot (local LLM via Ollama) that can answer questions about both live and historical data.

## Stack

- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2, Alembic, Ultralytics YOLO, ByteTrack, OpenCV, XGBoost, Prophet.
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS, react-leaflet, i18next (Arabic + English with RTL).
- **Database:** PostgreSQL 16 (port 5433).
- **LLM:** Ollama (local) — `qwen2.5:7b` recommended for Arabic.
- **Edge:** Raspberry Pi 4 with up to 3 USB webcams running `scripts/pi_streamer.py` (MJPEG only — all inference on the laptop).

## Repo layout

See `docs/PROJECT_PLAN.md` for the full layout, schema, API surface, and migration plan.

```
capstone/
├── backend/      FastAPI app, SQLAlchemy models, services, workers
├── frontend/     React + Vite dashboard
├── ml/           Training scripts and saved model artifacts
├── data/         Raw, processed, and synthetic datasets
├── models/       YOLO weights (best.pt)
├── scripts/      Pi streamer, dev launchers
├── docs/         Architecture, API, schema, setup
└── README.md
```

## Quick start

See `docs/SETUP.md` for full installation. TL;DR:

```powershell
# 1. Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
copy .env.example .env   # edit DB password and admin token
alembic upgrade head
python -m seed.load_history_csv
python -m seed.generate_synthetic
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
copy .env.example .env
npm run dev

# 3. Ollama (new terminal)
ollama serve
ollama pull qwen2.5:7b
```

Then open `http://localhost:5173`.

## License

Educational use only. Not approved for operational defense deployment.
