# Warning Card Service

Local backend for rendering MapLibre-based warning cards, posting them to X and Discord, and forwarding the warning payload to `weatherpower.app/warningcenter`.

## Setup

1. Copy `.env.example` to `.env`.
2. Confirm `MAPLIBRE_STYLE_URL` points to the deployed shared WeatherPower style.
3. Fill in `X_API_KEY` and `X_API_SECRET` with your X app credentials.
4. Optional: fill in `DISCORD_WEBHOOK_URL` to post Live Post cards to Discord.
5. Start the controller and click `Connect X`. This uses the API key and secret to start X's 3-legged OAuth flow, then saves the returned user posting token locally in `data/x-oauth.json`.
6. Optional but recommended on your LAN: set `CONTROLLER_TOKEN`.

```bash
npm install
npm start
```

On this Mac, use the local keep-alive launcher instead of a foreground terminal when you want the service to stay online:

```bash
npm run start:local
npm run stop:local
```

`start:local` installs/runs a macOS LaunchAgent with KeepAlive and writes logs to `data/server.log`.

Open the controller from this machine at:

```text
http://localhost:8787/controller
```

If `8787` is already occupied, run on another port:

```bash
PORT=8877 PUBLIC_BASE_URL=http://localhost:8877 npm start
```

From your main PC, use this computer's LAN IP:

```text
http://YOUR-LAN-IP:8787/controller
```

Use the same port you started the service with, for example `http://YOUR-LAN-IP:8877/controller` when using the fallback command above.

Open the auto-rendered warning center at:

```text
http://YOUR-LAN-IP:8877/warningcenter
```

Open the full operations dashboard at:

```text
http://YOUR-LAN-IP:8877/dashboard
```

Open the integrated WeatherSpace command center at:

```text
http://YOUR-LAN-IP:8877/weatherspace
```

## X Authorization

The local `.env` uses:

```text
PUBLIC_BASE_URL=http://YOUR-LAN-IP:8877
```

In the X developer app settings, add this callback URL before clicking `Connect X`:

```text
http://YOUR-LAN-IP:8877/api/x/auth/callback
```

API key and secret can generate app-only credentials, but app-only authentication is read-only. The Connect X flow turns those app credentials into a user-context access token after the posting account approves the app.

On the X developer app page, go to `Settings` in the upper-right of the app, then open the User authentication / OAuth settings. Enable OAuth 1.0a or 3-legged OAuth, set app permissions to read and write, add the callback URL above, save, then return to this controller and click `Connect X`.

## Live Warnings And Radar

The controller has a `Live NWS Warnings` panel. Pick a state and warning type, click `Fetch Real Warnings`, then click `Use` on the warning you want. The payload editor will fill with real `api.weather.gov` alert data, including the alert polygon and instructions.

Cards now render:

- NEXRAD reflectivity from IEM radar tiles.
- NEXRAD velocity from the nearest available radar site when the warning type benefits from velocity, such as tornado and severe thunderstorm warnings.
- Theme colors by warning/watch type: severe thunderstorm yellow, tornado red, PDS tornado pink, flood/flash flood green, winter blue, fire magenta, and marine purple.
- PDS tornado cards get a `PDS EMERGENCY` tag. Tornado emergency cards render as animated GIFs with a flashing emergency banner. Flood emergency cards get an emergency banner.
- Considerable severe thunderstorm warnings get a `CONSIDERABLE` tag and threat stat. Destructive severe thunderstorm warnings get a `DESTRUCTIVE` tag and threat stat.
- Wind, hail, and motion boxes render when NWS provides those values.
- The WeatherPower logo appears on the left and right of the card header.

## Auto-Rendered Warning Center

The server starts a background renderer automatically. It polls every active NWS watch and warning product, active SPC Mesoscale Discussions, SPC Day 1-8 convective outlook polygons, optional WeatherPower funny products, and optional Firebase/Firestore WeWatches, renders new or changed cards, and serves them to `/warningcenter`. Products without an alert polygon, such as many watches and zone-based fire/marine alerts, are rendered with fallback geometry from their affected NWS zones. SPC Mesoscale Discussions use the NOAA/SPC discussion polygon service and SPC product text for area, concerning, valid time, summary, and peak hazard fields.

