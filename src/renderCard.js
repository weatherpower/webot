import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import GIFEncoder from 'gif-encoder-2';
import { PNG } from 'pngjs';
import { config } from './config.js';
import { cardsDir, chromiumTmpDir, ensureRuntimeDirs, publicDir } from './paths.js';
import { CARD_SIZE, warningCardHtml } from './cardHtml.js';
import { normalizeWarning } from './warning.js';
import { enrichWarningRadar } from './radar.js';
import { enrichWarningTropical } from './nhc.js';
import { enrichWarningPopulation } from './population.js';

let logoDataUrlPromise;
let fontDataUrlsPromise;
let serverlessChromiumPromise;
let mapStylePromise;
const foregroundRenderQueue = [];
const backgroundRenderQueue = [];
let renderQueueActive = false;
const workerPath = fileURLToPath(new URL('./renderWorker.js', import.meta.url));
const activeBrowsers = new Set();
const activeWorkerProcesses = new Set();

const trackBrowser = (browser) => {
  activeBrowsers.add(browser);
  browser.once('disconnected', () => activeBrowsers.delete(browser));
  return browser;
};

const signalWorkerTree = (child, signal) => {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The worker may already have exited.
    }
  }
};

const getServerlessChromium = () => {
  if (!serverlessChromiumPromise) {
    serverlessChromiumPromise = import('@sparticuz/chromium').then((module) => module.default);
  }
  return serverlessChromiumPromise;
};

const launchBrowser = async () => {
  if (config.useServerlessChromium) {
    const serverlessChromium = await getServerlessChromium();
    return trackBrowser(await chromium.launch({
      headless: true,
      executablePath: await serverlessChromium.executablePath(),
      args: serverlessChromium.args
    }));
  }

  return trackBrowser(await chromium.launch({
    headless: true,
    ...(config.renderer.browserChannel ? { channel: config.renderer.browserChannel } : {}),
    args: ['--no-sandbox']
  }));
};

export const closeRenderer = async () => {
  const workers = [...activeWorkerProcesses];
  for (const child of workers) signalWorkerTree(child, 'SIGTERM');
  if (workers.length) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    for (const child of workers) {
      if (activeWorkerProcesses.has(child)) signalWorkerTree(child, 'SIGKILL');
    }
  }
  await Promise.allSettled([...activeBrowsers].map((browser) => browser.close()));
};

const isStaleBrowserError = (error) => (
  /browser has been closed|browser.newPage|target page|target closed|browser closed/i.test(error?.message || '')
);

const drainRenderQueue = async () => {
  if (renderQueueActive) return;
  renderQueueActive = true;
  try {
    while (foregroundRenderQueue.length || backgroundRenderQueue.length) {
      const job = foregroundRenderQueue.shift() || backgroundRenderQueue.shift();
      try {
        job.resolve(await job.task());
      } catch (error) {
        job.reject(error);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    renderQueueActive = false;
    if (foregroundRenderQueue.length || backgroundRenderQueue.length) {
      queueMicrotask(() => void drainRenderQueue());
    }
  }
};

const queueRender = (task, priority = 'foreground') => new Promise((resolve, reject) => {
  const queue = priority === 'background' ? backgroundRenderQueue : foregroundRenderQueue;
  queue.push({ task, resolve, reject });
  queueMicrotask(() => void drainRenderQueue());
});

const renderWarningCardsInWorker = (rawWarnings) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(config.useServerlessChromium ? { TMPDIR: chromiumTmpDir } : {}),
      RENDER_WORKER: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });
  activeWorkerProcesses.add(child);
  try {
    os.setPriority(child.pid, 10);
  } catch {
    // Shared hosts may not expose process-priority controls.
  }

  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  let forceKillTimer;

  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(workerTimer);
    clearTimeout(forceKillTimer);
    activeWorkerProcesses.delete(child);
    callback(value);
  };

  const workerTimer = setTimeout(() => {
    timedOut = true;
    signalWorkerTree(child, 'SIGTERM');
    forceKillTimer = setTimeout(() => {
      signalWorkerTree(child, 'SIGKILL');
      finish(reject, new Error(`Render worker timed out after ${config.renderer.workerTimeoutMs}ms`));
    }, 3000);
    forceKillTimer.unref?.();
  }, config.renderer.workerTimeoutMs);
  workerTimer.unref?.();

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.on('error', (error) => {
    // A worker that exits before consuming its payload closes this pipe first.
    // Its close handler reports the actual render failure.
    if (error?.code !== 'EPIPE') finish(reject, error);
  });
  child.on('error', (error) => finish(reject, error));
  child.on('close', (code) => {
    if (timedOut) {
      finish(reject, new Error(`Render worker timed out after ${config.renderer.workerTimeoutMs}ms`));
      return;
    }
    if (code !== 0) {
      finish(reject, new Error(stderr.trim() || `Render worker exited with code ${code}`));
      return;
    }
    try {
      finish(resolve, JSON.parse(stdout));
    } catch (error) {
      finish(reject, new Error(`Render worker returned invalid JSON: ${error.message}`));
    }
  });

  child.stdin.end(JSON.stringify(rawWarnings));
});

