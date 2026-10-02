// Renders a warning "short": a 15-second radar + polygon video with broadcast graphics.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { config } from './config.js';
import { cardsDir, chromiumTmpDir, ensureRuntimeDirs, publicDir } from './paths.js';
import { normalizeWarning } from './warning.js';
import { enrichWarningPopulation } from './population.js';
import { resolveNearestRadar } from './radar.js';
import { END_CARD_SECONDS, SHORT_FORMATS, warningShortHtml } from './shortHtml.js';

export const shortsDir = path.join(cardsDir, 'shorts');
const IEM_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
const IEM_COMPOSITE_META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
const LOOP_FRAMES = 18;
const LOOP_STEP_MINUTES = 5;

const resolveFfmpegPath = async () => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = (await import('ffmpeg-static')).default;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // Optional dependency; fall back to the system binary.
  }
  return 'ffmpeg';
};

export const compositeValidTime = async () => {
  try {
    const response = await fetch(IEM_COMPOSITE_META, { signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    const valid = Date.parse(body?.meta?.valid || '');
    if (Number.isFinite(valid)) return valid;
  } catch {
    // Fall back to the most recent 5-minute boundary minus processing lag.
  }
  const now = Date.now() - 6 * 60 * 1000;
  return now - (now % (LOOP_STEP_MINUTES * 60 * 1000));
};

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);

const isFloodFamily = (warning) => ['flash-flood', 'flood'].includes(warning.classification?.family);
const isRotationFamily = (warning) => ['tornado', 'severe'].includes(warning.classification?.family)
  && !warning.classification?.isWatch;

export const buildRadarPlan = async (warning, { duration = 15 } = {}) => {
  const valid = await compositeValidTime();
  const loopFrames = Array.from({ length: LOOP_FRAMES }, (_, index) => {
    const time = valid - (LOOP_FRAMES - 1 - index) * LOOP_STEP_MINUTES * 60 * 1000;
    return { id: `refl-${index}`, url: `${IEM_TILES}/ridge::USCOMP-N0Q-${stamp(time)}/{z}/{x}/{y}.png`, time };
  });
  const reflectivity = {
    kind: 'reflectivity', legend: 'reflectivity', title: 'RADAR', start: 0,
    frames: loopFrames, step: 0.2, hold: 0.8, opacity: 0.92, maxzoom: 11
  };

  let second = null;
  if (isFloodFamily(warning)) {
    second = {
      kind: 'rainfall', legend: 'rainfall', title: '24-HR RAIN ESTIMATE',
      frames: [{ id: 'rain-24h', url: `${IEM_TILES}/q2-p24h-900913/{z}/{x}/{y}.png`, time: valid }],
      step: 1, hold: 0, opacity: 0.55, maxzoom: 10
    };
  } else if (isRotationFamily(warning)) {
    let site = warning.radar?.site || '';
    if (!site) {
      const nearest = await resolveNearestRadar({ center: warning.center, issuedAt: new Date().toISOString() }).catch(() => null);
      if (nearest?.id && nearest.id !== 'USCOMP') site = nearest.id;
    }
    if (site) {
      second = {
        kind: 'velocity', legend: 'velocity', title: `${site} VELOCITY`,
        frames: [{ id: 'velocity', url: `${IEM_TILES}/ridge::${site}-N0U-0/{z}/{x}/{y}.png`, time: Date.now() }],
        step: 1, hold: 0, opacity: 0.72, maxzoom: 12
      };
    }
  }

  const segments = [reflectivity];
  if (second) {
    second.start = Math.round((duration - END_CARD_SECONDS) * 0.6 * 10) / 10;
    segments.push(second);
  }
  return { valid, segments };
};

let logoPromise;
let fontPromise;
const loadLogo = () => {
  logoPromise ||= fsp.readFile(path.join(publicDir, 'assets', 'wp-logo.png'))
    .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
    .catch(() => '');
  return logoPromise;
};
const loadFonts = () => {
  fontPromise ||= (async () => {
    const dir = path.join(publicDir, 'assets', 'fonts');
    const files = { oswald: 'oswald-latin.woff2', inter: 'inter-latin.woff2', ibmPlexMono600: 'ibm-plex-mono-600-latin.woff2' };
    const entries = await Promise.all(Object.entries(files).map(async ([name, file]) => (
      [name, `data:font/woff2;base64,${(await fsp.readFile(path.join(dir, file))).toString('base64')}`]
    )));
    return Object.fromEntries(entries);
  })();
  return fontPromise;
};

const launchBrowser = async () => {
  if (config.useServerlessChromium) {
    const serverlessChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({ headless: true, executablePath: await serverlessChromium.executablePath(), args: serverlessChromium.args });
  }
  return chromium.launch({
    headless: true,
    ...(config.renderer.browserChannel ? { channel: config.renderer.browserChannel } : {}),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
};

const startEncoder = async ({ outputPath, fps, size }) => {
  const ffmpeg = await resolveFfmpegPath();
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-vf', `scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', process.env.SHORTS_X264_PRESET || 'veryfast', '-crf', process.env.SHORTS_CRF || '21',
    '-r', String(fps), '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart', outputPath
  ];
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-600)}`))));
  });
  let pipeError = null;
  child.stdin.on('error', (error) => { pipeError = error; });
  const write = (buffer) => new Promise((resolve, reject) => {
    if (pipeError) { reject(pipeError); return; }
    if (child.stdin.write(buffer)) resolve();
    else child.stdin.once('drain', resolve);
  });
  return { write, finish: async () => { child.stdin.end(); await done; }, kill: () => child.kill('SIGKILL') };
};

export const prepareShortWarning = async (rawWarning) => {
  const normalized = normalizeWarning(rawWarning);
  const people = normalized.impacts?.people;
  if (people !== null && people !== undefined && people !== '' && Number.isFinite(Number(people))) return normalized;
  return enrichWarningPopulation(normalized).catch(() => normalized);
};

export const renderWarningShortDirect = async (rawWarning, {
  format = process.env.SHORTS_FORMAT || 'vertical',
  duration = Number(process.env.SHORTS_DURATION_SECONDS || 15),
  fps = Number(process.env.SHORTS_FPS || 30),
  onProgress
} = {}) => {
  await ensureRuntimeDirs();
  await fsp.mkdir(shortsDir, { recursive: true });
  const size = SHORT_FORMATS[format] || SHORT_FORMATS.vertical;
  const warning = await prepareShortWarning(rawWarning);
  const radarPlan = await buildRadarPlan(warning, { duration });
  const html = warningShortHtml({
    warning, radarPlan, format, duration,
    logoDataUrl: await loadLogo(),
    fontDataUrls: await loadFonts()
  });

  const id = crypto.randomUUID();
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}`;
  const videoName = `${base}.mp4`;
  const posterName = `${base}.jpg`;
  const videoPath = path.join(shortsDir, videoName);
  const posterPath = path.join(shortsDir, posterName);
  const tempPath = `${videoPath}.part.mp4`;

  if (config.useServerlessChromium) process.env.TMPDIR = chromiumTmpDir;
  const browser = await launchBrowser();
  let encoder;
  const started = Date.now();
  try {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__SHORT_READY === true, null, { timeout: 90000 });
    await page.evaluate(() => document.fonts?.ready);

    const cdp = await page.context().newCDPSession(page);
    const capture = async () => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
      return Buffer.from(data, 'base64');
    };
    encoder = await startEncoder({ outputPath: tempPath, fps, size });
    const totalFrames = Math.round(duration * fps);
    const posterFrame = Math.round(Math.min(duration - END_CARD_SECONDS - 0.5, 5.6) * fps);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const t = frame / fps;
      await page.evaluate((seconds) => window.__seek(seconds), t);
      const jpeg = await capture();
      await encoder.write(jpeg);
      if (frame === posterFrame) await fsp.writeFile(posterPath, jpeg);
      if (onProgress && frame % fps === 0) onProgress({ frame, totalFrames });
    }
    await encoder.finish();
    encoder = null;
    await fsp.rename(tempPath, videoPath);
  } catch (error) {
    encoder?.kill();
    await fsp.rm(tempPath, { force: true });
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }

  const stat = await fsp.stat(videoPath);
  return {
    id,
    format,
    width: size.width,
    height: size.height,
    duration,
    fps,
    renderMs: Date.now() - started,
    radarValidAt: new Date(radarPlan.valid).toISOString(),
    radarProducts: radarPlan.segments.map((segment) => segment.kind),
    filename: videoName,
    path: `/cards/shorts/${videoName}`,
    posterPath: `/cards/shorts/${posterName}`,
    bytes: stat.size,
    contentType: 'video/mp4',
    renderedAt: new Date().toISOString()
  };
};