Set `PUBLIC_WARNINGCENTER_ONLY=true` for a public path-mounted deployment. In that mode the service exposes only the read-only Warning Center, warning detail pages, card assets, health/map configuration, rendered-warning feeds, and storm reports. Controller, posting, authorization, logs, dashboards, and editing endpoints return `404`.

Set `AUTO_RENDER_LIMIT=0` to render the full active United States feed. Any positive number caps the NWS watch/warning count; active SPC Mesoscale Discussions and SPC outlooks are still added.

The auto-renderer polls no more often than once per minute and renders a bounded number of changed cards per cycle. Recommended settings:

```text
AUTO_RENDER_INTERVAL_MS=60000
AUTO_RENDER_BATCH_SIZE=4
AUTO_RENDER_MAX_PER_CYCLE=8
AUTO_RENDER_BATCH_COOLDOWN_MS=2000
RENDER_WORKER_TIMEOUT_MS=180000
CARD_CLEANUP_ENABLED=false
```

On macOS with Google Chrome installed, set `RENDER_BROWSER_CHANNEL=chrome`. Each batch gets one browser process, and the browser is closed when the batch finishes. Set `CARD_CLEANUP_ENABLED=true` only when automatic deletion of cards older than `CARD_RETENTION_HOURS` is intended.

Optional custom products:

- `FUNNY_WARNINGS_ENABLED=true` adds clearly labeled WeatherPower funny cards from your configured JSON feed. They are not official NWS products and their copy should say to still take real weather seriously.
- `FUNNY_WARNINGS_URL=` can point to custom funny JSON shaped as an array, `{items: []}`, `{warnings: []}`, or keyed objects.
- `FIREBASE_WEWATCHES_URL=` can point to a Firebase Realtime Database REST URL or Firestore REST documents URL. The renderer accepts arrays, keyed objects, `{wewatches: {}}`, `{watches: []}`, or Firestore `documents`.
- Firebase auth can be provided with `FIREBASE_WEWATCHES_AUTH`, `FIREBASE_WEWATCHES_API_KEY`, or `FIREBASE_WEWATCHES_BEARER`.

Optional Discord posting:

- `DISCORD_WEBHOOK_URL=` posts Live Post cards to a Discord webhook when `DISCORD_ENABLED=true`.
- `DISCORD_AUTO_POST_ENABLED=true` also posts newly rendered warning/watch/SPC/mesoscale cards once per product version.
- `DISCORD_AUTO_POST_MAX_PER_REFRESH=1` and `DISCORD_AUTO_POST_MIN_SECONDS=3600` drip-feed auto posts so a burst of warnings does not hit Discord all at once.
- `DISCORD_AUTO_POST_SUPPRESS_BACKFILL=true` prevents a fresh deploy from posting every already-active card on startup.
- Discord payloads attach the rendered PNG/GIF and include a Warning Detail link only when `PUBLIC_BASE_URL` is a public HTTPS URL. Localhost, LAN/private addresses, and unsafe URLs are stripped before Discord receives the payload. `allowed_mentions` is disabled so alert text cannot ping roles or users.

## WeWatch Builder

`GET /controller` includes a WeWatch Builder panel. It lets you create your own WeatherPower watch-style products by:

- Clicking the MapLibre map to draw a highlighted polygon, or using the Idabel starter box.
- Setting watch type, watch level, max wind, max hail, tornado chance, area name, expiration, and safety text.
- Saving the product to `data/wewatches.json`.
- Rendering it immediately with `Save + Render`, or letting the one-minute bounded auto-render loop add it to `/warningcenter`.

Useful WeWatch APIs:

- `GET /api/wewatches?includeExpired=true` lists saved builder products.
- `POST /api/wewatches` creates or updates a builder product.
- `DELETE /api/wewatches/:id` removes a builder product.