const getLogoDataUrl = async () => {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fs.readFile(path.join(publicDir, 'assets', 'wp-logo.png'))
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch(() => '');
  }
  return logoDataUrlPromise;
};

const getFontDataUrls = async () => {
  if (!fontDataUrlsPromise) {
    const fontDir = path.join(publicDir, 'assets', 'fonts');
    const fonts = {
      inter: 'inter-latin.woff2',
      oswald: 'oswald-latin.woff2',
      ibmPlexMono500: 'ibm-plex-mono-500-latin.woff2',
      ibmPlexMono600: 'ibm-plex-mono-600-latin.woff2',
      ibmPlexMono700: 'ibm-plex-mono-700-latin.woff2'
    };
    fontDataUrlsPromise = Promise.all(Object.entries(fonts).map(async ([name, filename]) => {
      const buffer = await fs.readFile(path.join(fontDir, filename));
      return [name, `data:font/woff2;base64,${buffer.toString('base64')}`];
    })).then(Object.fromEntries);
  }
  return fontDataUrlsPromise;
};

const getMapStyle = async () => {
  if (!mapStylePromise) {
    mapStylePromise = fetch(config.maps.styleUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.maps.requestTimeoutMs)
    }).then(async (response) => {
      if (!response.ok) throw new Error(`WeatherPower map style failed (${response.status})`);
      const style = await response.json();
      if (Array.isArray(style.sprite)) {
        style.sprite = style.sprite.map((entry) => ({
          ...entry,
          url: new URL(entry.url, config.maps.styleUrl).href
        }));
      } else if (typeof style.sprite === 'string') {
        style.sprite = new URL(style.sprite, config.maps.styleUrl).href;
      }
      return style;
    }).catch((error) => {
      mapStylePromise = undefined;
      throw error;
    });
  }
  return mapStylePromise;
};

const encodeGif = async ({ framePaths, outputPath, width = CARD_SIZE.width, height = CARD_SIZE.height }) => {
  const encoder = new GIFEncoder(width, height);
  encoder.setDelay(520);
  encoder.setRepeat(0);
  encoder.setQuality(10);
  encoder.start();

  for (const framePath of framePaths) {
    const png = PNG.sync.read(await fs.readFile(framePath));
    encoder.addFrame(png.data);
  }

  encoder.finish();
  await fs.writeFile(outputPath, encoder.out.getData());
};

const screenshotCard = async ({ browser, warning, logoDataUrl, fontDataUrls, mapStyle, staticMapDataUrl = '', outputPath }) => {
  const html = warningCardHtml({
    warning,
    mapConfig: { ...config.maps, style: mapStyle },
    logoDataUrl,
    fontDataUrls,
    staticMapDataUrl
  });
  const page = await browser.newPage({
    viewport: CARD_SIZE,
    deviceScaleFactor: 1
  });

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__CARD_READY === true, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    await page.waitForTimeout(650);
    await page.locator('#card').screenshot({
      path: outputPath,
      type: 'png',
      animations: 'disabled'
    });
  } finally {
    await page.close();
  }
};

