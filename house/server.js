// WeatherPower Stream House: a warning map you run your own live streams from, plus WeBot's on-air look
// (bars, alert cards, breaking alerts, scenes) as a separate overlay.
//   Map you work on:      http://localhost:7788
//   Stream map (output):  http://localhost:7788/map       follows your map, clean, 1920x1080
//   Overlay (output):     http://localhost:7788/overlay   transparent, 1920x1080, goes on top
//   Program (output):     http://localhost:7788/program   stream map + overlay in one
// The "WeatherPower Stream House" program (desktop/) runs this server inside its own window.
//
// Weather data comes from your WeatherPower server (the same alerts, WIS and headlines WeBot uses),
// fetched here once and pushed to every overlay instantly. Only this computer can reach it.
import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const CONFIG_FILE = path.join(here, 'house.config.json');
const STATE_FILE = process.env.HOUSE_STATE_FILE || path.join(here, 'house.state.json');
const config = {
  port: 7788,
  // Where the weather comes from: your cloud server (Live Control port, home internet only), then the
  // WeatherPower server on this PC if you run one.
  dataSources: ['http://207.244.248.128:8899/warningcenter', 'http://localhost:8899/warningcenter'],
  ...(existsSync(CONFIG_FILE) ? JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) : {}),
  ...(process.env.HOUSE_PORT ? { port: Number(process.env.HOUSE_PORT) } : {})
};

/* ---------------- show state (what the overlay shows), saved between runs ---------------- */
const DEFAULT_STATE = {
  scene: 'live',                 // live | starting | brb | ending
  theme: 'auto',
  focus: '',                     // two-letter state: counts, headlines and breaking alerts for that state only
  layout: { top: true, bottom: true, tallies: true, wis: true, clock: true, brand: true, card: false, lower: false, webot: false },
  headlines: 'alertsweather',    // alertsweather | alerts | weather | mix | custom
  ticker: { messages: ['Ask WeBot! Type !forecast and your city in the 24/7 WeatherPower Live chat'], everyItems: 5 },
  bottom: { mode: 'auto', label: 'LIVE', title: 'WEATHERPOWER LIVE', crawl: 'LIVE SEVERE WEATHER COVERAGE · WARNINGS · RADAR · FORECASTS', alertKey: null },
  card: { alertKey: null },
  lower: { name: 'WeatherPower Live', title: 'Live severe weather coverage', autoHideSec: 15, shownAt: null },
  breaking: { auto: true, tor: true, svr: false, ffe: true, pds: true, style: 'full', sound: true, seconds: 7 },
  starting: { title: 'Starting soon', message: 'Live severe weather coverage is about to begin.', endsAt: null },
  brb: { message: 'Hang tight, live weather coverage is coming right back.' },
  ending: { title: 'Thanks for watching', message: 'WeBot keeps the 24/7 stream going on WeatherPower Live.' },
  brandText: 'WEATHERPOWER.APP',
  // The stream map: which layers it draws, which radar, and the warning you picked (it pulses on stream).
  map: {
    layers: { radar: true, warnings: true, watches: true, reports: true, velocity: false },
    radar: 'auto',               // national | site | auto (nearest radar site once you zoom in)
    site: '',
    opacity: 0.85,
    selected: '',
    showSelected: true,
    follow: 'smooth'             // mirror (moves with you) | smooth (flies there when you stop) | hold (only on Take)
  },
  view: { center: [-96, 38.6], zoom: 4.3, bearing: 0, pitch: 0 },
  rev: 0
};
const merge = (def, val) => {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], val && typeof val === 'object' ? val[k] : undefined);
    return out;
  }
  if (def === null) return val === undefined ? null : val;
  return val === undefined || typeof val !== typeof def ? def : val;
};
let state = merge(DEFAULT_STATE, existsSync(STATE_FILE) ? JSON.parse(await fs.readFile(STATE_FILE, 'utf8').catch(() => '{}')) : {});
let saveTimer = null;
const saveState = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2)).catch(() => {}), 400); };
// Deep-merge a patch from the control panel; arrays and plain values replace.
const applyPatch = (target, patch) => {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in target) && !(k in DEFAULT_STATE)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) applyPatch(target[k], v);
    else target[k] = v;
  }
};

