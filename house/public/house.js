/* WeatherPower Stream House: the map you work on. Pick warnings on the map, steer the stream map, and run the
   overlay. Every change goes to the Stream House server, which pushes it to the outputs instantly. */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get: (k, d) => { try { const v = localStorage.getItem('wph-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('wph-' + k, JSON.stringify(v)); } catch {} } };
const S = {
  state: null, data: { alerts: [], reports: [] }, filter: 'warnings', M: null, shapesAt: '', newKeys: new Map(),
  src: Math.random().toString(36).slice(2), remote: false, held: false, view: null
};
const toast = (msg, kind = '', action) => {
  const el = document.createElement('div'); el.className = kind;
  el.innerHTML = '<span>' + esc(msg) + '</span>';
  if (action) {
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = action.text;
    b.onclick = () => { action.fn(); el.remove(); };
    el.appendChild(b);
  }
  $('toast').appendChild(el); setTimeout(() => el.remove(), action ? 12000 : 3500);
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
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const alertBy = (key) => S.data.alerts.find((a) => a.key === key);
// Storm warnings first; marine warnings (gales and such) sink to the bottom of the list.
const MARINE = /gale|storm warning|small craft|hurricane force|marine|seas|freezing spray|brisk wind|low water|rip current|surf/i;
const TOP = ['Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Extreme Wind Warning', 'Snow Squall Warning', 'Dust Storm Warning', 'Hurricane Warning', 'Storm Surge Warning', 'Tsunami Warning', 'Blizzard Warning', 'Ice Storm Warning'];
const order = (a) => (MARINE.test(a.event) && !/^(storm surge|tropical storm|hurricane) warning/i.test(a.event) ? 100 : 0) + (TOP.includes(a.event) ? TOP.indexOf(a.event) - 20 : 0);

/* ---------- output windows (each opens once; in the desktop program they're their own windows) ---------- */
const OUT = { map: ['/map', 'wp-stream-map'], overlay: ['/overlay?preview=1', 'wp-overlay'], program: ['/program', 'wp-program'] };
const openOut = (k) => window.open(OUT[k][0], OUT[k][1], 'width=1280,height=720');
document.querySelectorAll('[data-out]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openOut(a.dataset.out); }));

/* ---------- side tabs ---------- */
const showTab = (t) => {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((p) => p.classList.toggle('on', p.dataset.tab === t));
  store.set('tab', t);
};
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
showTab(store.get('tab', 'warn'));

/* ---------- the stream frame: the part of your map that's on stream ---------- */
const frameRect = () => {
  const W = $('mapwrap').clientWidth, H = $('mapwrap').clientHeight, m = 26;
  const w = Math.max(160, Math.min(W - 2 * m, ((H - 2 * m) * 16) / 9)), h = (w * 9) / 16;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, W, H };
};
// The stream map is 1920 px wide; it shows exactly what's inside the frame.
const zoomOffset = () => Math.log2(1920 / frameRect().w);
const placeFrame = () => {
  const r = frameRect(), st = S.state, f = $('frame');
  f.hidden = !store.get('frame', true);
  $('frame-btn').classList.toggle('on', !f.hidden);
  Object.assign(f.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const k = r.h / 1080, live = !st || st.scene === 'live';
  f.querySelector('.top').style.height = 80 * k + 'px';
  f.querySelector('.bottom').style.height = 80 * k + 'px';
  f.querySelector('.top').hidden = !(live && st?.layout.top);
  f.querySelector('.bottom').hidden = !(live && st?.layout.bottom);
  const card = f.querySelector('.ghost-card');
  card.hidden = !(live && st?.layout.card && st.card.alertKey);
  Object.assign(card.style, { left: 32 * k + 'px', top: 104 * k + 'px', width: 500 * k + 'px', height: 420 * k + 'px' });
  f.classList.toggle('held', S.held);
  $('flabel').textContent = !live ? 'ON STREAM · ' + ({ starting: 'STARTING SOON', brb: 'BE RIGHT BACK', ending: 'ENDING' }[st.scene] || '') + ' SCENE IS UP'
    : S.held ? 'PREVIEW · PRESS T TO TAKE' : 'ON STREAM';
};
new ResizeObserver(() => placeFrame()).observe($('mapwrap'));
$('frame-btn').addEventListener('click', () => { store.set('frame', !store.get('frame', true)); placeFrame(); });

/* ---------- sending your view to the stream map ---------- */
const outView = (how) => {
  const m = S.M.map, c = m.getCenter();
  return { center: [c.lng, c.lat], zoom: m.getZoom() + zoomOffset(), bearing: m.getBearing(), pitch: m.getPitch(), how, src: S.src };
};
let mirrorAt = 0, smoothTimer = null;
const sendView = (how) => post('/api/view', outView(how)).catch(() => {});
const follow = () => S.state?.map.follow || 'smooth';
const take = () => {
  if (!S.M) return;
  clearTimeout(smoothTimer);
  sendView('fly');
  autoSite(true);
  S.held = false;
  $('take').classList.remove('hot');
  placeFrame();
};
$('take').addEventListener('click', take);

/* ---------- radar site: automatic (nearest once you zoom in) or picked ---------- */
const autoSite = (force) => {
  const cfg = S.state?.map;
  if (!S.M || !cfg || cfg.radar !== 'auto' || (follow() === 'hold' && !force)) return;
  const z = S.M.map.getZoom() + zoomOffset(), c = S.M.map.getCenter();
  const site = z >= 6.2 ? S.M.nearestSite([c.lng, c.lat])?.id || '' : '';
  if (site !== cfg.site) { cfg.site = site; patch({ map: { site } }); }
};
const fillSites = () => {
  const sel = $('site');
  if (sel.options.length || !S.M?.sites.length) return;
  sel.innerHTML = '<option value="">Pick a radar site…</option>' + S.M.sites.filter((s) => s.state).slice().sort((a, b) => (a.state + a.name).localeCompare(b.state + b.name))
    .map((s) => `<option value="${esc(s.id)}">${esc(s.state)} · ${esc(s.name)} (${esc(S.M.siteLabel(s))})</option>`).join('');
};

/* ---------- render everything from the show state ---------- */
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
  const picked = st.bottom.alertKey && alertBy(st.bottom.alertKey);
  $('b-picked').textContent = st.bottom.mode === 'alert' ? (picked ? 'Picked: ' + picked.eventLabel : 'Pick a warning on the map, then “Bottom bar”.') : '';
  pressed('h-mode', st.headlines);
  setVal('h-msgs', (st.ticker.messages || []).join('\n')); setVal('h-every', st.ticker.everyItems); setVal('brand', st.brandText);
  $('br-auto').checked = st.breaking.auto; $('br-sound').checked = st.breaking.sound;
  document.querySelectorAll('[data-br]').forEach((el) => { el.checked = Boolean(st.breaking[el.dataset.br]); });
  pressed('br-style', st.breaking.style); setVal('br-secs', st.breaking.seconds);
  setVal('st-title', st.starting.title); setVal('st-msg', st.starting.message); setVal('brb-msg', st.brb.message);
  setVal('en-title', st.ending.title); setVal('en-msg', st.ending.message);
  // map controls
  const m = st.map;
  document.querySelectorAll('#lyr [data-lyr]').forEach((b) => b.classList.toggle('on', Boolean(m.layers[b.dataset.lyr])));
  pressed('radar-mode', m.radar);
  $('site').hidden = m.radar !== 'site';
  fillSites();
  if (document.activeElement !== $('site')) $('site').value = m.site || '';
  if (document.activeElement !== $('opacity')) $('opacity').value = Math.round((m.opacity || 0.85) * 100);
  pressed('follow', m.follow);
  if (m.follow !== 'hold') S.held = false;
  $('take').classList.toggle('hot', S.held);
  $('showsel').checked = m.showSelected;
  if (S.M) S.M.setConfig(m);
  placeFrame();
  renderSel();
  renderAlerts();
};
const renderData = () => {
  const d = S.data;
  $('s-data').textContent = d.error ? 'NOT CONNECTED' : d.updatedAt ? 'UPDATED ' + clock(d.updatedAt) : '—';
  $('s-data').className = d.error ? 'bad' : '';
  const t = d.tallies || {};
  $('s-alerts').textContent = `${t.tor || 0} TOR · ${t.svr || 0} SVR · ${t.ffw || 0} FFW · ${d.alerts.filter((a) => a.group === 'watches').length} WATCHES`;
  $('src').textContent = d.error ? 'Weather data: ' + d.error : d.source ? 'Weather data from ' + d.source.replace(/^https?:\/\//, '') : '';
  if (S.M) { S.M.setReports(d.reports); loadShapes(); }
  renderSel();
  renderAlerts();
};
const loadShapes = async () => {
  if (!S.M || !S.data.updatedAt || S.data.updatedAt === S.shapesAt) return;
  S.shapesAt = S.data.updatedAt;
  try { S.M.setShapes(await (await fetch('/api/map/shapes', { cache: 'no-store' })).json()); } catch { S.shapesAt = ''; }
};

/* ---------- the picked warning ---------- */
const onAir = () => new Set([S.state.layout.card && S.state.card.alertKey, S.state.bottom.mode === 'alert' && S.state.bottom.alertKey].filter(Boolean));
const left = (t) => {
  const min = Math.round((Date.parse(t) - Date.now()) / 60000);
  if (!Number.isFinite(min)) return '';
  return min <= 0 ? 'EXPIRING' : min < 60 ? 'ENDS IN ' + min + ' MIN' : 'ENDS IN ' + Math.floor(min / 60) + ' H ' + (min % 60) + ' MIN';
};
const renderSel = () => {
  if (!S.state) return;
  const key = S.state.map.selected, a = key && alertBy(key);
  $('sel').hidden = !a;
  if (!a) return;
  $('sel').style.setProperty('--c', a.color || '#888');
  $('sel-title').textContent = a.eventLabel || a.event;
  $('sel-area').textContent = a.areaDesc || a.area || a.place || '';
  const chips = [];
  if (a.status) chips.push(`<span class="chip">${esc(a.status)}</span>`);
  if (a.expiresAt) chips.push(`<span class="chip a">${esc(left(a.expiresAt))}${a.times?.expires ? ' · ' + esc(a.times.expires) : ''}</span>`);
  if (a.times?.issued) chips.push(`<span class="chip">ISSUED ${esc(a.times.issued)}</span>`);
  if (a.office) chips.push(`<span class="chip">NWS ${esc(a.office)}</span>`);
  if (a.threat) chips.push(`<span class="chip r">${esc(a.threat)}</span>`);
  if (a.people) chips.push(`<span class="chip c">${esc(Number(a.people).toLocaleString())} PEOPLE</span>`);
  $('sel-meta').innerHTML = chips.join('');
  $('sel-hz').innerHTML = (a.hazards || []).map((h) => `<span>${esc(typeof h === 'string' ? h : h.label || h.text || JSON.stringify(h))}</span>`).join('');
  $('sel-sum').textContent = a.summary || '';
  const cardOn = S.state.layout.card && S.state.card.alertKey === a.key;
  $('sa-card').textContent = cardOn ? 'Hide card' : 'Card';
  $('sa-card').classList.toggle('primary', cardOn);
  const botOn = S.state.bottom.mode === 'alert' && S.state.bottom.alertKey === a.key;
  $('sa-bottom').textContent = botOn ? 'Bottom: on air' : 'Bottom bar';
  $('sa-bottom').classList.toggle('primary', botOn);
  $('sel').classList.toggle('air', onAir().has(a.key));
};
setInterval(renderSel, 20000);
const select = (key, { fly = false } = {}) => {
  if (!S.state) return;
  S.state.map.selected = key || '';
  patch({ map: { selected: key || '' } });
  if (S.M) S.M.setConfig(S.state.map);
  renderSel(); renderAlerts();
  if (key) { showTab('warn'); if (fly) zoomTo(key); }
};
// Fit the warning inside the stream frame (clear of the top and bottom bars and the card).
const zoomTo = (key) => {
  const b = S.M?.boundsOf(key);
  if (!b) return;
  const r = frameRect(), k = r.h / 1080, a = alertBy(key);
  const cardW = S.state.layout.card && S.state.card.alertKey ? 540 * k : 0;
  S.M.map.fitBounds(b, {
    padding: { top: r.y + 110 * k + 20, bottom: r.H - r.y - r.h + 110 * k + 20, left: r.x + cardW + 30, right: r.W - r.x - r.w + 30 },
    maxZoom: (a?.group === 'watches' ? 7.2 : 9.4) - zoomOffset(), duration: 1600, essential: true
  });
};
$('sel-close').addEventListener('click', () => select(''));
$('sa-zoom').addEventListener('click', () => zoomTo(S.state.map.selected));
const cardToggle = (key) => {
  const same = S.state.layout.card && S.state.card.alertKey === key;
  patch({ layout: { card: !same }, card: { alertKey: same ? null : key } }, same ? 'Card hidden' : 'Card on stream');
};
const bottomToggle = (key) => {
  const same = S.state.bottom.mode === 'alert' && S.state.bottom.alertKey === key;
  patch({ bottom: same ? { mode: 'auto' } : { mode: 'alert', alertKey: key } }, same ? 'Bottom bar back to the top warning' : 'In the bottom bar');
};
const breaking = (key) => post('/api/breaking', { key }).then((r) => toast('Breaking: ' + r.alert, 'warn')).catch((e) => toast(e.message, 'bad'));
$('sa-card').addEventListener('click', () => cardToggle(S.state.map.selected));
$('sa-bottom').addEventListener('click', () => bottomToggle(S.state.map.selected));
$('sa-break').addEventListener('click', () => breaking(S.state.map.selected));
$('sa-radar').addEventListener('click', () => {
  const b = S.M?.boundsOf(S.state.map.selected);
  if (!b) return;
  const s = S.M.nearestSite([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], 600);
  if (!s) return toast('No radar site near this one', 'bad');
  patch({ map: { radar: 'site', site: s.id, layers: { radar: true } } }, 'Radar: ' + S.M.siteLabel(s) + ' ' + s.name);
});

/* ---------- warnings list ---------- */
const renderAlerts = () => {
  if (!S.state) return;
  const q = $('a-search').value.trim().toLowerCase();
  const f = S.state.focus;
  const list = S.data.alerts
    .filter((a) => (S.filter === 'all' ? true : a.group === S.filter) && (!f || a.states.includes(f)))
    .filter((a) => !q || [a.eventLabel, a.area, a.areaDesc, a.place, a.office, ...(a.states || []).map((s) => STATES[s] || s)].join(' ').toLowerCase().includes(q))
    .sort((x, y) => order(x) - order(y) || x.rank - y.rank || Date.parse(y.issuedAt || 0) - Date.parse(x.issuedAt || 0));
  $('t-count').textContent = S.data.alerts.filter((a) => a.group === 'warnings' && order(a) < 100).length || '';
  const air = onAir(), sel = S.state.map.selected, now = Date.now();
  $('alerts').innerHTML = list.slice(0, 150).map((a) => {
    const isNew = now - (S.newKeys.get(a.key) || 0) < 15 * 60000;
    return `<div class="arow ${air.has(a.key) ? 'feat' : ''} ${a.key === sel ? 'sel' : ''}" data-key="${esc(a.key)}" style="--c:${esc(a.color || '#888')}"><i></i>
    <div><b>${isNew ? '<em class="new">NEW</em>' : ''}${esc(a.eventLabel)}</b><small>${esc(a.area || a.place || '')}${a.expiresAt ? ' · ' + esc(left(a.expiresAt).toLowerCase()) : ''}</small></div>
    <div class="acts"><button class="btn sm" data-card="${esc(a.key)}" title="Card">Card</button><button class="btn sm" data-bottom="${esc(a.key)}" title="Bottom bar">Bar</button><button class="btn sm warn" data-break="${esc(a.key)}" title="Breaking takeover">Break</button></div></div>`;
  }).join('') || `<p class="empty" style="padding: 0 14px">${S.data.error ? 'No weather data: ' + esc(S.data.error) : 'No alerts match.'}</p>`;
};
document.querySelector('#a-filter').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v) return;
  S.filter = v; pressed('a-filter', v); renderAlerts();
});
$('a-search').addEventListener('input', renderAlerts);
$('alerts').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b?.dataset.card) return cardToggle(b.dataset.card);
  if (b?.dataset.bottom) return bottomToggle(b.dataset.bottom);
  if (b?.dataset.break) return breaking(b.dataset.break);
  const row = e.target.closest('.arow');
  if (row) select(row.dataset.key, { fly: true });
});

