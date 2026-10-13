#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo 'Missing .venv. Create a Python 3.11 environment and run python setup.py first.' >&2
  exit 1
fi
# Foreground by design: no hidden public background service.
exec .venv/bin/python -u run_backend.py --host "${FACE_BIND_HOST:-127.0.0.1}" --port "${FACE_PORT:-8000}"
