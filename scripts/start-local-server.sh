#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p data

PID_FILE="data/server.pid"
LOG_FILE="data/server.log"
PORT_VALUE="${PORT:-$(node -e "import('./src/config.js').then(({ config }) => console.log(config.port))")}"
LABEL="com.weatherpower.warning-card-service"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node)"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "Warning card service is already running on PID $PID."
    echo "Log: $ROOT_DIR/$LOG_FILE"
    exit 0
  fi
fi

EXISTING_PID="$(lsof -tiTCP:"$PORT_VALUE" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ -n "$EXISTING_PID" ]]; then
  echo "Port $PORT_VALUE is already in use by PID $EXISTING_PID."
  echo "$EXISTING_PID" > "$PID_FILE"
  exit 0
fi

echo "Starting warning card service on port $PORT_VALUE..."
if command -v launchctl >/dev/null 2>&1 && [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/$LOG_FILE</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$PLIST"
  launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
else
  nohup node src/server.js >> "$LOG_FILE" 2>&1 &
fi

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:$PORT_VALUE/api/health" >/dev/null 2>&1; then
    PID="$(lsof -tiTCP:"$PORT_VALUE" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    echo "${PID:-}" > "$PID_FILE"
    echo "Warning card service started on PID $PID."
    echo "Log: $ROOT_DIR/$LOG_FILE"
    exit 0
  fi
  sleep 0.25
done

echo "Service process started, but health did not respond yet."
echo "Last log lines:"
tail -n 40 "$LOG_FILE" || true
exit 1
