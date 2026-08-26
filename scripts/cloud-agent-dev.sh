#!/usr/bin/env bash
# Cloud Agent dev entrypoint — prevents stale Vite port drift (5183→5184) that
# causes "504 Outdated Optimizer Dep" / failed dynamic imports in Electron.
set -euo pipefail

export PATH="${HOME}/.bun/bin:${PATH}"
export DISPLAY="${DISPLAY:-:1}"
export ELECTRON_DISABLE_SANDBOX=1
export COZEA_ALLOW_INSECURE_DEVICE_IDENTITY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# A leftover electron-vite holds :5183; a second `bun run dev` silently binds
# :5184 while Electron still references :5183 prebundles.
pkill -f '[e]lectron-vite dev' 2>/dev/null || true
pkill -f '[e]lectron .*/out/main/index.js' 2>/dev/null || true
pkill -f '[e]lectron /workspace/out/main' 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k 5183/tcp 5184/tcp 2>/dev/null || true
fi
sleep 1

exec bun run dev
