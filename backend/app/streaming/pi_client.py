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
    import logging

    import cv2  # type: ignore[import-untyped]

    log = logging.getLogger(__name__)
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        # Don't enter a busy-loop; fail loudly so the worker stops cleanly.
        cap.release()
        raise RuntimeError(
            f"Could not open video source '{path}'. "
            "Check that the file exists, or use 'webcam:N' for a webcam, or 'http(s)://' for an MJPEG stream."
        )
    # Honour the video\'s native FPS instead of the previous 25-fps
    # hardcode. cv2 returns 0 if the codec didn\'t encode it; clamp to a
    # sensible 5–60 fps range so a corrupt header can\'t pin the CPU
    # or run a 200-fps slideshow.
    fps_native = cap.get(cv2.CAP_PROP_FPS) or 0.0
    fps_play = max(5.0, min(fps_native or 30.0, 60.0))
    frame_dt = 1.0 / fps_play
    log.info(
        "Local video %s: native fps=%.2f, playback fps=%.2f",
        path, fps_native, fps_play,
    )
    try:
        consecutive_failures = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                consecutive_failures += 1
                if consecutive_failures > 50:
                    raise RuntimeError(f"Video source '{path}' returned no frames for too long.")
                # Try looping (works for files); always yield to the event loop
                # so we don't pin a CPU on a broken source.
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                await asyncio.sleep(0.1)
                continue
            consecutive_failures = 0
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if not ok:
                continue
            yield bytes(buf)
            await asyncio.sleep(frame_dt)
    finally:
        cap.release()


async def read_webcam_as_mjpeg(
    device_index: int,
    width: int = 640,
    height: int = 480,
    target_fps: int = 25,
    jpeg_quality: int = 75,
) -> AsyncIterator[bytes]:
    """Yield JPEGs from a directly-attached webcam (laptop or USB camera).

    Use this when the camera lives on the same machine as the backend, so we
    skip the MJPEG-over-HTTP step entirely.
    """
    import asyncio
    import logging

    import cv2  # type: ignore[import-untyped]

    log = logging.getLogger(__name__)

    # Try a few backends in order. CAP_DSHOW is fastest on Windows but isn't
    # always available; CAP_MSMF is more reliable; CAP_ANY is the last resort.
    backends = [
        ("CAP_DSHOW", cv2.CAP_DSHOW),
        ("CAP_MSMF", cv2.CAP_MSMF),
        ("CAP_ANY", cv2.CAP_ANY),
    ]
    cap = None
    for name, flag in backends:
        log.info("Webcam %s: trying %s", device_index, name)
        candidate = cv2.VideoCapture(device_index, flag)
        if candidate.isOpened():
            log.info("Webcam %s: opened with %s", device_index, name)
            cap = candidate
            break
        candidate.release()

    if cap is None or not cap.isOpened():
        raise RuntimeError(
            f"Could not open webcam device index {device_index}. "
            "Close any other app using the webcam (Zoom, Teams, browser) and try again."
        )

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, target_fps)

    try:
        consecutive_failures = 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                consecutive_failures += 1
                if consecutive_failures > 50:
                    raise RuntimeError(f"Webcam {device_index} returned no frames for too long.")
                await asyncio.sleep(0.05)
                continue
            consecutive_failures = 0
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
            if not ok:
                continue
            yield bytes(buf)
            await asyncio.sleep(1 / max(target_fps, 1))
    finally:
        cap.release()