Useful endpoints:

- `GET /api/warnings/rendered` returns the current rendered-card index.
- `POST /api/warnings/rendered/refresh` forces a render refresh.
- `GET /warningcenter` shows the live rendered-card page.
- `GET /weatherspace` shows the integrated WeatherSpace command center.
- `GET /warningdetail?key=...` shows one rendered warning card.

## WeatherSpace

`GET /weatherspace` serves the integrated WeatherSpace app. It combines:

- WeatherSpace dark cosmic app shell and navigation.
- WeatherPower MapLibre custom style with live NEXRAD reflectivity.
- Active warning/watch/SPC/mesoscale polygons from the rendered-card feed.
- Rendered warning-card deck with direct warning-detail links.
- Idabel, Oklahoma current conditions.
- Recent storm reports from the IEM LSR feed.
- Discord/X posting health and cooldown status.
- Quick links to Warning Center, Dashboard, Controller, Radar, and WeWatch Builder.

## WeatherPower Dashboard

`GET /dashboard` serves the full WeatherPower operations dashboard. It combines:

- WeatherPower MapLibre custom style and live NEXRAD reflectivity.
- Full active U.S. rendered warning/watch/SPC product overlays.
- Recent storm reports from the IEM LSR feed.
- Idabel, Oklahoma as the default dashboard location.
- Local current conditions, daily forecast, hourly forecast, and point alerts from NWS.
- Generic WeatherPower-style weather icons instead of NWS icon images.
- Local hazards, planning signals, and a compact forecast timeline.
- SPC outlook and mesoscale discussion summaries.
- Saved locations, location search by `lat,lon`, layer controls, radar opacity controls, and quick links.

Useful dashboard APIs:

- `GET /api/dashboard/local?lat=33.8957&lon=-94.8263` returns current conditions and forecast.
- `GET /api/dashboard/reports?hours=12&limit=90` returns recent storm reports.
- Warning and watch cards estimate affected people and homes from official 2020 Census blocks or block groups whose centroids fall inside the alert polygon. Results are cached and labeled as estimates.

## API

- `GET /api/health` shows renderer, MapLibre maps, X, Discord, page endpoint, and controller status.
- Production place and ZIP search requires `OPEN_METEO_GEOCODING_URL` plus `OPEN_METEO_API_KEY` for a commercial Open-Meteo customer endpoint, or a WeatherPower-controlled compatible endpoint. The public Open-Meteo endpoint remains available only for local evaluation; production refuses to use it without an approved configuration.
- `GET /api/logs` returns recent render/post events.
- `POST /api/warnings/render` renders a PNG or emergency GIF and returns `/cards/<file>`.
- `POST /api/warnings/post` renders the card, uploads to X when configured, posts to Discord when configured, then posts JSON or multipart data to `PAGE_ENDPOINT_URL`.

If `CONTROLLER_TOKEN` is set, send it as `x-controller-token` or `?token=...` on API requests.

## Payload Shape

```json
{
  "title": "TORNADO WARNING IN WISCONSIN",
  "event": "Tornado Warning",
  "state": "Wisconsin",
  "expiresAt": "2026-06-24T21:15:00.000Z",
  "issuedAt": "2026-06-24T20:27:00.000Z",
  "timezone": "America/Chicago",
  "hazards": {
    "hail": "1.00 in",
    "hailSubtext": "Quarter size"
  },
  "impacts": {
    "people": 85078,
    "homes": 36545
  },
  "sourceText": "WEATHER SPOTTERS REPORTED FUNNEL CLOUD - MOVING NW AT 23 MPH",
  "whatToDo": "Move to the lowest floor of a sturdy building immediately. Stay away from windows.",
  "polygon": [
    [-89.22, 42.73],
    [-88.95, 42.68],
    [-89.02, 42.51],
    [-89.30, 42.60],
    [-89.38, 42.71],
    [-89.22, 42.73]
  ],
  "center": [-89.12, 42.62],
  "zoom": 8.8,
  "postText": "Tornado Warning in Wisconsin until 4:15 PM CDT. Take shelter now."
}
```