/* ---------- a little ding on this computer for new tornado warnings ---------- */
let actx = null;
const ding = () => {
  try {
    actx = actx || new AudioContext();
    const t = actx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.18); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
      o.connect(g).connect(actx.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.55);
    });
  } catch {}
};
$('ding').checked = store.get('ding', true);
$('newpop').checked = store.get('newpop', true);
$('ding').addEventListener('change', () => store.set('ding', $('ding').checked));
$('newpop').addEventListener('change', () => store.set('newpop', $('newpop').checked));

/* ---------- live connection ---------- */
const connect = () => {
  const es = new EventSource('/api/events?who=panel');
  es.addEventListener('state', (e) => { S.state = JSON.parse(e.data); renderState(); });
  es.addEventListener('data', (e) => { S.data = JSON.parse(e.data); renderData(); });
  es.addEventListener('view', (e) => {
    const v = JSON.parse(e.data);
    if (!S.M) { S.view = v; return; }
    if (v.src === S.src || v.how === 'jump') return;
    // Moved from somewhere else (a Stream Deck button, another window): follow it.
    S.remote = true;
    S.M.setView({ ...v, zoom: v.zoom - zoomOffset() }, 'fly');
  });
  es.addEventListener('new', (e) => {
    const a = JSON.parse(e.data);
    S.newKeys.set(a.key, Date.now());
    renderAlerts();
    if (a.group !== 'warnings') return;
    if ($('ding').checked && (/tornado/i.test(a.event) || a.rank === 0)) ding();
    if ($('newpop').checked) toast('NEW: ' + a.eventLabel + ' · ' + (a.area || ''), /tornado/i.test(a.event) ? 'bad' : 'warn', { text: 'Show', fn: () => select(a.key, { fly: true }) });
  });
  es.addEventListener('breaking', (e) => { const { alert, test } = JSON.parse(e.data); toast((test ? 'TEST: ' : 'BREAKING on stream: ') + alert.eventLabel + ' · ' + (alert.area || ''), 'warn'); });
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
};
connect();
setInterval(async () => {
  try {
    const { who = {} } = await (await fetch('/api/info')).json();
    const parts = [who.map && 'MAP', who.overlay && 'OVERLAY', who.program && 'PROGRAM'].filter(Boolean);
    $('s-outputs').textContent = parts.length ? parts.join(' · ') : 'NONE OPEN';
    $('s-outputs').className = parts.length ? '' : 'warn';
  } catch { $('s-outputs').textContent = 'STREAM HOUSE STOPPED'; $('s-outputs').className = 'bad'; }
}, 4000);

