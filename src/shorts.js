// Warning shorts queue: one video render at a time, in a child process, deduped per alert polygon.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { chromiumTmpDir, dataDir, ensureRuntimeDirs, projectRoot, replaceFile } from './paths.js';
import { appendLog } from './logStore.js';

const storePath = path.join(dataDir, 'shorts.json');
const workerPath = fileURLToPath(new URL('./renderShortWorker.js', import.meta.url));

let store = null;
let saving = Promise.resolve();
const queue = [];
let active = null;
const requestLog = new Map();

const shortHash = (warning) => crypto.createHash('sha1').update(JSON.stringify({
  v: 'short-v1',
  event: warning.event,
  expiresAt: warning.expiresAt,
  geometry: warning.geometry || warning.polygon
})).digest('hex').slice(0, 16);

const isEligibleEvent = (warning = {}) => {
  const classification = warning.classification || {};
  if (classification.isForecast || classification.isOutlook || classification.isDiscussion) return false;
  if (!warning.geometry && !(warning.polygon || []).length) return false;
  return true;
};

export const isAutoShortTarget = (warning = {}) => {
  if (!isEligibleEvent(warning)) return false;
  const classification = warning.classification || {};
  if (classification.isEmergency || classification.isPds || classification.isDestructive) return true;
  return config.shorts.autoEvents.test(String(warning.event || ''));
};

const load = async () => {
  if (store) return store;
  await ensureRuntimeDirs();
  try {
    store = JSON.parse(await fs.readFile(storePath, 'utf8'));
  } catch {
    store = { items: {} };
  }
  store.items ||= {};
  // The in-memory queue does not survive restarts; release stranded jobs so they can requeue.
  for (const entry of Object.values(store.items)) {
    if (entry.status === 'queued' || entry.status === 'rendering') entry.status = entry.short ? 'ready' : 'idle';
    entry.sig ||= shortSig(entry);
  }
  return store;
};

