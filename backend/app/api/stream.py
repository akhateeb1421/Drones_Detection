"""WebSocket endpoints for live frame streaming and alarm broadcasts.

Both sockets require authentication: the client appends ``?token=<session
token>`` (the same token the REST API uses as a Bearer). The legacy admin
token value is also accepted for backwards compatibility. An invalid or
missing token closes the socket with code 4401 immediately after the
handshake — raw camera frames and alarm events are operational data and
must not be readable by anyone who can reach the port.
"""

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import resolve_ws_user
from app.streaming.frame_bus import frame_bus

log = logging.getLogger(__name__)
router = APIRouter(tags=["stream"])

WS_UNAUTHENTICATED = 4401  # app-level "unauthenticated" close code


async def _authenticate_ws(websocket: WebSocket, token: str | None) -> bool:
    """Accept then immediately close unauthenticated sockets.

    (Closing before accept() sends a 403 handshake response with no
    close code, which browsers report opaquely — accepting first lets
    the client see the 4401 and show a proper 'sign in' message.)
    """
    await websocket.accept()
    if resolve_ws_user(token) is None:
        await websocket.close(code=WS_UNAUTHENTICATED, reason="Authentication required.")
        return False
    return True


@router.websocket("/ws/live/{camera_id}")
async def ws_live(
    websocket: WebSocket,
    camera_id: int,
    token: str | None = Query(default=None),
) -> None:
    """Streams JPEG bytes followed by a JSON metadata frame for each YOLO step."""
    if not await _authenticate_ws(websocket, token):
        return
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
async def ws_alarms(
    websocket: WebSocket,
    token: str | None = Query(default=None),
) -> None:
    """Broadcasts threat events to all connected (authenticated) clients."""
    if not await _authenticate_ws(websocket, token):
        return
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
