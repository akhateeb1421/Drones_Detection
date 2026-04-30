"""MJPEG client — pulls JPEG frames from a camera URL one at a time.

The Pi exposes each USB webcam as a separate MJPEG stream (see
`scripts/pi_streamer.py`). We don't depend on cv2.VideoCapture for HTTP MJPEG
because its support varies wildly between platforms; we parse the multipart
stream ourselves so the loop is fully under our control.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import httpx

log = logging.getLogger(__name__)

_MJPEG_BOUNDARY = b"--frame"  # default boundary used in pi_streamer.py


async def stream_jpegs(url: str, timeout_s: float = 30.0) -> AsyncIterator[bytes]:
    """Yield successive JPEG byte blobs from a server-pushed MJPEG endpoint."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, read=None)) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            buf = b""
            async for chunk in resp.aiter_bytes():
                buf += chunk
                while True:
                    # Find the JPEG SOI/EOI markers.
                    soi = buf.find(b"\xff\xd8")
                    if soi < 0:
                        break
                    eoi = buf.find(b"\xff\xd9", soi)
                    if eoi < 0:
                        break
                    jpeg = buf[soi : eoi + 2]
                    buf = buf[eoi + 2 :]
                    yield jpeg


async def read_local_video_as_mjpeg(path: str) -> AsyncIterator[bytes]:
    """Fallback for demos: yields JPEGs from a local file using OpenCV."""
    import asyncio

    import cv2  # type: ignore[import-untyped]

    cap = cv2.VideoCapture(path)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                # loop the video for demo continuity
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if not ok:
                continue
            yield bytes(buf)
            await asyncio.sleep(1 / 25.0)  # roughly 25 fps source
    finally:
        cap.release()
