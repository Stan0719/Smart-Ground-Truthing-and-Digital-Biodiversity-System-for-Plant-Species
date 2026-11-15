"""Durable metadata outbox and browser-compatible local clip preparation.

Only JSON metadata is sent to the Plant API. Video bytes never leave this folder.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from threading import Event, Lock, Thread
import urllib.parse
import urllib.request

try:
    from .iot_movement import NoRedirect
except ImportError:
    from iot_movement import NoRedirect


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class ClipPublisher:
    def __init__(self, root, origin, camera_id, key, plant_id, *, ffmpeg=None):
        self.root = Path(root).resolve()
        self.camera_id, self.plant_id, self._key = camera_id, plant_id, key
        self._stop = Event()
        self._wake = Event()
        self._drain = Event()
        self._encoder_lock = Lock()
        self._encoder = None
        self._thread = None
        self._acknowledged = {}
        self._warned = set()
        self._opener = urllib.request.build_opener(NoRedirect())
        self.ffmpeg = ffmpeg or os.environ.get('FFMPEG_PATH') or shutil.which('ffmpeg')
        if not self.ffmpeg:
            try:
                from imageio_ffmpeg import get_ffmpeg_exe
                self.ffmpeg = get_ffmpeg_exe()
            except (ImportError, RuntimeError):
                pass
        self.configured = False
        try:
            url = urllib.parse.urlsplit(origin)
            valid_transport = url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))
            if (not valid_transport or not url.hostname or url.username is not None or url.password is not None
                    or url.path not in ('', '/') or '?' in origin or '#' in origin or '\\' in origin
                    or any(c.isspace() or ord(c) < 32 for c in origin)
                    or (url.port is not None and not 1 <= url.port <= 65535)
                    or not camera_id or not re.fullmatch(r'[a-f0-9]{64}', key)
                    or not re.fullmatch(r'[1-9][0-9]*', plant_id)):
                return
            self._url = origin.rstrip('/') + '/api/device/camera-events'
            self.configured = True
        except ValueError:
            return

    @classmethod
    def from_environment(cls, root, plant_id):
        return cls(root, os.environ.get('PLANT_API_ORIGIN', 'http://127.0.0.1:3000'),
                   os.environ.get('CAMERA_DEVICE_ID', '').strip(),
                   os.environ.get('CAMERA_DEVICE_KEY', ''), plant_id)

    def _save(self, event):
        path = self.root / (event['eventId'] + '.json')
        temporary = path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(event), encoding='utf-8')
        temporary.replace(path)

    def begin(self, event):
        if not self.configured:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        self._save({key: event[key] for key in ('eventId', 'plantId', 'eventType', 'title', 'description', 'detectedAt')} | {
            'cameraId': self.camera_id, 'recordingStartedAt': event['detectedAt'],
            'recordingEndedAt': None, 'recordingStatus': 'recording',
            'readingId': event.get('readingId'),
        })

    def finish(self, event_id):
        path = self.root / (event_id + '.json')
        event = json.loads(path.read_text(encoding='utf-8'))
        event.update(recordingEndedAt=timestamp(), recordingStatus='processing')
        self._save(event)
        self._wake.set()

    def _transcode(self, event):
        if not self.ffmpeg:
            raise OSError('Install FFmpeg or set FFMPEG_PATH to prepare browser recordings.')
        event_id = event['eventId']
        raw = self.root / (event_id + '.raw.mp4')
        target = self.root / (event_id + '.mp4')
        temporary = self.root / (event_id + '.encoding.mp4')
        with self._encoder_lock:
            if self._stop.is_set():
                raise OSError('Clip preparation stopped.')
            encoder = subprocess.Popen([self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                            '-i', str(raw), '-an', '-c:v', 'libx264', '-preset', 'veryfast',
                            '-crf', '28', '-pix_fmt', 'yuv420p', '-r', '15', '-movflags', '+faststart',
                            str(temporary)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self._encoder = encoder
        try:
            try:
                encoder.communicate(timeout=600)
            except subprocess.TimeoutExpired:
                encoder.kill(); encoder.communicate()
                raise
            if encoder.returncode != 0:
                raise OSError('Clip encoding did not finish.')
        finally:
            with self._encoder_lock:
                self._encoder = None
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise OSError('FFmpeg did not produce a completed clip.')
        temporary.replace(target)

    def process_once(self):
        """Retry durable snapshots after network failure or camera restarts."""
        pending = False
        for path in sorted(self.root.glob('*.json')):
            if self._stop.is_set():
                return
            try:
                if not re.fullmatch(r'[a-f0-9]{32}\.json', path.name):
                    continue
                event = json.loads(path.read_text(encoding='utf-8'))
                if event.get('cameraId') != self.camera_id or event.get('plantId') != self.plant_id or event.get('eventId') != path.stem:
                    continue
                snapshot = json.dumps(event, sort_keys=True)
                if self._acknowledged.get(path.name) != snapshot:
                    self._post(event)
                    self._acknowledged[path.name] = snapshot
                if event['recordingStatus'] == 'processing':
                    self._transcode(event)
                    event['recordingStatus'] = 'ready'
                    self._save(event)
                    pending = True
                    # Keep the raw file until metadata acknowledgement succeeds.
                elif event['recordingStatus'] == 'ready':
                    raw = self.root / (event['eventId'] + '.raw.mp4')
                    raw.unlink(missing_ok=True)
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                pending = True
                # A failed upload/encode remains on disk and can be retried.
                # Do not print provider errors, payloads or credentials.
                if path.name not in self._warned:
                    print('Clip pending: check FFmpeg, backend and camera credentials. Local files retained.', flush=True)
                    self._warned.add(path.name)
        return pending

    def _post(self, event):
        body = {key: value for key, value in event.items() if key != 'cameraId'}
        request = urllib.request.Request(self._url, data=json.dumps(body).encode('utf-8'), headers={
            'Content-Type': 'application/json', 'Authorization': 'Device ' + self._key,
            'X-Camera-ID': self.camera_id,
        }, method='POST')
        with self._opener.open(request, timeout=5) as response:
            result = json.loads(response.read(16384))
        if result != {'recorded': True}:
            raise ValueError('Camera metadata was not acknowledged.')

    def start(self):
        if not self.configured:
            print('Clip integration disabled: set CAMERA_DEVICE_ID and CAMERA_DEVICE_KEY for this plant.', flush=True)
            return
        self.root.mkdir(parents=True, exist_ok=True)
        # A previous process cannot still be writing these unfinished recordings.
        for path in self.root.glob('*.json'):
            try:
                event = json.loads(path.read_text(encoding='utf-8'))
                if (re.fullmatch(r'[a-f0-9]{32}\.json', path.name) and event.get('eventId') == path.stem
                        and event.get('cameraId') == self.camera_id and event.get('plantId') == self.plant_id
                        and event.get('recordingStatus') == 'recording'):
                    event.update(recordingStatus='failed', recordingEndedAt=timestamp())
                    self._save(event)
            except (OSError, ValueError, KeyError):
                pass
        if not self.ffmpeg:
            print('Clip playback needs FFmpeg on PATH or FFMPEG_PATH. Captures will stay queued locally.', flush=True)
        self._thread = Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            pending = self.process_once()
            if self._drain.is_set() and not pending and not self._pending_snapshots():
                return
            self._wake.wait(2)
            self._wake.clear()

    def _pending_snapshots(self):
        # A capture may have finalized while the worker acknowledged an older
        # recording snapshot; do not exit until its final snapshot is checked.
        for path in self.root.glob('*.json'):
            try:
                event = json.loads(path.read_text(encoding='utf-8'))
                if (event.get('cameraId') == self.camera_id and event.get('plantId') == self.plant_id
                        and (event.get('recordingStatus') == 'processing'
                             or self._acknowledged.get(path.name) != json.dumps(event, sort_keys=True))):
                    return True
            except (OSError, ValueError, AttributeError):
                continue
        return False

    def close(self):
        # Give the last finalized clip a bounded chance to finish before exiting.
        # Remaining work stays durable for the next launch.
        self._drain.set(); self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=8)
        self._stop.set()
        self._wake.set()
        with self._encoder_lock:
            if self._encoder is not None and self._encoder.poll() is None:
                self._encoder.terminate()
        if self._thread is not None:
            self._thread.join(timeout=6)
