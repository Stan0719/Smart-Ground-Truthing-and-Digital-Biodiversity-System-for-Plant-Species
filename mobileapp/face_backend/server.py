import argparse
import os
import faulthandler
import signal
import getpass
import hashlib
import json
import socket
import secrets
import re
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from collections import defaultdict, deque
import time
from core import Auth, AuthError
from image_pipeline import decode_image, represent_oriented, diagnostic, request_reference


def embed(data):
    # Imported only when scanning; never fall back to face detection alone.
    try:
        from deepface import DeepFace
    except (ImportError, ValueError) as error:
        raise RuntimeError('DeepFace dependencies could not load. Install requirements.txt.') from error
    from deepface.modules.exceptions import FaceNotDetected, SpoofDetected
    image = decode_image(data)
    print('DeepFace processing started.', flush=True)
    processing_started = time.monotonic()
    try:
        faces = represent_oriented(image, DeepFace.represent, FaceNotDetected)
    except SpoofDetected:
        diagnostic('verification_rejected', exception='SpoofDetected', detector='opencv')
        print('Face scan rejected: anti_spoofing', flush=True)
        raise AuthError('The anti-spoofing model could not confirm a live person. It can reject real faces too. No face was saved; use password login while we investigate.', 422, 'liveness_rejected') from None
    except FaceNotDetected:
        print('Face scan rejected: no_face_detected', flush=True)
        raise AuthError('No face was detected in the captured photo. Keep your whole face centered and still, then retry.', 422, 'no_face') from None
    except ValueError as error:
        print(f'Face processing failed: {type(error).__name__}', flush=True)
        raise RuntimeError('Face model could not process this capture.') from error
    if len(faces) != 1:
        raise AuthError('Show exactly one face.', 422, 'multiple_faces')
    print(f'DeepFace processing completed: elapsed={time.monotonic()-processing_started:.2f}s', flush=True)
    result = [float(value) for value in faces[0]['embedding']]
    diagnostic('embedding_generated', model='SFace', dimensions=len(result), success=True)
    return result


