#!/usr/bin/env bash
# Explicit real-account mode, separate from the existing prototype helper.
set -eu
cd "$(dirname "$0")/.."
FACE_WORKSPACE="$PWD"
export FACE_SERVICE_PORT="${FACE_SERVICE_PORT:-3002}"
export FACE_ACCOUNT_SERVICE_URL="http://127.0.0.1:$FACE_SERVICE_PORT"
export FACE_ACCOUNT_SERVICE_KEY_FILE="$FACE_WORKSPACE/face_backend/data/account-service.key"
FACE_RUNTIME="$FACE_WORKSPACE/face_backend/.venv/bin/python"
if [ ! -x "$FACE_RUNTIME" ]; then echo 'Restore the Python 3.11 environment first.' >&2; exit 1; fi
"$FACE_RUNTIME" - <<'PY'
import os,secrets
from pathlib import Path
p=Path(os.environ['FACE_ACCOUNT_SERVICE_KEY_FILE'])
p.parent.mkdir(exist_ok=True)
try:
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
except FileExistsError:
    if p.stat().st_mode & 0o077: raise SystemExit('Existing service key must have permissions 600.')
else:
    with os.fdopen(fd,'wb') as f: f.write(secrets.token_bytes(32))
PY
# Refuse to replace or silently reuse an existing face service/prototype.
"$FACE_RUNTIME" - <<'PY'
import socket,os
for port in (8000,int(os.environ.get('FACE_SERVICE_PORT','3002'))):
    s=socket.socket();busy=s.connect_ex(('127.0.0.1',port))==0;s.close()
    if busy: raise SystemExit(f'Port {port} is in use. Stop the previous face/account service before starting another instance.')
PY
FACE_REAL_PID=''
cleanup() { if [ -n "$FACE_REAL_PID" ]; then kill "$FACE_REAL_PID" 2>/dev/null || true; wait "$FACE_REAL_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
HOST=127.0.0.1 PORT="$FACE_SERVICE_PORT" AUTH_DB="$FACE_WORKSPACE/../web/server/data/auth.sqlite" node "$FACE_WORKSPACE/../web/server/index.mjs" &
FACE_REAL_PID=$!
"$FACE_RUNTIME" - <<'PY'
import os,sys,time
sys.path.insert(0,'face_backend')
from account_service import AccountService
client=AccountService(os.environ['FACE_ACCOUNT_SERVICE_URL'],os.environ['FACE_ACCOUNT_SERVICE_KEY_FILE'])
for _ in range(20):
    try:
        if client.request('health',{}).get('accountService')=='niah-web-auth': break
    except Exception: time.sleep(.5)
else: raise SystemExit('The real account service did not start. Inspect its terminal errors.')
print('Real account service verified; existing account restrictions remain enforced.',flush=True)
PY
if [ "${1:-}" = "--backend-only" ]; then
  FACE_IMAGE_DEBUG="${FACE_IMAGE_DEBUG:-0}" FACE_BIND_HOST="${FACE_BIND_HOST:-127.0.0.1}" bash face_backend/start.sh
else
  npm run start:face "$@"
fi
