#!/usr/bin/env bash
# Keep both services attached to YOUR terminal; never daemonize or change port visibility.
set -eu
cd "$(dirname "$0")/.."
FACE_PYTHON="$PWD/face_backend/.venv/bin/python"
if [ ! -x "$FACE_PYTHON" ]; then
  echo 'Create face_backend/.venv with Python 3.11 and run python setup.py first.' >&2
  exit 1
fi
FACE_BACKEND_PID=''
FACE_EXPO_PID=''
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$FACE_EXPO_PID" ]; then kill "$FACE_EXPO_PID" 2>/dev/null || true; fi
  if [ -n "$FACE_BACKEND_PID" ]; then
    kill "$FACE_BACKEND_PID" 2>/dev/null || true
    wait "$FACE_BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Reuse only a compatible existing local backend; never silently kill another process.
if "$FACE_PYTHON" -c 'import socket; s=socket.socket(); s.settimeout(1); code=s.connect_ex(("127.0.0.1",8000));s.close();raise SystemExit(code!=0)' 2>/dev/null; then
  echo 'Port 8000 already has a listener; checking its readiness.'
else
  FACE_IMAGE_DEBUG=1 FACE_BIND_HOST=0.0.0.0 bash face_backend/start.sh &
  FACE_BACKEND_PID=$!
fi
"$FACE_PYTHON" - <<'PY'
import json,time,urllib.request
for attempt in range(90):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2) as response:
            body=json.load(response)
        if body.get('service')!='Niah local face backend':
            raise SystemExit('Port 8000 belongs to another service. Stop it or fix the port before starting.')
        if body.get('ready') is True:
            print('Face backend ready on port 8000.',flush=True)
            break
    except (OSError,ValueError):
        time.sleep(1)
else:
    raise SystemExit('Backend did not become ready. Inspect its startup errors above; Expo was not started.')
PY
# Stop Expo if a backend we own exits. Existing independent backends remain user-managed.
EXPO_TUNNEL_SUBDOMAIN=true npx expo start --tunnel "$@" &
FACE_EXPO_PID=$!
while kill -0 "$FACE_EXPO_PID" 2>/dev/null; do
  if [ -n "$FACE_BACKEND_PID" ] && ! kill -0 "$FACE_BACKEND_PID" 2>/dev/null; then
    echo 'Face backend stopped. Stopping Expo; inspect backend exit logs above.' >&2
    exit 1
  fi
  sleep 1
done
wait "$FACE_EXPO_PID"
