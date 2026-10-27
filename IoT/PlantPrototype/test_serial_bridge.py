import unittest
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
            box=Outbox(path);box.enqueue('isolated-device',{'temperature':30})
            before=box.db.execute('SELECT body FROM queue').fetchone()[0]
            self.assertEqual(box.flush(lambda _: (_ for _ in ()).throw(OSError('offline')), 'isolated-device'),0)
            box.close();box=Outbox(path)
            sent=[]
            self.assertEqual(box.flush(lambda body: sent.append(body) or 201, 'isolated-device'),1)
            self.assertEqual(sent[0].decode(),before)
            self.assertEqual(len(json.loads(before)['client_key']),32)
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