def create_server(auth, host="127.0.0.1", port=8000, readiness=None):
    readiness = readiness or {"ready": True, "dependencies": "injected-test-matcher"}
    attempts = defaultdict(deque)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log biometric or credential requests.

        def send_json(self, status, result):
            encoded = json.dumps(result).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                print('Client disconnected before response delivery.', flush=True)

        def do_GET(self):
            if self.path not in ('/', '/health'):
                return self.send_json(404, {'error': 'Not found.'})
            current = {**readiness, **getattr(auth, 'health', lambda: {})()}
            self.send_json(200 if current['ready'] else 503, {
                'status': 'running' if current['ready'] else 'unavailable',
                'service': 'Niah local face backend', **current,
            })

        def do_POST(self):
            status = 200
            supplied_reference = self.headers.get('X-Face-Request-ID', '')
            request_id = supplied_reference if re.fullmatch(r'[a-f0-9]{12}', supplied_reference) else secrets.token_hex(6)
            request_reference.set(request_id)
            started = time.monotonic()
            known = {'/health', '/register', '/recovery/request', '/recovery/confirm', '/password', '/change-password', '/enrollment-status', '/enroll', '/legacy-link', '/legacy-reenroll', '/challenge', '/face-login', '/me', '/delete-face', '/logout'}
            endpoint = self.path if self.path in known else 'unknown'
            print(f'Face API {request_id}: incoming POST endpoint={endpoint}', flush=True)
            try:
                ip = self.client_address[0]
                now = time.time()
                queue = attempts[ip]
                while queue and queue[0] < now-60:
                    queue.popleft()
                if len(queue) >= 15:
                    return self.send_json(429, {'error': 'Too many attempts. Wait one minute.', 'code': 'rate_limited'})
                queue.append(now)
                length = int(self.headers.get('Content-Length', '0'))
                if self.headers.get('Transfer-Encoding'):
                    return self.send_json(400, {'error': 'Transfer encoding is unsupported. Send a JSON body with Content-Length.'})
                if length > 3000000:
                    return self.send_json(413, {'error': 'Photo is too large. Retake it at a lower resolution.'})
                if length <= 0:
                    return self.send_json(400, {'error': 'A JSON request body is required.'})
                if self.headers.get_content_type() != 'application/json':
                    return self.send_json(415, {'error': 'Send application/json.'})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self.send_json(400, {'error': 'Upload was incomplete. Please retry.'})
                body = json.loads(raw)
                if not isinstance(body, dict):
                    raise AuthError('A JSON object is required.', 400, 'invalid_request')
                token = self.headers.get('Authorization', '').removeprefix('Bearer ')
                if self.path == '/register':
                    if not all(isinstance(body.get(field),str) for field in ('name','email','password')):
                        raise AuthError('Invalid registration request.',400,'invalid_request')
                    if not hasattr(auth,'register'): raise AuthError('Authoritative registration is not configured.',503,'account_service_unavailable')
                    result=auth.register(body['name'],body['email'],body['password'])
                elif self.path in ('/recovery/request','/recovery/confirm'):
                    if not hasattr(auth,'authority'): raise AuthError('Authoritative recovery is not configured.',503,'recovery_unavailable')
                    result=auth.authority.request('recovery-request' if self.path.endswith('/request') else 'recovery-confirm',body)
                elif self.path == '/password':
                    if not isinstance(body.get('email'), str) or not isinstance(body.get('password'), str) or len(body['password']) > 1024 or len(body['email']) > 254:
                        raise AuthError('Invalid credentials.')
                    result = auth.password_login(body['email'], body['password'])
                elif self.path == '/change-password':
                    if not hasattr(auth, 'authority'): raise AuthError('Authoritative account service is required.',503,'account_service_unavailable')
                    result = auth.authority.request('change-password', {'token':token, 'password':body.get('password')})
                elif self.path == '/enrollment-status':
                    result = auth.enrollment_status(token)
                elif self.path == '/enroll':
                    if body.get('consent') is not True:
                        raise AuthError('Consent is required.', 403, 'consent_required')
                    result = auth.enroll(token, body.get('image'))
                elif self.path in ('/legacy-link','/legacy-reenroll'):
                    if not hasattr(auth,'recover_legacy'):
                        raise AuthError('Authoritative account service is required.',503,'account_service_unavailable')
                    for field in ('realPassword','legacyEmail','legacyPassword'):
                        if not isinstance(body.get(field),str) or not body[field] or len(body[field])>1024:
                            raise AuthError('Both account passwords are required.',400,'invalid_request')
                    if self.path == '/legacy-reenroll' and not isinstance(body.get('image'),str):
                        raise AuthError('A new live capture is required.',422,'invalid_image')
                    result = auth.recover_legacy(token,body['realPassword'],body['legacyEmail'],body['legacyPassword'],body.get('consent'),body.get('image') if self.path == '/legacy-reenroll' else None)
                elif self.path == '/challenge':
                    result = auth.challenge()
                elif self.path == '/face-login':
                    if not isinstance(body.get('challenge'), str) or len(body['challenge']) != 64:
                        raise AuthError('Invalid face attempt.')
                    result = auth.face_login(body['challenge'], body.get('image'))
                elif self.path == '/me':
                    result = dict(user=auth.session(token))
                    diagnostic('session_verified', success=True)
                elif self.path == '/delete-face':
                    result = auth.delete_face(token)
                elif self.path == '/logout':
                    result = auth.logout(token)
                else:
                    status, result = 404, dict(error='Not found.')
            except AuthError as error:
                diagnostic("request_rejected", endpoint=endpoint, code=error.code)
                status, result = error.status, dict(error=str(error), code=error.code)
            except socket.timeout:
                status, result = 408, dict(error="Upload timed out. Please retry.", code="upload_timeout")
            except ValueError:
                status, result = 400, dict(error='Invalid request. Please try again.')
            except Exception as error:
                import traceback
                code = type(error).__name__
                # Stack locations only: never print request bodies, credentials or images.
                print(f'Backend operation failed: {code}', flush=True)
                for frame in traceback.extract_tb(error.__traceback__):
                    print(f'  {Path(frame.filename).name}:{frame.lineno} in {frame.name}', flush=True)
                status, result = 503, dict(error=f'Face service unavailable ({code}). Restart the Python backend using its .venv and retry.')
            result['requestId'] = request_id
            # No request values or exception messages: they may include biometric data.
            print(f'Face API {request_id}: status={status} elapsed={time.monotonic()-started:.2f}s', flush=True)
            self.send_json(status, result)

    class FaceServer(HTTPServer):
        allow_reuse_address = True
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(30)
            return connection, address
    return FaceServer((host, port), Handler)