/* ---------------- weather data from the WeatherPower server ---------------- */
const data = { alerts: [], tallies: {}, wis: null, reports: [], headlines: { weather: [], news: [] }, source: '', updatedAt: null, error: null };
// Shapes for the maps (kept out of the live pushes; the maps fetch them when updatedAt changes).
let shapes = { type: 'FeatureCollection', features: [] };
let sourceIdx = 0;
const fetchJson = async (p) => {
  let lastErr;
  for (let i = 0; i < config.dataSources.length; i++) {
    const base = config.dataSources[(sourceIdx + i) % config.dataSources.length];
    try {
      const r = await fetch(base + p, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(base + p + ' → ' + r.status);
      sourceIdx = (sourceIdx + i) % config.dataSources.length;
      data.source = base;
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
};
// Only what the overlays need (no shapes): keeps every push small.
const slim = (a) => ({
  key: a.key, event: a.event, eventLabel: a.eventLabel, group: a.group, rank: a.rank, color: a.color, status: a.status,
  place: a.place, area: a.area, areaDesc: a.areaDesc, states: a.states || [], office: a.office, threat: a.threat,
  hazards: (a.hazards || []).slice(0, 6), summary: a.summary, people: a.people, times: a.times, issuedAt: a.issuedAt, expiresAt: a.expiresAt
});
const seen = new Set();
let primed = false;
const BREAK_RULES = [
  ['tor', (a) => /^tornado warning$/i.test(a.event)],
  ['svr', (a) => /^severe thunderstorm warning$/i.test(a.event)],
  ['ffe', (a) => /flash flood emergency|tornado emergency/i.test(a.eventLabel || '') || a.rank === 0],
  ['pds', (a) => /particularly dangerous|PDS/i.test(a.threat || '') || /destructive|considerable/i.test(a.threat || '')]
];
const loadAlerts = async () => {
  try {
    const body = await fetchJson('/api/v3/alerts');
    const full = (body.alerts || []).filter((a) => ['warnings', 'watches', 'statements', 'discussions'].includes(a.group));
    data.alerts = full.map(slim);
    shapes = {
      type: 'FeatureCollection',
      features: full.filter((a) => a.geometry).map((a) => ({
        type: 'Feature', geometry: a.geometry,
        properties: { key: a.key, color: a.accent || a.color || '#888', rank: a.rank ?? 9, group: a.group }
      })).sort((x, y) => y.properties.rank - x.properties.rank)
    };
    data.updatedAt = new Date().toISOString();
    data.error = null;
    // New alerts only (nothing fires for what was already out when Stream House started).
    for (const a of data.alerts) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      if (!primed) continue;
      if (a.group === 'warnings' || a.group === 'watches') broadcast('new', a);
      if (!state.breaking.auto || (state.focus && !a.states.includes(state.focus))) continue;
      if (BREAK_RULES.some(([k, test]) => state.breaking[k] && test(a))) broadcast('breaking', { alert: a, test: false });
    }
    primed = true;
    broadcast('data', data);
  } catch (e) {
    data.error = e.message;
    broadcast('data', data);
  }
};
const loadLive = async () => {
  try {
    const body = await fetchJson('/api/v3/live');
    data.tallies = body.tallies || {};
    data.reports = (body.reports || []).slice(0, 400).map((r) => ({ type: r.type, magnitude: r.magnitude, city: r.city, state: r.state, time: r.time, remark: r.remark, lon: r.lon, lat: r.lat }));
    data.wis = body.wis?.loaded ? { score: body.wis.score, label: body.wis.label, level: body.wis.level, ago30: body.wis.ago30, history: (body.wis.history || []).slice(-60) } : null;
    broadcast('data', data);
  } catch {}
};
const loadHeadlines = async () => {
  try { data.headlines = await fetchJson('/api/v3/headlines'); broadcast('data', data); } catch {}
};
setInterval(loadAlerts, 20000);
setInterval(loadLive, 15000);
setInterval(loadHeadlines, 10 * 60 * 1000);

/* ---------------- live updates (Server-Sent Events) ---------------- */
const clients = new Set();
const broadcast = (type, payload) => {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
};
const pushState = () => { state.rev += 1; saveState(); broadcast('state', state); };

/* ---------------- app ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ''))) return res.status(403).send('Local only');
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return res.status(403).json({ error: 'Blocked' });
  next();
});
app.use(express.static(path.join(here, 'public'), { index: 'index.html' }));
app.use('/assets', express.static(path.join(projectRoot, 'public', 'assets'), { maxAge: '1d' }));
app.get('/overlay', (req, res) => res.sendFile(path.join(here, 'public', 'overlay.html')));
app.get('/map', (req, res) => res.sendFile(path.join(here, 'public', 'map.html')));
app.get('/program', (req, res) => res.sendFile(path.join(here, 'public', 'program.html')));

/* ---------------- map data: shapes, radar, radar sites, base map ---------------- */
const cached = (ms, load) => {
  const memo = new Map();
  return async (key = '') => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.body;
    const body = await load(key);
    memo.set(key, { at: Date.now(), body });
    return body;
  };
};
const radarNational = cached(110000, () => fetchJson('/api/v3/radar'));
const radarSite = cached(110000, (site) => fetchJson('/api/v3/live/radar?site=' + encodeURIComponent(site)));
const radarSites = cached(24 * 3600 * 1000, () => fetchJson('/api/v3/nexrad'));
const mapConfig = cached(3600 * 1000, () => fetchJson('/api/v3/config'));
const sendJson = (load) => async (req, res) => {
  try { res.json(await load(req)); } catch (e) { res.status(502).json({ error: e.message }); }
};
app.get('/api/map/shapes', (req, res) => res.json(shapes));
app.get('/api/map/radar', sendJson(() => radarNational()));
app.get('/api/map/radar/site', sendJson((req) => {
  const site = String(req.query.site || '').toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(site)) throw new Error('Bad radar site');
  return radarSite(site);
}));
app.get('/api/map/sites', sendJson(() => radarSites()));
app.get('/api/map/style', sendJson(async () => {
  const c = await mapConfig().catch(() => ({}));
  return { styleUrl: c.darkStyleUrl || 'https://tiles.openfreemap.org/styles/dark' };
}));
// Where the stream map looks. Your map sends it; every stream map moves (how = jump, ease or fly).
app.post('/api/view', (req, res) => {
  const v = req.body || {};
  const num = (x, lo, hi, d) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : d);
  const center = Array.isArray(v.center) ? [num(v.center[0], -180, 180, -96), num(v.center[1], -85, 85, 38.6)] : state.view.center;
  state.view = { center, zoom: num(v.zoom, 0, 20, 4.3), bearing: num(v.bearing, -180, 180, 0), pitch: num(v.pitch, 0, 70, 0) };
  saveState();
  broadcast('view', { ...state.view, how: ['jump', 'ease', 'fly'].includes(v.how) ? v.how : 'fly', src: String(v.src || '').slice(0, 40) });
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  res.write(`event: data\ndata: ${JSON.stringify(data)}\n\n`);
  res.write(`event: view\ndata: ${JSON.stringify({ ...state.view, how: 'jump' })}\n\n`);
  // Who's listening (the overlay, the stream map, the program view or the map you work on).
  res.who = ['overlay', 'map', 'program', 'panel'].includes(req.query.who) ? req.query.who : 'other';
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});
app.get('/api/state', (req, res) => res.json(state));
app.post('/api/state', (req, res) => {
  applyPatch(state, req.body || {});
  if (req.body?.lower && req.body.lower.shown === true) state.lower.shownAt = new Date().toISOString();
  pushState();
  res.json(state);
});
app.post('/api/reset', (req, res) => { state = merge(DEFAULT_STATE, { rev: state.rev }); pushState(); res.json(state); });
app.post('/api/breaking', (req, res) => {
  const a = data.alerts.find((x) => x.key === req.body?.key) || data.alerts.find((x) => /tornado warning/i.test(x.event)) || data.alerts[0];
  if (!a) return res.status(404).json({ error: 'No alerts to show' });
  broadcast('breaking', { alert: a, test: Boolean(req.body?.test) });
  res.json({ ok: true, alert: a.eventLabel });
});
app.post('/api/refresh', async (req, res) => { await Promise.all([loadAlerts(), loadLive(), loadHeadlines()]); res.json({ ok: true, alerts: data.alerts.length, error: data.error }); });
app.get('/api/info', (req, res) => {
  const who = {};
  for (const c of clients) who[c.who] = (who[c.who] || 0) + 1;
  res.json({ port: config.port, dataSources: config.dataSources, source: data.source, clients: clients.size, who });
});

