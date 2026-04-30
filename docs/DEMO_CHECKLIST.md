# Demo Day Checklist

Run through this 30 minutes before the demo to catch anything broken.

## Hardware

- [ ] Laptop charged + plugged in (CPU YOLO is power-hungry).
- [ ] Pi 4 booted, on the same Wi-Fi network as the laptop.
- [ ] Three USB cameras plugged into the Pi.
- [ ] You can `ping pi.local` (or whatever hostname/IP you use) from the laptop.
- [ ] Speakers / headphones connected and audio is unmuted (alarm sound).

## Pi services

On the Pi, three streams running (one per camera):

```bash
python3 scripts/pi_streamer.py --port 8081 --device 0 &
python3 scripts/pi_streamer.py --port 8082 --device 1 &
python3 scripts/pi_streamer.py --port 8083 --device 2 &
```

Open each in a browser to confirm the feed is alive:

- http://pi-host:8081/stream
- http://pi-host:8082/stream
- http://pi-host:8083/stream

## Laptop services

```powershell
# 1. PostgreSQL is running on 5433
# 2. Ollama
ollama serve
# (Confirm the model is loaded:)
ollama run qwen2.5:7b "Say hi"

# 3. Backend
cd capstone\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --port 8000

# 4. Frontend
cd capstone\frontend
npm run dev
```

## Smoke tests

- [ ] `http://localhost:8000/health` returns `{"status":"ok"}`.
- [ ] `http://localhost:8000/docs` opens Swagger UI.
- [ ] `http://localhost:5173` opens the dashboard.
- [ ] Overview page shows the historical bar/pie charts populated.
- [ ] History Map filters by date and region; markers appear in Saudi Arabia.
- [ ] Live page shows a stream from at least one camera and bounding boxes overlay correctly.
- [ ] An obvious hostile drone (run `data/raw/shahed.mp4` as a fallback camera) fires the red banner and an audio alert.
- [ ] Approve / Reject buttons work — approved track appears in `/attacks?source=live`.
- [ ] Chatbot answers a question in Arabic and in English (after toggling language).

## Fallback if the Pi network drops

Add a Camera in the admin page with `stream_url` pointing at the local file:

```
..\data\raw\shahed.mp4
```

The backend's `pi_client.read_local_video_as_mjpeg` will loop the video forever
so the live page still has a working stream during the demo.

## Cleanup before showing screen

- [ ] Close unrelated browser tabs (passwords / personal email).
- [ ] Set system zoom to 110% so the dashboard reads from the back of the room.
- [ ] Pre-load the chatbot with one demo question so the first answer isn't slow.
