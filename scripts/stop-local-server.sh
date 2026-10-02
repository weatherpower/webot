#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="data/server.pid"
PORT_VALUE="${PORT:-$(node -e "import('./src/config.js').then(({ config }) => console.log(config.port))")}"
LABEL="com.weatherpower.warning-card-service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PID=""

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

if [[ -z "${PID:-}" ]] || ! kill -0 "$PID" 2>/dev/null; then
  PID="$(lsof -tiTCP:"$PORT_VALUE" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
fi

if command -v launchctl >/dev/null 2>&1 && [[ "$(uname -s)" == "Darwin" && -f "$PLIST" ]]; then
  launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
fi

if [[ -z "${PID:-}" ]]; then
  rm -f "$PID_FILE"
  pkill -f "$ROOT_DIR/src/renderWorker.js" 2>/dev/null || true
  echo "Warning card service is not running."
  exit 0
fi

echo "Stopping warning card service PID $PID..."
kill "$PID" 2>/dev/null || true

for _ in {1..20}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    pkill -f "$ROOT_DIR/src/renderWorker.js" 2>/dev/null || true
    echo "Stopped."
    exit 0
  fi
  sleep 0.25
done

echo "PID $PID did not stop gracefully; forcing it."
kill -9 "$PID" 2>/dev/null || true
pkill -f "$ROOT_DIR/src/renderWorker.js" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Stopped."
