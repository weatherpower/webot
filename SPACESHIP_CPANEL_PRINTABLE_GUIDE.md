# WeatherPower SpaceShip / cPanel Deployment Guide

Use this checklist to put the WeatherPower warning center and WeatherSpace command center on `weatherpower.app/warningcenter`.

## What You Are Uploading

Upload the project archive:

```text
warning-card-service.tar.gz
```

The app will:

- Render full United States active NWS warnings and watches.
- Render SPC mesoscale discussions.
- Render SPC Day 1-8 outlook cards.
- Serve a full WeatherPower operations dashboard at `/dashboard`.
- Serve the new WeatherSpace command center at `/weatherspace`.
- Show the new warning center UI with your Mapbox style.
- Serve cards at `/cards/...`.
- Serve the controller at `/controller`.

## Before You Start

- [ ] You can log in to SpaceShip/cPanel.
- [ ] Your domain `weatherpower.app` is added in cPanel.
- [ ] Node.js app support is available in cPanel.
- [ ] You have your Mapbox public token ready.
- [ ] You have your X app API key and API secret ready.
- [ ] Optional: you have your Discord webhook URL ready.
- [ ] You have a controller password/token you can remember.

Important: do not upload your local `.env`, `node_modules`, `cards`, or `data` folders if you are moving this to production. The archive made by this project should exclude those runtime files.

## 1. Upload The App

1. Open cPanel.
2. Open **File Manager**.
3. Go to your home folder, not `public_html`.
4. Create a folder named:

```text
warning-card-service
```

5. Open that folder.
6. Upload `warning-card-service.tar.gz`.
7. Right-click the archive and choose **Extract**.
8. If the files extract into another nested folder, move the files so `package.json`, `app.js`, `src`, and `public` are directly inside:

```text
/home/YOUR_CPANEL_USER/warning-card-service
```

## 2. Create The Node.js App

1. Go back to cPanel home.
2. Open **Setup Node.js App**.
3. Click **Create Application**.
4. Use these settings:

```text
Node.js version: 20.x or newer
Application mode: Production
Application root: warning-card-service
Application URL: weatherpower.app/warningcenter
Application startup file: app.js
```

5. Click **Create**.
6. Click **Run NPM Install**.

If cPanel only lets you choose the domain and a path separately, choose:

```text
Domain: weatherpower.app
URL path: warningcenter
```

## 3. Add Environment Variables

In **Setup Node.js App**, open the app you created and add these environment variables.

Use your real values where the guide says `PASTE_...`.

```text
HOME_PAGE=weatherspace
PUBLIC_BASE_URL=https://weatherpower.app/warningcenter

MAPBOX_STYLE_URL=mapbox://styles/weatherpower/cmrsxh3kq00dx01s172gr0mc1
MAPBOX_ACCESS_TOKEN=PASTE_YOUR_MAPBOX_PUBLIC_TOKEN

X_API_KEY=PASTE_YOUR_X_API_KEY
X_API_SECRET=PASTE_YOUR_X_API_SECRET

PAGE_ENDPOINT_URL=https://weatherpower.app/warningcenter
PAGE_POST_MODE=json

DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=PASTE_YOUR_DISCORD_WEBHOOK_URL
DISCORD_AUTO_POST_ENABLED=true
DISCORD_AUTO_POST_MAX_PER_REFRESH=1
DISCORD_AUTO_POST_MIN_SECONDS=3600
DISCORD_AUTO_POST_SUPPRESS_BACKFILL=true
DISCORD_USERNAME=WeatherPower
DISCORD_AVATAR_URL=

AUTO_RENDER_ENABLED=true
AUTO_RENDER_INTERVAL_MS=60000
AUTO_RENDER_LIMIT=0
AUTO_RENDER_CONCURRENCY=2
AUTO_RENDER_BATCH_SIZE=4
AUTO_RENDER_MAX_PER_CYCLE=8
AUTO_RENDER_BATCH_COOLDOWN_MS=2000
RENDER_WORKER_TIMEOUT_MS=180000
CARD_CLEANUP_ENABLED=false
CARD_RETENTION_HOURS=24

# Optional custom WeatherPower products.
FUNNY_WARNINGS_ENABLED=false
FUNNY_WARNINGS_URL=
FUNNY_WARNINGS_FILE=custom-products/funny-warnings.json

# Optional Firebase/Firestore WeWatches feed.
FIREBASE_WEWATCHES_URL=
FIREBASE_WEWATCHES_AUTH=
FIREBASE_WEWATCHES_API_KEY=
FIREBASE_WEWATCHES_BEARER=
CUSTOM_PRODUCTS_TIMEOUT_MS=7000

CONTROLLER_TOKEN=MAKE_A_PRIVATE_CONTROLLER_PASSWORD
```

For the funny Dollar Store / Temu card, change this only when you actually want it live:

```text
FUNNY_WARNINGS_ENABLED=true
```

For Firebase WeWatches, paste your Firebase REST URL into:

```text
FIREBASE_WEWATCHES_URL=https://YOUR_FIREBASE_PATH.json
```

Do not set `PORT` in cPanel unless SpaceShip support tells you to. cPanel usually gives the app its own port automatically.

`HOME_PAGE=weatherspace` makes the cool WeatherSpace command center load first at `https://weatherpower.app/warningcenter`. The classic card feed still stays available inside the app.

