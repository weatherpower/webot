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
