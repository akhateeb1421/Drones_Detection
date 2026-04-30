"""WebSocket endpoints for live frame streaming and alarm broadcasts."""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.streaming.frame_bus import frame_bus

log = logging.getLogger(__name__)
router = APIRouter(tags=["stream"])


@router.websocket("/ws/live/{camera_id}")
async def ws_live(websocket: WebSocket, camera_id: int) -> None:
    """Streams JPEG bytes followed by a JSON metadata frame for each YOLO step."""
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=4)
    frame_bus.subscribe(f"cam:{camera_id}", queue)
    try:
        while True:
            payload = await queue.get()
            jpeg = payload["jpeg"]
            meta = payload["meta"]
            await websocket.send_bytes(jpeg)
            await websocket.send_json(meta)
    except WebSocketDisconnect:
        log.info("Live WS disconnected for cam %s", camera_id)
    except Exception:  # noqa: BLE001
        log.exception("Live WS crashed for cam %s", camera_id)
    finally:
        frame_bus.unsubscribe(f"cam:{camera_id}", queue)


@router.websocket("/ws/alarms")
async def ws_alarms(websocket: WebSocket) -> None:
    """Broadcasts threat events to all connected clients."""
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=32)
    frame_bus.subscribe("alarms", queue)
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        log.info("Alarms WS disconnected")
    except Exception:  # noqa: BLE001
        log.exception("Alarms WS crashed")
    finally:
        frame_bus.unsubscribe("alarms", queue)
