"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, located relative to THIS FILE (backend/app/core/config.py
# -> parents[2] == backend/). The env_file used to be the relative string
# ".env", which resolves against the CURRENT WORKING DIRECTORY — so
# launching uvicorn from the repo root instead of backend/ silently loaded
# nothing and every DB/auth setting fell back to its default ("password
# authentication failed for user postgres"). Listing the absolute backend
# path FIRST and the CWD ".env" second keeps both launch styles working
# (later files win, so a CWD .env can still override for local tweaks).
_BACKEND_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_BACKEND_ENV), ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # PostgreSQL
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "history"
    db_user: str = "postgres"
    db_password: str = "change_me"

    # FastAPI
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Auth
    # Legacy shared admin token. Still accepted (X-Admin-Token header) so
    # existing tooling keeps working, but the primary auth is now
    # username/password accounts + signed session tokens (see /auth/login).
    admin_token: str = "replace_me"
    # Secret used to sign session tokens. If left empty, a secret is
    # derived from admin_token — set AUTH_SECRET explicitly in production.
    auth_secret: str = ""
    # Session token lifetime in hours.
    auth_token_ttl_hours: float = 12.0
    # Bootstrap accounts, created on first startup when the users table is
    # empty. Change these in .env before first run; passwords can also be
    # changed later directly in the DB (pbkdf2 hashes via app.core.security).
    admin_username: str = "admin"
    admin_password: str = ""      # empty -> falls back to admin_token value
    operator_username: str = "operator"
    operator_password: str = ""   # empty -> "operator" (with a loud warning)

    # YOLO + tracker
    # `yolo_weights` is the LEGACY single-file fallback — used when neither
    # of the per-source files below exists, and as the default for any code
    # path that asks for "the model" without specifying live-vs-video.
    yolo_weights: str = "../models/best.pt"
    # Two specialised models, one tuned for each capture mode. We split
    # them because the same scene can detect very differently between a
    # webcam feed (phone screen, indoor lighting, motion blur) and a
    # pre-recorded outdoor clip (sky background, atmospheric haze, sharper
    # focus). The pipeline picks one of these based on the camera's
    # stream_url scheme — webcam: / http: -> _live, anything else (file)
    # -> _video. If the requested file is missing the loader falls back
    # to `yolo_weights` with a warning so the system stays usable when
    # the operator only ships one of the two.
    yolo_weights_live: str = "../models/best_live.pt"
    yolo_weights_video: str = "../models/best_video.pt"
    # YOLO input resolution. 640 is the model\'s training resolution
    # and gives the best small-object recall (distant drones occupy
    # only 20-40 px of the frame, and a 416-px downscale loses too
    # much detail to detect them at all). 416 was a speed compromise
    # but caused "no detection" reports on tighter / smaller-target
    # recorded clips; the decoupled display/inference loop in
    # pipeline.py means display fps no longer depends on inference
    # speed, so paying ~2x inference cost for full recall is worth it.
    yolo_imgsz: int = 640
    # Per-source resolution overrides. Live cameras (webcam, HTTP MJPEG)
    # run at a low resolution to keep detection latency well under a
    # second on CPU — fine because the live demo shows the drone large
    # and close.
    #
    # The recorded clip pre-computes detections once (cached per
    # location), so it CAN run at a higher resolution than live without
    # affecting playback smoothness. Higher resolution improves recall on
    # a small drone entering at the horizon (best_video.pt was fine-tuned
    # at 1280, so 640 under-resolves the entering target and misses it
    # until it's larger mid-frame).
    #
    # BUT on a CPU-only machine, 1280 pre-compute pegs the cores (and RAM)
    # for minutes and can lock the box up — so the default stays at the
    # tractable 640. If the machine has headroom and you want the entering
    # drone caught earlier, raise YOLO_IMGSZ_VIDEO toward 832 or 960 in
    # .env (recall improves, pre-compute gets proportionally slower).
    # Avoid 1280 unless you have a GPU or a strong many-core CPU.
    # If either is set to 0 we fall back to ``yolo_imgsz``.
    yolo_imgsz_live: int = 416
    yolo_imgsz_video: int = 1280
    yolo_conf: float = 0.50
    # Looser threshold reserved for hostile classes (DJI / Shahed /
    # Orlan / generic drone). YOLO is asked to emit detections down to
    # this floor so a marginal-conf DJI still reaches the tracker; the
    # inference loop then re-applies `yolo_conf` to NON-hostile classes
    # (bird/airplane/helicopter) to keep their noise down. Net effect:
    # any DJI sighting lands in the pending-approvals queue immediately,
    # regardless of whether the threat-score gate fires an alarm.
    yolo_conf_hostile: float = 0.15
    # Recorded-clip-only hostile confidence floor. The bundled demo drone
    # is a small distant speck for most of its short on-screen window, so
    # the model often sees it below the live 0.15 gate. The recorded clip
    # plays clean sky footage where false positives are unlikely, so we can
    # afford a lower floor here to surface those faint small-drone frames
    # — without making the LIVE camera trigger-happy. Lower toward 0.05 if
    # the demo drone is still missed; raise it if you see spurious boxes.
    yolo_conf_video: float = 0.01
    yolo_iou: float = 0.45
    tracker_cfg: str = "../scripts/bytetrack_drone.yaml"
    # Recorded-clip-only tracker config. The demo drone enters as a tiny
    # distant speck whose confidence sits below the live tracker's 0.35
    # new-track gate, so ByteTrack never opens a track for it (no track id
    # -> no box, no persisted row, empty pending-approvals). This config
    # uses much lower thresholds so faint detections can start tracks.
    # Live cameras keep the strict default above.
    tracker_cfg_video: str = "../scripts/bytetrack_drone_recorded.yaml"

    # Distance (metres) the RECORDED-CLIP camera assumes its target is at,
    # used purely for the demo's pixel→world speed/position scaling.
    #
    # The recorded clip copies its geometry from whatever live camera the
    # operator picks as its "location", and those long-range surveillance
    # cameras assume targets several kilometres out. Speed scales linearly
    # with that distance, so a drone in the bundled demo footage (which was
    # shot close up) ended up reading hundreds of km/h. Decoupling the clip's
    # assumed distance with this dedicated value gives a realistic readout
    # regardless of which location is selected.
    #
    # Tuning: displayed speed scales LINEARLY with this number. If the demo
    # drone reads too fast, lower it; too slow, raise it. ~350 m makes a
    # target that crosses ~40 % of the frame in the 5 s clip read ~180 km/h.
    recorded_clip_distance_m: float = 60.0

    # Spurious-track filter for the recorded clip. The clip runs an
    # ultra-low confidence floor (yolo_conf_video, default 0.01) so the
    # tiny distant demo drone is caught — but that floor also lets faint
    # noise blobs open short-lived tracks (the "dji that isn't in the
    # clip"). A real drone crossing the clip is detected across many
    # frames and reaches a modest peak confidence at least once; a track
    # that achieves NEITHER is discarded after the full-clip analysis.
    recorded_clip_min_track_frames: int = 5
    recorded_clip_min_track_conf: float = 0.12

    # Dashboard playback speed multiplier for the recorded clip. This ONLY
    # affects how fast the cached clip is replayed to the dashboard — the
    # one-time detection pre-compute always runs at the clip's native fps,
    # so the displayed km/h speed and predicted path stay true to the real
    # drone regardless of this value. 1.0 = real time, 1.5 = 50% faster.
    recorded_clip_playback_speed: float = 2.0

    # Pipeline
    # Drop every Nth source frame at the very start of the loop. Keep
    # this at 1 — display fps no longer depends on inference fps thanks
    # to the decoupled-overlay path in pipeline.py. Raising it just
    # throws away frames the WebSocket could have shipped.
    inference_frame_skip: int = 1
    # Run YOLO + tracker once every N decoded frames. Frames between
    # YOLO runs are still published to the WebSocket but reuse the
    # last set of detection boxes as their overlay — so display fps
    # ~= source fps and inference fps ~= source_fps / N. N=2 keeps
    # box drift to one source-frame interval (~40 ms at 25 fps).
    inference_every_n_frames: int = 2
    inference_queue_max: int = 2
    # Confidence floor used by alarms.evaluate to award the
    # `high_confidence` bonus. Lower than the frontend's display
    # threshold so backend alarms don't lag the on-screen CRITICAL
    # badge for moderate-confidence sightings.
    threat_conf_threshold: float = 0.45
    threat_eta_seconds: float = 60.0
    # Minimum seconds between alarm events for the SAME track. Applies to
    # the live loop and the recorded-clip replay alike, so the audible
    # alarm fires once per new threat instead of once per YOLO pass.
    alarm_throttle_s: float = 3.0

    # Cross-camera triangulation. When a track is linked across two
    # cameras and both saw the drone within this window, the two bearing
    # rays are intersected to compute a REAL position (instead of the
    # per-camera assumed-distance estimate). max_range bounds how far from
    # either camera an intersection may land before we call it spurious.
    triangulation_window_s: float = 3.0
    triangulation_max_range_m: float = 20000.0

    # --- LLM backend selection ----------------------------------------
    # "ollama" -> hit a local Ollama server (the original setup).
    # "local"  -> load a HuggingFace base model + PEFT LoRA in-process.
    #             Slower per token but self-contained (no Ollama needed).
    # The chatbot service branches on this at request time.
    llm_backend: str = "local"

    # --- Ollama (used when llm_backend == "ollama") -------------------
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    ollama_timeout_s: float = 600.0
    ollama_keep_alive: str = "30m"

    # --- Google Gemini API (used when chat backend == "api") ----------
    # gemini-2.0-flash on Google AI Studio — free tier, no credit card.
    # The key is read from GOOGLE_API_KEY in .env. If unset, the API
    # path surfaces a clear error rather than 500.
    google_api_key: str = ""
    # gemini-2.5-flash is the current default flash model on AI Studio.
    # The 1.5 family was deprecated on v1beta at the end of 2025, and
    # 2.0-flash sometimes ships with limit:0 on older projects, so 2.5
    # is the most reliable free-tier choice in 2026.
    gemini_model: str = "gemini-2.5-flash"
    gemini_max_tokens: int = 1024

    # --- Local LLM (used when llm_backend == "local") -----------------
    # Base model — Ultralytics-style auto-download from HuggingFace on
    # first run. The downloaded weights are cached under
    # ~/.cache/huggingface/.
    llm_base_model: str = "Qwen/Qwen2.5-3B"
    # Path to the PEFT LoRA adapter folder (must contain
    # adapter_config.json + adapter_model.safetensors). Resolves relative
    # to backend/ if not absolute.
    llm_lora_path: str = "../models/llm/drone_qa_qwen_lora_saved"
    # Generation params. Lower temperature for ops-style answers.
    llm_max_new_tokens: int = 512
    llm_temperature: float = 0.3
    llm_top_p: float = 0.9

    # Demo fallback
    fallback_video: str = "../data/raw/shahed.mp4"

    # Where to store per-track thumbnail JPEGs.
    thumbnail_dir: str = "../data/thumbnails"

    @property
    def database_url(self) -> str:
        # URL-encode user + password so passwords containing reserved characters
        # (@, :, /, ?, #, etc.) don't break the connection URL.
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password)
        return (
            f"postgresql+psycopg2://{user}:{password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @staticmethod
    def resolve_path(p: str | Path) -> Path:
        """Resolve a possibly-relative config path against backend/.

        Relative paths in .env (../models/best.pt, ../data/..., etc.) were
        historically resolved against the process CWD, which only worked
        when uvicorn was launched from backend/. Anchoring them to this
        package's location makes every launch directory equivalent.
        """
        path = Path(p)
        if path.is_absolute():
            return path
        return (_BACKEND_ENV.parent / path).resolve()

    @property
    def yolo_weights_path(self) -> Path:
        return self.resolve_path(self.yolo_weights)

    @property
    def tracker_cfg_path(self) -> Path:
        return self.resolve_path(self.tracker_cfg)

    @property
    def fallback_video_path(self) -> Path:
        return self.resolve_path(self.fallback_video)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
