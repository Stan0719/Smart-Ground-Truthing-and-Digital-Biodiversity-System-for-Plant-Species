from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from camera.clip_publisher import ClipPublisher


class ClipPublisherTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.publisher = ClipPublisher(self.root, 'http://127.0.0.1:3000', 'registered-camera', 'a' * 64, '42')
        self.event = {'eventId': 'b' * 32, 'cameraId': 'registered-camera', 'plantId': '42',
                      'readingId': 'triggering-sensor-reading',
                      'eventType': 'possible_plant_contact', 'title': 'Possible contact', 'description': 'Contact plus MPU',
                      'detectedAt': datetime.now(timezone.utc).isoformat()}

    def metadata(self):
        return json.loads((self.root / (self.event['eventId'] + '.json')).read_text(encoding='utf-8'))

    def raw_clip(self):
        path = self.root / (self.event['eventId'] + '.raw.mp4')
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'mp4v'), 15, (64, 48))
        self.assertTrue(writer.isOpened())
        for index in range(15):
            writer.write(np.full((48, 64, 3), index * 10, dtype=np.uint8))
        writer.release()
        return path

    def test_real_clip_is_h264_and_only_ready_after_encoding_and_metadata_acknowledgement(self):
        self.assertTrue(self.publisher.ffmpeg, 'Install requirements-clips.txt before running clip integration tests')
        self.publisher.begin(self.event)
        raw = self.raw_clip()
        self.publisher.finish(self.event['eventId'])
        posted = []
        with patch.object(self.publisher, '_post', side_effect=lambda event: posted.append(dict(event))):
            self.publisher.process_once()
            self.assertEqual(posted[0]['recordingStatus'], 'processing')
            self.assertEqual(self.metadata()['recordingStatus'], 'ready')
            self.assertTrue(raw.exists())
            self.publisher.process_once()
            self.assertEqual(posted[-1]['recordingStatus'], 'ready')
            self.assertFalse(raw.exists())
        target = self.root / (self.event['eventId'] + '.mp4')
        result = subprocess.run([self.publisher.ffmpeg, '-hide_banner', '-i', str(target), '-f', 'null', '-'],
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'Video: h264', result.stderr)
        self.assertFalse((self.root / (self.event['eventId'] + '.encoding.mp4')).exists())

    def test_network_failure_retries_same_event_after_restart_and_keeps_files(self):
        self.publisher.begin(self.event)
        raw = self.raw_clip()
        self.publisher.finish(self.event['eventId'])
        with patch.object(self.publisher, '_post', side_effect=OSError('offline')), patch.object(self.publisher, '_transcode') as encode:
            self.publisher.process_once()
            encode.assert_not_called()
        self.assertTrue(raw.exists())
        restored = ClipPublisher(self.root, 'http://127.0.0.1:3000', 'registered-camera', 'a' * 64, '42')
        with patch.object(restored, '_post') as post:
            restored.process_once(); restored.process_once()
            self.assertEqual(post.call_args.args[0]['eventId'], self.event['eventId'])
            self.assertEqual(post.call_args.args[0]['recordingStatus'], 'ready')
        self.assertFalse(raw.exists())

    def test_failed_encoding_cannot_advertise_a_ready_clip_or_remove_raw_evidence(self):
        self.publisher.begin(self.event)
        raw = self.raw_clip()
        self.publisher.finish(self.event['eventId'])
        with patch.object(self.publisher, '_post'), patch.object(self.publisher, '_transcode', side_effect=OSError('encoder unavailable')):
            self.publisher.process_once()
        self.assertEqual(self.metadata()['recordingStatus'], 'processing')
        self.assertTrue(raw.exists())

    def test_normal_shutdown_drains_the_last_clip_without_requiring_a_camera_restart(self):
        posted = []
        with patch.object(self.publisher, '_post', side_effect=lambda event: posted.append(dict(event))):
            self.publisher.start()
            try:
                self.publisher.begin(self.event)
                raw = self.raw_clip()
                self.publisher.finish(self.event['eventId'])
            finally:
                self.publisher.close()
        self.assertEqual(self.metadata()['recordingStatus'], 'ready')
        self.assertEqual(posted[-1]['recordingStatus'], 'ready')
        self.assertFalse(raw.exists())
        self.assertFalse(self.publisher._thread.is_alive())

    def test_restart_marks_interrupted_capture_failed_without_processing_other_cameras(self):
        self.publisher.begin(self.event)
        with patch.object(self.publisher, '_run'):
            self.publisher.start(); self.publisher.close()
        self.assertEqual(self.metadata()['recordingStatus'], 'failed')
        self.assertIsNotNone(self.metadata()['recordingEndedAt'])
        with patch.object(self.publisher, '_post') as post:
            other = self.metadata() | {'cameraId': 'another-camera'}
            self.publisher._save(other)
            self.publisher.process_once()
            post.assert_not_called()

    def test_upload_is_metadata_only_with_separate_camera_credentials_and_no_redirects(self):
        self.publisher.begin(self.event)
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b'{"recorded": true}'
        with patch.object(self.publisher._opener, 'open', return_value=Response()) as post:
            self.publisher._post(self.metadata())
        request = post.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:3000/api/device/camera-events')
        self.assertEqual(request.get_header('Authorization'), 'Device ' + 'a' * 64)
        self.assertEqual(request.get_header('X-camera-id'), 'registered-camera')
        payload = json.loads(request.data)
        self.assertEqual(payload['readingId'], 'triggering-sensor-reading')
        self.assertNotIn('cameraId', payload)
        self.assertNotIn('videoUrl', payload)
        self.assertLess(len(request.data), 2000)
        for origin in ['http://example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/path']:
            self.assertFalse(ClipPublisher(self.root, origin, 'camera', 'a' * 64, '42').configured)


if __name__ == '__main__':
    unittest.main()
