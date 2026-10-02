// Live stream support: activity index with history, storm reports, nearest-radar loops and the
// stream control store (pin an alert, focus a state, make the bot talk, banner messages).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { dataDir, ensureRuntimeDirs, publicDir, replaceFile } from './paths.js';
import { fetchStormReports } from './localWeather.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const IEM_TILES = `${IEM}/cache/tile.py/1.0.0`;
const IEM_HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app' };
const indexPath = path.join(dataDir, 'live-index.json');
const controlPath = path.join(dataDir, 'live-control.json');
const INDEX_BUCKET_MS = 10 * 60 * 1000;
const INDEX_HISTORY_MS = 24 * 60 * 60 * 1000;

const fetchJson = async (url, timeoutMs = 10000) => {
  const response = await fetch(url, { headers: IEM_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
};

const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';

/* ---------------- tallies + WeatherPower Index ---------------- */

export const talliesFor = (alerts = []) => {
  const count = (re) => alerts.filter((alert) => re.test(alert.event || '')).length;
  return {
    tor: count(/^tornado warning$/i),
    svr: count(/^severe thunderstorm warning$/i),
    ffw: count(/^flash flood warning$/i),
    torWatch: count(/^tornado watch$/i),
    svrWatch: count(/^severe thunderstorm watch$/i),
    warnings: alerts.filter((alert) => alert.group === 'warnings').length,
    watches: alerts.filter((alert) => alert.group === 'watches').length,
    mds: alerts.filter((alert) => alert.group === 'discussions').length,
    emergencies: alerts.filter((alert) => alert.rank === 0).length
  };
};

const SPC_RISK_POINTS = { TSTM: 0.5, MRGL: 1, SLGT: 2.5, ENH: 5, MDT: 10, HIGH: 18 };
const SPC_RISK_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];

export const spcDay1Risk = (alerts = []) => {
  let best = -1;
  for (const alert of alerts) {
    if (alert.group !== 'outlooks' || !/day 1/i.test(alert.eventLabel || '')) continue;
    const risk = (alert.hazards || []).find((chip) => chip.label === 'RISK')?.value;
    best = Math.max(best, SPC_RISK_ORDER.indexOf(String(risk || '').toUpperCase()));
  }
  return best >= 0 ? SPC_RISK_ORDER[best] : null;
};

// Weight per alert, then diminishing returns per event type so 70 river flood warnings
// do not outweigh one tornado warning.
const weightFor = (alert) => {
  const event = String(alert.event || '');
  const threat = String(alert.threat || '');
  if (alert.rank === 0) return 14;
  if (/^tornado warning$/i.test(event)) return alert.rank === 1 ? 12 : /observed|confirmed/i.test(threat) ? 8 : 6;
  if (/^severe thunderstorm warning$/i.test(event)) return /destructive/i.test(threat) ? 4 : /considerable/i.test(threat) ? 2.5 : 1.5;
  if (/^flash flood warning$/i.test(event)) return /considerable/i.test(threat) ? 3 : 1.5;
  if (/^tornado watch$/i.test(event)) return alert.rank === 1 ? 8 : 3;
  if (/^severe thunderstorm watch$/i.test(event)) return 1.5;
  if (/^hurricane warning$/i.test(event)) return 5;
  if (/^(tropical storm|storm surge|extreme wind) warning$/i.test(event)) return 1;
  if (alert.group === 'discussions') return 0.6;
  if (alert.group === 'outlooks' || alert.group === 'forecasts') return 0;
  if (!(alert.states || []).length) return 0.03;
  if (/^flood warning$/i.test(event)) return 0.04;
  if (alert.group === 'warnings') return 0.06;
  if (alert.group === 'watches') return 0.1;
  return 0.03;
};

export const indexValueFor = (alerts = []) => {
  const byEvent = new Map();
  for (const alert of alerts) {
    const weight = weightFor(alert);
    if (!weight) continue;
    const entry = byEvent.get(alert.event) || { sum: 0, n: 0 };
    entry.sum += weight;
    entry.n += 1;
    byEvent.set(alert.event, entry);
  }
  let value = 0;
  // Background hazards (river floods, gales, heat) flatten out faster than storm warnings do.
  for (const { sum, n } of byEvent.values()) value += (sum / n) * n ** (sum / n < 0.5 ? 0.6 : 0.75);
  value += SPC_RISK_POINTS[spcDay1Risk(alerts)] || 0;
  return Math.round(value * 100) / 100;
};

export const indexLabelFor = (value) => {
  if (value < 5) return 'QUIET';
  if (value < 12) return 'ACTIVE';
  if (value < 30) return 'BUSY';
  if (value < 70) return 'SEVERE';
  return 'EXTREME';
};

let indexStore = null;
const loadIndex = async () => {
  if (indexStore) return indexStore;
  try {
    indexStore = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {
    indexStore = { history: [] };
  }
  indexStore.history ||= [];
  return indexStore;
};

export const recordIndex = async (value) => {
  const store = await loadIndex();
  const now = Date.now();
  const bucket = now - (now % INDEX_BUCKET_MS);
  const last = store.history[store.history.length - 1];
  if (last && last.t === bucket) {
    last.v = Math.max(last.v, value);
    return store;
  }
  store.history = [...store.history.filter((point) => point.t > now - INDEX_HISTORY_MS), { t: bucket, v: value }];
  await ensureRuntimeDirs();
  const temp = `${indexPath}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store));
  await replaceFile(temp, indexPath).catch(() => {});
  return store;
};

export const indexSummary = async (alerts) => {
  const value = indexValueFor(alerts);
  const store = await recordIndex(value);
  const hourAgo = store.history.filter((point) => point.t <= Date.now() - 55 * 60 * 1000).pop();
  return {
    value,
    label: indexLabelFor(value),
    delta1h: hourAgo ? Math.round((value - hourAgo.v) * 100) / 100 : null,
    spcDay1: spcDay1Risk(alerts),
    history: store.history.map((point) => [point.t, point.v])
  };
};

/* ---------------- storm reports ---------------- */

let reportsCache = { at: 0, body: null };
export const recentReports = async () => {
  if (reportsCache.body && Date.now() - reportsCache.at < 2 * 60 * 1000) return reportsCache.body;
  try {
    const body = await fetchStormReports({ hours: 3, limit: 250 });
    reportsCache = {
      at: Date.now(),
      body: (body.reports || []).filter((report) => report.geometry).map((report) => ({
        id: report.id,
        type: report.type,
        magnitude: report.magnitude,
        city: report.city,
        state: report.state,
        time: report.time,
        remark: String(report.remark || '').slice(0, 160),
        lon: report.geometry.coordinates[0],
        lat: report.geometry.coordinates[1]
      }))
    };
  } catch (error) {
    if (!reportsCache.body) reportsCache = { at: Date.now() - 60 * 1000, body: [] };
  }
  return reportsCache.body;
};

/* ---------------- NEXRAD sites + single-site loops ---------------- */

let sitesCache = { at: 0, body: null };
export const nexradSites = async () => {
  if (sitesCache.body && Date.now() - sitesCache.at < 24 * 60 * 60 * 1000) return sitesCache.body;
  try {
    const body = await fetchJson(`${IEM}/geojson/network/NEXRAD.geojson`, 15000);
    sitesCache = {
      at: Date.now(),
      body: (body.features || [])
        .filter((feature) => feature.properties?.online !== false && feature.geometry?.coordinates)
        .map((feature) => ({
          id: feature.id,
          name: feature.properties.sname,
          state: feature.properties.state,
          lon: feature.geometry.coordinates[0],
          lat: feature.geometry.coordinates[1]
        }))
    };
  } catch {
    if (!sitesCache.body) return [];
  }
  return sitesCache.body;
};

const siteRadarCache = new Map();
export const siteRadar = async (siteInput) => {
  const site = String(siteInput || '').toUpperCase().replace(/^K(?=[A-Z]{3}$)/, '');
  if (!/^[A-Z0-9]{3}$/.test(site)) throw Object.assign(new Error('Unknown radar site'), { status: 400 });
  const cached = siteRadarCache.get(site);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.body;
  const end = Date.now();
  const start = end - 75 * 60 * 1000;
  const list = async (product) => {
    const body = await fetchJson(`${IEM}/json/radar.py?operation=list&radar=${site}&product=${product}&start=${isoMinute(start)}&end=${isoMinute(end)}`);
    return (body.scans || []).map((scan) => scan.ts).filter(Boolean).slice(-10);
  };
  const tile = (product, ts) => `${IEM_TILES}/ridge::${site}-${product}-${ts.replace(/[-:TZ]/g, '').slice(0, 12)}/{z}/{x}/{y}.png`;
  const [refl, vel] = await Promise.all([list('N0B').catch(() => []), list('N0S').catch(() => [])]);
  const body = {
    site,
    reflectivity: refl.map((ts) => ({ time: ts, tiles: tile('N0B', ts) })),
    velocity: vel.length ? { time: vel[vel.length - 1], tiles: tile('N0S', vel[vel.length - 1]) } : null,
    product: 'N0B',
    tilt: '0.5°'
  };
  siteRadarCache.set(site, { at: Date.now(), body });
  if (siteRadarCache.size > 60) siteRadarCache.delete(siteRadarCache.keys().next().value);
  return body;
};

/* ---------------- stream control ---------------- */

export const MUSIC_SOURCES = ['auto', 'radio', 'files'];
export const MUSIC_MOODS = ['auto', 'calm', 'chill', 'tense'];
export const TTS_ENGINES = ['neural', 'openai', 'browser'];
// Kokoro voices (free, run inside the stream page). The af_/am_ ones are American, bf_/bm_ British.
export const NEURAL_VOICES = [
  'am_michael', 'am_fenrir', 'am_puck', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_adam',
  'af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'af_kore', 'af_sarah', 'af_nova', 'af_sky', 'af_alloy', 'af_jessica', 'af_river',
  'bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'
];
export const OPENAI_VOICES = ['onyx', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'sage', 'shimmer', 'alloy', 'verse'];

const DEFAULT_MUSIC = { on: true, volume: 35, source: 'auto', mood: 'auto', duck: true };
const DEFAULT_TTS = { engine: 'neural', voice: 'am_michael', openaiVoice: 'onyx', speed: 1 };
const DEFAULT_CONTROL = { rev: 0, pin: null, state: '', mode: 'auto', voice: true, sound: true, banner: null, music: DEFAULT_MUSIC, tts: DEFAULT_TTS, commands: [] };
let control = null;

const loadControl = async () => {
  if (control) return control;
  try {
    const saved = JSON.parse(await fs.readFile(controlPath, 'utf8'));
    control = { ...DEFAULT_CONTROL, ...saved, music: { ...DEFAULT_MUSIC, ...saved.music }, tts: { ...DEFAULT_TTS, ...saved.tts } };
  } catch {
    control = { ...DEFAULT_CONTROL };
  }
  return control;
};

// The stream page reports what it is playing on every poll so the control panel can show it.
// Memory only: it is just a display hint, and anyone can load the stream page.
let streamBeat = null;
export const noteStreamBeat = (query = {}) => {
  if (!query.np && !query.tts) return;
  const clip = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
  streamBeat = {
    at: new Date().toISOString(),
    playing: clip(query.np, 90),
    mood: MUSIC_MOODS.includes(query.mood) ? query.mood : '',
    tts: clip(query.tts, 40)
  };
};

/* ---------------- background music files ---------------- */

const MUSIC_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
const musicDir = path.join(publicDir, 'music');
let musicCache = { at: 0, tracks: [] };

// "Artist - Title.mp3" shows as Title by Artist. Leading track numbers ("03 ") are dropped.
export const trackTitle = (file) => {
  const base = file.replace(MUSIC_EXT, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim();
  const [artist, ...rest] = base.split(/\s+-\s+/);
  return rest.length ? { title: rest.join(' - '), artist } : { title: base, artist: '' };
};

export const musicTracks = async () => {
  if (Date.now() - musicCache.at < 60 * 1000) return musicCache.tracks;
  let files = [];
  try {
    files = (await fs.readdir(musicDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && MUSIC_EXT.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {}
  const tracks = files.map((file) => ({ ...trackTitle(file), url: '/public/music/' + encodeURIComponent(file) }));
  musicCache = { at: Date.now(), tracks };
  return tracks;
};

const saveControl = async () => {
  await ensureRuntimeDirs();
  const temp = `${controlPath}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(control, null, 1));
  await replaceFile(temp, controlPath);
};

export const liveControl = async () => {
  const current = await loadControl();
  const now = Date.now();
  return {
    ...current,
    banner: current.banner && Date.parse(current.banner.until) > now ? current.banner : null,
    commands: current.commands.filter((command) => now - Date.parse(command.at) < 5 * 60 * 1000),
    stream: streamBeat && now - Date.parse(streamBeat.at) < 60 * 1000 ? streamBeat : null
  };
};

const cleanText = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export const applyLiveCommand = async (body = {}) => {
  const current = await loadControl();
  const action = String(body.action || '');
  const pushCommand = (command) => {
    current.commands = [...current.commands, { id: current.rev + 1, at: new Date().toISOString(), ...command }].slice(-20);
  };
  if (action === 'ping') return liveControl();
  switch (action) {
    case 'pin':
      current.pin = cleanText(body.key, 400) || null;
      break;
    case 'unpin':
      current.pin = null;
      break;
    case 'state':
      current.state = /^[A-Z]{2}$/.test(String(body.state || '').toUpperCase()) ? String(body.state).toUpperCase() : '';
      break;
    case 'mode':
      current.mode = ['auto', 'national', 'outlook', 'reports', 'models'].includes(body.mode) ? body.mode : 'auto';
      break;
    case 'voice':
      current.voice = Boolean(body.on);
      break;
    case 'sound':
      current.sound = Boolean(body.on);
      break;
    case 'banner': {
      const text = cleanText(body.text, 160);
      const minutes = Math.min(720, Math.max(1, Number(body.minutes) || 30));
      current.banner = text ? { text, until: new Date(Date.now() + minutes * 60 * 1000).toISOString() } : null;
      break;
    }
    case 'say': {
      const text = cleanText(body.text, 300);
      if (!text) throw Object.assign(new Error('Nothing to say'), { status: 400 });
      pushCommand({ type: 'say', text });
      break;
    }
    case 'next':
      pushCommand({ type: 'next' });
      break;
    case 'test-breaking':
      pushCommand({ type: 'test-breaking', key: cleanText(body.key, 400) || null });
      break;
    case 'reload':
      pushCommand({ type: 'reload' });
      break;
    case 'music': {
      const music = { ...current.music };
      if ('on' in body) music.on = Boolean(body.on);
      if ('volume' in body) music.volume = Math.round(Math.min(100, Math.max(0, Number(body.volume) || 0)));
      if (MUSIC_SOURCES.includes(body.source)) music.source = body.source;
      if (MUSIC_MOODS.includes(body.mood)) music.mood = body.mood;
      if ('duck' in body) music.duck = Boolean(body.duck);
      current.music = music;
      break;
    }
    case 'music-next':
      pushCommand({ type: 'music-next' });
      break;
    case 'tts': {
      const tts = { ...current.tts };
      if (TTS_ENGINES.includes(body.engine)) tts.engine = body.engine;
      if (NEURAL_VOICES.includes(body.voice)) tts.voice = body.voice;
      if (OPENAI_VOICES.includes(body.openaiVoice)) tts.openaiVoice = body.openaiVoice;
      if ('speed' in body) tts.speed = Math.round(Math.min(1.4, Math.max(0.7, Number(body.speed) || 1)) * 100) / 100;
      current.tts = tts;
      break;
    }
    default:
      throw Object.assign(new Error(`Unknown action "${action}"`), { status: 400 });
  }
  current.rev += 1;
  await saveControl();
  return liveControl();
};

// Stream control must never fall open: unlike other controller routes it requires a token to be configured.
export const requireLiveToken = (req, res, next) => {
  if (!config.controllerToken) {
    res.status(403).json({ ok: false, error: 'Set CONTROLLER_TOKEN on the server to use the stream control panel' });
    return;
  }
  const token = req.get('x-controller-token') || req.body?.token;
  if (token === config.controllerToken) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: 'Wrong control token' });
};
