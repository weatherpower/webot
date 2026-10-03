/* WeatherPower Stream House control panel. Every change goes to the Stream House server, which pushes it
   to the OBS overlay instantly. */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const S = { state: null, data: { alerts: [] }, filter: 'warnings' };
const toast = (msg, kind = '') => {
  const el = document.createElement('div'); el.className = kind; el.textContent = msg;
  $('toast').appendChild(el); setTimeout(() => el.remove(), 3500);
};
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || 'Failed (' + r.status + ')');
  return json;
};
const patch = (p, msg) => post('/api/state', p).then(() => { if (msg) toast(msg); }).catch((e) => toast(e.message, 'bad'));
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
$('focus').innerHTML += Object.entries(STATES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

/* ---------- preview scaling ---------- */
const fitPreview = () => { const w = $('preview').clientWidth; $('preview-frame').style.transform = `scale(${w / 1920})`; };
new ResizeObserver(fitPreview).observe($('preview'));

/* ---------- render controls from state (never overwrite a field you're typing in) ---------- */
const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el && el.dataset.dirty !== '1') el.value = v ?? ''; };
const pressed = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
const renderState = () => {
  const st = S.state;
  document.querySelectorAll('.scenebtn').forEach((b) => b.classList.toggle('on', b.dataset.scene === st.scene));
  const names = { live: 'LIVE', starting: 'STARTING SOON', brb: 'BE RIGHT BACK', ending: 'ENDING' };
  $('s-scene').className = 'onair' + (st.scene === 'live' ? ' live' : ' brb');
  $('s-scene-t').textContent = names[st.scene] || st.scene;
  document.querySelectorAll('#layout [data-l]').forEach((el) => { el.checked = Boolean(st.layout[el.dataset.l]); });
  setVal('theme', st.theme); setVal('focus', st.focus);
  setVal('lw-name', st.lower.name); setVal('lw-title', st.lower.title); setVal('lw-auto', st.lower.autoHideSec);
  $('lw-show').classList.toggle('primary', !st.layout.lower);
  pressed('b-mode', st.bottom.mode);
  setVal('b-label', st.bottom.label); setVal('b-title', st.bottom.title); setVal('b-crawl', st.bottom.crawl);
  const picked = st.bottom.alertKey && S.data.alerts.find((a) => a.key === st.bottom.alertKey);
  $('b-picked').textContent = picked ? 'Picked: ' + picked.eventLabel + ' · ' + (picked.area || '') : st.bottom.mode === 'alert' ? 'Pick an alert with “Bottom” in the list.' : '';
  pressed('h-mode', st.headlines);
  setVal('h-msgs', (st.ticker.messages || []).join('\n')); setVal('h-every', st.ticker.everyItems); setVal('brand', st.brandText);
  $('br-auto').checked = st.breaking.auto; $('br-sound').checked = st.breaking.sound;
  document.querySelectorAll('[data-br]').forEach((el) => { el.checked = Boolean(st.breaking[el.dataset.br]); });
  pressed('br-style', st.breaking.style); setVal('br-secs', st.breaking.seconds);
  setVal('st-title', st.starting.title); setVal('st-msg', st.starting.message); setVal('brb-msg', st.brb.message);
  setVal('en-title', st.ending.title); setVal('en-msg', st.ending.message);
  renderAlerts();
};
const renderData = () => {
  const d = S.data;
  $('s-data').textContent = d.error ? 'NOT CONNECTED' : d.updatedAt ? 'UPDATED ' + new Date(d.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  $('s-data').className = d.error ? 'bad' : '';
  const t = d.tallies || {};
  $('s-alerts').textContent = `${t.tor || 0} TOR · ${t.svr || 0} SVR · ${t.ffw || 0} FFW`;
  $('src').textContent = d.error ? 'DATA: ' + d.error : d.source ? 'DATA: ' + d.source.replace(/^https?:\/\//, '') : '';
  renderAlerts();
};
const renderAlerts = () => {
  if (!S.state) return;
  const q = $('a-search').value.trim().toLowerCase();
  const f = S.state.focus;
  const list = S.data.alerts
    .filter((a) => (S.filter === 'all' ? true : a.group === S.filter) && (!f || a.states.includes(f)))
    .filter((a) => !q || [a.eventLabel, a.area, a.areaDesc, a.place, ...(a.states || []).map((s) => STATES[s] || s)].join(' ').toLowerCase().includes(q))
    .sort((x, y) => x.rank - y.rank || Date.parse(y.issuedAt || 0) - Date.parse(x.issuedAt || 0));
  $('a-count').textContent = list.length + ' SHOWN';
  const onAir = new Set([S.state.layout.card && S.state.card.alertKey, S.state.bottom.mode === 'alert' && S.state.bottom.alertKey].filter(Boolean));
  $('alerts').innerHTML = list.slice(0, 120).map((a) => `<div class="arow ${onAir.has(a.key) ? 'feat' : ''}" style="--c:${esc(a.color || '#888')}"><i></i>
    <div><b>${esc(a.eventLabel)}</b><small>${esc(a.area || a.place || '')}${a.times?.expires ? ' · until ' + esc(a.times.expires) : ''}</small></div>
    <div class="acts"><button class="btn sm" data-card="${esc(a.key)}">Card</button><button class="btn sm" data-bottom="${esc(a.key)}">Bottom</button><button class="btn sm warn" data-break="${esc(a.key)}">Break</button></div></div>`).join('')
    || `<p class="empty">${S.data.error ? 'No weather data: ' + esc(S.data.error) : 'No alerts match.'}</p>`;
};

/* ---------- live connection ---------- */
const connect = () => {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => { S.state = JSON.parse(e.data); renderState(); });
  es.addEventListener('data', (e) => { S.data = JSON.parse(e.data); renderData(); });
  es.addEventListener('breaking', (e) => { const { alert, test } = JSON.parse(e.data); toast((test ? 'TEST: ' : 'BREAKING on air: ') + alert.eventLabel + ' · ' + (alert.area || ''), 'warn'); });
  es.onopen = () => { $('s-overlay').textContent = 'CONNECTED'; };
  es.onerror = () => { $('s-overlay').textContent = 'RECONNECTING…'; es.close(); setTimeout(connect, 2000); };
};
connect();
setInterval(async () => { try { const i = await (await fetch('/api/info')).json(); const obs = Math.max(0, i.clients - 2); $('s-overlay').textContent = obs ? 'OBS: ' + obs + ' CONNECTED' : 'OBS: NOT CONNECTED YET'; } catch {} }, 5000);

/* ---------- controls ---------- */
const scene = (s) => patch({ scene: s });
document.querySelectorAll('.scenebtn').forEach((b) => b.addEventListener('click', () => scene(b.dataset.scene)));
$('layout').addEventListener('change', (e) => { const k = e.target.dataset.l; if (k) patch({ layout: { [k]: e.target.checked } }); });
$('theme').addEventListener('change', () => patch({ theme: $('theme').value }));
$('focus').addEventListener('change', () => patch({ focus: $('focus').value }, $('focus').value ? 'Focus: ' + STATES[$('focus').value] : 'Whole country'));
document.querySelectorAll('input[type=text], input[type=number], textarea').forEach((el) => {
  el.addEventListener('input', () => { el.dataset.dirty = '1'; });
});
const clean = (...ids) => ids.forEach((id) => { $(id).dataset.dirty = ''; });

// lower third
const lowerFields = () => ({ name: $('lw-name').value.trim(), title: $('lw-title').value.trim(), autoHideSec: Number($('lw-auto').value) || 0 });
$('lw-show').addEventListener('click', () => { clean('lw-name', 'lw-title', 'lw-auto'); patch({ layout: { lower: true }, lower: { ...lowerFields(), shown: true } }); });
$('lw-hide').addEventListener('click', () => patch({ layout: { lower: false } }));
['lw-name', 'lw-title'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lw-show').click(); }));

// bottom bar
document.querySelector('#b-mode').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ bottom: { mode: v } }); });
$('b-apply').addEventListener('click', () => { clean('b-label', 'b-title', 'b-crawl'); patch({ bottom: { mode: 'custom', label: $('b-label').value.trim(), title: $('b-title').value.trim(), crawl: $('b-crawl').value.trim() } }, 'Bottom bar updated'); });