/* ---------- the map ---------- */
(async () => {
  for (let i = 0; i < 40 && !(S.state && S.view); i++) await new Promise((r) => setTimeout(r, 100));
  const v = S.view || { center: [-96, 38.6], zoom: 4.3 };
  const M = await WPMap.create($('map'), { interactive: true, view: { ...v, zoom: v.zoom - zoomOffset() } });
  S.M = M;
  const map = M.map;
  map.keyboard.disable();   // the keys below are Stream House shortcuts
  M.onFrame = ({ time, latest, site }) => {
    $('rtime').textContent = time ? (site ? M.siteLabel(site) + ' ' : 'US ') + clock(time) : '—';
    $('rtime').classList.toggle('latest', Boolean(latest));
    $('lyr-vel').disabled = !M.local?.velocity;
  };
  M.onSiteError = (id) => toast('Radar ' + M.siteLabel(M.sites.find((s) => s.id === id) || { id }) + ' has no data right now (it may be down). Showing the national radar; pick another site.', 'bad');
  M.onReady = () => { if (S.state) M.setConfig(S.state.map); M.setReports(S.data.reports); S.shapesAt = ''; loadShapes(); };
  if (M.ready) M.onReady();
  fillSites();
  if (S.state) $('site').value = S.state.map.site || '';

  // Follow modes: Mirror sends every move, Smooth sends where you stop, Hold waits for Take.
  map.on('move', () => {
    if (S.remote || follow() !== 'mirror') return;
    const now = Date.now();
    if (now - mirrorAt > 90) { mirrorAt = now; sendView('ease'); }
  });
  map.on('moveend', () => {
    if (S.remote) { S.remote = false; return; }
    const f = follow();
    if (f === 'mirror') sendView('ease');
    else if (f === 'smooth') { clearTimeout(smoothTimer); smoothTimer = setTimeout(() => sendView('fly'), 250); }
    else { S.held = true; $('take').classList.add('hot'); placeFrame(); }
    autoSite();
  });

  // Pick a warning by clicking it (the most serious one wins where they overlap); click a report for details.
  const under = (pt) => map.queryRenderedFeatures(pt, { layers: ['a-fill'] }).map((f) => f.properties).sort((x, y) => x.rank - y.rank)[0];
  map.on('click', (e) => {
    const rep = map.queryRenderedFeatures(e.point, { layers: ['reports'] })[0];
    if (rep) {
      const r = M.reportAt(rep.properties.i);
      if (r) new maplibregl.Popup({ closeButton: false, className: 'rpop', maxWidth: '300px' }).setLngLat([r.lon, r.lat])
        .setHTML(`<b style="color:${WPMap.REPORT_COLORS[r.type] || '#fff'}">${esc(r.type)}${r.magnitude ? ' ' + esc(r.magnitude) : ''}</b><small>${esc(r.city || '')}${r.state ? ', ' + esc(r.state) : ''}${r.time ? ' · ' + esc(clock(r.time)) : ''}</small>${r.remark ? '<p>' + esc(r.remark) + '</p>' : ''}`).addTo(map);
      return;
    }
    const f = under(e.point);
    if (f) select(f.key);
  });
  map.on('mousemove', (e) => {
    const f = under(e.point);
    const overReport = map.queryRenderedFeatures(e.point, { layers: ['reports'] }).length > 0;
    map.getCanvas().style.cursor = f || overReport ? 'pointer' : '';
    M.setHover(f?.key || '');
    const a = f && alertBy(f.key);
    const tip = $('tip');
    tip.hidden = !a;
    if (a) {
      tip.innerHTML = `<b style="--c:${esc(a.color || '#888')}">${esc(a.eventLabel)}</b><small>${esc(a.area || a.place || '')}</small><small>${esc(left(a.expiresAt))}</small>`;
      tip.style.transform = `translate(${Math.min(e.point.x + 16, $('mapwrap').clientWidth - 300)}px, ${e.point.y + 16}px)`;
    }
  });
  map.getCanvas().addEventListener('mouseleave', () => { $('tip').hidden = true; M.setHover(''); });
})();