def initialize_models():
    # Fail early in the terminal instead of making every camera request fail.
    try:
        import cv2
        from deepface import DeepFace
        cascade = Path(cv2.data.haarcascades) / 'haarcascade_frontalface_default.xml'
        if not cascade.is_file():
            raise RuntimeError('Missing OpenCV face detector. Run setup.py with the virtual environment.')
        DeepFace.build_model('SFace')
        from spoof_diagnostics import instrument_spoof_model
        instrument_spoof_model(DeepFace.build_model('Fasnet', task='spoofing'))
        DeepFace.build_model('opencv', task='face_detector')
    except Exception as error:
        print(f'Face backend startup failed: {type(error).__name__}: {error}', flush=True)
        raise SystemExit(1)
    return {"ready": True, "dependencies": "loaded", "models": ["SFace", "Fasnet", "opencv"]}

if __name__ == '__main__':
    faulthandler.enable()
    def stop_server(signum, _frame):
        print(f'Backend shutdown requested: signal={signum}', flush=True)
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop_server)
    parser = argparse.ArgumentParser()
    parser.add_argument('--create-user', action='store_true')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--check-models', action='store_true')
    parser.add_argument('--check-storage', action='store_true')
    args = parser.parse_args()
    if args.check_models:
        print(json.dumps(initialize_models()))
        raise SystemExit(0)
    from postgres_store import load_face_environment, connect_face_store
    load_face_environment()
    try:
        store = connect_face_store()
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from None
    if args.check_storage:
        print(json.dumps({'ready': True, 'storage': 'postgresql', 'schema': store.schema}))
        store.close()
        raise SystemExit(0)
    auth = Auth(None, embed, database=store)
    if args.create_user:
        auth.provision(input('Email: '), getpass.getpass('Password (12+ characters): '), input('Name: '), input('Role (botanist/visitor): '))
        print('Local server account created. Use these credentials in the app.')
        raise SystemExit
    print(f'Face storage: PostgreSQL private schema {store.schema}', flush=True)
    print('Initializing face models; HTTP service will listen only after readiness succeeds.', flush=True)
    readiness = initialize_models()
    readiness['storage'] = 'postgresql'
    service_url = os.environ.get('FACE_ACCOUNT_SERVICE_URL')
    key_file = os.environ.get('FACE_ACCOUNT_SERVICE_KEY_FILE')
    if bool(service_url) != bool(key_file):
        raise SystemExit('Configure both FACE_ACCOUNT_SERVICE_URL and FACE_ACCOUNT_SERVICE_KEY_FILE; refusing partial account integration.')
    if service_url:
        from account_service import AccountService
        from authoritative_auth import AuthoritativeFaceAuth
        auth = AuthoritativeFaceAuth(auth, AccountService(service_url, key_file))
        readiness['accountService'] = 'authoritative'
    else:
        if os.environ.get('ALLOW_PROTOTYPE_AUTH') != '1':
            raise SystemExit('Configure authoritative account service. Local prototype mode requires explicit ALLOW_PROTOTYPE_AUTH=1.')
        readiness['accountService'] = 'prototype'
    print('Account service mode: '+readiness['accountService'], flush=True)
    server = create_server(auth, args.host, args.port, readiness)
    print(f"Face authentication backend listening on {args.host}:{args.port}. Keep this terminal running.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Face backend stopped.", flush=True)
    finally:
        server.server_close()
        auth.db.close()
