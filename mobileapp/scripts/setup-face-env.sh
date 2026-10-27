#!/usr/bin/env bash
# Persistent Python 3.11, existing package/template preservation, no system sudo.
set -euo pipefail
cd "$(dirname "$0")/../.."
FACE_SETUP_ROOT="$PWD"
if ! compgen -G "$FACE_SETUP_ROOT/.local-runtimes/cpython-3.11*/bin/python3.11" >/dev/null; then
  python3 -m pip install --target "$FACE_SETUP_ROOT/.local-tools" uv==0.13.5
  UV_PYTHON_INSTALL_DIR="$FACE_SETUP_ROOT/.local-runtimes" "$FACE_SETUP_ROOT/.local-tools/bin/uv" python install 3.11
fi
FACE_SETUP_PYTHON=$(find "$FACE_SETUP_ROOT/.local-runtimes" -path '*/bin/python3.11' -type f -print -quit)
if [ -z "$FACE_SETUP_PYTHON" ]; then echo 'Python 3.11 installation failed.' >&2; exit 1; fi
FACE_SETUP_VENV="$FACE_SETUP_ROOT/mobileapp/face_backend/.venv"
if [ ! -d "$FACE_SETUP_VENV" ]; then
  "$FACE_SETUP_PYTHON" -m venv "$FACE_SETUP_VENV"
elif [ ! -x "$FACE_SETUP_VENV/bin/python" ]; then
  "$FACE_SETUP_PYTHON" - "$FACE_SETUP_VENV" <<'PY'
import sys,re,time
from pathlib import Path
venv=Path(sys.argv[1]);link=venv/'bin/python';cfg=venv/'pyvenv.cfg'
if not link.is_symlink() or not cfg.is_file():raise SystemExit('Unrecognized environment; preserve it and inspect manually.')
backup=cfg.with_name('pyvenv.cfg.before-repair-'+str(int(time.time())))
backup.write_text(cfg.read_text())
link.unlink();link.symlink_to(sys.executable)
s=re.sub(r'^home = .*$', 'home = '+str(Path(sys.executable).parent),cfg.read_text(),flags=re.M)
s=re.sub(r'^executable = .*$', 'executable = '+sys.executable,s,flags=re.M)
cfg.write_text(s)
PY
fi
"$FACE_SETUP_VENV/bin/python" "$FACE_SETUP_ROOT/mobileapp/face_backend/setup.py"
"$FACE_SETUP_VENV/bin/python" "$FACE_SETUP_ROOT/mobileapp/face_backend/server.py" --check-models