/* ---------- map toolbar ---------- */
$('lyr').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lyr]'); if (!b || b.disabled) return;
  const k = b.dataset.lyr;
  patch({ map: { layers: { [k]: !S.state.map.layers[k] } } });
});
document.querySelector('#radar-mode').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v || !S.M) return;
  if (v === 'national') patch({ map: { radar: 'national' } });
  else if (v === 'auto') { S.state.map.radar = 'auto'; patch({ map: { radar: 'auto' } }).then(() => autoSite(true)); }
  else {
    const c = S.M.map.getCenter();
    const site = S.state.map.site || S.M.nearestSite([c.lng, c.lat], 2000)?.id || '';
    patch({ map: { radar: 'site', site } });
  }
});
$('site').addEventListener('change', () => { if ($('site').value) patch({ map: { radar: 'site', site: $('site').value } }); $('site').blur(); });
$('opacity').addEventListener('input', () => patch({ map: { opacity: Number($('opacity').value) / 100 } }));
$('play').addEventListener('click', () => { if (!S.M) return; S.M.setPlaying(!S.M.playing); $('play').textContent = S.M.playing ? '❚❚' : '▶'; });
document.querySelector('#follow').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v; if (!v) return;
  patch({ map: { follow: v } });
  if (v !== 'hold') { S.held = false; if (S.M) sendView('fly'); }
});
$('home').addEventListener('click', () => S.M?.map.flyTo({ center: [-96, 38.6], zoom: 4.3 - zoomOffset(), bearing: 0, pitch: 0, essential: true }));
$('showsel').addEventListener('change', () => patch({ map: { showSelected: $('showsel').checked } }));

