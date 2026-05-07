"""FastAPI entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, analysis, areas, attacks, cameras, chatbot, detections, predictions, stream
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.workers.pipeline import shutdown_pipeline, startup_pipeline


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    await startup_pipeline()
    yield
    await shutdown_pipeline()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Drone Defense System",
        version="0.1.0",
        description="Real-time hostile drone detection, tracking, and analytics.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": app.version}

    app.include_router(attacks.router)
    app.include_router(detections.router)
    app.include_router(cameras.router)
    app.include_router(areas.router)
    app.include_router(analysis.router)
    app.include_router(predictions.router)
    app.include_router(chatbot.router)
    app.include_router(stream.router)
    app.include_router(admin.router)

    return app


app = create_app()
