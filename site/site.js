/* Shared bits for every page of the WeatherPower website: header, footer, helpers, the live light. */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const API = '/warningcenter/api/v3';
const getJson = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
const ago = (iso) => { if (!iso) return ''; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86400) + ' days ago'; };
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const left = (iso) => { if (!iso) return ''; const ms = Date.parse(iso) - Date.now(); return ms <= 0 ? 'expired' : dur(ms) + ' left'; };
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

const PAGES = [['/', 'Home'], ['/webot', 'WeBot'], ['/nice', 'Porch Weather'], ['/tools', 'Tools'], ['/about', 'About']];
const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
document.body.insertAdjacentHTML('afterbegin', `
<header class="top"><div class="wrap">
  <a class="logo" href="/"><img src="/favicon.ico" alt=""><div><b>WeatherPower</b><small>LIVE · WITH WEBOT</small></div></a>
  <button class="burger" id="burger" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <nav class="main" id="nav">${PAGES.map(([h, l]) => `<a href="${h}" class="${h === here ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div class="spacer"></div>
  <a class="live-btn off" id="live-btn" href="https://www.youtube.com" data-yt="live" target="_blank" rel="noopener"><i></i><span id="live-t">Checking…</span></a>
</div></header>`);
document.body.insertAdjacentHTML('beforeend', `
<footer><div class="wrap">
  <div><b>WeatherPower</b><p style="margin:0 0 8px">A 24/7 live weather stream hosted by WeBot, a sassy Southern robot, plus free tools for watching the sky. A passion project from Idabel, Oklahoma.</p>
    <p style="margin:0">Not affiliated with Ryan Hall, Y'all or any other weather channel. Always follow official warnings from the National Weather Service and your local officials.</p></div>
  <div><b>Explore</b>${PAGES.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}<a href="https://weatherpower.app/radar" target="_blank" rel="noopener">Live radar ↗</a></div>
  <div><b>Connect</b><a href="https://www.youtube.com" data-yt="channel" target="_blank" rel="noopener">YouTube</a><a href="https://github.com/weatherpower/webot" target="_blank" rel="noopener">Open source on GitHub</a><a href="https://weatherpower.app/radar" target="_blank" rel="noopener">Support WeatherPower</a></div>
  <div class="fine">Alerts: NWS · Outlooks: SPC, WPC, NHC · Radar: Iowa Environmental Mesonet · Forecasts: Open-Meteo · Map: OpenStreetMap, OpenFreeMap. Data is automated and can contain errors. © ${new Date().getFullYear()} WeatherPower.</div>
</div></footer>`);
// YouTube links come from the server's public config (channel id), so nothing is hard-coded here.
getJson('/site-config.json').then((c) => { if (!c.channelId) return; const base = 'https://www.youtube.com/channel/' + encodeURIComponent(c.channelId); document.querySelectorAll('[data-yt]').forEach((a) => { a.href = a.dataset.yt === 'live' ? base + '/live' : base; }); }).catch(() => {});
$('burger').addEventListener('click', () => $('nav').classList.toggle('open'));

// The live light in the header: WeBot's public status (3 s cache on the server).
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
