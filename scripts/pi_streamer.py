"""Pi 4 USB-webcam MJPEG streamer.

Runs on the Raspberry Pi 4. Exposes one MJPEG endpoint per attached USB camera
on a configurable port. The laptop backend pulls these streams and runs all
inference — the Pi only captures and pushes frames.

Usage on the Pi:
    python3 pi_streamer.py --port 8081 --device 0
    python3 pi_streamer.py --port 8082 --device 1
    python3 pi_streamer.py --port 8083 --device 2

Each stream is then available at:
    http://<pi-host>:8081/stream

Tested with `cv2.VideoCapture` on Bookworm. No extra dependencies beyond
opencv-python. Designed to be run as a systemd service (one unit per camera).
"""

from __future__ import annotations

import argparse
import logging
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

import cv2  # type: ignore[import-untyped]


log = logging.getLogger("pi_streamer")
BOUNDARY = "frame"


class FrameGrabber:
    """Continuously reads frames from a webcam in a background thread."""

    def __init__(self, device: int, width: int, height: int, fps: int, jpeg_quality: int) -> None:
        self.device = device
        self.width = width
        self.height = height
        self.fps = fps
        self.jpeg_quality = jpeg_quality
        self._cap = None
        self._latest: bytes | None = None
        self._lock = Lock()
        self._stop = False
        self._thread = Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self._cap = cv2.VideoCapture(self.device)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._cap.set(cv2.CAP_PROP_FPS, self.fps)
        if not self._cap.isOpened():
            raise RuntimeError(f"Could not open device {self.device}")
        self._thread.start()

    def stop(self) -> None:
        self._stop = True
        if self._cap is not None:
            self._cap.release()

    def _loop(self) -> None:
        assert self._cap is not None
        while not self._stop:
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
            if not ok:
                continue
            data = bytes(buf)
            with self._lock:
                self._latest = data

    def latest(self) -> bytes | None:
        with self._lock:
            return self._latest


_grabber: FrameGrabber  # set in main


class MJPEGHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/stream":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Age", "0")
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
        self.end_headers()
        try:
            while True:
                jpeg = _grabber.latest()
                if jpeg is None:
                    time.sleep(0.05)
                    continue
                try:
                    self.wfile.write(b"--" + BOUNDARY.encode() + b"\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    break
                time.sleep(1.0 / max(_grabber.fps, 1))
        except Exception:  # noqa: BLE001
            log.exception("MJPEG client error")

    def log_message(self, format: str, *args: object) -> None:  # silence default access log
        return


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=20)
    parser.add_argument("--jpeg-quality", type=int, default=70)
    args = parser.parse_args()

    global _grabber
    _grabber = FrameGrabber(args.device, args.width, args.height, args.fps, args.jpeg_quality)
    _grabber.start()

    host = "0.0.0.0"
    server = ThreadingHTTPServer((host, args.port), MJPEGHandler)
    server.daemon_threads = True

    try:
        bind_ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        bind_ip = host
    log.info("Pi streamer device=%s -> http://%s:%s/stream", args.device, bind_ip, args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _grabber.stop()
        server.server_close()


if __name__ == "__main__":
    main()
