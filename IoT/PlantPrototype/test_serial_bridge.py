import unittest
import os
from serial_bridge import frames

class UsbSerialTests(unittest.TestCase):
    def test_usb_reader_uses_firmware_baud_skips_timeouts_and_closes(self):
        from serial_bridge import serial_lines
        calls = []
        class Connection:
            def __enter__(self):
                self.lines = iter([b'', b'Temperature: 29.50 C\r\n', b'bad\xff\n'])
                return self
            def readline(self):
                return next(self.lines)
            def __exit__(self, *args):
                calls.append('closed')
        def factory(port, **options):
            calls.append((port, options))
            return Connection()
        reader = serial_lines('COM4', factory)
        self.assertEqual(next(reader), 'Temperature: 29.50 C\r\n')
        self.assertEqual(next(reader), 'bad\ufffd\n')
        reader.close()
        self.assertEqual(calls, [('COM4', {'baudrate': 115200, 'timeout': 2}), 'closed'])

    def test_usb_network_urls_are_rejected_before_opening(self):
        from serial_bridge import serial_lines
        def forbidden(*args, **kwargs):
            self.fail('A rejected port must not be opened')
        for port in ['', 'socket://example.invalid:1234', 'rfc2217://example.invalid']:
            with self.assertRaises(ValueError):
                next(serial_lines(port, forbidden))

    def test_usb_disconnect_closes_connection_without_fabricating_frame(self):
        from serial_bridge import serial_lines
        closed = []
        class Connection:
            def __enter__(self):
                return self
            def readline(self):
                raise OSError('Disconnected')
            def __exit__(self, *args):
                closed.append(True)
        with self.assertRaises(OSError):
            list(frames(serial_lines('/dev/ttyUSB0', lambda *a, **kw: Connection())))
        self.assertEqual(closed, [True])

class SerialBridgeTests(unittest.TestCase):
    def test_existing_firmware_frame(self):
        lines = ['========== SENSOR READINGS ==========', 'Soil Moisture: 2150',
                 'Temperature: 29.50 C', 'Humidity: 82.00 %',
                 'IMU: X-axis acceleration change detected!', '====================================']
        self.assertEqual(list(frames(lines)), [{'soilMoisture': 2150.0,
            'temperature': 29.5, 'humidity': 82.0, 'movement': 1}])

    def test_frames_do_not_reuse_old_sensor_values(self):
        self.assertEqual(list(frames(['Temperature: 30 C', '====================================',
            'Humidity: 50 %', '===================================='])), [{'temperature': 30}, {'humidity': 50}])

    def test_current_firmware_dashboard_format(self):
        dashboard = [
            '==============================================',
            '       BIODIVERSITY SENSOR MONITOR',
            '==============================================',
            '[ SOIL MOISTURE ]', 'Reading      : 2150',
            '[ RAINDROP SENSOR ]', 'Reading      : 812',
            '[ DHT11 ]', 'Temperature  : 29.5 C', 'Humidity     : 82.0 %',
            '[ MPU6050 ]', 'Movement     : DETECTED',
        ]
        self.assertEqual(list(frames(dashboard)), [])

        next_refresh = dashboard + dashboard
        self.assertEqual(list(frames(next_refresh)), [{
            'soilMoisture': 2150.0, 'rainfall': 812.0,
            'temperature': 29.5, 'humidity': 82.0, 'movement': 1,
        }])

    def test_current_firmware_waiting_values_are_ignored(self):
        lines = [
            'BIODIVERSITY SENSOR MONITOR', '[ SOIL MOISTURE ]',
            'Reading      : Waiting for first sample',
            '[ RAINDROP SENSOR ]', 'Reading      : 400',
            '[ DHT11 ]', 'Temperature  : Waiting for first sample',
            'Humidity     : Waiting for first sample',
            '[ MPU6050 ]', 'Movement     : No movement',
            'BIODIVERSITY SENSOR MONITOR',
        ]
        self.assertEqual(list(frames(lines)), [{'rainfall': 400.0, 'movement': 0}])

    def test_platformio_flat_dashboard_reads_rain_and_resets_movement(self):
        def dashboard(status):
            return ['BIODIVERSITY SENSOR MONITOR',
                    '[ ENVIRONMENTAL MONITORING ]',
                    'Soil Moisture          : 4095',
                    'Raindrop Sensor        : 812',
                    'Temperature            : 26.3 C',
                    'Humidity               : 83.0 %',
                    '[ MOVEMENT DETECTION ]',
                    'MPU6050                : Connected',
                    'Movement Status        : ' + status,
                    'Movement Count         : 5']
        lines = dashboard('DETECTED') + dashboard('No movement') + ['BIODIVERSITY SENSOR MONITOR']
        expected = {'soilMoisture': 4095.0, 'rainfall': 812.0,
                    'temperature': 26.3, 'humidity': 83.0}
        self.assertEqual(list(frames(lines)), [dict(expected, movement=1), dict(expected, movement=0)])

    def test_unknown_movement_text_does_not_invent_a_sensor_reading(self):
        lines = ['BIODIVERSITY SENSOR MONITOR',
                 'Movement Status : Not detected', 'Movement Count : 5',
                 'Temperature : 26.3 C', 'BIODIVERSITY SENSOR MONITOR']
        self.assertEqual(list(frames(lines)), [{'temperature': 26.3}])

    def test_capture_metadata_requires_explicit_mpu_health_and_resets_each_frame(self):
        from datetime import datetime
        lines = ['BIODIVERSITY SENSOR MONITOR', 'MPU6050 : Connected',
                 'Movement Status : DETECTED', 'BIODIVERSITY SENSOR MONITOR',
                 'MPU6050 : Not detected', 'Movement Status : No movement',
                 'BIODIVERSITY SENSOR MONITOR', 'Temperature : 26.3 C',
                 'BIODIVERSITY SENSOR MONITOR']
        actual = list(frames(lines, include_metadata=True))
        self.assertEqual([f['capture']['mpu_connected'] for f in actual], [True, False, None])
        self.assertEqual([f['values'] for f in actual], [{'movement': 1}, {'movement': 0}, {'temperature': 26.3}])
        for frame in actual:
            self.assertIsNotNone(datetime.fromisoformat(frame['capture']['observed_at']).tzinfo)

    def test_sectioned_mpu_health_is_captured(self):
        actual = list(frames(['BIODIVERSITY SENSOR MONITOR', '[ MPU6050 ]',
                             'Status : Connected', 'Movement : DETECTED',
                             'BIODIVERSITY SENSOR MONITOR'], include_metadata=True))
        self.assertTrue(actual[0]['capture']['mpu_connected'])

    def test_current_firmware_malformed_values_do_not_crash(self):
        lines = ['BIODIVERSITY SENSOR MONITOR', '[ SOIL MOISTURE ]',
                 'Reading      : ..', '[ DHT11 ]', 'Temperature  : nan C',
                 'Humidity     : 50 %', 'BIODIVERSITY SENSOR MONITOR']
        self.assertEqual(list(frames(lines)), [{'humidity': 50.0}])