/* ---------- show controls ---------- */
const scene = (s) => patch({ scene: s });
document.querySelectorAll('.scenebtn').forEach((b) => b.addEventListener('click', () => scene(b.dataset.scene)));
$('layout').addEventListener('change', (e) => { const k = e.target.dataset.l; if (k) patch({ layout: { [k]: e.target.checked } }); });
$('theme').addEventListener('change', () => patch({ theme: $('theme').value }));
$('focus').addEventListener('change', () => patch({ focus: $('focus').value }, $('focus').value ? 'Focus: ' + STATES[$('focus').value] : 'Whole country'));
document.querySelectorAll('input[type=text], input[type=number], textarea').forEach((el) => {
  el.addEventListener('input', () => { el.dataset.dirty = '1'; });
});
const clean = (...ids) => ids.forEach((id) => { $(id).dataset.dirty = ''; });

const lowerFields = () => ({ name: $('lw-name').value.trim(), title: $('lw-title').value.trim(), autoHideSec: Number($('lw-auto').value) || 0 });
$('lw-show').addEventListener('click', () => { clean('lw-name', 'lw-title', 'lw-auto'); patch({ layout: { lower: true }, lower: { ...lowerFields(), shown: true } }); });
$('lw-hide').addEventListener('click', () => patch({ layout: { lower: false } }));
['lw-name', 'lw-title'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lw-show').click(); }));

document.querySelector('#b-mode').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ bottom: { mode: v } }); });
$('b-apply').addEventListener('click', () => { clean('b-label', 'b-title', 'b-crawl'); patch({ bottom: { mode: 'custom', label: $('b-label').value.trim(), title: $('b-title').value.trim(), crawl: $('b-crawl').value.trim() } }, 'Bottom bar updated'); });