## Warning Center v3 (October 2026)

- **Cards** are now 1600×900 broadcast graphics (`src/cardHtml.js`); the previous template is kept in `src/cardHtmlLegacy.js`.
- **Warning shorts**: 15-second radar + polygon videos (`src/shortVideo.js`, `src/shortHtml.js`). Vertical 1080×1920 by default (`SHORTS_FORMAT=square` for 1080×1080). Flood products switch to the 24-hour rain estimate halfway through; tornado and severe thunderstorm warnings switch to nearest-site velocity.
  - Auto-rendered for `SHORTS_AUTO_EVENTS` (default: tornado, severe thunderstorm, flash flood, hurricane, extreme wind, storm surge warnings, plus any emergency/PDS/destructive alert), at most `SHORTS_AUTO_MAX_PER_CYCLE` new videos per cycle, one render at a time.
  - Anyone can request a video for an active alert from the Warning Center (rate limited by `SHORTS_PUBLIC_REQUESTS_PER_WINDOW` per 10 minutes, queue capped by `SHORTS_MAX_QUEUE`).
  - Files live in `cards/shorts/` and are deleted `SHORTS_RETENTION_HOURS` after the alert ends.
  - Needs ffmpeg: the `ffmpeg-static` package, `FFMPEG_PATH`, or `ffmpeg` on PATH.
  - Preview locally: `node scripts/render-short.js [--event "Tornado Warning"] [--format square]`.
- **Public API v3** (all under `/warningcenter/api/v3`): `GET alerts?group=&state=&q=`, `GET alerts.geojson`, `GET alert?key=`, `GET radar`, `GET config`, `GET shorts`, `GET short?key=`, `POST short/request?key=` (public, rate limited), `POST short/render?key=` (controller token). Keys go in the query string because Apache rejects encoded slashes in paths.
- `bash scripts/dev-safe.sh` runs a local server on :8899 that never posts to Discord/X.
- **Card cleanup** is now on by default: every 15 minutes, card images not used by an active alert and older than `CARD_RETENTION_HOURS` (24) are removed, along with stale state `.tmp` files, all but the 3 newest corrupt-state backups, and orphaned video files. One-time backlog: `node scripts/cleanup-cards.js --dry-run`, then without `--dry-run`. Note that an existing `.env` with `CARD_CLEANUP_ENABLED=false` still turns it off.

## WeatherPower Live (24/7 stream)

`/warningcenter/live` is a 1920×1080 broadcast page made for an OBS **Browser** source
(width 1920, height 1080, "Control audio via OBS" on). It runs by itself:

- **Auto-director** cycles the most important alerts: flies to the polygon, shows the alert card
  (expires countdown, threat, people in the warning, warnings inside a watch, areas, hazards, the
  NWS storm-location / impacts sentence), and loops the **nearest NEXRAD site's** super-res
  reflectivity. Tornado warnings switch to storm-relative velocity partway through. National overview,
  SPC Day 1 outlook and storm-report shots are mixed in.
- **Breaking takeover** for new tornado warnings, PDS/emergency/destructive alerts and tornado
  watches: full-screen sting, WeatherPower chime (not the EAS tone), and WeBot reads it out.
  Other new warnings get a chime and jump the queue.
- **Top bar**: TOR / SVR / FFW / watch counters, rotating headline ticker, and the
  **WeatherPower Index (WPI)** with a 24-hour sparkline (QUIET / ACTIVE / BUSY / SEVERE / EXTREME).
- **WeBot** (`public/assets/webot.png`): talks with the browser's speech voice, eye color follows the threat,
  seasonal hat (October / December), safety tips when it's quiet, roundup every 20 minutes.
- **Bottom bar**: clock, now-tracking line with hazard chips, area crawl, people in the path,
  shot progress and alert countdown.

