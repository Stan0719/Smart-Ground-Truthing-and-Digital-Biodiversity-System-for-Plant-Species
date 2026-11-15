import base64
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import Image
from engine import BioCLIPSearch, MODEL, rank_matches

HERE = Path(__file__).resolve().parent
IMAGE_CACHE = HERE / ".cache" / "web-images"
SEARCH = None
BUSY = Lock()


def photo_path(encoded):
    data = base64.b64decode(encoded, validate=True)
    if not data or len(data) > 4 * 1024 * 1024:
        raise ValueError("Invalid image size")

    with Image.open(BytesIO(data)) as photo:
        if photo.format not in ("JPEG", "PNG"):
            raise ValueError("Use JPEG or PNG")
        if photo.width * photo.height > 24000000:
            raise ValueError("Image is too large")
        photo.verify()

    path = IMAGE_CACHE / (
        hashlib.sha256(data).hexdigest() + ".img"
    )
    if not path.exists():
        path.write_bytes(data)
    return path


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {
                "ready": SEARCH is not None,
                "model": MODEL,
            })
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/search":
            return self.reply(404, {"error": "Not found"})

        if not BUSY.acquire(blocking=False):
            return self.reply(503, {
                "error": "BioCLIP is busy; retry shortly."
            })

        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 20 * 1024 * 1024:
                return self.reply(413, {
                    "error": "Request exceeds 20 MB."
                })

            payload = json.loads(self.rfile.read(size))
            references = payload["references"]

            if not isinstance(references, list):
                raise ValueError("Invalid references")
            if not 1 <= len(references) <= 50:
                raise ValueError("Supply 1 to 50 reference photos")

            ids = [item["id"] for item in references]
            if any(
                not isinstance(item, str)
                or not item
                or len(item) > 100
                for item in ids
            ):
                raise ValueError("Invalid reference ID")
            if len(set(ids)) != len(ids):
                raise ValueError("Duplicate reference IDs")

            query = SEARCH.embed(photo_path(payload["query"]))
            features = [
                SEARCH.embed(photo_path(item["image"]))
                for item in references
            ]

            matches = rank_matches(
                query, ids, features, top_k=len(ids)
            )

            self.reply(200, {
                "model": MODEL,
                "matches": [
                    {"id": asset_id, "similarity": score}
                    for asset_id, score in matches
                ],
            })
        except (ValueError, TypeError, KeyError, OSError):
            self.reply(400, {
                "error": "Invalid image or comparison request."
            })
        except Exception:
            self.reply(503, {
                "error": "BioCLIP inference failed. Check Python."
            })
        finally:
            BUSY.release()


if __name__ == "__main__":
    IMAGE_CACHE.mkdir(parents=True, exist_ok=True)
    SEARCH = BioCLIPSearch(HERE / ".cache")

    with ThreadingHTTPServer(
        ("127.0.0.1", 8002), Handler
    ) as server:
        print(
            "BioCLIP API ready: http://127.0.0.1:8002",
            flush=True,
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass