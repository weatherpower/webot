// WeatherPower Stream House: WeBot's on-air look (bars, alert cards, breaking alerts, scenes) for YOUR
// live streams. Add http://localhost:7788/overlay as an OBS Browser Source (1920x1080) on top of your
// camera / screen, and run the show from http://localhost:7788. Start it with "Stream House.cmd".
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
const STATE_FILE = path.join(here, 'house.state.json');
const config = {
  port: 7788,
  // Where the weather comes from: your cloud server (Live Control port, home internet only), then the
  // WeatherPower server on this PC if you run one.
  dataSources: ['http://104.207.81.143:8899/warningcenter', 'http://localhost:8899/warningcenter'],
  ...(existsSync(CONFIG_FILE) ? JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) : {})
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
const data = { alerts: [], tallies: {}, wis: null, headlines: { weather: [], news: [] }, source: '', updatedAt: null, error: null };
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
    data.alerts = (body.alerts || []).filter((a) => ['warnings', 'watches', 'statements', 'discussions'].includes(a.group)).map(slim);
    data.updatedAt = new Date().toISOString();
    data.error = null;
    // Breaking: new alerts only (nothing fires for what was already out when Stream House started).
    for (const a of data.alerts) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      if (!primed || !state.breaking.auto || (state.focus && !a.states.includes(state.focus))) continue;
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

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  res.write(`event: data\ndata: ${JSON.stringify(data)}\n\n`);
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
app.get('/api/info', (req, res) => res.json({ port: config.port, dataSources: config.dataSources, source: data.source, clients: clients.size }));

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
  console.log(`  Control panel:  http://localhost:${config.port}`);
  console.log(`  OBS overlay:    http://localhost:${config.port}/overlay   (Browser Source, 1920 x 1080)`);
  await Promise.all([loadAlerts(), loadLive(), loadHeadlines()]);
  console.log(data.error ? `  Weather data: NOT CONNECTED (${data.error})` : `  Weather data: ${data.alerts.length} alerts from ${data.source}`);
});
