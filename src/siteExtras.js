// The public website's own little back end (mounted on the public status listener in src/server.js):
// SPC Day 1 outlook pass-through, storm submissions, and free phone alerts (ntfy) for a saved spot.
// Nothing here needs a login; everything is rate-limited and stored in data/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './paths.js';

const SPC_DAY1 = 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson';
const SUBS_FILE = () => path.join(dataDir, 'site-alerts.json');
const SUBMIT_FILE = () => path.join(dataDir, 'site-submissions.json');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.warn('[site]', e.message); } };
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// Per-address rate limit: at most `max` hits in `minutes`.
const hits = new Map();
const limited = (req, key, max, minutes) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').pop().trim();
  const k = key + '|' + ip, now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < minutes * 60000);
  if (list.length >= max) return true;
  list.push(now); hits.set(k, list);
  return false;
};

/* ---------- point in polygon (alert and outlook shapes) ---------- */
const inRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const inGeometry = (pt, geom) => {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole)));
};

/* ---------- SPC Day 1 categorical outlook (10 minute cache) ---------- */
let spc = { at: 0, body: null };
const spcDay1 = async () => {
  if (spc.body && Date.now() - spc.at < 10 * 60000) return spc.body;
  const r = await fetch(SPC_DAY1, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'weatherpower.app site contact@weatherpower.app' } });
  if (!r.ok) throw new Error('SPC ' + r.status);
  const body = await r.json();
  spc = { at: Date.now(), body };
  return body;
};

/* ---------- phone alerts: a saved spot + an ntfy topic ---------- */
const KINDS = { tornado: /tornado/i, severe: /severe thunderstorm|tornado/i, flood: /flood/i, winter: /winter|blizzard|ice storm|snow/i, all: /./ };
const notify = async (topic, title, text, tags) => {
  await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: text, headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Priority: '5', Tags: tags }, signal: AbortSignal.timeout(10000) }).catch((e) => console.warn('[site] ntfy:', e.message));
};
const checkAlerts = async (port) => {
  const subs = readJson(SUBS_FILE(), []);
  if (!subs.length) return;
  const fc = await fetch(`http://127.0.0.1:${port}/warningcenter/api/v3/alerts.geojson`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  const warnings = (fc.features || []).filter((f) => f.properties?.group === 'warnings');
  let changed = false;
  for (const s of subs) {
    s.sent ||= [];
    for (const f of warnings) {
      const p = f.properties, key = p.key;
      if (s.sent.includes(key) || !(KINDS[s.kind] || KINDS.all).test(p.event || '') || !inGeometry([s.lon, s.lat], f.geometry)) continue;
      s.sent.push(key); if (s.sent.length > 60) s.sent.shift(); changed = true;
      await notify(s.topic, `${p.event} for ${s.place}`, `${p.event} includes ${s.place}${p.expiresAt ? ' until ' + new Date(p.expiresAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT' : ''}. Take cover if it is a tornado warning. From WeatherPower.`, /tornado/i.test(p.event) ? 'tornado' : /flood/i.test(p.event) ? 'ocean' : 'zap');
    }
  }
  if (changed) writeJson(SUBS_FILE(), subs);
};

export const mountSite = (pub, { port, express }) => {
  pub.use('/api', express.json({ limit: '32kb' }));

  pub.get('/api/spc/day1', async (req, res) => {
    try { res.set('Cache-Control', 'public, max-age=300'); res.json(await spcDay1()); } catch (e) { res.status(503).json({ error: e.message }); }
  });

  // Storm reports and photo links from viewers (shown to the owner in WeBot Studio later).
  pub.post('/api/submit', (req, res) => {
    if (limited(req, 'submit', 5, 60)) return res.status(429).json({ error: 'Slow down: 5 reports an hour.' });
    const b = req.body || {};
    const item = { id: crypto.randomUUID(), at: new Date().toISOString(), name: clean(b.name, 40), place: clean(b.place, 80), text: clean(b.text, 600), link: /^https?:\/\/\S+$/.test(b.link || '') ? clean(b.link, 300) : '' };
    if (!item.text && !item.link) return res.status(400).json({ error: 'Tell us what you saw, or add a photo link.' });
    const list = readJson(SUBMIT_FILE(), []);
    list.unshift(item); writeJson(SUBMIT_FILE(), list.slice(0, 500));
    console.log('[site] storm report from', item.name || 'someone', '·', item.place);
    res.json({ ok: true });
  });
  // The owner reads reports with the controller token (same one as Live Control).
  pub.get('/api/submissions', (req, res) => {
    const t = process.env.CONTROLLER_TOKEN || '';
    const got = String(req.headers['x-controller-token'] || '');
    if (!t || got.length !== t.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(t))) return res.status(401).json({ error: 'Controller token required' });
    res.json(readJson(SUBMIT_FILE(), []));
  });

  // Free phone alerts: the viewer saves a spot and an ntfy topic; we ping the topic when a warning covers it.
  pub.post('/api/alerts/subscribe', (req, res) => {
    if (limited(req, 'subscribe', 10, 60)) return res.status(429).json({ error: 'Too many sign-ups from this address. Try later.' });
    const b = req.body || {};
    const lat = Number(b.lat), lon = Number(b.lon);
    const topic = clean(b.topic, 64);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -64) return res.status(400).json({ error: 'Pick a spot in the US first.' });
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(topic)) return res.status(400).json({ error: 'Topic must be 8–64 letters, numbers, - or _.' });
    const subs = readJson(SUBS_FILE(), []).filter((s) => s.topic !== topic);
    if (subs.length >= 2000) return res.status(503).json({ error: 'Sign-ups are full for now.' });
    subs.push({ topic, lat, lon, place: clean(b.place, 80) || 'your spot', kind: KINDS[b.kind] ? b.kind : 'all', at: new Date().toISOString(), sent: [] });
    writeJson(SUBS_FILE(), subs);
    notify(topic, 'WeatherPower alerts are on', `You will get a ping here when a ${b.kind === 'all' || !KINDS[b.kind] ? 'warning' : b.kind + ' warning'} covers ${clean(b.place, 80) || 'your spot'}.`, 'white_check_mark');
    res.json({ ok: true });
  });
  pub.post('/api/alerts/unsubscribe', (req, res) => {
    const topic = clean(req.body?.topic, 64);
    writeJson(SUBS_FILE(), readJson(SUBS_FILE(), []).filter((s) => s.topic !== topic));
    res.json({ ok: true });
  });

  // Porch Weather takes about a minute to build: load it at startup and keep it warm, so pages never wait.
  const warm = () => fetch(`http://127.0.0.1:${port}/warningcenter/api/v3/nice`, { signal: AbortSignal.timeout(240000) }).catch(() => {});
  setTimeout(warm, 15000); setInterval(warm, 3 * 3600 * 1000 + 30000);
  setInterval(() => checkAlerts(port).catch((e) => console.warn('[site] alerts:', e.message)), 2 * 60000);
};
