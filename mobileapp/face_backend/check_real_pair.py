"""Actual-model HTTP check in an isolated temporary database; never alters app data.
Returns nonzero if the second photo cannot authenticate at the unchanged threshold.
"""
import argparse
import base64
import contextlib
import http.client
import io
import json
import tempfile
import threading
from pathlib import Path
from PIL import Image
from core import Auth
from server import create_server, embed


def run(first, second):
    images = []
    for path in (first, second):
        with Image.open(path) as source:
            photo = source.convert('RGB')
            photo.thumbnail((1600, 1600))
            buffer = io.BytesIO()
            photo.save(buffer, format='JPEG', quality=85)
            images.append(base64.b64encode(buffer.getvalue()).decode())
    ready, state = threading.Event(), {}
    with tempfile.TemporaryDirectory() as directory:
        def serve():
            filename = str(Path(directory) / 'isolated.sqlite')
            auth = Auth(filename, embed)
            auth.provision('fixture@example.invalid', 'isolated-fixture-password', 'Fixture')
            initial = auth.password_login('fixture@example.invalid', 'isolated-fixture-password')
            auth.enroll(initial['token'], images[0])
            auth.db.close()
            auth = Auth(filename, embed)
            state['persisted'] = auth.enrollment_status(initial['token'])['enrolled']
            state['server'] = create_server(auth, port=0)
            ready.set()
            try:
                state['server'].serve_forever()
            finally:
                state['server'].server_close()
                auth.db.close()
        def wrapped():
            try:
                serve()
            except Exception as error:
                state['error'] = type(error).__name__
                ready.set()
        with contextlib.redirect_stdout(io.StringIO()):
            worker = threading.Thread(target=wrapped, daemon=True)
            worker.start()
            if not ready.wait(120):
                raise RuntimeError('Model initialization timed out.')
            if 'error' in state:
                raise RuntimeError('Enrollment failed: '+state['error'])
            def call(path, body=None, token=None, method='POST'):
                connection = http.client.HTTPConnection('127.0.0.1', state['server'].server_port, timeout=60)
                headers = {'Content-Type': 'application/json'}
                if token:
                    headers['Authorization'] = 'Bearer '+token
                connection.request(method, path, json.dumps(body or {}) if method == 'POST' else None, headers)
                response = connection.getresponse()
                result = json.loads(response.read())
                status = response.status
                connection.close()
                return status, result
            outcomes = {'health': call('/health', method='GET')[0] == 200, 'enrollment_persisted': state['persisted']}
            try:
                for label, image in zip(('same_photo', 'second_photo'), images):
                    challenge = call('/challenge')[1]['challenge']
                    status, session = call('/face-login', {'challenge': challenge, 'image': image})
                    outcomes[label] = {'status': status, 'code': session.get('code')}
                    if status == 200:
                        verified, profile = call('/me', token=session['token'])
                        outcomes[label]['session_verified'] = verified == 200 and profile['user']['role'] == 'botanist'
                        call('/logout', token=session['token'])
                        outcomes[label]['logout_revoked'] = call('/me', token=session['token'])[0] == 401
            finally:
                state['server'].shutdown()
                worker.join(10)
        print(json.dumps(outcomes, indent=2))
        return 0 if outcomes['second_photo'].get('session_verified') is True else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first', required=True, type=Path)
    parser.add_argument('--second', required=True, type=Path)
    args = parser.parse_args()
    raise SystemExit(run(args.first, args.second))