## 4. Save And Restart

1. Click **Save**.
2. Click **Restart** for the Node.js app.
3. Wait 30-60 seconds.

## 5. Test The Public Page

Open:

```text
https://weatherpower.app/warningcenter
```

You should see:

- WeatherSpace command center with the space-style UI.
- Live map using your custom Mapbox style and radar overlay.
- Active warnings, watches, SPC outlooks, mesoscale discussions, and reports.
- Card tiles auto-rendering without manual posting.
- Discord status showing the 60 minute cooldown.

If you see the controller instead of WeatherSpace, check that this env var is set:

```text
HOME_PAGE=weatherspace
```

Then restart the app.

To make the classic warning center the first page instead, use:

```text
HOME_PAGE=warningcenter
```

To make the operations dashboard the first page instead, use:

```text
HOME_PAGE=dashboard
```

The dashboard now defaults to Idabel, Oklahoma and uses generic WeatherPower weather icons, local hazards, planning signals, and a forecast timeline.

Then open:

```text
https://weatherpower.app/warningcenter/dashboard
```

You can also open the WeatherSpace route directly:

```text
https://weatherpower.app/warningcenter/weatherspace
```

## WeWatch Builder

Open the controller:

```text
https://weatherpower.app/warningcenter/controller
```

Use the **WeWatch Builder** panel to create your own WeatherPower watches:

1. Click **Use Idabel Box**, or click points on the map to draw a custom highlighted area.
2. Choose watch type and watch level.
3. Enter wind, hail, tornado chance, area name, expiration, and safety text.
4. Click **Save WeWatch** to add it to the live auto-render feed.
5. Click **Save + Render** if you also want an immediate card preview.

Saved WeWatches live in the app runtime data file:

```text
data/wewatches.json
```

If your Node app is mounted at the domain root, open:

```text
https://weatherpower.app/dashboard
```

## 6. Test Health

Open:

```text
https://weatherpower.app/warningcenter/api/health
```

If that does not work, also try:

```text
https://weatherpower.app/api/health
```

Good health should show JSON with:

```text
ok: true
mapbox.configured: true
autoRender.enabled: true
```

## 7. Open The Controller

Open:

```text
https://weatherpower.app/warningcenter/controller?token=YOUR_CONTROLLER_TOKEN
```

If cPanel strips the `/warningcenter` path, this may also work:

```text
https://weatherpower.app/controller?token=YOUR_CONTROLLER_TOKEN
```

Use the controller to:

- Check health.
- View logs.
- Force a render refresh.
- Connect X.
- Use the visual card editor.

## 8. Connect X

In the X Developer Portal:

1. Open your WeatherPower app.
2. Go to app **Settings**.
3. Open user authentication / OAuth settings.
4. Enable read and write permissions.
5. Add this callback URL:

```text
https://weatherpower.app/warningcenter/api/x/auth/callback
```

6. Save the X app settings.
7. Go back to the WeatherPower controller.
8. Click **Connect X**.
9. Approve the app with the X account that should post.

If the callback fails, also add this fallback callback URL in X:

```text
https://weatherpower.app/api/x/auth/callback
```

Then try **Connect X** again.

## 9. Force A Render Refresh

In the controller, click the force refresh button.

Or use this URL with a tool that can send POST requests:

```text
POST https://weatherpower.app/warningcenter/api/warnings/rendered/refresh?token=YOUR_CONTROLLER_TOKEN
Body: {"force":true}
```

After a minute, reload:

```text
https://weatherpower.app/warningcenter
```

## 10. Common Problems

### The page says Mapbox token missing

Check:

```text
MAPBOX_ACCESS_TOKEN
MAPBOX_STYLE_URL
```

Then restart the Node.js app.

### Old warnings or yesterday's watches are showing

1. Open the controller.
2. Force refresh with `force=true`.
3. Make sure:

```text
AUTO_RENDER_LIMIT=0
AUTO_RENDER_ENABLED=true
```

The app filters expired products and rewrites the rendered index.

### Watches look like boxes

The app should use NWS affected-zone geometry for watches. If a watch still looks boxy, it usually means the NWS zone geometry request failed or the product had limited geometry. Open the controller logs and look for NWS geometry errors.

### Velocity is not showing on a card

Velocity is only used on products that need it, mainly tornado and severe thunderstorm warnings. Flood, winter, fire, outlook, and most watch cards use reflectivity only.

### Hail is showing on the wrong card type

Hail should only show on severe thunderstorm products when NWS includes hail data. If you see hail on flood, winter, fire, or outlook cards, force refresh and check logs.

### The app is down after restart

Check these in cPanel:

```text
Application root: warning-card-service
Startup file: app.js
Node version: 20.x or newer
```

Then click:

```text
Run NPM Install
Restart
```

### The controller gives unauthorized

Use:

```text
?token=YOUR_CONTROLLER_TOKEN
```

or send this header:

```text
x-controller-token: YOUR_CONTROLLER_TOKEN
```

## 11. After It Works

- [ ] Bookmark `https://weatherpower.app/warningcenter`.
- [ ] Bookmark `https://weatherpower.app/warningcenter/weatherspace`.
- [ ] Bookmark the controller URL with your token.
- [ ] Confirm `api/health` shows Mapbox configured.
- [ ] Confirm cards are rendering automatically.
- [ ] Confirm X connection is ready before expecting auto-posts.
