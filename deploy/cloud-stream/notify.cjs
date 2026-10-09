// Phone alerts for WeatherPower Live, through the free ntfy app (https://ntfy.sh, no account).
// Runs once a minute from the host's cron (notify-cron.sh) inside the stream container and sends:
//   - tornado warnings (and emergencies) at or near home, plus severe storm / flash flood warnings and
//     tornado watches that cover home (home = /api/v3/config, Idabel, OK)
//   - the stream stopping (no heartbeat from the stream page, or ffmpeg not running) and coming back
// Settings (.env): NTFY_TOPIC (required), NTFY_SERVER (default https://ntfy.sh), NOTIFY_MILES (default 40).
const fs = require('fs');
const { execSync } = require('child_process');

const BASE = 'http://127.0.0.1:8899/warningcenter';
const TOPIC = process.env.NTFY_TOPIC || '';
const SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const MILES = Number(process.env.NOTIFY_MILES || 40);
const STATE_FILE = '/app/data/notify-state.json';
const WATCH = 'https://www.youtube.com/channel/UC58hHZLRth8YFHNqS4mEjSg/live';
let placeName = 'home';

const load = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {}, down: 0, downSent: false, primed: false }; } };
const save = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s));
const getJson = async (p) => { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const push = async ({ title, message, priority = 3, tags = [], click }) => {
  if (!TOPIC) { console.log('[notify] no NTFY_TOPIC:', title); return; }
  const headers = { Title: title, Priority: String(priority), Tags: tags.join(',') };
  if (click) headers.Click = click;
  const r = await fetch(`${SERVER}/${encodeURIComponent(TOPIC)}`, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(15000) });
  console.log('[notify]', r.status, title);
};