// One-tap actions for a Stream Deck ("Website" action, open in background) or hotkey tools.
const ACTIONS = {
  'scene/live': () => { state.scene = 'live'; },
  'scene/starting': () => { state.scene = 'starting'; },
  'scene/brb': () => { state.scene = 'brb'; },
  'scene/ending': () => { state.scene = 'ending'; },
  'lower/show': () => { state.layout.lower = true; state.lower.shownAt = new Date().toISOString(); },
  'lower/hide': () => { state.layout.lower = false; },
  'lower/toggle': () => { state.layout.lower = !state.layout.lower; state.lower.shownAt = new Date().toISOString(); },
  'card/hide': () => { state.layout.card = false; },
  'bottom/auto': () => { state.bottom.mode = 'auto'; },
  'map/home': () => { state.view = { center: [-96, 38.6], zoom: 4.3, bearing: 0, pitch: 0 }; broadcast('view', { ...state.view, how: 'fly' }); },
  'map/clear': () => { state.map.selected = ''; },
  'breaking/test': () => { const a = data.alerts.find((x) => /tornado warning/i.test(x.event)) || data.alerts[0]; if (a) broadcast('breaking', { alert: a, test: true }); }
};
app.get('/do/:group/:action', (req, res) => {
  const fn = ACTIONS[`${req.params.group}/${req.params.action}`];
  if (!fn) return res.status(404).json({ error: 'Unknown action', actions: Object.keys(ACTIONS) });
  fn();
  pushState();
  res.json({ ok: true, scene: state.scene });
});

app.listen(config.port, '127.0.0.1', async () => {
  console.log(`WeatherPower Stream House is running.`);
  console.log(`  Your map:       http://localhost:${config.port}`);
  console.log(`  Stream map:     http://localhost:${config.port}/map       (Browser Source, 1920 x 1080)`);
  console.log(`  Overlay:        http://localhost:${config.port}/overlay   (Browser Source, 1920 x 1080, on top)`);
  await Promise.all([loadAlerts(), loadLive(), loadHeadlines()]);
  console.log(data.error ? `  Weather data: NOT CONNECTED (${data.error})` : `  Weather data: ${data.alerts.length} alerts from ${data.source}`);
});