const save = () => {
  saving = saving.then(async () => {
    const temp = `${storePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store, null, 1));
    await replaceFile(temp, storePath);
  }).catch((error) => console.warn(`Shorts store save failed: ${error.message}`));
  return saving;
};

const removeFiles = async (short) => {
  for (const publicPath of [short?.path, short?.posterPath]) {
    if (!publicPath) continue;
    await fs.rm(path.join(projectRoot, publicPath.replace(/^\//, '')), { force: true });
  }
};

export const pruneShorts = async () => {
  await load();
  const cutoff = Date.now() - config.shorts.retentionHours * 3600 * 1000;
  let changed = false;
  for (const [key, entry] of Object.entries(store.items)) {
    const expires = Date.parse(entry.expiresAt || '');
    const ended = Number.isFinite(expires) ? expires : Date.parse(entry.updatedAt || '') || 0;
    if (ended < cutoff) {
      await removeFiles(entry.short);
      for (const old of entry.history || []) await removeFiles(old);
      delete store.items[key];
      changed = true;
    }
  }
  if (changed) await save();
  // Remove video files that no store entry references (crashed renders, manual test renders).
  const referenced = new Set(Object.values(store.items).flatMap((entry) => [entry.short, ...(entry.history || [])])
    .flatMap((short) => [short?.path, short?.posterPath]).filter(Boolean).map((p) => path.basename(p)));
  const dir = path.join(projectRoot, 'cards', 'shorts');
  for (const file of await fs.readdir(dir).catch(() => [])) {
    if (referenced.has(file)) continue;
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(filePath, { force: true });
  }
};

const publicEntry = (key, entry) => entry && ({
  key,
  status: entry.status,
  event: entry.event,
  areaDesc: entry.areaDesc,
  expiresAt: entry.expiresAt,
  updatedAt: entry.updatedAt,
  error: entry.status === 'error' ? 'Render failed' : undefined,
  queuePosition: entry.status === 'queued' ? queue.findIndex((job) => job.key === key) + 1 || undefined : undefined,
  short: entry.short ? {
    url: `${config.publicBaseUrl}${entry.short.path}`,
    path: entry.short.path,
    posterPath: entry.short.posterPath,
    posterUrl: `${config.publicBaseUrl}${entry.short.posterPath}`,
    format: entry.short.format,
    width: entry.short.width,
    height: entry.short.height,
    duration: entry.short.duration,
    bytes: entry.short.bytes,
    renderedAt: entry.short.renderedAt,
    radarValidAt: entry.short.radarValidAt,
    radarProducts: entry.short.radarProducts
  } : null
});

// NWS gives a warning a new ID on every update (hurricanes and surge every few hours), so a short is also
// found by "same warning": event + area. Without this, finished shorts stop showing after an update.
export const shortSig = (w = {}) => [w.event, w.areaDesc].map((s) => String(s || '').trim().toLowerCase()).join('|');
const SAME_WARNING_MS = Math.max(0, Number(process.env.SHORTS_SAME_WARNING_HOURS ?? 3)) * 3600000;

const newestBySig = (sig) => {
  let best = null;
  for (const [key, entry] of Object.entries(store.items)) {
    if (entry.sig !== sig || !entry.short) continue;
    if (!best || Date.parse(entry.short.renderedAt || 0) > Date.parse(best[1].short.renderedAt || 0)) best = [key, entry];
  }
  return best;
};

export const getShort = async (key, warning = null) => {
  await load();
  const entry = store.items[key];
  if (!entry?.short && warning) {
    const found = newestBySig(shortSig(warning));
    if (found) return { ...publicEntry(found[0], found[1]), key, status: entry?.status === 'queued' || entry?.status === 'rendering' ? entry.status : 'ready' };
  }
  return publicEntry(key, entry) || null;
};

export const listShorts = async ({ readyOnly = true } = {}) => {
  await load();
  const now = Date.now();
  return Object.entries(store.items)
    .filter(([, entry]) => !readyOnly || entry.short)
    .filter(([, entry]) => !Date.parse(entry.expiresAt || '') || Date.parse(entry.expiresAt) > now)
    .map(([key, entry]) => publicEntry(key, entry))
    .sort((a, b) => Date.parse(b.short?.renderedAt || b.updatedAt || 0) - Date.parse(a.short?.renderedAt || a.updatedAt || 0));
};

export const shortsByKey = async () => {
  await load();
  const map = new Map();
  for (const [key, entry] of Object.entries(store.items)) {
    const value = {
      status: entry.status,
      path: entry.short?.path,
      posterPath: entry.short?.posterPath,
      renderedAt: entry.short?.renderedAt
    };
    map.set(key, value);
    const sigKey = entry.sig && `sig:${entry.sig}`;
    if (sigKey && value.path && !(Date.parse(map.get(sigKey)?.renderedAt || 0) > Date.parse(value.renderedAt || 0))) map.set(sigKey, value);
  }
  return map;
};

const runWorker = (warning, options) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: { ...process.env, ...(config.useServerlessChromium ? { TMPDIR: chromiumTmpDir } : {}) },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), config.shorts.timeoutMs);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0) return reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `Short worker exited ${code}`));
    try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`Short worker returned invalid JSON: ${error.message}`)); }
  });
  child.stdin.end(JSON.stringify({ warning, options }));
});

const drain = async () => {
  if (active || !queue.length) return;
  const job = queue.shift();
  active = job;
  const entry = store.items[job.key];
  entry.status = 'rendering';
  entry.updatedAt = new Date().toISOString();
  await save();
  try {
    const short = await runWorker(job.warning, { format: config.shorts.format });
    if (entry.short) {
      entry.history = [...(entry.history || []), entry.short].slice(-3);
    }
    entry.short = short;
    entry.status = 'ready';
    entry.hash = job.hash;
    await appendLog({ level: 'info', action: 'render-short', warningTitle: job.warning.title, message: `${short.path} in ${Math.round(short.renderMs / 1000)}s` });
  } catch (error) {
    entry.status = entry.short ? 'ready' : 'error';
    entry.lastError = error.message.slice(0, 500);
    await appendLog({ level: 'error', action: 'render-short', warningTitle: job.warning.title, message: error.message.slice(0, 500) });
  } finally {
    entry.updatedAt = new Date().toISOString();
    active = null;
    await save();
    setImmediate(() => void drain());
  }
};

// Queue a render unless this exact polygon already has a short (or is queued).
export const queueShort = async (warning, { reason = 'auto', force = false } = {}) => {
  if (!config.shorts.enabled) return { queued: false, reason: 'Shorts are disabled' };
  if (!isEligibleEvent(warning)) return { queued: false, reason: 'This product has no warning polygon to film' };
  await load();
  const key = warning.key || warning.nwsId;
  const expires = Date.parse(warning.expiresAt || '');
  if (Number.isFinite(expires) && expires - Date.now() < 8 * 60 * 1000) return { queued: false, reason: 'Alert expires too soon' };
  const hash = shortHash(warning);
  const entry = store.items[key];
  if (!force && entry && (entry.status === 'queued' || entry.status === 'rendering')) return { queued: true, existing: true };
  if (!force && entry?.hash === hash && entry.short) return { queued: false, ready: true };
  if (!force && entry?.status === 'error' && entry.hash === hash && Date.now() - Date.parse(entry.updatedAt || 0) < 15 * 60 * 1000) {
    return { queued: false, reason: 'Recent render failed; retrying later' };
  }
  const sig = shortSig(warning);
  if (!force) {
    // Same warning under an older NWS ID: reuse it instead of filming it again every update.
    const same = Object.entries(store.items).filter(([k, e]) => k !== key && e.sig === sig);
    if (same.some(([, e]) => e.status === 'queued' || e.status === 'rendering')) return { queued: true, existing: true };
    const fresh = newestBySig(sig);
    if (fresh && reason === 'auto' && Date.now() - Date.parse(fresh[1].short.renderedAt || 0) < SAME_WARNING_MS) return { queued: false, ready: true };
    if (same.some(([, e]) => e.status === 'error' && Date.now() - Date.parse(e.updatedAt || 0) < 15 * 60 * 1000)) {
      return { queued: false, reason: 'Recent render failed; retrying later' };
    }
  }
  if (queue.length >= config.shorts.maxQueue) return { queued: false, reason: 'Render queue is full; try again in a few minutes' };
  store.items[key] = {
    ...(entry || {}),
    status: 'queued',
    sig,
    pendingHash: hash,
    event: warning.event,
    areaDesc: warning.areaDesc,
    expiresAt: warning.expiresAt,
    reason,
    updatedAt: new Date().toISOString()
  };
  const job = { key, hash, warning };
  if (reason === 'auto') queue.push(job);
  else queue.unshift(job);
  await save();
  setImmediate(() => void drain());
  return { queued: true };
};

// Public, rate-limited request from the Warning Center ("Make a video").
export const requestShort = async (warning, clientKey = 'anon') => {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (requestLog.get(clientKey) || []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= config.shorts.publicRequestsPerWindow) {
    const error = new Error('Too many video requests; try again in a few minutes');
    error.status = 429;
    error.retryAfterSeconds = Math.ceil((windowMs - (now - recent[0])) / 1000);
    throw error;
  }
  const result = await queueShort(warning, { reason: 'request' });
  if (result.queued && !result.existing) {
    recent.push(now);
    requestLog.set(clientKey, recent);
  }
  return result;
};

// Called after each auto-render cycle with the current alert list.
export const queueAutoShorts = async (warnings = []) => {
  if (!config.shorts.enabled || !config.shorts.autoEnabled) return;
  await pruneShorts();
  const targets = warnings.filter(isAutoShortTarget);
  let added = 0;
  for (const warning of targets) {
    if (added >= config.shorts.autoMaxPerCycle) break;
    const result = await queueShort(warning, { reason: 'auto' });
    if (result.queued && !result.existing) added += 1;
  }
};

export const shortsStatus = () => ({
  enabled: config.shorts.enabled,
  autoEnabled: config.shorts.autoEnabled,
  format: config.shorts.format,
  queueLength: queue.length,
  rendering: active ? active.key : null
});
