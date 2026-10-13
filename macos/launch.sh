#!/bin/bash
# macOS version of desktop/launch_signed.pyw: opens WeBot Studio, Stream House or WeBot (Jarvis) as its own
# app window. Starts the app's Node server if it isn't running, opens it in a Chrome (or Edge) app window with
# its own profile, and stops the server again when you quit that window (Cmd+Q).
#   bash macos/launch.sh studio|house|jarvis        (the .app launchers made by setup-mac.sh run this)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # apps started from Finder get a bare PATH
WHICH="${1:-studio}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$WHICH" in
  studio) PORT=7777; SERVER="studio/server.js";  SIZE="1560,980" ;;
  house)  PORT=7788; SERVER="house/server.js";   SIZE="1680,1000" ;;
  jarvis) PORT=7790; SERVER="jarvis/server.cjs"; SIZE="470,720" ;;
  *) echo "usage: launch.sh studio|house|jarvis"; exit 1 ;;
esac
DATA="$HOME/Library/Application Support/WeatherPower/launcher"
mkdir -p "$DATA"
LOG="$DATA/$WHICH.log"
URL="http://127.0.0.1:$PORT/"

port_open() { nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; }

SERVER_PID=""
if ! port_open; then
  echo "--- $(date) starting $SERVER" >>"$LOG"
  (cd "$ROOT" && exec node "$SERVER") >>"$LOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do port_open && break; sleep 0.5; done
fi

BROWSER=""
for b in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  [ -x "$b" ] && BROWSER="$b" && break
done
if [ -z "$BROWSER" ]; then
  # No Chrome/Edge: a normal Safari tab still works (Jarvis's speech recognition wants Chrome or Edge).
  open "$URL"
  exit 0
fi

PROFILE="$DATA/browser-$WHICH"
"$BROWSER" --app="$URL" --user-data-dir="$PROFILE" --window-size="$SIZE" --no-first-run --no-default-browser-check >/dev/null 2>&1 &
# On a Mac the browser keeps running after its window closes, until you quit it (Cmd+Q). Stop the server then.
sleep 5
while pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; do sleep 3; done
[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
exit 0
