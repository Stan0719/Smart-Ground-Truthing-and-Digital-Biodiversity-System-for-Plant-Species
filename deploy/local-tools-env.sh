# Source in a VS Code bash terminal: source deploy/local-tools-env.sh
NIAH_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$NIAH_PROJECT_ROOT/.local-tools/bin:$PATH"
export TAILSCALE_SOCKET="/tmp/niah-tailscale-$(id -u)/tailscaled.sock"
