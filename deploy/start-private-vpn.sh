#!/usr/bin/env bash
# Local daemon only. Does not authenticate/enroll, enable Serve, or enable Funnel.
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local-tools/tailscale
chmod 700 .local-tools/tailscale
NIAH_VPN_RUNTIME="/tmp/niah-tailscale-$(id -u)"
if [ -L "$NIAH_VPN_RUNTIME" ]; then echo 'Refusing a symlink runtime directory.' >&2; exit 1; fi
mkdir -p "$NIAH_VPN_RUNTIME"
if [ "$(stat -c %u "$NIAH_VPN_RUNTIME")" != "$(id -u)" ]; then echo 'Runtime directory belongs to another user.' >&2; exit 1; fi
chmod 700 "$NIAH_VPN_RUNTIME"
if [ -S "$NIAH_VPN_RUNTIME/tailscaled.sock" ]; then
  echo 'A private Tailscale socket already exists. Inspect its status; do not start a duplicate daemon.' >&2
  exit 1
fi
exec "$PWD/.local-tools/bin/tailscaled" --tun=userspace-networking --state="$PWD/.local-tools/tailscale/state" --statedir="$PWD/.local-tools/tailscale" --socket="$NIAH_VPN_RUNTIME/tailscaled.sock" --socks5-server=127.0.0.1:1055 --no-logs-no-support
