import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { config, readiness } from './config.js';
import { ensureRuntimeDirs, publicDir, cardsDir } from './paths.js';
import { appendLog, readLogs } from './logStore.js';
import { closeRenderer, renderWarningCard } from './renderCard.js';
import { postCardToX } from './posters/x.js';
import { postCardToDiscord } from './posters/discord.js';
import { postToPageEndpoint } from './posters/pageEndpoint.js';
import { requireControllerToken } from './auth.js';
import { sampleWarning } from './sampleWarning.js';
import { finishXOAuth1, startXOAuth1 } from './xOAuth.js';
import { getXAuthStatus } from './xAuthStore.js';
import { fetchActiveWarnings } from './nws.js';
import { fetchActiveMesoscaleDiscussions } from './spc.js';
import { fetchActiveSpcOutlooks } from './spcOutlooks.js';
import { fetchActiveCustomProducts } from './customProducts.js';
import { getRenderedState, getRenderedWarning, refreshRenderedWarnings, startAutoRenderer } from './autoRenderer.js';
import { startWis } from './wis.js';
import { fetchLocalWeather, fetchStormReports } from './localWeather.js';
import { deleteWeWatch, listWeWatches, saveWeWatch } from './weWatchStore.js';
import { publicWarningCenterFeed } from './publicFeed.js';
import { generateForecastSearchCards } from './forecastSearch.js';
import { geocodeMapRequest, publicMapConfig, routeMapRequest } from './mapServices.js';
import { apiV3Router, webotStatus } from './apiV3.js';
import { shortsStatus } from './shorts.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (/^\/warningcenter\/(api|public|cards|controller|dashboard|warningdetail|weatherspace|live|wis|webot|favicon\.ico)\b/.test(req.url)) {
    req.url = req.url.replace(/^\/warningcenter/, '');
  }
  if (/^\/dashboard\/(api|public|cards|controller|warningcenter|warningdetail|weatherspace)\b/.test(req.url)) {
    req.url = req.url.replace(/^\/dashboard/, '');
  }
  if (/^\/weatherspace\/(api|public|cards|controller|dashboard|warningcenter|warningdetail)\b/.test(req.url)) {
    req.url = req.url.replace(/^\/weatherspace/, '');
  }
  next();
});
app.use((req, res, next) => {
  if (config.publicWarningCenterOnly && req.method === 'GET') {
    const normalizedPath = req.path.replace(/\/+$/, '') || '/';
    if (normalizedPath === '/' || normalizedPath === '/warningcenter') {
      res.sendFile(path.join(publicDir, 'warningcenter.html'));
      return;
    }
  }
  next();
});
app.use((req, res, next) => {
  if (!config.publicWarningCenterOnly) {
    next();
    return;
  }

  const publicGetPaths = [
    '/',
    '/warningcenter',
    '/warningdetail',
    '/live',
    '/wis',
    '/webot',
    '/live/control',
    '/favicon.ico',
    '/api/health',
    '/api/maps/config',
    '/api/maps/geocode',
    '/api/maps/route',
    '/api/forecasts/search',
    '/api/warnings/rendered',
    '/api/dashboard/reports'
  ];
  const isPublicGet = (req.method === 'GET' || req.method === 'HEAD') && (
    publicGetPaths.includes(req.path)
    || req.path.startsWith('/public/')
    || req.path.startsWith('/cards/')
    || req.path.startsWith('/api/warnings/rendered/')
    || req.path.startsWith('/api/v3/')
  );
  // Live control is token-checked in its own handler, which refuses to run without a configured token.
  const isPublicShortRequest = req.method === 'POST' && (req.path === '/api/v3/short/request' || req.path === '/api/v3/live/control');

  if (isPublicGet || isPublicShortRequest) {
    next();
    return;
  }

  res.status(404).json({ ok: false, error: 'Not found' });
});
app.use('/public', express.static(publicDir, { maxAge: '1h' }));
app.use('/cards', express.static(cardsDir, { maxAge: '1h' }));

