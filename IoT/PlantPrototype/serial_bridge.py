"""Read the existing firmware's serial text from stdin; send authenticated readings.

Use --port to read a local USB serial port, or pipe a trusted reader into stdin.
No firmware or serial-port permissions are changed here. Destination and credentials
are supplied through environment variables, never command-line arguments.
"""
import json
import math
import os
import re
import sys
import uuid
import sqlite3
import time
import argparse
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

LABELS = {'Soil Moisture': 'soilMoisture', 'Rain Sensor': 'rainfall',
          'Sound Sensor': 'sound', 'Temperature': 'temperature', 'Humidity': 'humidity'}

def serial_module():
    try:
        import serial
    except ImportError:
        raise SystemExit('USB mode requires pyserial: python -m pip install -r IoT/PlantPrototype/requirements.txt') from None
    return serial


def serial_lines(port, serial_factory=None):
    if not port or '://' in port:
        raise ValueError('Select a local USB serial port, not a network URL.')
    factory = serial_factory or serial_module().Serial
    with factory(port, baudrate=115200, timeout=2) as connection:
        while True:
            line = connection.readline()
            if line:
                yield line.decode('utf-8', errors='replace')


def list_serial_ports():
    serial_module()
    from serial.tools.list_ports import comports
    ports = sorted(comports(), key=lambda item: item.device)
    for port in ports:
        print(f'{port.device}: {port.description}')
    if not ports:
        print('No serial ports detected on this host. Connect the board to the host running this command.')
    return 0 if ports else 1


def frames(lines):
    values = {}
    for line in lines:
        line = line.strip()
        if line == '========== SENSOR READINGS ==========':
            values = {}
        elif line == '====================================':
            if values:
                yield values
            values = {}
        else:
            match = re.match(r'^(Soil Moisture|Rain Sensor|Sound Sensor|Temperature|Humidity):\s*(-?[\d.]+)', line)
            if match:
                try:
                    value = float(match[2])
                except ValueError:
                    continue
                if math.isfinite(value):
                    values[LABELS[match[1]]] = value
            if line.startswith('IMU:') and 'change detected' in line:
                values['movement'] = 1

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a device credential to a redirect/sign-in destination.
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


class Outbox:
    def __init__(self, filename):
        path = Path(filename)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.last_status = None
        self.db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self.db.execute('CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
        self.db.commit()

    def enqueue(self, device, values):
        if self.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0] >= 10000:
            raise RuntimeError('Device outbox is full. Restore connectivity and flush before reading more frames.')
        payload = json.dumps({'device_id': device, 'values': values, 'client_key': uuid.uuid4().hex})
        self.db.execute('INSERT INTO queue(body) VALUES(?)', (payload,))
        self.db.commit()  # Commit before network I/O; retries reuse this client key.

    def flush(self, send, device):
        delivered = 0
        self.last_status = None
        for row_id, body in self.db.execute('SELECT id,body FROM queue ORDER BY id').fetchall():
            if json.loads(body)['device_id'] != device:
                raise RuntimeError('Outbox belongs to another device. Restore its configuration; nothing was deleted.')
            try:
                status = send(body.encode())
            except urllib.error.HTTPError as error:
                self.last_status = error.code
                error.close()
                break
            except OSError:
                self.last_status = 0
                break
            if status != 201:
                self.last_status = status
                break
            self.db.execute('DELETE FROM queue WHERE id=?', (row_id,))
            self.db.commit()
            delivered += 1
        return delivered

    def drain(self, send, device, attempts=30, sleep=time.sleep):
        if not isinstance(attempts, int) or not 1 <= attempts <= 1000:
            raise ValueError('Drain attempts must be between 1 and 1000.')
        for attempt in range(attempts):
            self.flush(send, device)
            if not self.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]:
                return True
            # Never retry credentials, rejected payloads or redirect destinations.
            if self.last_status and self.last_status != 429 and self.last_status < 500:
                return False
            if attempt + 1 < attempts:
                sleep(min(30, 1.1 * 2 ** min(attempt, 5)))
        return False

    def close(self):
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description='Private durable sensor uploader')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--flush-only', action='store_true', help='One delivery pass, retaining failures')
    mode.add_argument('--drain', action='store_true', help='Automatically retry the existing queue without reading serial input')
    mode.add_argument('--port', help='Read the selected local USB serial port at firmware baud 115200 (requires pyserial)')
    mode.add_argument('--list-ports', action='store_true', help='List local serial ports without connecting or sending readings')
    parser.add_argument('--attempts', type=int, default=30, help='Bounded drain passes (1-1000; default 30)')
    args = parser.parse_args()
    if not 1 <= args.attempts <= 1000:
        parser.error('--attempts must be between 1 and 1000')
    if args.list_ports:
        return list_serial_ports()
    if args.port and '://' in args.port:
        parser.error('--port must be a local serial port, not a network URL')
    if args.port:
        serial_module()  # Check optional dependency before any network or outbox access.
    origin = os.environ.get('PLANT_API_ORIGIN', '')
    url = urllib.parse.urlsplit(origin)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise SystemExit('Configure an HTTPS PLANT_API_ORIGIN.')
    key, device = os.environ.get('DEVICE_KEY', ''), os.environ.get('DEVICE_ID', '')
    if not re.fullmatch(r'[a-f0-9]{64}', key) or not device:
        raise SystemExit('Configure DEVICE_ID and DEVICE_KEY for the registered sensor.')
    opener = urllib.request.build_opener(NoRedirect())
    def send(body):
        request = urllib.request.Request(origin.rstrip('/') + '/api/device/readings', body,
            {'Content-Type': 'application/json', 'Authorization': 'Device ' + key}, method='POST')
        with opener.open(request, timeout=10) as response:
            return response.status
    outbox = Outbox(os.environ.get('IOT_OUTBOX', str(Path(__file__).parent / '.private' / 'outbox.sqlite')))
    try:
        if args.drain:
            outbox.drain(send, device, attempts=args.attempts)
        else:
            outbox.flush(send, device)
        if not args.flush_only and not args.drain:
            for values in frames(serial_lines(args.port) if args.port else sys.stdin):
                outbox.enqueue(device, values)
                outbox.flush(send, device)
                queued = outbox.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]
                if queued:
                    print(f'Delivery unavailable: {queued} reading(s) retained in the private outbox.', file=sys.stderr)
        remaining = outbox.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]
        if remaining:
            print(f'{remaining} reading(s) retained privately. Restore connectivity/configuration and run --drain for automatic bounded retries.', file=sys.stderr)
            return 1
        return 0
    finally:
        outbox.close()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        raise SystemExit('Stopped. Existing queued readings remain in the private outbox.') from None
    except (OSError, sqlite3.Error, RuntimeError):
        raise SystemExit('Bridge failed; preserve the private outbox and check storage/device configuration.') from None