// headlines
document.querySelector('#h-mode').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ headlines: v }); });
$('h-apply').addEventListener('click', () => {
  clean('h-msgs', 'h-every', 'brand');
  patch({ ticker: { messages: $('h-msgs').value.split('\n').map((s) => s.trim()).filter(Boolean), everyItems: Math.max(1, Number($('h-every').value) || 5) }, brandText: $('brand').value.trim() || 'WEATHERPOWER.APP' }, 'Top bar updated');
});

// breaking
$('br-auto').addEventListener('change', () => patch({ breaking: { auto: $('br-auto').checked } }));
$('br-sound').addEventListener('change', () => patch({ breaking: { sound: $('br-sound').checked } }));
document.querySelectorAll('[data-br]').forEach((el) => el.addEventListener('change', () => patch({ breaking: { [el.dataset.br]: el.checked } })));
document.querySelector('#br-style').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ breaking: { style: v } }); });
$('br-secs').addEventListener('change', () => { clean('br-secs'); patch({ breaking: { seconds: Math.max(3, Number($('br-secs').value) || 7) } }); });
$('br-test').addEventListener('click', () => post('/api/breaking', { test: true }).then((r) => toast('Test: ' + r.alert)).catch((e) => toast(e.message, 'bad')));

// alerts list
document.querySelector('#a-filter').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v) return;
  S.filter = v; pressed('a-filter', v); renderAlerts();
});
$('a-search').addEventListener('input', renderAlerts);
$('alerts').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.card) {
    const same = S.state.layout.card && S.state.card.alertKey === b.dataset.card;
    patch({ layout: { card: !same }, card: { alertKey: same ? null : b.dataset.card } }, same ? 'Card hidden' : 'Card on air');
  } else if (b.dataset.bottom) patch({ bottom: { mode: 'alert', alertKey: b.dataset.bottom } }, 'In the bottom bar');
  else if (b.dataset.break) post('/api/breaking', { key: b.dataset.break }).then((r) => toast('Breaking: ' + r.alert, 'warn')).catch((err) => toast(err.message, 'bad'));
});