app.get('/', (req, res) => {
  if (config.publicWarningCenterOnly) {
    res.sendFile(path.join(publicDir, 'warningcenter.html'));
    return;
  }
  if (config.homePage === 'dashboard') {
    res.sendFile(path.join(publicDir, 'dashboard.html'));
    return;
  }
  if (config.homePage === 'warningcenter') {
    res.sendFile(path.join(publicDir, 'warningcenter.html'));
    return;
  }
  if (config.homePage === 'weatherspace') {
    res.sendFile(path.join(publicDir, 'weatherspace.html'));
    return;
  }
  res.redirect('/controller');
});

app.get('/controller', (req, res) => {
  res.sendFile(path.join(publicDir, 'controller.html'));
});

app.get('/warningcenter', (req, res) => {
  res.sendFile(path.join(publicDir, 'warningcenter.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/weatherspace', (req, res) => {
  res.sendFile(path.join(publicDir, 'weatherspace.html'));
});

app.get('/warningdetail', (req, res) => {
  res.sendFile(path.join(publicDir, 'warningdetail.html'));
});

// Weather Intensity Score page: the same live WIS the stream shows (GET /api/v3/wis).
app.get('/wis', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'wis.html'));
});

// WeBot status page (public): what's on the stream now, what's next, what WeBot said.
app.get('/webot', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'webot.html'));
});

app.get('/live', (req, res) => {
  res.sendFile(path.join(publicDir, 'live.html'));
});

app.get('/live/control', (req, res) => {
  res.sendFile(path.join(publicDir, 'livecontrol.html'));
});

app.get('/favicon.ico', (req, res) => {
  res.type('image/png').sendFile(path.join(publicDir, 'assets', 'wp-logo.png'));
});

