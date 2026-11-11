import http.client
import json
import time
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from camera import camera_server


class CameraHTTPTests(unittest.TestCase):
    def setUp(self):
        self.server = camera_server.start_server('CAM-TEST', '42', port=0)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request_json(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_status_tracks_real_frame_publication_and_staleness(self):
        status, initial = self.request_json('/camera-status')
        self.assertEqual(status, 200)
        self.assertEqual(initial['status'], 'Offline')
        self.assertEqual(initial['plantId'], '42')
        self.assertIsNone(initial['lastSeenAt'])

        camera_server.publish_frame(np.zeros((54, 96, 3), dtype=np.uint8))
        _, online = self.request_json('/camera-status?refresh=1')
        self.assertEqual(online['status'], 'Online')
        self.assertIsNotNone(online['lastSeenAt'])

        with patch.object(camera_server, '_last_frame', time.monotonic() - 11):
            _, stale = self.request_json('/camera-status')
        self.assertEqual(stale['status'], 'Offline')

    def test_events_match_the_existing_website_contract_without_fabricated_confidence(self):
        self.assertEqual(self.request_json('/camera-events'), (200, {'events': []}))
        camera_server.publish_event('possible_plant_contact', 'Possible plant contact', 'Review required.')
        status, result = self.request_json('/camera-events')
        self.assertEqual(status, 200)
        event = result['events'][0]
        self.assertEqual(event['cameraId'], 'CAM-TEST')
        self.assertEqual(event['plantId'], '42')
        self.assertEqual(event['eventType'], 'possible_plant_contact')
        self.assertEqual(event['status'], 'New')
        self.assertIsNone(event['confidence'])
        self.assertTrue(event['eventId'])
        self.assertTrue(event['detectedAt'])

    def test_live_feed_contains_a_decodable_jpeg_with_correct_multipart_headers(self):
        camera_server.publish_frame(np.full((54, 96, 3), 127, dtype=np.uint8))
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET', '/video-feed')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn('multipart/x-mixed-replace', response.getheader('Content-Type'))
            self.assertEqual(response.readline(), b'--frame\r\n')
            self.assertEqual(response.readline(), b'Content-Type: image/jpeg\r\n')
            size = int(response.readline().split(b':', 1)[1])
            self.assertEqual(response.readline(), b'\r\n')
            image = cv2.imdecode(np.frombuffer(response.read(size), dtype=np.uint8), cv2.IMREAD_COLOR)
            self.assertIsNotNone(image)
            self.assertEqual(image.shape, (54, 96, 3))
        finally:
            connection.close()

    def test_unknown_paths_return_json_404(self):
        self.assertEqual(self.request_json('/missing'), (404, {'error': 'Not found.'}))


if __name__ == '__main__':
    unittest.main()
