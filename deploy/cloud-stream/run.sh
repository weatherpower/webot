#!/usr/bin/env bash
# WeatherPower Live on a cloud server, no OBS: a virtual screen (Xvfb) and sound card (PulseAudio), the
# WeatherPower server, Chrome showing the stream page full screen, and ffmpeg sending it to YouTube.
# Each piece restarts by itself if it stops. Settings come from the environment (see CLOUD_STREAM.md).
set -u
cd "$(dirname "$0")/../.."

WIDTH="${STREAM_WIDTH:-1920}"
HEIGHT="${STREAM_HEIGHT:-1080}"
FPS="${STREAM_FPS:-30}"
VIDEO_BITRATE="${STREAM_BITRATE:-6000k}"
PRESET="${STREAM_PRESET:-veryfast}"
AUDIO_BITRATE="${STREAM_AUDIO_BITRATE:-160k}"
RTMP_URL="${STREAM_RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}"
PORT="${PORT:-8899}"
PAGE="http://127.0.0.1:${PORT}/warningcenter/live${STREAM_PAGE_QUERY:+?${STREAM_PAGE_QUERY}}"
# STREAM_OUTPUT overrides the destination (a file such as /app/data/test.flv for a dry run).
if [ -n "${STREAM_OUTPUT:-}" ]; then
  OUTPUT="$STREAM_OUTPUT"
elif [ -n "${YOUTUBE_STREAM_KEY:-}" ]; then
  OUTPUT="${RTMP_URL}/${YOUTUBE_STREAM_KEY}"
else
  echo "[stream] Set YOUTUBE_STREAM_KEY (or STREAM_OUTPUT for a test run) and start again." >&2
  exit 1
fi

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
pids=()
cleanup() { log "stopping"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; exit 0; }
trap cleanup INT TERM

# 1. Virtual screen and sound card.
export DISPLAY=:99
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp -ac &
pids+=($!)
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --log-target=stderr >/dev/null 2>&1
for _ in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.5; done
pactl load-module module-null-sink sink_name=stream sink_properties=device.description=stream >/dev/null
pactl set-default-sink stream

# 2. The WeatherPower server (safe mode: never posts to Discord or X). Loopback-only trust: on a cloud
# server nothing outside this machine counts as the "home network".
export HOST="${HOST:-0.0.0.0}" PORT LIVE_TRUST_LAN=false SHORTS_ENABLED="${SHORTS_ENABLED:-false}" SHORTS_AUTO_ENABLED="${SHORTS_AUTO_ENABLED:-false}"
export AUTO_RENDER_ENABLED="${AUTO_RENDER_ENABLED:-true}"
(while true; do bash scripts/dev-safe.sh; log "server stopped (exit $?), restarting in 5 s"; sleep 5; done) &
pids+=($!)
for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:${PORT}/warningcenter/api/v3/live" >/dev/null && break; sleep 1; done
log "server is up"

# 3. Chrome, full screen on the virtual screen. Software WebGL (SwiftShader) draws the map without a GPU.
CHROME="${CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium)}"
(while true; do
  rm -rf /tmp/stream-chrome
  "$CHROME" --kiosk --start-fullscreen --window-position=0,0 --window-size="${WIDTH},${HEIGHT}" \
    --no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble \
    --disable-features=Translate,MediaRouter --noerrdialogs --no-sandbox --disable-dev-shm-usage \
    --autoplay-policy=no-user-gesture-required \
    --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
    --user-data-dir=/tmp/stream-chrome "$PAGE" >/dev/null 2>&1
  log "chrome stopped (exit $?), restarting in 3 s"; sleep 3
done) &
pids+=($!)
sleep 12

# 4. ffmpeg: capture the screen and the sound card, encode H.264 + AAC, send to YouTube.
GOP=$((FPS * 2))
(while true; do
  ffmpeg -hide_banner -loglevel warning -nostats \
    -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${WIDTH}x${HEIGHT}" -i :99.0+0,0 \
    -thread_queue_size 1024 -f pulse -ac 2 -i stream.monitor \
    -c:v libx264 -preset "$PRESET" -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$(( ${VIDEO_BITRATE%k} * 2 ))k" \
    -pix_fmt yuv420p -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
    -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 \
    -f flv "$OUTPUT"
  log "ffmpeg stopped (exit $?), restarting in 5 s"; sleep 5
done) &
pids+=($!)
log "streaming ${WIDTH}x${HEIGHT} at ${FPS} fps, ${VIDEO_BITRATE} (${PRESET})"
wait
