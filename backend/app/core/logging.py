"""Logging configuration."""

import logging
import sys

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.app_log_level.upper(), logging.INFO)
    logging.basicConfig(
        stream=sys.stdout,
        level=level,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("uvicorn.access").setLevel(level)
