# Deploy Warning Center To weatherpower.app

This service cannot be uploaded as only static HTML. It needs Node because it fetches NWS alerts, renders Mapbox/radar cards, stores `/cards`, and keeps X credentials server-side.

## Spaceship cPanel Recommended Setup

Spaceship Web Hosting supports Node.js apps through cPanel's `Setup Node.js App` tool. Spaceship says this tool is powered by CloudLinux and Passenger, lets you create/manage Node apps, run `npm install`, and set environment variables from cPanel.

Because shared cPanel usually does not give you Nginx reverse-proxy control, the simplest reliable setup is:

```text
https://warnings.weatherpower.app/warningcenter
```

Then make:

```text
https://weatherpower.app/warningcenter
```

redirect to it or embed it with a full-page iframe. WeatherSpace is served by the same Node app, so you can use it as the first screen or open it at `/weatherspace`.

## A. Create The Node App In Spaceship cPanel

1. Log in to Spaceship.
2. Open your hosting package.
3. Open `cPanel`.
4. Find `Setup Node.js App`.
5. Click `Create Application`.
6. Use these values:

```text
Node.js version: latest available 20+ or 22+
Application mode: Production
Application root: warning-card-service
Application URL: warnings.weatherpower.app
Application startup file: app.js
```

Create the app. cPanel will make a folder like:

```text
/home/YOUR_CPANEL_USER/warning-card-service
```

## B. Upload Files

On your Mac:

```bash
cd /Users/josh/Documents/Codex/2026-06-24/mka/outputs
tar --exclude='warning-card-service/node_modules' \
  --exclude='warning-card-service/cards' \
  --exclude='warning-card-service/data' \
  -czf warning-card-service.tar.gz warning-card-service
```

Upload `warning-card-service.tar.gz` through cPanel File Manager or FTP.

In cPanel Terminal:

```bash
cd ~
tar -xzf warning-card-service.tar.gz
```

Make sure `package.json`, `app.js`, `src/`, and `public/` are directly inside:

```text
/home/YOUR_CPANEL_USER/warning-card-service
```

## C. Install Dependencies

In `Setup Node.js App`, open the app and click:

```text
Run NPM Install
```

Then open cPanel Terminal and use the virtual environment command shown at the top of the Node app page. It usually looks similar to:

```bash
source /home/YOUR_CPANEL_USER/nodevenv/warning-card-service/20/bin/activate
cd /home/YOUR_CPANEL_USER/warning-card-service
npx playwright install chromium
```

If Playwright browser install fails on shared hosting, use Spaceship Starlight VM/Hyperlift instead. This renderer needs a headless browser to screenshot Mapbox cards.

## D. Set Environment Variables In cPanel

In `Setup Node.js App` → edit your app → Environment variables, add:

```env
NODE_ENV=production
PORT=8877
HOST=0.0.0.0
HOME_PAGE=weatherspace
PUBLIC_BASE_URL=https://warnings.weatherpower.app
MAPBOX_STYLE_URL=mapbox://styles/weatherpower/cmrsxh3kq00dx01s172gr0mc1
MAPBOX_ACCESS_TOKEN=YOUR_MAPBOX_TOKEN
X_API_KEY=YOUR_X_API_KEY
X_API_SECRET=YOUR_X_API_SECRET
PAGE_ENDPOINT_URL=https://warnings.weatherpower.app/warningcenter
PAGE_POST_MODE=json
DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=YOUR_DISCORD_WEBHOOK_URL
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
FUNNY_WARNINGS_ENABLED=false
FUNNY_WARNINGS_URL=
FUNNY_WARNINGS_FILE=custom-products/funny-warnings.json
FIREBASE_WEWATCHES_URL=
FIREBASE_WEWATCHES_AUTH=
FIREBASE_WEWATCHES_API_KEY=
FIREBASE_WEWATCHES_BEARER=
CUSTOM_PRODUCTS_TIMEOUT_MS=7000
CONTROLLER_TOKEN=MAKE_A_LONG_RANDOM_PASSWORD
```

Save, then click `Restart`.

Use `HOME_PAGE=weatherspace` for the new WeatherSpace command center, `HOME_PAGE=warningcenter` for the classic warning card feed, or `HOME_PAGE=dashboard` for the operations dashboard.

## E. X Callback For cPanel/Subdomain

In the X Developer Portal app settings, set callback URL to:

```text
https://warnings.weatherpower.app/api/x/auth/callback
```

Then open:

```text
https://warnings.weatherpower.app/controller
```

Enter the controller token and click `Connect X`.

## F. Put It On weatherpower.app/warningcenter

If your main site already uses `public_html`, make this file:

```text
public_html/warningcenter/index.html
```

Use this full-page iframe:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WeatherPower Warning Center</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #020409; }
    iframe { display: block; width: 100%; height: 100vh; border: 0; }
  </style>
</head>
<body>
  <iframe src="https://warnings.weatherpower.app/weatherspace" title="WeatherSpace Command Center"></iframe>