app.get('/api/health', async (req, res, next) => {
  try {
    const base = readiness();
    if (config.publicWarningCenterOnly) {
      res.json({
        ok: base.ok,
        time: base.time,
        renderer: base.renderer,
        maps: base.maps,
        nws: base.nws,
        spc: base.spc,
        radar: base.radar,
        autoRender: base.autoRender,
        population: base.population,
        shorts: shortsStatus()
      });
      return;
    }
    res.json({
      ...base,
      x: {
        ...base.x,
        ...(await getXAuthStatus())
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/warnings/rendered', async (req, res, next) => {
  try {
    const force = req.query.force === 'true';
    const state = force
      ? await refreshRenderedWarnings({ force: true })
      : await getRenderedState();
    if (req.query.view === 'center') {
      res.set('Cache-Control', 'public, max-age=2, stale-while-revalidate=3');
      res.json(publicWarningCenterFeed(state));
      return;
    }
    res.json(state);
  } catch (error) {
    next(error);
  }
});

app.post('/api/warnings/rendered/refresh', requireControllerToken, async (req, res, next) => {
  try {
    res.json(await refreshRenderedWarnings({ force: Boolean(req.body?.force) }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/warnings/rendered/:key', async (req, res, next) => {
  try {
    const item = await getRenderedWarning(req.params.key);
    if (!item) {
      res.status(404).json({ error: 'Rendered warning not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.use('/api/v3', apiV3Router());

app.get('/api/sample-warning', (req, res) => {
  res.json(sampleWarning);
});

app.get('/api/maps/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(publicMapConfig());
});

app.get('/api/maps/geocode', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    res.json(await geocodeMapRequest(req.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/maps/route', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await routeMapRequest(req.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/forecasts/search', async (req, res, next) => {
  try {
    const result = await generateForecastSearchCards({
      query: req.query.q,
      clientKey: req.ip
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    await appendLog({
      level: error.status && error.status < 500 ? 'warn' : 'error',
      action: 'generate-public-forecast-cards',
      message: error.message,
      status: error.status
    });
    next(error);
  }
});

app.get('/api/dashboard/local', async (req, res, next) => {
  try {
    res.json(await fetchLocalWeather({
      lat: req.query.lat,
      lon: req.query.lon
    }));
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'fetch-dashboard-local',
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.get('/api/dashboard/reports', async (req, res, next) => {
  try {
    res.json(await fetchStormReports({
      hours: req.query.hours,
      limit: req.query.limit
    }));
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'fetch-dashboard-reports',
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.get('/api/logs', requireControllerToken, async (req, res, next) => {
  try {
    res.json({ logs: await readLogs(Number(req.query.limit || 100)) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/warnings/active', requireControllerToken, async (req, res, next) => {
  try {
    const result = await fetchActiveWarnings({
      area: req.query.area,
      event: req.query.event,
      point: req.query.point,
      warningOnly: req.query.warningOnly === 'true',
      limit: req.query.limit ?? 0
    });
    const includeDiscussions = req.query.includeDiscussions !== 'false' && !req.query.area && !req.query.point;
    if (includeDiscussions && (!req.query.event || /mesoscale discussion/i.test(String(req.query.event)))) {
      const discussions = await fetchActiveMesoscaleDiscussions();
      result.count += discussions.count;
      result.warnings = [
        ...(result.warnings || []),
        ...(discussions.warnings || [])
      ];
    }
    const includeOutlooks = req.query.includeOutlooks !== 'false' && !req.query.area && !req.query.point;
    if (includeOutlooks && (!req.query.event || /outlook/i.test(String(req.query.event)))) {
      const outlooks = await fetchActiveSpcOutlooks();
      result.count += outlooks.count;
      result.warnings = [
        ...(result.warnings || []),
        ...(outlooks.warnings || [])
      ];
    }
    const includeCustom = req.query.includeCustom !== 'false' && !req.query.area && !req.query.point;
    if (includeCustom && !req.query.event) {
      const customProducts = await fetchActiveCustomProducts();
      result.count += customProducts.count;
      result.warnings = [
        ...(result.warnings || []),
        ...(customProducts.warnings || [])
      ];
    }
    res.json(result);
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'fetch-active-warnings',
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.get('/api/wewatches', requireControllerToken, async (req, res, next) => {
  try {
    res.json({
      items: await listWeWatches({ includeExpired: req.query.includeExpired === 'true' })
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/wewatches', requireControllerToken, async (req, res, next) => {
  try {
    const item = await saveWeWatch(req.body || {});
    await appendLog({
      level: 'info',
      action: 'save-wewatch',
      warningTitle: item.title || item.event || item.id,
      message: `Saved WeWatch ${item.id}`
    });
    refreshRenderedWarnings().catch((error) => {
      console.warn(`WeWatch refresh failed: ${error.message}`);
    });
    res.json({ ok: true, item });
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'save-wewatch',
      message: error.message
    });
    next(error);
  }
});

app.delete('/api/wewatches/:id', requireControllerToken, async (req, res, next) => {
  try {
    const result = await deleteWeWatch(req.params.id);
    await appendLog({
      level: 'info',
      action: 'delete-wewatch',
      message: result.deleted ? `Deleted WeWatch ${result.id}` : `WeWatch ${result.id} was not found`
    });
    refreshRenderedWarnings().catch((error) => {
      console.warn(`WeWatch refresh failed: ${error.message}`);
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'delete-wewatch',
      message: error.message
    });
    next(error);
  }
});

app.get('/api/x/auth/start', requireControllerToken, async (req, res, next) => {
  try {
    const callbackUrl = `${config.publicBaseUrl}/api/x/auth/callback`;
    const authorizeUrl = await startXOAuth1({ callbackUrl });
    res.redirect(authorizeUrl);
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'x-auth-start',
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.get('/api/x/auth/callback', async (req, res, next) => {
  try {
    if (req.query.denied) {
      res.status(400).send('X authorization was denied. You can close this tab and try again from the controller.');
      return;
    }

    const oauthToken = req.query.oauth_token;
    const oauthVerifier = req.query.oauth_verifier;
    if (!oauthToken || !oauthVerifier) {
      res.status(400).send('X callback is missing oauth_token or oauth_verifier.');
      return;
    }

    const saved = await finishXOAuth1({ oauthToken, oauthVerifier });
    await appendLog({
      level: 'info',
      action: 'x-auth-finish',
      message: `Connected X account ${saved.screenName || saved.userId || 'unknown'}`
    });

    res.send(`<!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>X Connected</title></head>
        <body style="font-family: system-ui; background: #07101b; color: #edf4ff; padding: 32px;">
          <h1>X account connected</h1>
          <p>The posting token was saved locally. You can close this tab and refresh health in the controller.</p>
          <p><a style="color: #8fd3ff;" href="/controller">Back to controller</a></p>
        </body>
      </html>`);
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'x-auth-finish',
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.post('/api/warnings/render', requireControllerToken, async (req, res, next) => {
  try {
    const render = await renderWarningCard(req.body?.warning || req.body || sampleWarning);
    const logEntry = await appendLog({
      level: 'info',
      action: 'render',
      warningTitle: render.warning.title,
      card: {
        filename: render.filename,
        url: render.publicPath,
        bytes: render.bytes
      }
    });

    res.json({
      ok: true,
      render: {
        ...render,
        filePath: undefined,
        url: render.publicPath
      },
      logEntry
    });
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'render',
      message: error.message
    });
    next(error);
  }
});

app.post('/api/warnings/post', requireControllerToken, async (req, res, next) => {
  const dryRun = req.body?.dryRun ?? config.dryRunDefault;
  try {
    const warning = req.body?.warning || req.body || sampleWarning;
    const render = await renderWarningCard(warning);
    const postText = warning.postText || render.warning.postText;
    const xResult = await postCardToX({
      imagePath: render.filePath,
      text: postText,
      dryRun
    });
    const discordResult = await postCardToDiscord({
      warning: render.warning,
      render,
      text: postText,
      dryRun,
      context: 'manual'
    });
    const pageResult = await postToPageEndpoint({
      warning: render.warning,
      render,
      xResult,
      discordResult,
      dryRun
    });

    const logEntry = await appendLog({
      level: 'info',
      action: 'post',
      dryRun: Boolean(dryRun),
      warningTitle: render.warning.title,
      card: {
        filename: render.filename,
        url: render.publicPath,
        bytes: render.bytes
      },
      x: xResult,
      discord: discordResult,
      pageEndpoint: pageResult
    });

    res.json({
      ok: true,
      dryRun: Boolean(dryRun),
      render: {
        ...render,
        filePath: undefined,
        url: render.publicPath
      },
      x: xResult,
      discord: discordResult,
      pageEndpoint: pageResult,
      logEntry
    });
  } catch (error) {
    await appendLog({
      level: 'error',
      action: 'post',
      dryRun: Boolean(dryRun),
      message: error.message,
      status: error.status,
      body: error.body
    });
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(error.status || 500).json({
    ok: false,
    error: error.message,
    status: error.status,
    details: error.body
  });
});

const startServer = async () => {
  await ensureRuntimeDirs();
  const server = app.listen(config.port, config.host, () => {
    console.log(`Warning card service listening on http://${config.host}:${config.port}`);
    console.log(`Dashboard: ${config.publicBaseUrl}/dashboard`);
    console.log(`Controller: ${config.publicBaseUrl}/controller`);
    console.log(`Warning Center: ${config.publicBaseUrl}/warningcenter`);
    startAutoRenderer();
    startWis().catch((error) => console.error('WIS', error.message));
  });
  // PUBLIC_STATUS_PORT: a second, read-only listener with only the WeBot status page (safe to open to
  // the internet while the main port stays behind the home-IP firewall).
  const statusPort = Number(process.env.PUBLIC_STATUS_PORT || 0);
  if (statusPort) {
    const pub = express();
    pub.disable('x-powered-by');
    pub.use(compression());
    const page = (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(publicDir, 'webot.html')); };
    pub.get(['/', '/webot', '/warningcenter/webot'], page);
    pub.get('/warningcenter/api/v3/webot/status', async (req, res) => {
      try {
        res.set('Cache-Control', 'public, max-age=3');
        res.json(await webotStatus());
      } catch {
        res.status(503).json({ ok: false });
      }
    });
    pub.get('/warningcenter/public/assets/webot.png', (req, res) => res.sendFile(path.join(publicDir, 'assets', 'webot.png'), { maxAge: '1d' }));
    pub.use('/warningcenter/public/assets/fonts', express.static(path.join(publicDir, 'assets', 'fonts'), { maxAge: '7d', index: false }));
    pub.get('/favicon.ico', (req, res) => res.type('image/png').sendFile(path.join(publicDir, 'assets', 'wp-logo.png')));
    pub.use((req, res) => res.status(404).type('text').send('Not found'));
    pub.listen(statusPort, config.host, () => console.log(`WeBot status page: http://${config.host}:${statusPort}/`));
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Warning card service received ${signal}; closing render workers.`);
    server.close();
    await closeRenderer().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
};

startServer().catch((error) => {
  console.error(`Warning card service failed to start: ${error.stack || error.message}`);
  process.exitCode = 1;
});