URL options: `?state=OK`, `?voice=0`, `?sound=0`, `?bot=0`, `?hat=0`, `?tips=0`, `?speed=1.5`
(longer shots), `?tz=America/Chicago`.

WeBot's voice uses the operating system's speech engine. If OBS's browser source doesn't pick it
up, open the stream URL in Chrome, add it with Window Capture, and capture desktop audio.

**Control panel**: `/warningcenter/live/control` (needs `CONTROLLER_TOKEN`; the control API refuses
to run if no token is configured). Pin an alert, focus a state, switch Auto / National / Outlook /
Reports, skip, make WeBot say something, show a banner message, toggle voice/sounds, run a
labeled breaking-alert test, or reload the stream remotely.

API: `GET /api/v3/live` (tallies, index + history, control state, storm reports),
`GET /api/v3/live/radar?site=EWX` (single-site loop tiles), `GET /api/v3/nexrad` (radar sites),
`POST /api/v3/live/control` with `X-Controller-Token` and `{ "action": "pin" | "unpin" | "state" |
"mode" | "voice" | "sound" | "banner" | "say" | "next" | "test-breaking" | "reload" | "ping" }`.
Stream state is stored in `data/live-control.json` and `data/live-index.json`.

### WeBot thinks and checks the models

The stream doesn't only track warnings. In its rotation WeBot zooms out, thinks (eyes glancing
around) while the next model check loads, then plays a **Model Studio** loop
(WeatherPower Radar 3.1's model service, `https://weatherpower.app/wpcc-render/api/models`):

- HRRR, NAM 3km, GFS and ECMWF fields: simulated radar, precip type, CAPE, updraft helicity,
  temperature, dew point, gusts, total rain and snow. The rotation leans severe (radar, CAPE, UH)
  when there are TOR/SVR warnings or an SPC slight risk or higher, and winter fields from November
  to March.
- A "model check" card compares every model at the hot spot (top CONUS warning, then the highest
  SPC risk area, then home: `FORECAST_CARDS_CITY/STATE/LAT/LON`). WeBot reads a take built only from
  those numbers and says when the models disagree. Hours a model doesn't have show as unavailable.
- Frames go through `GET /api/v3/models/frame/:model/:run/:field/:hour.webp` (cached), because Model
  Studio only renders new hours for weatherpower.app pages or keyed requests.
- `WEATHERPOWER_API_KEY` (a `wp_` key from https://weatherpower.app/developers/) is sent with those
  requests and also adds the HRRR Skew-T sounding chart to severe model checks
  (`GET /api/v3/models/sounding.png`). Everything else works without it.

API: `GET /api/v3/models/catalog`, `GET /api/v3/models/segment?model=hrrr&field=refc&lat=&lon=&place=`.
Control panel: **Models** mode makes WeBot loop think → model check.

WeBot never shows caption bubbles; safety tips ride in the top ticker.

### Background music

**WeBot Radio** is lo-fi music composed live in the stream page with Web Audio (electric piano, pads,
bass, soft drums, vinyl crackle). It is free, never repeats exactly, and has nothing for YouTube
Content ID to match. Each "song" runs about 2–3 minutes with a name on screen (`♪ NIGHT SHIFT ·
WEBOT RADIO`). On **Auto** mood it follows the weather: calm when quiet, chill when busy, and a darker
storm mood (switching at the next bar) when tornado warnings are out or the index is SEVERE.
The music ducks under WeBot's voice and nearly mutes for breaking alerts.

Your own songs: drop audio files in `public/music/` (`Artist - Title.mp3`). **Auto** source plays them
shuffled when any exist, **WeBot Radio** forces the generated music. Only use music you have the
rights to stream.

Control panel → **Music**: on/off, next song, volume, Auto / WeBot Radio / My tracks, mood (Auto,
Calm, Chill, Storm), and "lower for voice". **Stream status** shows what the stream is playing.
URL: `?music=0` turns music off for that browser source.
API: `GET /api/v3/live/music`; control actions `music` (`on`, `volume`, `source`, `mood`, `duck`) and
`music-next`.

### WeBot's voice

| Engine | Cost | How |
| --- | --- | --- |
| OpenAI via Puter.js (default, voice **Alloy**) | Puter's "user pays" model: billed to the Puter account signed in on the stream page, which gets a free monthly allowance | The stream loads `https://js.puter.com/v2/` and calls `puter.ai.txt2speech` (OpenAI `gpt-4o-mini-tts`). First run shows a **Sign in to Puter** button: in OBS right-click the source → Interact and click it once; the sign-in is remembered. Signed out or allowance used up → computer voice. |
| Free neural voice | Free | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) runs inside the stream page via `kokoro-js` in a Web Worker. First start downloads ~90 MB from jsDelivr/Hugging Face, then it is cached. Works in an OBS browser source. Voices include Michael, Fenrir, Puck, Heart (best quality), Bella, George… |
| OpenAI voice | Paid by OpenAI (gpt-4o-mini-tts is roughly $0.015/min) | Set `OPENAI_API_KEY`. Optional `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`), `OPENAI_TTS_VOICE` (`onyx`), `OPENAI_TTS_INSTRUCTIONS`, `OPENAI_TTS_DAILY_CHARS` (default 150000/day budget). |
| Self-hosted, OpenAI-compatible | Free | Point `OPENAI_TTS_BASE_URL` at any server with OpenAI's `/v1/audio/speech` API (for example Kokoro-FastAPI on your PC), no key needed. |
| Computer voice | Free | The browser's speech voices. Used as the fallback while the neural voice loads or if it fails. |