document.querySelector('#h-mode').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ headlines: v }); });
$('h-apply').addEventListener('click', () => {
  clean('h-msgs', 'h-every', 'brand');
  patch({ ticker: { messages: $('h-msgs').value.split('\n').map((s) => s.trim()).filter(Boolean), everyItems: Math.max(1, Number($('h-every').value) || 5) }, brandText: $('brand').value.trim() || 'WEATHERPOWER.APP' }, 'Top bar updated');
});

$('br-auto').addEventListener('change', () => patch({ breaking: { auto: $('br-auto').checked } }));
$('br-sound').addEventListener('change', () => patch({ breaking: { sound: $('br-sound').checked } }));
document.querySelectorAll('[data-br]').forEach((el) => el.addEventListener('change', () => patch({ breaking: { [el.dataset.br]: el.checked } })));
document.querySelector('#br-style').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) patch({ breaking: { style: v } }); });
$('br-secs').addEventListener('change', () => { clean('br-secs'); patch({ breaking: { seconds: Math.max(3, Number($('br-secs').value) || 7) } }); });
$('br-test').addEventListener('click', () => post('/api/breaking', { test: true }).then((r) => toast('Test: ' + r.alert)).catch((e) => toast(e.message, 'bad')));

$('sc-apply').addEventListener('click', () => {
  clean('st-title', 'st-msg', 'brb-msg', 'en-title', 'en-msg');
  patch({ starting: { title: $('st-title').value.trim(), message: $('st-msg').value.trim() }, brb: { message: $('brb-msg').value.trim() }, ending: { title: $('en-title').value.trim(), message: $('en-msg').value.trim() } }, 'Scene text updated');
});
$('st-go').addEventListener('click', () => patch({ scene: 'starting', starting: { endsAt: new Date(Date.now() + (Number($('st-min').value) || 5) * 60000).toISOString() } }, 'Countdown started'));
$('st-clear').addEventListener('click', () => patch({ starting: { endsAt: null } }));

