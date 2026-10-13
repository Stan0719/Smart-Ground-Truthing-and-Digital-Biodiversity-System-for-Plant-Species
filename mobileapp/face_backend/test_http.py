"""Actual HTTP requests with an injected matcher; no personal images or accounts."""
import base64
import contextlib
import http.client
import io
import json
import threading
import socket
import unittest
from core import Auth, AuthError
from server import create_server

class HttpTests(unittest.TestCase):
    def setUp(self):
        ready = threading.Event()
        def run():
            def embed(data):
                if data == b'timeout': raise socket.timeout()
                if data == b'integration-error': raise TypeError('controlled integration defect')
                if data == b'crash': raise RuntimeError('internal-secret-not-for-response')
                if data == b'spoof': raise AuthError('Live person not confirmed.', 422, 'liveness_rejected')
                if data == b'bad-photo': raise AuthError('Invalid image.', 422, 'invalid_image')
                return [1., 0.] if data == b'owner' else [0., 1.]
            auth = Auth(':memory:', embed)
            auth.provision('test@example.com', 'valid-password', 'Test')
            self.server = create_server(auth, port=0, readiness={'ready': True, 'dependencies': 'mocked'})
            ready.set()
            try: self.server.serve_forever()
            finally:
                self.server.server_close()
                auth.db.close()
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        self.assertTrue(ready.wait(5))

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(5)

    def call(self, path, body=None, token=None, method='POST', raw=None, content_type='application/json', reference=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': content_type}
        if token: headers['Authorization'] = 'Bearer '+token
        if reference: headers['X-Face-Request-ID'] = reference
        content = raw if raw is not None else json.dumps(body or {})
        connection.request(method, path, content if method == 'POST' else None, headers)
        response = connection.getresponse()
        data = response.read()
        self.assertTrue(data)
        self.assertEqual(int(response.getheader('Content-Length')), len(data))
        result = json.loads(data)
        status = response.status
        connection.close()
        return status, result

    def login(self):
        status, result = self.call('/password', {'email':'test@example.com','password':'valid-password'})
        self.assertEqual(status, 200)
        return result['token']

    def image(self, value=b'owner'):
        return base64.b64encode(value).decode()

    def test_correlation_reference_validated(self):
        reference = 'abcdef123456'
        status, result = self.call('/challenge', reference=reference)
        self.assertEqual(status, 200)
        self.assertEqual(result['requestId'], reference)
        status, result = self.call('/challenge', reference='unsafe-untrusted-value')
        self.assertEqual(status, 200)
        self.assertRegex(result['requestId'], r'^[a-f0-9]{12}$')

    def test_health_and_unknown_route(self):
        status, result = self.call('/health', method='GET')
        self.assertEqual(status, 200)
        self.assertTrue(result['ready'])
        self.assertEqual(self.call('/unknown', method='GET')[0], 404)

    def test_malformed_empty_and_wrong_type(self):
        self.assertEqual(self.call('/password', raw='{')[0], 400)
        self.assertEqual(self.call('/password', raw='')[0], 400)
        self.assertEqual(self.call('/password', raw='[]')[0], 400)
        self.assertEqual(self.call('/password', content_type='text/plain')[0], 415)
        self.assertEqual(self.call('/password', {'email':[], 'password':None})[0], 401)

    def test_auth_consent_invalid_image(self):
        self.assertEqual(self.call('/enroll', {'image':self.image(), 'consent':True})[0], 401)
        token=self.login()
        self.assertEqual(self.call('/enroll', {'image':self.image()}, token)[0], 403)
        for image in ('not-base64!', '', self.image(b'bad-photo')):
            self.assertEqual(self.call('/enroll', {'image':image, 'consent':True}, token)[0], 422)

    def test_successful_enroll_login_and_replay(self):
        token=self.login()
        status, result=self.call('/enroll', {'image':self.image(), 'consent':True}, token)
        self.assertEqual(status,200)
        self.assertTrue(result['enrolled'])
        status, existing = self.call('/enroll', {'image':self.image(b'spoof'), 'consent':True}, token)
        self.assertEqual(status, 409)
        self.assertEqual(existing['code'], 'already_enrolled')
        self.assertEqual(existing['error'], 'Your face is already registered. You can now use Face Login.')
        self.assertEqual(self.call('/enrollment-status')[0], 401)
        status, enrollment = self.call('/enrollment-status', token=token)
        self.assertEqual(status, 200)
        self.assertTrue(enrollment['enrolled'])
        self.assertNotIn('template', enrollment)
        challenge=self.call('/challenge')[1]['challenge']
        status,session=self.call('/face-login',{'challenge':challenge,'image':self.image()})
        self.assertEqual(status,200)
        self.assertEqual(self.call('/me',token=session['token'])[0],200)
        self.assertEqual(self.call('/face-login',{'challenge':challenge,'image':self.image()})[0],401)

    def test_logout_then_face_login_preserves_identity(self):
        token = self.login()
        enrolled = self.call('/enroll', {'image': self.image(), 'consent': True}, token)[1]
        self.assertEqual(self.call('/logout', token=token)[0], 200)
        self.assertEqual(self.call('/me', token=token)[0], 401)
        challenge = self.call('/challenge')[1]['challenge']
        status, session = self.call('/face-login', {'image': self.image(), 'challenge': challenge})
        self.assertEqual(status, 200)
        self.assertEqual(session['user'], enrolled['user'])
        self.assertEqual(session['user']['role'], 'botanist')
        self.assertNotEqual(session['token'], token)
        self.assertEqual(self.call('/me', token=session['token'])[1]['user'], enrolled['user'])

    def test_failure_survival_and_error_redaction(self):
        token=self.login()
        status,result=self.call('/enroll', {'image':self.image(b'crash'),'consent':True},token)
        self.assertEqual(status,503)
        self.assertNotIn('internal-secret',json.dumps(result))
        self.assertIn('requestId',result)
        self.assertEqual(self.call('/health',method='GET')[0],200)
        self.assertEqual(self.call('/enroll', {'image':self.image(b'spoof'),'consent':True},token)[0],422)

    def test_internal_type_error_is_service_failure_not_invalid_request(self):
        token=self.login()
        status,result=self.call('/enroll',{'image':self.image(b'integration-error'),'consent':True},token)
        self.assertEqual(status,503)
        self.assertNotIn('controlled integration defect',json.dumps(result))
        self.assertEqual(self.call('/health',method='GET')[0],200)

    def test_processing_timeout_returns_json_and_server_survives(self):
        token=self.login()
        status,result=self.call('/enroll', {'image':self.image(b'timeout'),'consent':True},token)
        self.assertEqual(status,408)
        self.assertEqual(result['code'],'upload_timeout')
        self.assertEqual(self.call('/health',method='GET')[0],200)

    def test_oversized_upload_rejected_before_processing(self):
        # Send headers first: server rejects oversized uploads without receiving the body.
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.putrequest('POST', '/enroll')
            connection.putheader('Content-Type', 'application/json')
            connection.putheader('Content-Length', '3000001')
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status,413)
            self.assertIn('too large', json.loads(response.read())['error'])
        finally: connection.close()

    def test_unknown_face_and_invalid_session(self):
        token=self.login()
        self.call('/enroll', {'image':self.image(),'consent':True},token)
        challenge=self.call('/challenge')[1]['challenge']
        status, rejected = self.call('/face-login', {'image':self.image(b'other'),'challenge':challenge})
        self.assertEqual(status, 401)
        self.assertEqual(rejected['code'], 'face_not_matched')
        self.assertEqual(self.call('/me',token='forged')[0],401)

if __name__ == '__main__': unittest.main()