Kokoro's `af_alloy` is a free voice in the same style as OpenAI's Alloy if Puter's allowance isn't enough.
Control panel → **WeBot**: engine, voice, speed and a Test button. URL: `?tts=puter|openai|neural|browser`.
API: `GET /api/v3/live/voice`, `GET /api/v3/live/tts?text=&voice=` (OpenAI-compatible engine only,
rate-limited to 40 lines a minute plus the daily character budget).

### Weather Intensity Score (WIS), shared by the WIS page and the stream

`src/wis.js` is the scoring engine from the WeatherPower WIS page (same alert sources, scoring,
caps, labels and 30-minute projection). The server runs it once a minute on every active NWS alert
plus active WeWatch alerts (public Firebase `wewatches`), and keeps real per-minute history for 24 h
in `data/wis-history.json`. `GET /api/v3/wis` (also inside `GET /api/v3/live`).

- The stream's top-right box shows WIS (score, level, 30-minute change, last hour).
- The WIS page is served at `/warningcenter/wis` (`public/wis.html`). It takes its score and history
  from `/warningcenter/api/v3/wis`, so both always match; if the feed is unreachable it scores in the
  browser as before.

### Show rotation, national model checks and the tropics

- The stream no longer follows a fixed playlist: each segment is a weighted random pick (alerts most
  often when it's active), and non-alert segments don't repeat back to back.
- Model checks are national: WeBot scans 23 cities across the lower 48 with the lead model, names the
  top spots (card + map markers) and compares every model at the top spot.
- **Tropics** (`GET /api/v3/tropics`, NOAA NHC): every active storm with its cone, forecast track and
  points, past track, model spaghetti tracks and coastal watches/warnings; WeBot reads each storm once
  per advisory. With no storms it shows the NHC 7-day outlook areas. Control panel: **Tropics** mode.

### WeBot talks on every shot, national radar map, live cameras

- **Commentary:** WeBot says something on every segment, built from the data on screen: the alert
  (place, expiry, the NWS storm-location line, hail/wind/tornado tags, nearby storm reports, radar
  site, people inside), "back to…" updates on repeat visits, the national overview, SPC outlook,
  storm reports, tropics, the surface map and model checks. Lines never queue up behind each other,
  and the show waits up to 15 seconds for him to finish (a breaking alert or Skip still cuts in).
- **National radar + surface map** (`GET /api/v3/surface`, NWS WPC coded surface bulletin): highs and
  lows with millibars, cold/warm/stationary/occluded fronts and troughs over the national radar. On
  quiet days it comes up often; the bottom bar becomes "NOW PLAYING · song · ARTIST NAME · MODE".
  Control panel: **Radar map** mode.
- **Live cameras** from the WeatherPower Traffic camera network (Camera Wall `/api/cameras`): during
  an alert zoom the nearest camera within 30 miles shows in a LIVE box with a marker on the map.
  Easiest: `CAMERA_CATALOG_FILE` = the WeatherPower Traffic catalog on this PC (`configs/railfan_cameras.json`),
  no login needed. Or its API with `CAMERA_API_USER` / `CAMERA_API_PASS` (a viewer account) and `CAMERA_API_BASE`.
  Video plays through `/api/v3/cameras/stream/:id/index.m3u8` (adds the agency headers some feeds need; only fetches
  from that camera's own site). Sites that refuse (e.g. DriveTexas, which needs its own session) are skipped for an hour;
  a dead stream falls back to the camera's still image. Only public feeds (state DOT cameras) are used
  unless `CAMERA_ALLOW_LOCAL=true`. `GET /api/v3/cameras/near?lat=&lon=&miles=`.

### Camera picker and Puter in OBS

- **Live Control → Cameras:** search all cameras (name, road, city), filter by state and live video vs
  stills, preview any camera (live video plays right there), and **Put on stream** to pin it: the pinned
  camera stays on screen through every shot. Modes: Auto (nearest camera on alert zooms), Pinned, Off.
  API: `GET /api/v3/cameras?q=&state=&kind=&offset=`, `GET /api/v3/cameras/item/:id`; control action
  `camera` (`mode`, `id`, `name`). Cameras play with hls.js first (newer Chrome claims native HLS but
  can't play these agency streams).
- **Puter sign-in for OBS:** OBS browser sources can't open Puter's sign-in popup. In Live Control →
  WeBot → Puter, click **Sign in & link for OBS** (in a normal browser). The server keeps the token in
  `data/live-secrets.json` (never in the public `/api/v3/live`), and the stream fetches it from
  `GET /api/v3/live/puter?key=` using its private stream key. Use the OBS link shown in Live Control
  (it ends in `?key=…`); the key is derived from `CONTROLLER_TOKEN`.

### Looks, state outlines, cameras on air

- **Look (bar themes):** Live Control → Look picks the top/bottom bar colors: Auto (follows the weather:
  tornado red, severe storm red, flood green, tropical teal, winter blue, heat orange, violet when quiet)
  or a fixed look (Violet, Clear Skies, Severe Storms, Tornado, Flooding, Winter, Heat, Tropical, Night,
  Halloween). Control action `theme`.
- **State outlines** next to the state name in the radar box (US Census shapes from us-atlas via jsDelivr),
  the lower-48 outline for the national view.
- **WeBot talks about cameras:** every camera that comes up gets a line (queued after the alert line), with
  the camera's place said naturally and whether it sits inside an active warning; pinned cameras get a
  check-in every few segments. Sentences no longer split inside "U.S." or decimals.
- **Sound starts by itself:** no "sound is on" announcement; a browser that blocks autoplay starts sound on
  the first click or key press anywhere, and WeBot's opening line waits for it. Pinning an alert in Live
  Control switches the stream right away.
- `WARNING_DATA_DIR` runs a second (test) server with its own settings and state.

### Quiet on calm days

- WeBot only talks when the Weather Intensity Score is 100 or higher (any tornado warning puts it there).
  Live Control → WeBot → Talk: **Auto (WIS 100+)**, **Start talking** (always talk), **Quiet**. Typed
  "Say it" lines always play. Control action `talk` (`auto` | `on` | `off`). No opening "WeBot here" line.
- Calm days (WIS under 100, no tornado warnings) are slow and chill: scenes hold 1–3 minutes, mostly the
  national radar map with the now-playing bar, fewer alert hops.