class ApiOriginTests(unittest.TestCase):
    def test_http_is_accepted_only_for_explicit_localhost_origins(self):
        from serial_bridge import validate_api_origin
        for origin in ['http://127.0.0.1:3000', 'http://localhost:3000/', 'http://[::1]:3000/']:
            with self.subTest(origin=origin):
                self.assertEqual(validate_api_origin(origin), origin.rstrip('/'))

    def test_https_remains_supported_for_remote_servers(self):
        from serial_bridge import validate_api_origin
        self.assertEqual(validate_api_origin(' https://backend.example.invalid/ '),
                         'https://backend.example.invalid')

    def test_remote_http_and_ambiguous_origins_are_rejected(self):
        from serial_bridge import validate_api_origin
        for origin in ['', 'http://192.168.1.10:3000', 'http://backend.example.invalid',
                       'http://127.0.0.1.example.invalid', 'http://localhost.example.invalid',
                       'http://localhost@backend.example.invalid', 'https://user:secret@example.invalid',
                       'http://@localhost:3000', 'http://127.0.0.1:3000/api',
                       'http://127.0.0.1:3000/?key=secret', 'http://127.0.0.1:3000/#fragment',
                       'http://127.0.0.1:3000/?', 'http://127.0.0.1:65536',
                       'http://127.0.0.1:0', 'http://[::1', 'http://local\nhost:3000',
                       'ftp://localhost:3000', 'http://localhost:3000\\extra']:
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    validate_api_origin(origin)

    def test_rejected_origin_never_opens_the_outbox_or_network(self):
        from serial_bridge import main
        from unittest.mock import patch
        with patch.dict(os.environ, {'PLANT_API_ORIGIN': 'http://remote.example.invalid'}), \
                patch('sys.argv', ['serial_bridge.py', '--flush-only']), \
                patch('serial_bridge.Outbox') as outbox, \
                patch('serial_bridge.urllib.request.build_opener') as opener:
            with self.assertRaises(SystemExit):
                main()
        outbox.assert_not_called()
        opener.assert_not_called()

    def test_local_http_upload_uses_the_real_cli_and_preserves_auth_and_payload(self):
        import io
        import json
        import tempfile
        from pathlib import Path
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        from unittest.mock import patch
        from serial_bridge import main
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                received.append((self.path, self.headers.get('Authorization'), body))
                self.send_response(201)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                env = {'PLANT_API_ORIGIN': f'http://127.0.0.1:{server.server_port}/',
                       'DEVICE_ID': 'synthetic-device', 'DEVICE_KEY': 'a' * 64,
                       'IOT_OUTBOX': str(Path(folder) / 'synthetic.sqlite'),
                       'no_proxy': '127.0.0.1', 'NO_PROXY': '127.0.0.1'}
                lines = '\n'.join(['BIODIVERSITY SENSOR MONITOR',
                                   'Raindrop Sensor : 812', 'Temperature : 26.3 C',
                                   'Movement Status : No movement', 'BIODIVERSITY SENSOR MONITOR'])
                with patch.dict(os.environ, env), patch('sys.argv', ['serial_bridge.py']), \
                        patch('sys.stdin', io.StringIO(lines)):
                    self.assertEqual(main(), 0)
                self.assertEqual(len(received), 1)
                path, auth, body = received[0]
                self.assertEqual(path, '/api/device/readings')
                self.assertEqual(auth, 'Device ' + 'a' * 64)
                self.assertEqual(body['device_id'], 'synthetic-device')
                self.assertEqual(body['values'], {'rainfall': 812.0, 'temperature': 26.3, 'movement': 0})
                self.assertEqual(len(body['client_key']), 32)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

