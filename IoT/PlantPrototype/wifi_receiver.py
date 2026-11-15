"""HTTPS ingress from ESP32; persist readings in the existing bridge outbox."""
import json
import os
import ssl
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from serial_bridge import Outbox, NoRedirect, validate_api_origin
import urllib.request


class Receiver(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, handler, outbox, device, token, send):
        super().__init__(address, handler)
        self.outbox, self.device, self.token, self.send = outbox, device, token, send
        self.outbox_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/readings':
            self.send_error(404)
            return
        if self.headers.get('Authorization') != 'Bearer ' + self.server.token:
            self.send_error(401)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 1 <= size <= 8192:
                raise ValueError
            packet = json.loads(self.rfile.read(size))
            values = packet['values']
            if not isinstance(values, dict) or not values:
                raise ValueError
            capture = packet.get('capture', {})
            capture['observed_at'] = datetime.now(timezone.utc).isoformat()
            with self.server.outbox_lock:
                self.server.outbox.enqueue(self.server.device, values, capture=capture)
                delivered = self.server.outbox.flush(self.server.send, self.server.device)
                queued = self.server.outbox.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]
                backend_status = self.server.outbox.last_status
            print(
                f'Reading received; delivered={delivered}; queued={queued}; '
                f'backend_status={backend_status}',
                flush=True,
            )
            self.send_response(202)
            self.end_headers()
            self.wfile.write(b'queued')
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            self.send_error(400, 'Invalid reading payload')

    def log_message(self, fmt, *args):
        pass


def main():
    host = os.environ.get('IOT_LISTEN_HOST', '0.0.0.0')
    port = int(os.environ.get('IOT_LISTEN_PORT', '8443'))
    cert, key = os.environ.get('IOT_TLS_CERT', ''), os.environ.get('IOT_TLS_KEY', '')
    token, device = os.environ.get('IOT_INGRESS_TOKEN', ''), os.environ.get('DEVICE_ID', '')
    api_key = os.environ.get('DEVICE_KEY', '')
    origin = validate_api_origin(os.environ.get('PLANT_API_ORIGIN', ''))
    if not cert or not key or not token or not device or len(api_key) != 64:
        raise SystemExit('Configure IOT_TLS_CERT, IOT_TLS_KEY, IOT_INGRESS_TOKEN, DEVICE_ID, DEVICE_KEY, and PLANT_API_ORIGIN.')
    opener = urllib.request.build_opener(NoRedirect())
    def send(body):
        req = urllib.request.Request(origin + '/api/device/readings', body,
            {'Content-Type': 'application/json', 'Authorization': 'Device ' + api_key}, method='POST')
        with opener.open(req, timeout=10) as response:
            return response.status
    outbox = Outbox(
        os.environ.get('IOT_OUTBOX', str(Path(__file__).parent / '.private' / 'outbox.sqlite')),
        cross_thread=True,
    )
    server = Receiver((host, port), Handler, outbox, device, token, send)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f'HTTPS receiver listening on {host}:{port}')
    try:
        server.serve_forever()
    finally:
        server.server_close()
        outbox.close()


if __name__ == '__main__':
    main()
