/* Shared bits for every page: header with menus, footer, helpers, the live light, your saved spot. */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const API = '/warningcenter/api/v3';
const getJson = async (url, opts) => { const r = await fetch(url, { cache: 'no-store', ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || url + ' ' + r.status); return j; };
const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ago = (iso) => { if (!iso) return ''; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86400) + ' days ago'; };
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const left = (iso) => { if (!iso) return ''; const ms = Date.parse(iso) - Date.now(); return ms <= 0 ? 'expired' : dur(ms) + ' left'; };
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
const KINDS = { alert: 'Top alert', pinned: 'Pinned alert', think: 'Model check', models: 'Weather models', national: 'National radar', outlook: 'Severe outlook', reports: 'Storm reports', tropics: 'Tropics', surface: 'Radar & fronts', forecast: 'Daily forecast', gas: 'Gas prices', rain: 'Rain outlook', train: 'Train cam' };
// SPC Day 1 categories, lowest to highest.
const SPC = { TSTM: ['General thunderstorms', '#55bb55'], MRGL: ['Marginal risk', '#005500'], SLGT: ['Slight risk', '#ddbb00'], ENH: ['Enhanced risk', '#ff7700'], MDT: ['Moderate risk', '#dd0000'], HIGH: ['High risk', '#ff00ff'] };
const SPC_ORDER = Object.keys(SPC);
// Point in polygon for alert and outlook shapes.
const inRing = (pt, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
const inGeometry = (pt, g) => { if (!g) return false; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h))); };

// Your spot: saved in this browser only. Search uses Open-Meteo's free geocoder.
const WPSpot = {
  get: () => { try { return JSON.parse(localStorage.getItem('wp-spot') || 'null'); } catch { return null; } },
  set: (s) => { try { localStorage.setItem('wp-spot', JSON.stringify(s)); } catch {} document.dispatchEvent(new CustomEvent('wp-spot', { detail: s })); },
  search: async (q) => (await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&countryCode=US`)).results || [],
  // A search box that fills in the spot: WPSpot.picker(element, onPick)
  picker: (el, onPick) => {
    el.classList.add('picker');
    el.innerHTML = '<input type="search" placeholder="City or town, like Idabel OK" autocomplete="off"><div class="res" hidden></div>';
    const input = el.querySelector('input'), res = el.querySelector('.res');
    let t = null;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim().replace(/,?\s+[A-Za-z]{2}$/, '');
      if (q.length < 2) { res.hidden = true; return; }
      t = setTimeout(async () => {
        try {
          const list = await WPSpot.search(q);
          res.innerHTML = list.map((r, i) => `<button data-i="${i}">${esc(r.name)}<small>${esc(r.admin1 || '')}</small></button>`).join('') || '<button disabled>No match</button>';
          res.hidden = false;
          res.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => { const r = list[b.dataset.i]; const s = { name: r.name, state: r.admin1 || '', lat: r.latitude, lon: r.longitude }; input.value = s.name + ', ' + s.state; res.hidden = true; onPick(s); }));
        } catch { res.hidden = true; }
      }, 300);
    });
    document.addEventListener('click', (e) => { if (!el.contains(e.target)) res.hidden = true; });
    return input;
  }
};

const NAV = `
  <a href="/" class="${location.pathname === '/' ? 'on' : ''}">Home</a>
  <div class="dd ${/^\/(radar|nice|webot)/.test(location.pathname) ? 'on' : ''}"><a href="/radar">Weather</a><div class="menu">
    <a href="/radar">Radar &amp; warnings<small>Live radar with every warning on it</small></a>
    <a href="/nice">Porch Weather<small>How nice it'll be outside, 7 days out</small></a>
    <a href="/webot">WeBot tracker<small>What's on the stream right now</small></a>
    <a href="https://weatherpower.app/radar" target="_blank" rel="noopener">WeatherPower radar app ↗<small>The full interactive radar</small></a>
  </div></div>
  <a href="/tools" class="${location.pathname.startsWith('/tools') ? 'on' : ''}">Tools</a>
  <a href="/submit" class="${location.pathname.startsWith('/submit') ? 'on' : ''}">Submit</a>
  <a href="/alerts" class="${location.pathname.startsWith('/alerts') ? 'on' : ''}">Alerts</a>
  <a href="/about" class="${location.pathname.startsWith('/about') ? 'on' : ''}">About</a>`;
document.body.insertAdjacentHTML('afterbegin', `
<header class="top"><div class="wrap">
  <a class="logo" href="/"><img src="/favicon.ico" alt=""><div><b>WeatherPower</b><small>LIVE · WITH WEBOT</small></div></a>
  <button class="burger" id="burger" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <nav class="main" id="nav">${NAV}</nav>
  <div class="spacer"></div>
  <a class="live-btn off" id="live-btn" href="https://www.youtube.com" data-yt="live" target="_blank" rel="noopener"><i></i><span id="live-t">Checking…</span></a>
</div></header>`);
document.body.insertAdjacentHTML('beforeend', `
<footer><div class="wrap">
  <div><b>WeatherPower</b><p style="margin:0 0 8px">A 24/7 live weather stream hosted by WeBot, plus free tools for watching the sky. A passion project from Idabel, Oklahoma.</p>
    <p style="margin:0">Not affiliated with Ryan Hall, Y'all or any other weather channel. Always follow official warnings from the National Weather Service and your local officials.</p></div>
  <div><b>Explore</b><a href="/radar">Radar &amp; warnings</a><a href="/nice">Porch Weather</a><a href="/webot">WeBot tracker</a><a href="/tools">Tools</a><a href="/submit">Send us your storm</a><a href="/alerts">Phone alerts</a><a href="/about">About</a></div>
  <div><b>Connect</b><a href="https://www.youtube.com" data-yt="channel" target="_blank" rel="noopener">YouTube</a><a href="https://github.com/weatherpower/webot" target="_blank" rel="noopener">Open source on GitHub</a><a href="https://weatherpower.app/radar" target="_blank" rel="noopener">Support WeatherPower</a></div>
  <div class="fine">Alerts: NWS · Outlooks: SPC, WPC, NHC · Radar: Iowa Environmental Mesonet · Forecasts: Open-Meteo · Map: OpenStreetMap, OpenFreeMap. Data is automated and can contain errors. © ${new Date().getFullYear()} WeatherPower.</div>
</div></footer>`);
$('burger').addEventListener('click', () => $('nav').classList.toggle('open'));
getJson('/site-config.json').then((c) => { if (!c.channelId) return; const base = 'https://www.youtube.com/channel/' + encodeURIComponent(c.channelId); document.querySelectorAll('[data-yt]').forEach((a) => { a.href = a.dataset.yt === 'live' ? base + '/live' : base; }); window.WPConfig = c; document.dispatchEvent(new CustomEvent('wp-config', { detail: c })); }).catch(() => {});

// The live light: WeBot's public status.
window.WPStatus = null;
const pollStatus = async () => {
  try {
    const s = await getJson(API + '/webot/status');
    window.WPStatus = s;
    const on = s.onAir && !s.brb;
    $('live-btn').className = 'live-btn' + (on ? '' : ' off');
    $('live-t').textContent = on ? 'Live now' + (s.chat?.viewers != null ? ' · ' + s.chat.viewers + ' watching' : '') : s.brb ? 'Be right back' : 'Off air';
    document.dispatchEvent(new CustomEvent('wp-status', { detail: s }));
  } catch { $('live-t').textContent = 'Watch on YouTube'; }
};
pollStatus();
setInterval(pollStatus, 15000);