$('refresh').addEventListener('click', () => post('/api/refresh').then((r) => toast(r.error ? 'Weather data: ' + r.error : r.alerts + ' alerts loaded', r.error ? 'bad' : '')));
$('reset').addEventListener('click', () => { if (confirm('Reset every Stream House setting back to the defaults?')) post('/api/reset').then(() => toast('Reset')); });

/* ---------- keys (not while typing) ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2' || e.key === 'F3' || e.key === 'F4') { e.preventDefault(); openOut({ F2: 'map', F3: 'overlay', F4: 'program' }[e.key]); return; }
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || !S.state) return;
  const k = e.key.toLowerCase(), sel = S.state.map.selected;
  if (k === '1') scene('live'); else if (k === '2') scene('starting'); else if (k === '3') scene('brb'); else if (k === '4') scene('ending');
  else if (k === 'l') { if (S.state.layout.lower) patch({ layout: { lower: false } }); else patch({ layout: { lower: true }, lower: { shown: true } }); }
  else if (k === 'escape') select('');
  else if (k === 'c' && sel) cardToggle(sel);
  else if (k === 'b' && sel) bottomToggle(sel);
  else if (k === 't') take();
  else if (k === 'h') $('home').click();
  else if (k === 'r') patch({ map: { layers: { radar: !S.state.map.layers.radar } } });
  else if (k === ' ') { e.preventDefault(); $('play').click(); }
});
// Clicked buttons let go of focus, so Space and the letter keys stay Stream House shortcuts.
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail) b.blur(); });