// scene text + countdown
$('sc-apply').addEventListener('click', () => {
  clean('st-title', 'st-msg', 'brb-msg', 'en-title', 'en-msg');
  patch({ starting: { title: $('st-title').value.trim(), message: $('st-msg').value.trim() }, brb: { message: $('brb-msg').value.trim() }, ending: { title: $('en-title').value.trim(), message: $('en-msg').value.trim() } }, 'Scene text updated');
});
$('st-go').addEventListener('click', () => patch({ scene: 'starting', starting: { endsAt: new Date(Date.now() + (Number($('st-min').value) || 5) * 60000).toISOString() } }, 'Countdown started'));
$('st-clear').addEventListener('click', () => patch({ starting: { endsAt: null } }));

// misc
$('copy-obs').addEventListener('click', (e) => { e.preventDefault(); navigator.clipboard.writeText(location.origin + '/overlay').then(() => toast('Copied: ' + location.origin + '/overlay')); });
$('refresh').addEventListener('click', () => post('/api/refresh').then((r) => toast(r.error ? 'Weather data: ' + r.error : r.alerts + ' alerts loaded', r.error ? 'bad' : '')));
$('reset').addEventListener('click', () => { if (confirm('Reset every Stream House setting back to the defaults?')) post('/api/reset').then(() => toast('Reset')); });

// keyboard: 1-4 scenes, L lower third (not while typing)
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '1') scene('live'); else if (k === '2') scene('starting'); else if (k === '3') scene('brb'); else if (k === '4') scene('ending');
  else if (k === 'l') { if (S.state?.layout.lower) patch({ layout: { lower: false } }); else patch({ layout: { lower: true }, lower: { shown: true } }); }
});
