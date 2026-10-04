# WeatherPower Live: guide for an AI helper

Read this first. It explains what this project is, where it runs, and how to change it safely.

## What it is
- **WeatherPower Live** is a 24/7 YouTube weather stream hosted by **WeBot**, a sassy Southern AI robot
  (voice via Puter / OpenAI "alloy"). A Node server (`src/`) gathers NWS alerts, radar, models, gas prices,
  and YouTube chat; a browser page (`public/live.html`, ~3,400 lines, built at 1920×1080) draws the show.
- On the cloud server, a Docker container runs: Xvfb (virtual screen) → Chrome kiosk showing `live.html`
  (map drawn by SwiftShader, no GPU) → PulseAudio → ffmpeg → YouTube RTMP. See `deploy/cloud-stream/run.sh`.

## Where things live
| Path | What |
|---|---|
| `src/server.js` | Express app (port 8899 = Live Control, 8080 → host 80 = public status page) |
| `src/apiV3.js` | Most API routes (`/warningcenter/api/v3/...`) |
| `src/live.js` | Live Control state + `applyLiveCommand` actions (say, reload, chat-say, chat-show, brain…) |
| `src/youtubeChat.js` | Reads YouTube chat (API key, quota-limited), `!forecast` `!gas` `!roast me`, chat filter |
| `src/personality.js` | WeBot's hand-written Southern replies (no AI text on stream → can't cuss) |
| `src/brain.js` | Editable settings (segments, lines, chat limits, personality, radio) saved in `data/webot-brain.json` |
| `public/live.html` | The stream page (map, bars, cards, chat box, WeBot, radio, voice) |
| `public/livecontrol.html` | Live Control page (needs the controller token) |
| `public/webot.html` | Public status page |
| `deploy/cloud-stream/` | `run.sh` (stream), `notify.cjs` + `notify-cron.sh` (ntfy phone alerts), `snapshot.cjs` |
| `studio/` | **WeBot Studio**: local control-room app (port 7777) that manages the server over SSH |
| `house/` | **WeatherPower Stream House**: warning-map + OBS overlay app for the owner's own streams (port 7788) |
| `desktop/` | Electron shell that runs Studio and Stream House as Windows .exe programs (`npm run build`) |

## Newer features (Oct 2026)
- Chat: WeBot answers any chat (3 per check, 15/hour, 1/min per viewer), `!forecast`, `!gas`, `!roast me`, and welcomes back regulars (`data/regulars.json`).
- Segments: Rain outlook (WPC Excessive Rainfall, `src/wpcOutlook.js`), Train Cam (SouthWest RailCams, `src/trainCams.js`; off because YouTube embeds ask the server to sign in).
- Map moves fade instead of zooming (CPU-drawn map). Studio and Live Control show viewers, total views and live time.
- Every commit auto-pushes to GitHub (`.git/hooks/post-commit`).

## The cloud server
- Contabo VPS, Ubuntu 24.04, 6 cores / 12 GB. `ssh -p 22022 root@207.244.248.128`. App in `/opt/weatherpower`.
- Secrets live only in `/opt/weatherpower/.env` on the server (YouTube stream key + API key, controller token,
  ntfy topic). **Never commit `.env` or print secrets.**
- Port 8899 (Live Control) is firewalled to the owner's home IP (`/usr/local/sbin/wp-firewall.sh`,
  `allowed-ips.txt`). Port 80 is the public status page.
- Stream settings in `.env`: 1080p output (`STREAM_WIDTH/HEIGHT`), drawn at 720p (`RENDER_WIDTH/HEIGHT`),
  `STREAM_PRESET=veryfast`, `STREAM_CPUS=5.5`. **The owner wants 1080p kept.** The map is CPU-drawn, so heavy
  map work causes lag and audio dropouts; map moves use a fade instead of zooming.

## How to deploy a change
1. Edit locally, check syntax (`node --check file.js`; for `.html`, check the inline scripts).
2. Copy changed files: `scp -P 22022 <file> root@207.244.248.128:/opt/weatherpower/<file>`
3. Server code (`src/`, `deploy/`): `ssh -p 22022 root@207.244.248.128 "cd /opt/weatherpower && docker compose build -q && docker compose up -d"`
   (the YouTube stream drops for ~1 minute).
4. Page-only change (`public/live.html`): `docker compose cp public/live.html stream:/app/public/live.html`,
   then Live Control action `reload`; rebuild the image later so it sticks.
5. `git rev-parse --short HEAD > /opt/weatherpower/.deployed-commit` on the server (Studio shows it).

## Rules the owner cares about
- WeBot's voice is sassy-Southern but **never cusses**; roast what people say, never who they are.
- Cameras stay off the stream (`CAMERA_ON_AIR=false`) until permission is granted.
- Keep the stream at 1080p; ask before trade-offs that restart the stream or lower quality.
- Test on a local copy first (`PORT=8898 ... bash scripts/dev-safe.sh`), never with real credentials.