</body>
</html>
```

If you are okay with the URL changing, use a redirect instead:

```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=https://warnings.weatherpower.app/weatherspace">
<link rel="canonical" href="https://warnings.weatherpower.app/weatherspace">
```

## G. Verify

Open:

```text
https://warnings.weatherpower.app/api/health
https://warnings.weatherpower.app/api/warnings/rendered
https://warnings.weatherpower.app/weatherspace
https://warnings.weatherpower.app/warningcenter
https://weatherpower.app/warningcenter
```

The first full render can take a minute or two.

---

## VPS/Nginx Alternative

Use this only if you move to a VPS or have Nginx control.

## 1. Choose Where It Runs

Best production shape:

```text
Internet
  -> https://weatherpower.app/warningcenter
  -> Nginx reverse proxy
  -> Node service on 127.0.0.1:8877
```

Use a VPS or existing server that already serves `weatherpower.app`. If the current site is static-only hosting, use a VPS/subdomain like `warnings.weatherpower.app`, then link or iframe it from `weatherpower.app/warningcenter`.

## 2. Upload The Service

From this Mac:

```bash
cd /Users/josh/Documents/Codex/2026-06-24/mka/outputs
tar --exclude='warning-card-service/node_modules' \
  --exclude='warning-card-service/cards' \
  --exclude='warning-card-service/data' \
  -czf warning-card-service.tar.gz warning-card-service

scp warning-card-service.tar.gz YOUR_SERVER_USER@YOUR_SERVER_IP:/tmp/
```

On the server:

```bash
sudo mkdir -p /opt/weatherpower
sudo tar -xzf /tmp/warning-card-service.tar.gz -C /opt/weatherpower
cd /opt/weatherpower/warning-card-service
npm install --omit=dev
npx playwright install chromium
```

## 3. Production `.env`

Create:

```bash
sudo nano /opt/weatherpower/warning-card-service/.env
```

Use:

```env
PORT=8877
HOST=127.0.0.1
PUBLIC_BASE_URL=https://weatherpower.app
HOME_PAGE=weatherspace

MAPBOX_STYLE_URL=mapbox://styles/weatherpower/cmrsxh3kq00dx01s172gr0mc1
MAPBOX_ACCESS_TOKEN=YOUR_MAPBOX_TOKEN

X_API_KEY=YOUR_X_API_KEY
X_API_SECRET=YOUR_X_API_SECRET

PAGE_ENDPOINT_URL=https://weatherpower.app/warningcenter
PAGE_ENDPOINT_TOKEN=
PAGE_POST_MODE=json
DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=YOUR_DISCORD_WEBHOOK_URL
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
FUNNY_WARNINGS_ENABLED=false
FUNNY_WARNINGS_URL=
FUNNY_WARNINGS_FILE=custom-products/funny-warnings.json
FIREBASE_WEWATCHES_URL=
FIREBASE_WEWATCHES_AUTH=
FIREBASE_WEWATCHES_API_KEY=
FIREBASE_WEWATCHES_BEARER=
CUSTOM_PRODUCTS_TIMEOUT_MS=7000

CONTROLLER_TOKEN=MAKE_A_LONG_RANDOM_PASSWORD
```

Keep `.env` private.

## 4. Run With systemd

Create:

```bash
sudo nano /etc/systemd/system/weatherpower-warning.service
```

Paste:

```ini
[Unit]
Description=WeatherPower Warning Card Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/weatherpower/warning-card-service
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo chown -R www-data:www-data /opt/weatherpower/warning-card-service
sudo systemctl daemon-reload
sudo systemctl enable --now weatherpower-warning
sudo systemctl status weatherpower-warning
```

## 5. Nginx Routes

In your `weatherpower.app` Nginx server block, add:

```nginx
location = /warningcenter {
  proxy_pass http://127.0.0.1:8877/warningcenter;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location = /weatherspace {
  proxy_pass http://127.0.0.1:8877/weatherspace;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location = /warningdetail {
  proxy_pass http://127.0.0.1:8877/warningdetail;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/ {
  proxy_pass http://127.0.0.1:8877/api/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /cards/ {
  proxy_pass http://127.0.0.1:8877/cards/;
  proxy_set_header Host $host;
}

location /public/ {
  proxy_pass http://127.0.0.1:8877/public/;
  proxy_set_header Host $host;
}

location = /controller {
  proxy_pass http://127.0.0.1:8877/controller;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
}
```

Reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. X Callback

In the X Developer Portal app settings, set the callback URL to:

```text
https://weatherpower.app/api/x/auth/callback
```

Then open:

```text
https://weatherpower.app/controller
```

Enter `CONTROLLER_TOKEN`, click `Connect X`, and approve the app.

## 7. Verify

```bash
curl https://weatherpower.app/api/health
curl https://weatherpower.app/api/warnings/rendered
```

Open:

```text
https://weatherpower.app/weatherspace
https://weatherpower.app/warningcenter
```

The first full render can take a minute or two because it renders every active warning/watch card.

## 8. Updating Later

From this Mac, make a new tarball, upload it, then on the server:

```bash
cd /opt/weatherpower/warning-card-service
npm install --omit=dev
sudo systemctl restart weatherpower-warning
sudo journalctl -u weatherpower-warning -f
```
