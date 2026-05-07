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
    yolo_iou: float = 0.45
    tracker_cfg: str = "../scripts/bytetrack_drone.yaml"

    # Pipeline
    inference_frame_skip: int = 2
    inference_queue_max: int = 2
    threat_conf_threshold: float = 0.6
    threat_eta_seconds: float = 60.0

    # Ollama
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    # Read-timeout (seconds) for Ollama replies. Bigger models take longer,
    # and the very first call after a model switch must wait for Ollama to
    # load the weights into memory — that alone can be 30-120s on CPU.
    ollama_timeout_s: float = 600.0
    # How long Ollama keeps the model resident after a request. "30m" matches
    # Ollama's default; raise to e.g. "12h" to avoid cold reloads.
    ollama_keep_alive: str = "30m"

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
