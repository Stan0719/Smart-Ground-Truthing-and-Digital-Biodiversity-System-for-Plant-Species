#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
if ! command -v timeout >/dev/null 2>&1; then
  echo 'This time-limited launcher requires Linux timeout. Use start.sh in your own terminal instead.' >&2
  exit 1
fi
# Fixed 30-minute testing window; inherits the host selected by the caller.
exec timeout --signal=TERM --kill-after=10s 30m bash start.sh
