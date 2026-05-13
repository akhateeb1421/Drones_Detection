"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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
    admin_token: str = "replace_me"

    # YOLO + tracker
    yolo_weights: str = "../models/best.pt"
    yolo_imgsz: int = 640
    yolo_conf: float = 0.50
    # Looser threshold reserved for hostile classes (DJI / Shahed /
    # Orlan / generic drone). YOLO is asked to emit detections down to
    # this floor so a marginal-conf DJI still reaches the tracker; the
    # inference loop then re-applies `yolo_conf` to NON-hostile classes
    # (bird/airplane/helicopter) to keep their noise down. Net effect:
    # any DJI sighting lands in the pending-approvals queue immediately,
    # regardless of whether the threat-score gate fires an alarm.
    yolo_conf_hostile: float = 0.15
    yolo_iou: float = 0.45
    tracker_cfg: str = "../scripts/bytetrack_drone.yaml"

    # Pipeline
    inference_frame_skip: int = 2
    inference_queue_max: int = 2
    # Confidence floor used by alarms.evaluate to award the
    # `high_confidence` bonus. Lower than the frontend's display
    # threshold so backend alarms don't lag the on-screen CRITICAL
    # badge for moderate-confidence sightings.
    threat_conf_threshold: float = 0.45
    threat_eta_seconds: float = 60.0

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

    @property
    def yolo_weights_path(self) -> Path:
        return Path(self.yolo_weights).resolve()

    @property
    def tracker_cfg_path(self) -> Path:
        return Path(self.tracker_cfg).resolve()

    @property
    def fallback_video_path(self) -> Path:
        return Path(self.fallback_video).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