class MalformedFrameTests(__import__('unittest').TestCase):
    def test_malformed_numeric_value_does_not_crash_reader(self):
        from serial_bridge import frames
        self.assertEqual(list(frames(['========== SENSOR READINGS ==========','Temperature: ..','Humidity: 40','===================================='])), [{'humidity':40.0}])

class OutboxTests(unittest.TestCase):
    def test_failed_delivery_survives_restart_with_identical_retry_key(self):
        import tempfile, json, os
        from pathlib import Path
        from serial_bridge import Outbox
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'queue.sqlite'
            capture={'observed_at':'2026-11-04T00:00:00+00:00','mpu_connected':True}
            box=Outbox(path);box.enqueue('isolated-device',{'temperature':30},capture=capture)
            before=box.db.execute('SELECT body FROM queue').fetchone()[0]
            self.assertEqual(box.flush(lambda _: (_ for _ in ()).throw(OSError('offline')), 'isolated-device'),0)
            box.close();box=Outbox(path)
            sent=[]
            self.assertEqual(box.flush(lambda body: sent.append(body) or 201, 'isolated-device'),1)
            self.assertEqual(sent[0].decode(),before)
            self.assertEqual(len(json.loads(before)['client_key']),32)
            self.assertEqual(json.loads(sent[0])['capture'],capture)
            if os.name == 'posix':
                self.assertEqual(os.stat(path).st_mode&0o777,0o600)
            self.assertEqual(box.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],0);box.close()

    def test_rejection_and_device_change_preserve_outbox(self):
        import tempfile
        from pathlib import Path
        from serial_bridge import Outbox
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'queue.sqlite');box.enqueue('one',{'humidity':50})
            self.assertEqual(box.flush(lambda _:401,'one'),0)
            with self.assertRaises(RuntimeError):box.flush(lambda _:201,'other')
            self.assertEqual(box.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],1);box.close()

    def test_redirect_does_not_forward_device_credentials(self):
        import urllib.request,urllib.error
        from serial_bridge import NoRedirect
        request=urllib.request.Request('https://api.example.invalid/api/device/readings',headers={'Authorization':'Device isolated'})
        try:
            NoRedirect().redirect_request(request,None,302,'Redirect',{},'https://other.example.invalid')
            self.fail('Redirect must fail')
        except urllib.error.HTTPError as error:
            error.close()

class AutomaticDrainTests(unittest.TestCase):
    def test_rate_limit_recovers_automatically_without_changing_payload(self):
        import tempfile
        from pathlib import Path
        from serial_bridge import Outbox
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'queue.sqlite');box.enqueue('one',{'humidity':50})
            sent=[];waits=[]
            def send(body):
                sent.append(body)
                if len(sent)==1:
                    import urllib.error
                    raise urllib.error.HTTPError("https://synthetic.invalid",429,"Rate limited",{},None)
                return 201
            self.assertTrue(box.drain(send,'one',sleep=waits.append))
            self.assertEqual(sent[0],sent[1]);self.assertEqual(waits,[1.1]);box.close()

    def test_credentials_and_redirect_rejection_stop_without_retries_or_deletion(self):
        import tempfile
        from pathlib import Path
        from serial_bridge import Outbox
        for status in [302,400,401,403,409]:
            with tempfile.TemporaryDirectory() as folder:
                box=Outbox(Path(folder)/'queue.sqlite');box.enqueue('one',{'humidity':50})
                sent=[]
                self.assertFalse(box.drain(lambda body:sent.append(body) or status,'one',sleep=lambda _:self.fail('must not retry')))
                self.assertEqual(len(sent),1);self.assertEqual(box.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],1);box.close()

    def test_network_failure_has_bounded_backoff_and_preserves_queue(self):
        import tempfile
        from pathlib import Path
        from serial_bridge import Outbox
        with tempfile.TemporaryDirectory() as folder:
            box=Outbox(Path(folder)/'queue.sqlite');box.enqueue('one',{'humidity':50});waits=[]
            self.assertFalse(box.drain(lambda _:(_ for _ in ()).throw(OSError('offline')),'one',attempts=3,sleep=waits.append))
            self.assertEqual(waits,[1.1,2.2]);self.assertEqual(box.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],1);box.close()
