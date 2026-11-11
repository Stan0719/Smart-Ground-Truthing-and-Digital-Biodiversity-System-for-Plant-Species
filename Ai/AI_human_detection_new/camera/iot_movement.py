"""Read this plant's fresh MPU6050 state without opening the ESP32 serial port."""

from datetime import datetime
import json
import os
import re
from threading import Event, Lock, Thread
import time
import urllib.error
import urllib.parse
import urllib.request


MAX_AGE_SECONDS = 5


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


class IoTMovementSource:
    def __init__(self, origin, device_id, key, plant_id):
        self.device_id = device_id.strip()
        self.plant_id = plant_id.strip()
        self._key = key
        self._lock = Lock()
        self._stop = Event()
        self._thread = None
        self._state = {"status": "unavailable", "movement": None}
        self._received_at = float('-inf')
        self.configured = False
        try:
            origin = origin.strip()
            url = urllib.parse.urlsplit(origin)
            port = url.port
            valid_transport = url.scheme == 'https' or (
                url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))
            if (not valid_transport or not url.hostname or url.username is not None
                    or url.password is not None or url.path not in ('', '/')
                    or '?' in origin or '#' in origin or '\\' in origin
                    or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in origin)
                    or (port is not None and not 1 <= port <= 65535)
                    or not self.device_id or not re.fullmatch(r'[a-f0-9]{64}', key)
                    or not re.fullmatch(r'[1-9][0-9]*', self.plant_id)):
                return
            query = urllib.parse.urlencode({'device_id': self.device_id, 'plant_id': self.plant_id})
            self._url = url.geturl().rstrip('/') + '/api/device/movement?' + query
            self._opener = urllib.request.build_opener(NoRedirect())
            self.configured = True
        except ValueError:
            return

    @classmethod
    def from_environment(cls, plant_id):
        return cls(os.environ.get('PLANT_API_ORIGIN', 'http://127.0.0.1:3000'),
                   os.environ.get('DEVICE_ID', ''), os.environ.get('DEVICE_KEY', ''), plant_id)

    def poll(self):
        if not self.configured:
            return
        try:
            request = urllib.request.Request(self._url, headers={
                'Authorization': 'Device ' + self._key, 'Accept': 'application/json'})
            with self._opener.open(request, timeout=2) as response:
                state = json.loads(response.read(16384))
            if (not isinstance(state, dict) or state.get('deviceId') != self.device_id
                    or state.get('plantId') != self.plant_id
                    or state.get('status') not in ('moving', 'stationary', 'stale', 'unavailable')):
                raise ValueError('Invalid sensor response')
            if state['status'] in ('moving', 'stationary'):
                expected = 1 if state['status'] == 'moving' else 0
                if type(state.get('movement')) is not int or state['movement'] != expected:
                    raise ValueError('Invalid movement value')
                # Parse now as well as on each snapshot; malformed times cannot open the gate.
                self._observed_timestamp(state)
            with self._lock:
                self._state = state
                self._received_at = time.monotonic()
        except (OSError, ValueError, TypeError, KeyError):
            with self._lock:
                self._state = {'status': 'unavailable', 'movement': None}
                self._received_at = float('-inf')

    @staticmethod
    def _observed_timestamp(state):
        value = state.get('observedAt')
        if not isinstance(value, str):
            raise ValueError('Missing sensor time')
        observed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if observed.tzinfo is None:
            raise ValueError('Sensor time requires a timezone')
        return observed.timestamp()

    def snapshot(self):
        with self._lock:
            state = dict(self._state)
            received_at = self._received_at
        if state['status'] in ('moving', 'stationary'):
            age = time.time() - self._observed_timestamp(state)
            if age < -1 or age > MAX_AGE_SECONDS or time.monotonic() - received_at > MAX_AGE_SECONDS:
                state.update(status='stale', movement=None)
        if state['status'] not in ('moving', 'stationary'):
            state['movement'] = None
        return state

    def start(self):
        if not self.configured:
            print('IoT alerts disabled: set CAMERA_PLANT_ID, DEVICE_ID and DEVICE_KEY in this terminal.', flush=True)
            return
        self._thread = Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            self.poll()
            self._stop.wait(0.5)

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