/* ---------- geometry: inside the polygon, or how far away ---------- */
const rings = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : g.type === 'GeometryCollection' ? g.geometries.flatMap(rings) : []);
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const miles = ([x1, y1], [x2, y2]) => {
  const R = 3958.8, r = Math.PI / 180, dLat = (y2 - y1) * r, dLon = (x2 - x1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const where = (home, g) => {
  const rs = rings(g);
  if (rs.some((ring) => inRing(home, ring))) return { inside: true, miles: 0 };
  let best = { miles: Infinity, pt: null };
  for (const ring of rs) for (const pt of ring) { const d = miles(home, pt); if (d < best.miles) best = { miles: d, pt }; }
  if (!best.pt) return { inside: false, miles: Infinity };
  const deg = (Math.atan2(best.pt[0] - home[0], best.pt[1] - home[1]) * 180) / Math.PI;
  return { inside: false, miles: best.miles, dir: COMPASS[Math.round(((deg + 360) % 360) / 45) % 8] };
};

(async () => {
  const s = load();
  const now = Date.now();

  /* ---------- the stream (skipped while it's switched off on purpose) ---------- */
  let up = true, why = '';
  if (process.env.STREAM_OFF !== 'true') try {
    const live = await getJson('/api/v3/live');
    const beat = live.control?.stream?.at ? Date.parse(live.control.stream.at) : 0;
    if (!beat || now - beat > 90000) { up = false; why = 'The stream page stopped checking in.'; }
  } catch (e) { up = false; why = 'The WeatherPower server isn’t answering (' + e.message + ').'; }
  if (up && process.env.STREAM_OFF !== 'true') { try { execSync('pgrep -x ffmpeg', { stdio: 'ignore' }); } catch { up = false; why = 'ffmpeg (the part that sends video to YouTube) isn’t running.'; } }
  // Two bad checks in a row (2 minutes) before saying anything: restarts and page reloads are quick.
  s.down = up ? 0 : (s.down || 0) + 1;
  if (!up && s.down >= 2 && !s.downSent) {
    await push({ title: 'WeatherPower Live is DOWN', message: why + ' Check WeBot Studio → Logs, or restart it in Studio → Server.', priority: 5, click: WATCH, tags: ['rotating_light'] });
    s.downSent = true;
  } else if (up && s.downSent) {
    await push({ title: 'WeatherPower Live is back up', message: 'The stream is running again.', priority: 3, tags: ['white_check_mark'] });
    s.downSent = false;
  }

  /* ---------- warnings at home ---------- */
  try {
    const [config, body] = await Promise.all([getJson('/api/v3/config'), getJson('/api/v3/alerts')]);
    const h = config.home;
    if (h && Number.isFinite(h.lat)) {
      const home = [h.lon, h.lat], place = (h.place || 'home').split(',')[0];
      placeName = place;
      for (const a of body.alerts || []) {
        if (!a.geometry || !['warnings', 'watches'].includes(a.group) || s.sent[a.key]) continue;
        const ev = String(a.event || ''), label = String(a.eventLabel || ev);
        const tornado = /^tornado warning$/i.test(ev) || /tornado emergency/i.test(label);
        const watch = /^tornado watch$|^severe thunderstorm watch$/i.test(ev);
        const other = /^(severe thunderstorm warning|flash flood warning|extreme wind warning)$/i.test(ev) || /flash flood emergency/i.test(label);
        if (!tornado && !watch && !other) continue;
        const w = where(home, a.geometry);
        const send = tornado ? w.inside || w.miles <= MILES : w.inside;
        if (!send) continue;
        s.sent[a.key] = now;
        if (!s.primed) continue;   // first run: remember what's already out, don't alert on it
        const when = a.times?.expires ? ' until ' + a.times.expires : '';
        const loc = w.inside ? `${place} is IN this warning` : `${Math.round(w.miles)} mi ${w.dir} of ${place}`;
        await push({
          title: (tornado ? '🌪 ' : '') + label + (w.inside ? ' FOR ' + place.toUpperCase() : ' nearby'),
          message: `${loc}${when}. ${a.area || a.areaDesc || ''}\n${String(a.summary || '').slice(0, 300)}`,
          priority: tornado ? (w.inside ? 5 : 4) : watch ? 3 : 4,
          tags: [tornado ? 'warning' : watch ? 'eyes' : 'cloud_with_lightning_and_rain'],
          click: WATCH
        });
      }
    }
    s.primed = true;
    // Forget alerts after two days.
    for (const [k, t] of Object.entries(s.sent)) if (now - t > 2 * 86400000) delete s.sent[k];
  } catch (e) { console.log('[notify] alerts:', e.message); }

  /* ---------- WeBot's Puter voice credits (checked every 30 minutes) ---------- */
  // Asks the stream page's Puter sign-in how much of the monthly allowance is left. Warns once at 25%,
  // once at 10%, and once when it runs out; a new month (or a new Puter account) resets the warnings.
  if (process.argv.includes('--puter') || now - (s.puterAt || 0) > 30 * 60 * 1000) {
    s.puterAt = now;
    try {
      const { chromium } = require('/app/node_modules/playwright');
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
      const page = browser.contexts()[0].pages().find((p) => p.url().includes('/live'));
      const info = page ? await page.evaluate(async () => { try { return (await puter.auth.getMonthlyUsage()).allowanceInfo; } catch { return null; } }) : null;
      await browser.close().catch(() => {});
      if (info && Number.isFinite(info.remaining) && info.monthUsageAllowance) {
        const left = Math.max(0, info.remaining), pct = Math.round((left / info.monthUsageAllowance) * 100);
        if (left > (s.puterLeft ?? -1) + 50) s.puterLevel = 0;   // refilled: new month or a new account
        s.puterLeft = left;
        const level = left <= 1 ? 3 : pct <= 10 ? 2 : pct <= 25 ? 1 : 0;
        if (level > (s.puterLevel || 0)) {
          s.puterLevel = level;
          await push({
            title: level === 3 ? "WeBot's voice is OUT of Puter credits" : `WeBot's Puter credits: ${pct}% left`,
            message: level === 3 ? 'WeBot can’t talk with the Alloy voice until the credits reset. Link another Puter account in Live Control → Puter to bring his voice back.'
              : `${Math.round(left)} of ${info.monthUsageAllowance} credits left this month. To make them last, lower "Most answers in an hour" in WeBot Studio → Brain → Chat, or link a second Puter account.`,
            priority: level === 3 ? 5 : 4, tags: ['speaking_head'], click: WATCH
          });
        }
        console.log('[notify] puter', Math.round(left), pct + '%');
      }
    } catch (e) { console.log('[notify] puter check:', e.message); }
  }

  /* ---------- Level 2 radar from the owner's PC: stale = the PC or the worker is down ---------- */
  try {
    const idx = JSON.parse(fs.readFileSync('/app/data/radar-l2/index.json', 'utf8'));
    const ageMin = (now - Date.parse(idx.generatedAt || 0)) / 60000;
    if (ageMin > 20 && !s.radarDownSent) {
      s.radarDownSent = true;
      await push({ title: 'Level 2 radar stopped updating', message: `No new radar images for ${Math.round(ageMin)} minutes. Is the PC on and the "WeatherPower Level 2 radar" window running? Check WeBot Studio → Overview → Level 2 radar.`, priority: 4, tags: ['satellite'] });
    } else if (ageMin <= 20 && s.radarDownSent) {
      s.radarDownSent = false;
      await push({ title: 'Level 2 radar is back', message: 'Radar images are flowing from the PC again.', priority: 3, tags: ['white_check_mark'] });
    }
  } catch (e) { console.log('[notify] radar-l2:', e.message); }

  if (process.argv.includes('--test')) await push({ title: 'WeatherPower alerts are on', message: `You’ll get tornado warnings near ${placeName} and a heads-up if the stream goes down.`, click: WATCH, tags: ['white_check_mark'] });
  save(s);
})().catch((e) => { console.error('[notify]', e.message); process.exit(1); });