const prepareWarningRender = async (rawWarning) => {
  const tropicalWarning = await enrichWarningTropical(normalizeWarning(rawWarning));
  const isForecast = tropicalWarning.cardLayout === 'forecast' || tropicalWarning.classification?.isForecast;
  const populationWarning = isForecast ? tropicalWarning : await enrichWarningPopulation(tropicalWarning);
  const warning = isForecast ? populationWarning : await enrichWarningRadar(populationWarning);
  const id = crypto.randomUUID();
  const extension = warning.classification?.renderAsGif ? 'gif' : 'png';
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.${extension}`;
  const filePath = path.join(cardsDir, filename);
  return { warning, id, extension, filename, filePath };
};

const forecastStaticMapDataUrl = async (warning, browser, mapStyle) => {
  const [lon, lat] = (warning.center || []).map(Number);
  if (!config.maps.styleUrl || !Number.isFinite(lon) || !Number.isFinite(lat)) return '';
  const page = await browser.newPage({
    viewport: CARD_SIZE,
    deviceScaleFactor: 1
  });
  const payload = JSON.stringify({
    style: mapStyle || config.maps.styleUrl,
    center: [lon, lat],
    zoom: Number(warning.zoom || 8.5)
  }).replaceAll('</script', '<\\/script');
  try {
    await page.setContent(`<!doctype html>
      <html><head><meta charset="utf-8">
      <link href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">
      <style>html,body,#map{width:100%;height:100%;margin:0;background:#15191f}.maplibregl-ctrl-container{display:none}</style>
      </head><body><div id="map"></div>
      <script>window.__WP_FORECAST_MAP__=${payload};<\/script>
      <script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"><\/script>
      <script>
        const data=window.__WP_FORECAST_MAP__;
        const map=new maplibregl.Map({container:'map',style:data.style,center:data.center,zoom:data.zoom,interactive:false,attributionControl:false,preserveDrawingBuffer:true});
        map.once('load',()=>map.once('idle',()=>{window.__WP_MAP_READY__=true;}));
        map.on('error',()=>{window.__WP_MAP_ERROR__=true;});
      <\/script></body></html>`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__WP_MAP_READY__ === true, null, { timeout: 15000 });
    const buffer = await page.locator('#map').screenshot({ type: 'png', animations: 'disabled' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } finally {
    await page.close();
  }
};

const renderPreparedWarning = async ({ browser, prepared, logoDataUrl, fontDataUrls, mapStyle }) => {
  const { warning, id, extension, filename, filePath, staticMapDataUrl } = prepared;
  if (extension === 'gif') {
    const frameA = path.join(cardsDir, `${id}-frame-a.png`);
    const frameB = path.join(cardsDir, `${id}-frame-b.png`);
    try {
      await screenshotCard({
        browser,
        warning: { ...warning, emergencyFlashFrame: false },
        logoDataUrl,
        fontDataUrls,
        mapStyle,
        staticMapDataUrl,
        outputPath: frameA
      });
      await screenshotCard({
        browser,
        warning: { ...warning, emergencyFlashFrame: true },
        logoDataUrl,
        fontDataUrls,
        mapStyle,
        staticMapDataUrl,
        outputPath: frameB
      });
      await encodeGif({ framePaths: [frameA, frameB], outputPath: filePath });
    } finally {
      await fs.rm(frameA, { force: true });
      await fs.rm(frameB, { force: true });
    }
  } else {
    await screenshotCard({
      browser,
      warning,
      logoDataUrl,
      fontDataUrls,
      mapStyle,
      staticMapDataUrl,
      outputPath: filePath
    });
  }

  const stat = await fs.stat(filePath);
  return {
    id,
    filename,
    filePath,
    publicPath: `/cards/${filename}`,
    bytes: stat.size,
    contentType: extension === 'gif' ? 'image/gif' : 'image/png',
    warning
  };
};

export const renderWarningCardsDirect = async (rawWarnings) => {
  const warnings = Array.isArray(rawWarnings) ? rawWarnings : [];
  if (!warnings.length) return [];
  await ensureRuntimeDirs();
  const preparedWarnings = [];
  for (const warning of warnings) preparedWarnings.push(await prepareWarningRender(warning));
  const isForecastBatch = preparedWarnings.every((prepared) => (
    prepared.warning.cardLayout === 'forecast' || prepared.warning.classification?.isForecast
  ));
  const logoDataUrl = await getLogoDataUrl();
  const fontDataUrls = await getFontDataUrls();
  const mapStyle = await getMapStyle().catch(() => null);
  let browser = await launchBrowser();
  if (isForecastBatch) {
    const staticMapDataUrl = await forecastStaticMapDataUrl(preparedWarnings[0].warning, browser, mapStyle).catch(() => '');
    for (const prepared of preparedWarnings) prepared.staticMapDataUrl = staticMapDataUrl;
  }
  const results = [];
  const pageConcurrency = isForecastBatch && warnings.length > 1
    ? (preparedWarnings[0].staticMapDataUrl ? 4 : 2)
    : 1;

  try {
    for (let index = 0; index < preparedWarnings.length; index += pageConcurrency) {
      const chunk = preparedWarnings.slice(index, index + pageConcurrency);
      const renderChunk = () => Promise.all(chunk.map((prepared) => (
        renderPreparedWarning({ browser, prepared, logoDataUrl, fontDataUrls, mapStyle })
      )));
      try {
        results.push(...await renderChunk());
      } catch (error) {
        if (!isStaleBrowserError(error)) throw error;
        await browser.close().catch(() => {});
        browser = await launchBrowser();
        results.push(...await renderChunk());
      }
    }
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
};

export const renderWarningCardDirect = async (rawWarning) => (
  (await renderWarningCardsDirect([rawWarning]))[0]
);

export const renderWarningCards = async (rawWarnings, { priority = 'foreground' } = {}) => {
  const warnings = Array.isArray(rawWarnings) ? rawWarnings : [];
  if (!warnings.length) return [];
  if (process.env.RENDER_WORKER === '1') {
    return renderWarningCardsDirect(warnings);
  }
  return queueRender(async () => {
    try {
      return await renderWarningCardsInWorker(warnings);
    } catch (error) {
      if (!isStaleBrowserError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
      return renderWarningCardsInWorker(warnings);
    }
  }, priority);
};

export const renderWarningCard = async (rawWarning, options) => {
  const renders = await renderWarningCards([rawWarning], options);
  return renders[0];
};
