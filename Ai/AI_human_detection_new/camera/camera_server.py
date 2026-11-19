import json
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Condition, Event, Thread
from uuid import uuid4

import cv2

_condition = Condition()
_jpeg = None
_sequence = 0
_last_frame = 0.0
_last_seen = None
_camera = {}
_events = deque(maxlen=100)


class CameraHTTPServer(ThreadingHTTPServer):
    def __init__(self, address, handler):
        self.stopped = Event()
        super().__init__(address, handler)

    def server_close(self):
        self.stopped.set()
        with _condition:
            _condition.notify_all()
        super().server_close()


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def publish_frame(frame):
    global _jpeg, _sequence, _last_frame, _last_seen

    now = time.monotonic()

    # Limit JPEG encoding and streaming to approximately 8 FPS.
    if now - _last_frame < 0.125:
        return

    ok, encoded = cv2.imencode(
        ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75]
    )
    if not ok:
        return

    with _condition:
        _jpeg = encoded.tobytes()
        _sequence += 1
        _last_frame = now
        _last_seen = timestamp()
        _condition.notify_all()


def publish_event(event_type, title, description, *, event_id=None, reading_id=None):
    with _condition:
        event = {
            "eventId": event_id or uuid4().hex,
            "cameraId": _camera["cameraId"],
            "plantId": _camera["plantId"],
            "eventType": event_type,
            "title": title,
            "description": description,
            "confidence": None,
            "detectedAt": timestamp(),
            "status": "New",
        }
        if reading_id is not None:
            event["readingId"] = reading_id
        _events.appendleft(event)
        return dict(event)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        try:
            if path == "/camera-status":
                with _condition:
                    online = (
                        _jpeg is not None
                        and time.monotonic() - _last_frame < 10
                    )
                    payload = {
                        **_camera,
                        "status": "Online" if online else "Offline",
                        "lastSeenAt": _last_seen,
                    }
                return self.send_json(payload)

            if path == "/camera-events":
                with _condition:
                    payload = {"events": list(_events)}
                return self.send_json(payload)

            if path != "/video-feed":
                return self.send_json({"error": "Not found."}, 404)

            self.send_response(200)
            self.send_header(
                "Content-Type",
                "multipart/x-mixed-replace; boundary=frame",
            )
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            seen = 0
            while not self.server.stopped.is_set():
                with _condition:
                    _condition.wait_for(
                        lambda: _sequence != seen or self.server.stopped.is_set(),
                        timeout=2,
                    )
                    if self.server.stopped.is_set():
                        return
                    if _sequence == seen:
                        continue

                    seen = _sequence
                    frame = _jpeg

                self.wfile.write(
                    b"--frame\r\nContent-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode()
                    + frame
                    + b"\r\n"
                )
                self.wfile.flush()

        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return


def start_server(camera_id, plant_id, *, port=8001):
    global _jpeg, _sequence, _last_frame, _last_seen

    if not camera_id or not plant_id:
        raise ValueError(
            "Set CAMERA_ID and CAMERA_PLANT_ID before starting."
        )

    server = CameraHTTPServer(("127.0.0.1", port), Handler)
    with _condition:
        _camera.update(
            cameraId=camera_id,
            plantId=plant_id,
            name="Plant monitoring camera",
        )
        _jpeg = None
        _sequence = 0
        _last_frame = 0.0
        _last_seen = None
        _events.clear()

    Thread(target=server.serve_forever, daemon=True).start()

    print(f"Camera HTTP service: http://127.0.0.1:{server.server_port}", flush=True)
    return server
