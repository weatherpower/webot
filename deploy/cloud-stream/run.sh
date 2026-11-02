#!/usr/bin/env bash
# WeatherPower Live on a cloud server, no OBS: a virtual screen (Xvfb) and sound card (PulseAudio), the
# WeatherPower server, Chrome showing the stream page full screen, and ffmpeg sending it to YouTube.
# Each piece restarts by itself if it stops. Settings come from the environment (see CLOUD_STREAM.md).
set -u
cd "$(dirname "$0")/../.."

# What YouTube gets (STREAM_*) and what Chrome draws (RENDER_*, default the same). Without a graphics card,
# drawing 720p and scaling it up to 1080p is far smoother than drawing 1080p.
OUT_W="${STREAM_WIDTH:-1920}"
OUT_H="${STREAM_HEIGHT:-1080}"
WIDTH="${RENDER_WIDTH:-$OUT_W}"
HEIGHT="${RENDER_HEIGHT:-$OUT_H}"
SCALE=""
[ "${WIDTH}x${HEIGHT}" != "${OUT_W}x${OUT_H}" ] && SCALE="-vf scale=${OUT_W}:${OUT_H}:flags=lanczos"
FPS="${STREAM_FPS:-30}"
VIDEO_BITRATE="${STREAM_BITRATE:-6000k}"
PRESET="${STREAM_PRESET:-veryfast}"
AUDIO_BITRATE="${STREAM_AUDIO_BITRATE:-160k}"
RTMP_URL="${STREAM_RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}"
PORT="${PORT:-8899}"
# lite=1: the page's speed savings for a server without a graphics card.
# STREAM_TZ: the on-screen clock's time zone (servers run on UTC).
PAGE="http://127.0.0.1:${PORT}/warningcenter/live?${STREAM_PAGE_QUERY:-lite=1}&tz=${STREAM_TZ:-America/Chicago}"
# STREAM_OUTPUT overrides the destination (a file such as /app/data/test.flv for a dry run).
if [ -n "${STREAM_OUTPUT:-}" ]; then
  OUTPUT="$STREAM_OUTPUT"
elif [ -n "${YOUTUBE_STREAM_KEY:-}" ]; then
  OUTPUT="${RTMP_URL}/${YOUTUBE_STREAM_KEY}"
else
  if [ "${STREAM_OFF:-false}" != true ]; then
    echo "[stream] Set YOUTUBE_STREAM_KEY (or STREAM_OUTPUT for a test run) and start again." >&2
    exit 1
  fi
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
# Clear PulseAudio files left from a previous run of this container (after a server reboot they made
# PulseAudio refuse to start, and the stream had no sound device: Oct 19 2026 outage).
rm -rf "$XDG_RUNTIME_DIR/pulse" /tmp/pulse-* "${HOME:-/root}"/.config/pulse/*-runtime "${HOME:-/root}"/.config/pulse/*.pid 2>/dev/null || true
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --log-target=stderr >/dev/null 2>&1
for _ in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.5; done
pactl load-module module-null-sink sink_name=stream sink_properties=device.description=stream >/dev/null
pactl set-default-sink stream

# 2. The WeatherPower server (safe mode: never posts to Discord or X). Loopback-only trust: on a cloud
# server nothing outside this machine counts as the "home network".
export HOST="${HOST:-0.0.0.0}" PORT LIVE_TRUST_LAN=false SHORTS_ENABLED="${SHORTS_ENABLED:-false}" SHORTS_AUTO_ENABLED="${SHORTS_AUTO_ENABLED:-false}"
export AUTO_RENDER_ENABLED="${AUTO_RENDER_ENABLED:-true}"
# The stream draws its own warnings: skip the card images (a second headless Chrome that starves the
# stream of CPU, which makes the audio sputter). With the stream off there's room, so cards come back on.
CARDS_DEFAULT=false; [ "${STREAM_OFF:-false}" = true ] && CARDS_DEFAULT=true
export AUTO_RENDER_CARDS="${AUTO_RENDER_CARDS:-$CARDS_DEFAULT}"
(while true; do bash scripts/dev-safe.sh; log "server stopped (exit $?), restarting in 5 s"; sleep 5; done) &
pids+=($!)
for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:${PORT}/warningcenter/api/v3/live" >/dev/null && break; sleep 1; done
log "server is up"

# STREAM_OFF=true in .env: keep the server (Warning Center, Shorts, alerts) but don't draw or send the stream.
if [ "${STREAM_OFF:-false}" = true ]; then
  log "stream is OFF (STREAM_OFF=true): not sending to YouTube"
  wait
  exit 0
fi

# 3. Chrome, full screen on the virtual screen. Software WebGL (SwiftShader) draws the map without a GPU.
CHROME="${CHROME_BIN:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium)}"
# The map needs WebGL (SwiftShader). Compositing stays on the CPU, which only redraws what changed
# (the crawl, WeBot) instead of the whole picture 60 times a second.
CHROME_GL_FLAGS="${CHROME_GL_FLAGS:---disable-gpu-compositing --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist}"
(while true; do
  rm -rf /tmp/stream-chrome
  "$CHROME" --kiosk --start-fullscreen --window-position=0,0 --window-size="${WIDTH},${HEIGHT}" \
    --no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble \
    --disable-features=Translate,MediaRouter --noerrdialogs --no-sandbox --disable-dev-shm-usage \
    --autoplay-policy=no-user-gesture-required --audio-buffer-size=${CHROME_AUDIO_BUFFER:-2048} \
    $CHROME_GL_FLAGS ${CHROME_EXTRA_FLAGS:-} \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
    --user-data-dir=/tmp/stream-chrome "$PAGE" >/dev/null 2>&1
  log "chrome stopped (exit $?), restarting in 3 s"; sleep 3
done) &
pids+=($!)
# Map drawing (SwiftShader, Chrome's GPU process) is the CPU hog. Run it at low priority so the sound
# (Chrome's audio + PulseAudio) and ffmpeg always get the CPU first; the map just slows a little in a pinch.
# Checked every 30 s because Chrome makes new threads (and a new GPU process if it restarts).
(while sleep 30; do
  for c in $(grep -l -a -e "[-]-type=gpu-process" /proc/[0-9]*/cmdline 2>/dev/null); do p=${c%/cmdline}; p=${p#/proc/}
    for t in /proc/$p/task/*; do renice -n "${MAP_NICE:-10}" -p "${t##*/}" >/dev/null 2>&1; done
  done
done) &
pids+=($!)
sleep 12

# 4. ffmpeg: capture the screen and the sound card, encode H.264 + AAC, send to YouTube.
GOP=$((FPS * 2))
(while true; do
  ffmpeg -hide_banner -loglevel warning -nostats \
    -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${WIDTH}x${HEIGHT}" -i :99.0+0,0 \
    -thread_queue_size 4096 -f pulse -fragment_size 8192 -ac 2 -i stream.monitor \
    $SCALE -c:v libx264 -preset "$PRESET" -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$(( ${VIDEO_BITRATE%k} * 2 ))k" \
    -pix_fmt yuv420p -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
    -af aresample=async=1000 -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 \
    -f flv "$OUTPUT"
  log "ffmpeg stopped (exit $?), restarting in 5 s"; sleep 5
done) &
pids+=($!)
log "streaming ${OUT_W}x${OUT_H} (drawn at ${WIDTH}x${HEIGHT}) at ${FPS} fps, ${VIDEO_BITRATE} (${PRESET})"
wait
