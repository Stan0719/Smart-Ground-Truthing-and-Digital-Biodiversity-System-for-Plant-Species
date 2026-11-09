from datetime import datetime, timezone
import io
import json
import time
import unittest
from unittest.mock import MagicMock, patch

from camera.iot_movement import IoTMovementSource, NoRedirect


class IoTMovementTests(unittest.TestCase):
    def source(self):
        source = IoTMovementSource('http://127.0.0.1:3000', 'sensor', 'a' * 64, '1')
        source._opener = MagicMock()
        return source

    def response(self, source, movement=1, **overrides):
        state = {'deviceId': 'sensor', 'plantId': '1',
                 'status': 'moving' if movement else 'stationary', 'movement': movement,
                 'observedAt': datetime.now(timezone.utc).isoformat()}
        state.update(overrides)
        source._opener.open.return_value = io.BytesIO(json.dumps(state).encode())
        source.poll()

    def test_fresh_movement_stops_on_zero_or_network_failure(self):
        source = self.source()
        self.response(source)
        self.assertEqual(source.snapshot()['movement'], 1)
        request = source._opener.open.call_args.args[0]
        self.assertNotIn('a' * 64, request.full_url)
        self.assertEqual(request.get_header('Authorization'), 'Device ' + 'a' * 64)
        self.response(source, movement=0)
        self.assertEqual(source.snapshot()['movement'], 0)
        source._opener.open.side_effect = OSError('Unavailable')
        source.poll()
        self.assertIsNone(source.snapshot()['movement'])

    def test_stale_cached_movement_expires_without_a_new_response(self):
        source = self.source()
        self.response(source)
        with patch('camera.iot_movement.time.time', return_value=time.time() + 6):
            self.assertEqual(source.snapshot()['status'], 'stale')
            self.assertIsNone(source.snapshot()['movement'])

    def test_wrong_plant_unknown_health_and_malformed_times_fail_closed(self):
        for overrides in [{'plantId': '2'}, {'deviceId': 'other'},
                          {'status': 'unavailable', 'movement': 1},
                          {'observedAt': None}, {'observedAt': 'not-a-time'},
                          {'observedAt': '2026-11-04T00:00:00'},
                          {'movement': True}, {'status': 'stationary', 'movement': 1}]:
            with self.subTest(overrides=overrides):
                source = self.source()
                self.response(source, **overrides)
                self.assertIsNone(source.snapshot()['movement'])

    def test_missing_configuration_never_contacts_backend(self):
        source = IoTMovementSource('http://127.0.0.1:3000', '', '', '1')
        self.assertFalse(source.configured)
        source.start()
        self.assertIsNone(source.snapshot()['movement'])
        source.close()

    def test_remote_http_is_rejected_and_redirects_do_not_forward_credentials(self):
        import urllib.error
        import urllib.request
        self.assertFalse(IoTMovementSource('http://remote.invalid', 'sensor', 'a' * 64, '1').configured)
        request = urllib.request.Request('https://synthetic.invalid', headers={'Authorization': 'Device synthetic'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            NoRedirect().redirect_request(request, None, 302, 'Redirect', {}, 'https://other.invalid')
        caught.exception.close()
