/* WeBot Studio front end. Talks only to the Studio server on this PC (studio/server.js). */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const call = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `${method} ${url} failed (${r.status})`);
  return json;
};
const toast = (msg, kind = '') => {
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = msg;
  $('toast').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 4500);
};
const modal = (title, html, actions = [{ label: 'Close' }]) => new Promise((resolve) => {
  $('m-title').textContent = title;
  $('m-body').innerHTML = html;
  $('m-actions').innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.kind || '');
    b.textContent = a.label;
    b.onclick = () => { if (!a.keepOpen) $('modal').classList.remove('on'); resolve(a.value); };
    $('m-actions').appendChild(b);
  });
  $('modal').classList.add('on');
});
const confirmBox = (title, text, label = 'Yes, do it', kind = 'warn') => modal(title, `<p class="dim">${text}</p>`, [{ label: 'Cancel', value: false }, { label, value: true, kind }]);
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' hr ago'; };
const dur = (sec) => { sec = Math.max(0, Math.round(sec)); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, p, v) => { const ks = p.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; }); o[ks[ks.length - 1]] = v; };
const KINDS = {
  alert: 'Top alert', pinned: 'Pinned alert', think: 'Model check', models: 'Weather models', national: 'National overview',
  outlook: 'Severe outlook', reports: 'Storm reports', tropics: 'Tropics', surface: 'Radar & fronts', forecast: 'Daily forecast', gas: 'Gas prices'
};

/* ---------------- navigation ---------------- */
const pages = {};
const show = (name) => {
  if (!$('page-' + name)) name = 'overview';
  if (S.page === 'code' && name !== 'code' && ED.dirty && !confirm('You have unsaved code changes. Leave anyway?')) return;
  S.page = name;
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === name));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + name));
  history.replaceState(null, '', '#' + name);
  pages[name]?.enter?.();
};
$('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-page]'); if (b) show(b.dataset.page); });
const S = { page: 'overview', overview: null, cfg: null };

/* ---------------- overview + top strip ---------------- */
const pct = (v, max) => Math.max(0, Math.min(100, (v / max) * 100));
const renderOverview = (o) => {
  S.overview = o;
  const st = o.status || {}, srv = o.server || {}, ctl = o.control || {};
  // strip
  const onair = $('s-onair');
  onair.className = 'onair' + (st.brb ? ' brb' : st.onAir ? ' live' : '');
  $('s-onair-t').textContent = st.error ? 'NO STATUS' : st.brb ? 'BRB' : st.onAir ? 'ON AIR' : 'OFF AIR';
  const now = st.now;
  $('s-now').textContent = st.brb ? 'Be right back' : now ? (KINDS[now.type] || now.type) + (now.title ? ' · ' + now.title : '') : '—';
  $('s-viewers').textContent = st.chat?.viewers ?? '—';
  $('s-views').textContent = st.chat?.totalViews != null ? Number(st.chat.totalViews).toLocaleString() : '—';
  S.liveSince = st.chat?.startedAt ? Date.parse(st.chat.startedAt) : null;
  tickUptime();
  if (!srv.error) {
    const cpuPct = pct(srv.container.cpu, srv.container.cpuLimit);
    $('s-cpu').textContent = Math.round(cpuPct) + '%';
    $('s-cpu').className = cpuPct > 92 ? 'bad' : cpuPct > 80 ? 'warn' : '';
    $('s-quality').textContent = `${srv.stream.height}p · ${srv.stream.bitrate}`;
  }
  $('f-ssh').innerHTML = `<span class="dot ${srv.error ? 'bad' : 'ok'}"></span> ${srv.error ? 'down' : 'ok'}`;
  $('f-deployed').textContent = srv.deployed ? srv.deployed.slice(0, 7) : 'unknown';

  // on air
  $('o-updated').textContent = 'updated ' + clock(new Date().toISOString());
  if (st.error) {
    $('o-kind').textContent = 'STATUS PAGE UNREACHABLE';
    $('o-label').textContent = '—';
    $('o-title').textContent = st.error;
  } else {
    $('o-kind').textContent = st.brb ? 'PAUSED' : now ? (KINDS[now.type] || now.type).toUpperCase() : 'IDLE';
    $('o-label').textContent = st.brb ? 'Be right back' : now?.k && !/NOW TRACKING/i.test(now.k) ? now.k : now ? KINDS[now.type] || now.type : 'Off air';
    $('o-title').textContent = st.brb ? (st.brb.message || '') : now?.title || '';
    $('o-start').textContent = now?.start ? 'STARTED ' + clock(now.start) : '';
    S.seg = now;
    $('o-next').innerHTML = (st.upNext || []).map((k, i) => `<span class="chip ${i ? '' : 'c'}">${i + 1} · ${esc(KINDS[k] || k)}</span>`).join('') || '<span class="empty">—</span>';
    $('o-requests').innerHTML = (st.requests || []).map((r) => `<div class="chip r">Viewer request · ${esc(r.kind === 'gas' ? 'Gas' : 'Forecast')} · ${esc(r.place)}${r.user ? ' · ' + esc(r.user) : ''}</div>`).join('');
    const said = st.said?.[0];
    $('o-said').className = 'quote' + (said ? '' : ' empty');
    $('o-said').innerHTML = said ? `“${esc(said.text)}”<div class="k" style="margin-top:6px">${esc(clock(said.at))} · ${esc(ago(said.at))}</div>` : 'Nothing yet. WeBot talks when the weather gets serious, for chat, or when Talk is On.';
    // weather
    $('o-wis').textContent = st.wis ? st.wis.score : '—';
    $('o-wis-l').textContent = st.wis ? st.wis.label : '';
    const t = st.tallies || {};
    $('o-tor').textContent = t.tor || 0; $('o-svr').textContent = t.svr || 0; $('o-ffw').textContent = t.ffw || 0; $('o-wat').textContent = t.watches || 0;
    $('o-warn').innerHTML = (st.watching || []).map((a) => `<li style="--c:${esc(a.color || '#888')}"><i></i><span><b class="mono" style="font-size:12px">${esc(a.label)}${a.count > 1 ? ' ×' + a.count : ''}</b><br><span class="faint">${esc([a.place, (a.states || []).join(', ')].filter(Boolean).join(' · '))}</span></span><span class="k">${a.expiresAt ? 'TO ' + esc(clock(a.expiresAt)) : ''}</span></li>`).join('') || '<li class="empty" style="display:block">No warnings.</li>';
    $('o-recent').innerHTML = (st.recent || []).slice(0, 9).map((s) => `<li><time>${esc(clock(s.start))}</time><span>${esc(KINDS[s.type] || s.type)}<br><span class="faint">${esc(s.title || '')}</span></span></li>`).join('') || '<li class="empty" style="display:block">Fills in as the show runs.</li>';
    $('o-chat').textContent = st.chat?.enabled ? (st.chat.live ? 'reading live chat' : 'on, waiting for the live video') : 'off';
  }
  // server
  if (srv.error) {
    $('o-container').innerHTML = `<span class="bad">${esc(srv.error)}</span>`;
  } else {
    const cpuPct = pct(srv.container.cpu, srv.container.cpuLimit);
    $('o-cpu').textContent = `${Math.round(srv.container.cpu)}% of ${srv.container.cpuLimit}%`;
    $('o-cpu-bar').style.width = cpuPct + '%';
    $('o-cpu-bar').style.background = cpuPct > 92 ? 'var(--red)' : cpuPct > 80 ? 'var(--amber)' : 'var(--cyan)';
    const memPct = pct(srv.host.memUsed, srv.host.memTotal);
    $('o-mem').textContent = `${(srv.host.memUsed / 1024).toFixed(1)} / ${(srv.host.memTotal / 1024).toFixed(1)} GB`;
    $('o-mem-bar').style.width = memPct + '%';
    $('o-container').innerHTML = /^Up/.test(srv.container.status) ? `<span class="ok">${esc(srv.container.status)}</span>` : `<span class="bad">${esc(srv.container.status)}</span>`;
    $('o-sending').innerHTML = srv.procs.ffmpeg ? '<span class="ok">ffmpeg → YouTube</span>' : '<span class="bad">ffmpeg not running</span>';
    $('o-q').textContent = `${srv.stream.width}×${srv.stream.height} · ${srv.stream.fps} fps · ${srv.stream.bitrate} · ${srv.stream.preset}`;
    $('o-load').textContent = srv.host.load.map((n) => n.toFixed(2)).join('  ') + `  (${srv.host.cores} cores)`;
    $('o-disk').textContent = `${(srv.host.diskUsed / 1024).toFixed(1)} / ${(srv.host.diskTotal / 1024).toFixed(1)} GB`;
    $('o-up').textContent = dur(srv.host.uptimeSec);
    $('o-srv-at').textContent = clock(srv.at);
    $('o-log').textContent = srv.log.slice(-6).map((l) => l.replace(/^stream-1\s+\|\s?/, '')).join('\n') || '—';
  }
  // show control state
  if (!ctl.error) {
    const pressed = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    pressed('c-talk', ctl.talk || 'auto');
    pressed('c-voice', ctl.voice === false ? 'off' : 'on');
    pressed('c-genre', ctl.music?.genre || 'mix');
    pressed('c-chat', ctl.chatRead === false ? 'off' : 'on');
    if (document.activeElement !== $('c-mode')) $('c-mode').value = ctl.mode || 'auto';
    $('c-brb').textContent = ctl.brb ? 'End BRB' : 'Start BRB';
    $('c-brb').classList.toggle('danger', Boolean(ctl.brb));
    S.brb = Boolean(ctl.brb);
  }
};
const tickSeg = () => {
  const n = S.seg;
  if (!n?.start || !n?.end) { $('o-bar').style.width = '0'; $('o-left').textContent = ''; return; }
  const a = Date.parse(n.start), b = Date.parse(n.end);
  $('o-bar').style.width = pct(Date.now() - a, b - a) + '%';
  const left = Math.round((b - Date.now()) / 1000);
  $('o-left').textContent = left > 0 ? 'NEXT IN ' + (left >= 60 ? Math.floor(left / 60) + 'M ' + (left % 60) + 'S' : left + 'S') : 'WRAPPING UP';
};
const loadOverview = async () => {
  try { renderOverview(await call('GET', '/api/overview')); } catch (e) { $('s-onair-t').textContent = 'STUDIO ERROR'; toast(e.message, 'bad'); }
};
setInterval(() => { if (!document.hidden) loadOverview(); }, 10000);
setInterval(tickSeg, 1000);

// show control
const act = async (body, ok) => {
  try { await call('POST', '/api/control', body); if (ok) toast(ok); setTimeout(loadOverview, 1200); } catch (e) { toast(e.message, 'bad'); }
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act({ action: b.dataset.act }, b.textContent.trim())));
const segClick = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) fn(b.dataset.v, b); });
segClick('c-talk', (v) => act({ action: 'talk', mode: v }, 'Talk: ' + v));
segClick('c-voice', (v) => act({ action: 'voice', on: v === 'on' }, 'Voice ' + v));
segClick('c-genre', (v) => act({ action: 'music', genre: v }, 'Radio style: ' + v));
segClick('c-chat', (v) => act({ action: 'chat-read', on: v === 'on' }, v === 'on' ? 'WeBot reads chat' : 'Chat: commands only'));
$('c-mode').addEventListener('change', () => act({ action: 'mode', mode: $('c-mode').value }, 'Show: ' + $('c-mode').selectedOptions[0].textContent));
$('c-brb').addEventListener('click', async () => {
  if (S.brb) return act({ action: 'brb', on: false }, 'BRB ended');
  const msg = await modal('Start “Be right back”', '<div class="field"><label>Message on the card (optional)</label><input type="text" id="brb-msg" maxlength="140" placeholder="Switching servers, back in a minute"></div>', [{ label: 'Cancel', value: null }, { label: 'Start BRB', kind: 'warn', value: 'go' }]);
  if (msg) act({ action: 'brb', on: true, message: document.getElementById('brb-msg')?.value || '' }, 'BRB on');
});
const sayIt = () => { const t = $('c-say').value.trim(); if (t) act({ action: 'say', text: t }, 'Sent to WeBot').then(() => { $('c-say').value = ''; }); };
$('c-say-btn').addEventListener('click', sayIt);
$('c-say').addEventListener('keydown', (e) => { if (e.key === 'Enter') sayIt(); });

// snapshot
const snap = async () => {
  $('snap-btn').disabled = true;
  try {
    const r = await fetch('/api/snapshot');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Snapshot failed');
    const url = URL.createObjectURL(await r.blob());
    const el = $('snap');
    if (el.dataset.url) URL.revokeObjectURL(el.dataset.url);
    el.dataset.url = url;
    el.style.backgroundImage = `url(${url})`;
    el.textContent = '';
    $('snap-at').textContent = 'TAKEN ' + clock(new Date().toISOString());
  } catch (e) { toast(e.message, 'bad'); }
  $('snap-btn').disabled = false;
};
$('snap-btn').addEventListener('click', snap);
setInterval(() => { if ($('snap-auto').checked && S.page === 'overview' && !document.hidden) snap(); }, 30000);
pages.overview = { enter: loadOverview };

// How long the YouTube broadcast has been live (YouTube's start time), ticking every 30 s.
const tickUptime = () => {
  const ms = S.liveSince ? Date.now() - S.liveSince : NaN;
  if (!Number.isFinite(ms) || ms < 0) { $('s-uptime').textContent = '—'; return; }
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  $('s-uptime').textContent = d ? d + 'D ' + h + 'H' : h ? h + 'H ' + (m % 60) + 'M' : (m % 60) + 'M';
};
setInterval(tickUptime, 30000);

/* ---------------- brain ---------------- */
const SEGMENTS = [
  ['surface', 'National radar & fronts', 'The radar map with highs, lows and fronts', true, true],
  ['forecast', 'Daily forecasts', 'WeBot zooms to a random city', true, true],
  ['alert', 'Top alerts', 'A close look at one warning or watch', true, true],
  ['gas', 'Gas prices', 'Weekly prices around a city', true, true],
  ['train', 'Train Cam', 'A live SouthWest RailCams cam', true, true],
  ['rain', 'Rain outlook (WPC)', 'Flash flood risk for today and the next 2 days', true, true],
  ['think', 'Model check', 'WeBot “thinks”, then shows a weather model', true, true],
  ['national', 'National overview', 'Every active warning', true, true],
  ['outlook', 'Severe outlook', 'Today’s SPC outlook (when there is one)', true, true],
  ['reports', 'Storm reports', 'Recent tornado, hail and wind reports', true, true],
  ['models', 'Weather models (after a check)', 'How long the model loop stays up', false, true],
  ['tropics', 'Tropics', 'Hurricanes and areas to watch', false, true]
];
const BRAIN = [
  { id: 'identity', title: 'Identity', fields: [
    { path: 'identity.name', label: 'Name on the name tag', type: 'text' },
    { path: 'identity.tagline', label: 'Small line next to the name', type: 'text' }
  ] },
  { id: 'segments', title: 'Segments', custom: true },
  { id: 'lines', title: 'Lines', intro: 'One line per row; WeBot picks one at random. <code>{city}</code> becomes the city and state, <code>{name}</code> the viewer who asked.', fields: [
    { path: 'lines.forecast', label: 'Daily forecast openers', type: 'lines' },
    { path: 'lines.forecastRequest', label: 'When a viewer asks for a forecast', type: 'text' },
    { path: 'lines.gas', label: 'Gas price openers', type: 'lines' },
    { path: 'lines.gasRequest', label: 'When a viewer asks about gas', type: 'text' },
    { path: 'lines.surface', label: 'National radar openers', type: 'lines' },
    { path: 'lines.train', label: 'Train Cam openers ({city} = the cam’s town)', type: 'lines' },
    { path: 'lines.rain', label: 'Rain (WPC) outlook openers', type: 'lines' }
  ] },
  { id: 'chat', title: 'Chat', fields: [
    { path: 'chat.readAloud', label: 'Read regular chat messages out loud', type: 'bool' },
    { path: 'chat.showOnScreen', label: 'Show chat messages in the chat box on the stream', type: 'bool' },
    { path: 'chat.readEverySeconds', label: 'Read at most one message every (seconds)', type: 'num', min: 15, step: 5 },
    { path: 'chat.sameViewerMinutes', label: 'Same viewer read at most every (minutes)', type: 'num', min: 0, step: 1 },
    { path: 'chat.maxRepliesPerRead', label: 'Answers per chat check (about once a minute)', type: 'num', min: 1, step: 1 },
    { path: 'chat.maxRepliesPerHour', label: 'Most answers in an hour', type: 'num', min: 1, step: 5 },
    { path: 'chat.requestEveryMinutes', label: '!forecast / !gas: at most one every (minutes)', type: 'num', min: 0, step: 0.5 },
    { path: 'chat.commandCooldownMinutes', label: 'Each viewer can ask again after (minutes)', type: 'num', min: 0, step: 1 },
    { path: 'chat.maxRequestsPer20Minutes', label: 'Most requests in any 20 minutes', type: 'num', min: 1, step: 1 },
    { path: 'chat.blockedWords', label: 'Never read messages with these words (one per line)', type: 'lines', help: 'On top of the built-in filter for slurs, profanity, links and phone numbers.' },
    { path: 'chat.hint', label: 'Top-bar tip about chat commands', type: 'text' },
    { path: 'chat.replies.greeting', label: 'Replies to hello / hey / howdy', type: 'lines' },
    { path: 'chat.replies.compliment', label: 'Replies to compliments', type: 'lines' },
    { path: 'chat.replies.weatherQuestion', label: 'Replies to weather questions', type: 'lines' },
    { path: 'chat.replies.name', label: 'Replies when someone says WeBot', type: 'lines' }
  ] },
  { id: 'personality', title: 'Personality', tester: true, intro: 'WeBot is a sassy Southern robot: he reads a chat message, then talks back with one of these lines (picked at random, never the same one twice in a row). <code>{name}</code> becomes the viewer’s name, <code>{place}</code> the state they mentioned. He only says what’s written here, so keep it clean.', fields: [
    { path: 'personality.on', label: 'Southern sass on (off = the plain replies under Chat)', type: 'bool' },
    { path: 'personality.roastBack', label: 'Roast people back when they insult WeBot or call him a copy', type: 'bool' },
    { path: 'personality.nicknames', label: 'What he calls people when he can’t show their name', type: 'lines' },
    { path: 'personality.replies.welcomeBack', label: 'A regular comes back (3+ hours away)', type: 'lines' },
    { path: 'personality.replies.roastMe', label: '“!roast me” (they asked for it)', type: 'lines' },
    { path: 'personality.replies.rival', label: 'Called a copy / rip-off / “y’all bot”', type: 'lines' },
    { path: 'personality.replies.roast', label: 'Insulted (“trash”, “you suck”, “boring”)', type: 'lines' },
    { path: 'personality.replies.shrug', label: 'Insulted, with roasting off', type: 'lines' },
    { path: 'personality.replies.bot', label: '“Are you real / a bot?”', type: 'lines' },
    { path: 'personality.replies.greeting', label: 'Hello / hey / howdy', type: 'lines' },
    { path: 'personality.replies.goodbye', label: 'Bye / good night', type: 'lines' },
    { path: 'personality.replies.place', label: 'Says where they’re from', type: 'lines' },
    { path: 'personality.replies.first', label: '“First!”', type: 'lines' },
    { path: 'personality.replies.thanks', label: 'Thanks', type: 'lines' },
    { path: 'personality.replies.compliment', label: 'Compliments', type: 'lines' },
    { path: 'personality.replies.weatherQuestion', label: 'Weather questions', type: 'lines' },
    { path: 'personality.replies.storm', label: 'Storms where they are', type: 'lines' },
    { path: 'personality.replies.rain', label: 'Rain where they are', type: 'lines' },
    { path: 'personality.replies.snow', label: 'Snow and ice', type: 'lines' },
    { path: 'personality.replies.hot', label: 'Heat', type: 'lines' },
    { path: 'personality.replies.cold', label: 'Cold', type: 'lines' },
    { path: 'personality.replies.wx', label: 'Other weather talk', type: 'lines' },
    { path: 'personality.replies.laugh', label: 'lol / haha', type: 'lines' },
    { path: 'personality.replies.uptime', label: '“How long have you been up?” ({uptime} = time on the air)', type: 'lines' },
    { path: 'personality.replies.howAreYou', label: '“How are you?” / “What’s up?”', type: 'lines' },
    { path: 'personality.replies.notYou', label: '“Not talking to you, WeBot”', type: 'lines' },
    { path: 'personality.replies.name', label: 'Says “WeBot”', type: 'lines' },
    { path: 'personality.replies.question', label: 'Any other question', type: 'lines' },
    { path: 'personality.replies.other', label: 'Everything else', type: 'lines' }
  ] },
  { id: 'radio', title: 'Radio', fields: [
    { path: 'radio.countryShare', label: 'Country songs when the style is Mix', type: 'percent' },
    { path: 'radio.countryNames', label: 'Country song names', type: 'lines' },
    { path: 'radio.calmNames', label: 'Calm lo-fi song names', type: 'lines' },
    { path: 'radio.chillNames', label: 'Chill lo-fi song names', type: 'lines' },
    { path: 'radio.stormNames', label: 'Storm song names', type: 'lines' }
  ] }
];
const BR = { saved: null, work: null, section: 'identity' };
const brainDirty = () => JSON.stringify(BR.work) !== JSON.stringify(BR.saved);
const markBrain = () => {
  const d = brainDirty();
  $('brain-bar').classList.toggle('dirty', d);
  $('brain-state').textContent = d ? 'Unsaved changes' : 'Saved · matches the stream';
  $('brain-badge').hidden = !d;
};
const fieldHtml = (f) => {
  const v = getPath(BR.work, f.path);
  const id = 'b-' + f.path.replace(/\./g, '-');
  if (f.type === 'bool') return `<label class="toggle"><input type="checkbox" data-path="${f.path}" data-type="bool" ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
  const input = f.type === 'lines' ? `<textarea id="${id}" data-path="${f.path}" data-type="lines" rows="${Math.min(10, Math.max(3, (v || []).length + 1))}">${esc((v || []).join('\n'))}</textarea>`
    : f.type === 'num' ? `<input type="number" id="${id}" data-path="${f.path}" data-type="num" value="${esc(v)}" min="${f.min ?? 0}" step="${f.step ?? 1}" style="width:140px">`
    : f.type === 'percent' ? `<div class="row" style="flex-wrap:nowrap"><input type="range" id="${id}" data-path="${f.path}" data-type="percent" min="0" max="100" step="5" value="${Math.round((v || 0) * 100)}"><b class="mono" style="width:48px" data-show="${id}">${Math.round((v || 0) * 100)}%</b></div>`
    : `<input type="text" id="${id}" data-path="${f.path}" data-type="text" value="${esc(v)}">`;
  return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
};
// Number fields sit side by side; everything else gets its own row.
const groupFields = (fields) => {
  let html = '', nums = [];
  const flush = () => { if (nums.length) html += `<div class="numgrid">${nums.join('')}</div>`; nums = []; };
  fields.forEach((f) => { if (f.type === 'num') nums.push(fieldHtml(f)); else { flush(); html += fieldHtml(f); } });
  flush();
  return html;
};
const segmentsHtml = () => {
  const rows = SEGMENTS.map(([key, name, about, hasW, hasS]) => {
    const w = BR.work.calmWeights[key], s = BR.work.calmSeconds[key];
    return `<tr><td><b>${esc(name)}</b><small>${esc(about)}</small></td>
      <td>${hasW ? `<div class="w"><input type="range" min="0" max="10" step="0.1" value="${w}" data-path="calmWeights.${key}" data-type="num" data-pair="w-${key}"><input type="number" min="0" step="0.1" value="${w}" data-path="calmWeights.${key}" data-type="num" data-pair="w-${key}"></div>` : '<span class="faint">—</span>'}</td>
      <td>${hasS ? `<input type="number" min="5" step="5" value="${s}" data-path="calmSeconds.${key}" data-type="num">` : ''}</td></tr>`;
  }).join('');
  const total = SEGMENTS.filter((x) => x[3]).reduce((a, [k]) => a + (Number(BR.work.calmWeights[k]) || 0), 0);
  const SHORT = { surface: 'Radar', forecast: 'Forecasts', alert: 'Alerts', gas: 'Gas', train: 'Trains', rain: 'Rain', think: 'Models', national: 'Overview', outlook: 'Outlook', reports: 'Reports' };
  const share = SEGMENTS.filter((x) => x[3]).map(([k]) => `${SHORT[k]} ${total ? Math.round((BR.work.calmWeights[k] / total) * 100) : 0}%`).join(' · ');
  return `<div class="panel"><h2>Calm-day segments <span class="r">severe weather always takes over</span></h2>
    <table class="seg-table"><tr><th>Segment</th><th>How often (weight)</th><th>Seconds on screen</th></tr>${rows}</table>
    <p class="k" style="margin-top:12px;letter-spacing:.06em">ROUGH SHARE: ${esc(share)}</p></div>
    <div class="panel"><h2>Gas prices</h2>${fieldHtml({ path: 'gasEveryMinutes', label: 'At most once every (minutes)', type: 'num', min: 5, step: 5 })}</div>`;
};
// Personality tester: type a chat message and see what WeBot would say back (uses the unsaved edits too).
const testerHtml = () => `<div class="panel" style="margin-bottom:12px"><h2>Try it <span class="r">nothing goes on the stream</span></h2>
  <div class="row"><input type="text" id="try-user" placeholder="Viewer name" style="width:170px" value="StormFan"><input type="text" id="try-text" placeholder="Type a chat message, like: this is a ryan hall rip off" style="flex:1;min-width:240px"><button class="btn primary" id="try-go">What would WeBot say?</button></div>
  <div class="quote" id="try-out" style="margin-top:10px">…</div></div>`;
const tryReply = async () => {
  const text = $('try-text')?.value.trim();
  if (!text) return;
  try {
    const r = await call('POST', '/api/brain/try', { text, user: $('try-user').value.trim(), brain: BR.work });
    $('try-out').innerHTML = '<span class="k" style="display:block;margin-bottom:6px">' + esc(r.kind) + '</span>' + esc(r.reply || '(he just reads it, no comment)');
  } catch (e) { toast(e.message, 'bad'); }
};
document.addEventListener('click', (e) => { if (e.target.id === 'try-go') tryReply(); });
document.addEventListener('keydown', (e) => { if (e.target.id === 'try-text' && e.key === 'Enter') tryReply(); });
const renderBrain = () => {
  $('brain-nav').innerHTML = BRAIN.map((s) => `<button data-sec="${s.id}" class="${s.id === BR.section ? 'on' : ''}">${esc(s.title)}</button>`).join('');
  $('brain-form').innerHTML = BRAIN.map((s) => `<div class="form-section ${s.id === BR.section ? 'on' : ''}" data-sec="${s.id}">${s.custom ? segmentsHtml()
    : `${s.tester ? testerHtml() : ''}<div class="panel"><h2>${esc(s.title)}</h2>${s.intro ? `<p class="dim" style="margin:0 0 12px">${s.intro}</p>` : ''}<div class="stack">${groupFields(s.fields)}</div></div>`}</div>`).join('');
  markBrain();
};
$('brain-nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  BR.section = b.dataset.sec;
  document.querySelectorAll('#brain-nav button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.form-section').forEach((x) => x.classList.toggle('on', x.dataset.sec === BR.section));
});
$('brain-form').addEventListener('input', (e) => {
  const el = e.target, p = el.dataset.path;
  if (!p) return;
  const t = el.dataset.type;
  const v = t === 'bool' ? el.checked : t === 'num' ? Number(el.value) : t === 'percent' ? Number(el.value) / 100 : t === 'lines' ? el.value.split('\n').map((s) => s.trim()).filter(Boolean) : el.value;
  setPath(BR.work, p, v);
  if (el.dataset.pair) document.querySelectorAll(`[data-pair="${el.dataset.pair}"]`).forEach((x) => { if (x !== el) x.value = el.value; });
  if (t === 'percent') document.querySelector(`[data-show="${el.id}"]`).textContent = el.value + '%';
  markBrain();
});
$('brain-form').addEventListener('change', (e) => { if (e.target.dataset.path?.startsWith('calmWeights')) { const y = document.querySelector('.pages').scrollTop; renderBrain(); document.querySelector('.pages').scrollTop = y; } });
const loadBrain = async () => {
  try {
    const b = await call('GET', '/api/brain');
    BR.saved = b; BR.work = structuredClone(b);
    renderBrain();
  } catch (e) { $('brain-form').innerHTML = `<div class="panel"><p class="bad">${esc(e.message)}</p></div>`; }
};
$('brain-save').addEventListener('click', async () => {
  try {
    const b = await call('PUT', '/api/brain', BR.work);
    BR.saved = b; BR.work = structuredClone(b);
    renderBrain();
    toast('Saved. The stream picks it up within a few seconds.');
  } catch (e) { toast(e.message, 'bad'); }
});
$('brain-discard').addEventListener('click', () => { BR.work = structuredClone(BR.saved); renderBrain(); });
$('brain-reset').addEventListener('click', async () => {
  if (!(await confirmBox('Reset WeBot’s brain?', 'Every line, timing, chat rule and radio setting goes back to how it was built. This saves to the stream right away.', 'Reset everything', 'danger'))) return;
  try { const b = await call('PUT', '/api/brain', {}); BR.saved = b; BR.work = structuredClone(b); renderBrain(); toast('Back to defaults'); } catch (e) { toast(e.message, 'bad'); }
});
pages.brain = { enter: () => { if (!BR.saved || !brainDirty()) loadBrain(); } };
window.addEventListener('beforeunload', (e) => { if ((BR.saved && brainDirty()) || ED.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- server ---------------- */
const PRESETS = [
  { name: '720p · balanced', sub: '1280×720 · 30 fps · 6000k · faster', set: { STREAM_WIDTH: '1280', STREAM_HEIGHT: '720', STREAM_FPS: '30', STREAM_BITRATE: '6000k', STREAM_PRESET: 'faster' } },
  { name: '720p · light', sub: '1280×720 · 30 fps · 4500k · veryfast. Use if CPU is maxed or sound sputters', set: { STREAM_WIDTH: '1280', STREAM_HEIGHT: '720', STREAM_FPS: '30', STREAM_BITRATE: '4500k', STREAM_PRESET: 'veryfast' } },
  { name: '900p', sub: '1600×900 · 30 fps · 7000k · veryfast. Tight on 4 cores', set: { STREAM_WIDTH: '1600', STREAM_HEIGHT: '900', STREAM_FPS: '30', STREAM_BITRATE: '7000k', STREAM_PRESET: 'veryfast' } },
  { name: '1080p', sub: '1920×1080 · 30 fps · 8000k · faster · 6 CPUs', risky: true, set: { STREAM_WIDTH: '1920', STREAM_HEIGHT: '1080', STREAM_FPS: '30', STREAM_BITRATE: '8000k', STREAM_PRESET: 'faster', STREAM_CPUS: '6' } }
];
const ENV_HELP = {
  STREAM_WIDTH: 'Picture width', STREAM_HEIGHT: 'Picture height', STREAM_FPS: 'Frames per second', STREAM_BITRATE: 'Video bitrate sent to YouTube', STREAM_PRESET: 'Encoder speed (veryfast = less CPU, faster = sharper)',
  STREAM_CPUS: 'CPU cores the stream may use (keep under the plan’s total)', YOUTUBE_STREAM_KEY: 'Your YouTube stream key', YOUTUBE_API_KEY: 'Google key for reading chat', YOUTUBE_CHANNEL_ID: 'Your channel (for chat)',
  CONTROLLER_TOKEN: 'Password for Live Control', EIA_API_KEY: 'Gas prices key (eia.gov, free)', LIVE_CONTROL_BIND: 'Who can reach Live Control’s port (keep 0.0.0.0 with the firewall)'
};
const EV = { rows: [], set: {}, remove: [] };
const envDirty = () => Object.keys(EV.set).length + EV.remove.length;
const markEnv = () => {
  const n = envDirty();
  $('env-save').disabled = !n;
  $('env-dirty').textContent = n ? n + ' UNSAVED CHANGE' + (n === 1 ? '' : 'S') : '';
};
const curEnv = (k) => (k in EV.set ? EV.set[k] : EV.rows.find((r) => r.key === k)?.value);
const renderEnv = () => {
  $('env-table').innerHTML = EV.rows.filter((r) => !EV.remove.includes(r.key)).map((r) => {
    const changed = r.key in EV.set;
    const val = changed ? EV.set[r.key] : r.value;
    return `<tr class="${changed ? 'changed' : ''}"><td title="${esc(ENV_HELP[r.key] || '')}">${esc(r.key)}${ENV_HELP[r.key] ? `<div class="faint" style="font:400 11px 'WP Sans';margin-top:3px;white-space:normal">${esc(ENV_HELP[r.key])}</div>` : ''}</td>
      <td><input type="${r.secret && !r.revealed && !changed ? 'password' : 'text'}" data-env="${esc(r.key)}" value="${esc(val)}" placeholder="${r.secret && r.set ? '•••••••• (hidden)' : ''}" style="font-family:'WP Mono'"></td>
      <td style="width:150px;white-space:nowrap">${r.secret && r.set && !r.revealed ? `<button class="btn sm" data-reveal="${esc(r.key)}">Show</button> ` : ''}<button class="btn sm danger" data-remove="${esc(r.key)}">Remove</button></td></tr>`;
  }).join('');
  $('presets').innerHTML = PRESETS.map((p, i) => {
    const cur = Object.entries(p.set).filter(([k]) => k !== 'STREAM_CPUS').every(([k, v]) => String(curEnv(k) || '') === v);
    return `<button class="preset ${cur ? 'cur' : ''} ${p.risky ? 'risky' : ''}" data-preset="${i}"><b>${esc(p.name)}</b><span>${esc(p.sub)}</span></button>`;
  }).join('');
  markEnv();
};
$('env-table').addEventListener('input', (e) => {
  const k = e.target.dataset.env; if (!k) return;
  const row = EV.rows.find((r) => r.key === k);
  if (row && !row.secret && e.target.value === row.value) delete EV.set[k]; else EV.set[k] = e.target.value;
  e.target.closest('tr').classList.toggle('changed', k in EV.set);
  markEnv();
});
$('env-table').addEventListener('click', async (e) => {
  const rv = e.target.dataset.reveal, rm = e.target.dataset.remove;
  if (rv) {
    try { const { value } = await call('GET', '/api/env/reveal?key=' + encodeURIComponent(rv)); const row = EV.rows.find((r) => r.key === rv); row.value = value; row.revealed = true; renderEnv(); } catch (err) { toast(err.message, 'bad'); }
  }
  if (rm && await confirmBox('Remove ' + rm + '?', 'The setting is deleted from the server when you press Save settings.', 'Remove', 'danger')) { EV.remove.push(rm); delete EV.set[rm]; renderEnv(); }
});
$('presets').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const p = PRESETS[b.dataset.preset];
  if (p.risky && !(await confirmBox('1080p needs the bigger server', 'On the 4-core plan the stream maxes out the CPU at 1080p: the sound sputters and the map stutters. Only use this after resizing the server to CPU-optimized 3 (8 cores).', 'I have 8 cores, use 1080p'))) return;
  Object.assign(EV.set, p.set);
  if (!p.set.STREAM_CPUS && Number(curEnv('STREAM_CPUS') || 3) > 3) EV.set.STREAM_CPUS = '3';
  renderEnv();
  toast('Preset staged. Press Save settings, then Restart.');
});
$('env-add').addEventListener('click', () => {
  const k = $('env-new-k').value.trim().toUpperCase(), v = $('env-new-v').value;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) return toast('Setting names use letters, numbers and _', 'warn');
  if (!EV.rows.find((r) => r.key === k)) EV.rows.push({ key: k, value: '', secret: /(KEY|TOKEN|SECRET|PASSWORD|PASS|WEBHOOK)/.test(k), set: false, revealed: true });
  EV.set[k] = v; EV.remove = EV.remove.filter((x) => x !== k);
  $('env-new-k').value = ''; $('env-new-v').value = '';
  renderEnv();
});
$('env-save').addEventListener('click', async () => {
  try {
    await call('PUT', '/api/env', { set: EV.set, remove: EV.remove });
    toast('Settings saved on the server');
    $('env-banner').classList.add('on');
    await loadEnv();
  } catch (e) { toast(e.message, 'bad'); }
});
const restart = async () => {
  if (!(await confirmBox('Restart the stream?', 'The stream goes off air for about a minute while it restarts with the saved settings.', 'Restart'))) return;
  toast('Restarting… (about a minute)', 'warn');
  try { const r = await call('POST', '/api/server/restart'); toast(r.ok ? 'Restarted' : 'Restart had a problem: ' + r.out, r.ok ? '' : 'bad'); $('env-banner').classList.remove('on'); setTimeout(loadOverview, 3000); } catch (e) { toast(e.message, 'bad'); }
};
$('env-restart').addEventListener('click', restart);
$('env-restart2').addEventListener('click', restart);
$('srv-rebuild').addEventListener('click', async () => {
  if (!(await confirmBox('Rebuild the stream?', 'Rebuilds with the code already on the server and restarts (1–2 minutes off air). To send new code, use Code → Deploy instead.', 'Rebuild'))) return;
  toast('Rebuilding… (1–2 minutes)', 'warn');
  try { const r = await call('POST', '/api/server/rebuild'); toast(r.ok ? 'Rebuilt and running' : 'Rebuild problem: ' + r.out, r.ok ? '' : 'bad'); } catch (e) { toast(e.message, 'bad'); }
});
const loadEnv = async () => {
  try { EV.rows = await call('GET', '/api/env'); EV.set = {}; EV.remove = []; renderEnv(); } catch (e) { $('env-table').innerHTML = `<tr><td class="bad">${esc(e.message)}</td></tr>`; }
};
// firewall
const FW = { ips: [], myIp: '' };
const renderFw = () => {
  $('fw-list').innerHTML = FW.ips.map((ip) => `<div class="row" style="justify-content:space-between"><span class="mono">${esc(ip)}${ip === FW.myIp ? ' <span class="chip c">THIS PC</span>' : ''}</span><button class="btn sm danger" data-fwdel="${esc(ip)}" ${FW.ips.length < 2 ? 'disabled' : ''}>Remove</button></div>`).join('');
  $('fw-myip').textContent = FW.myIp ? 'THIS PC: ' + FW.myIp : '';
  $('fw-mine').disabled = !FW.myIp || FW.ips.includes(FW.myIp);
};
const saveFw = async (ips) => { try { const r = await call('PUT', '/api/firewall', { ips }); FW.ips = r.ips; renderFw(); toast('Live Control access updated'); } catch (e) { toast(e.message, 'bad'); } };
$('fw-list').addEventListener('click', async (e) => {
  const ip = e.target.dataset.fwdel; if (!ip) return;
  const self = ip === FW.myIp;
  if (await confirmBox('Remove ' + ip + '?', self ? 'This is THIS PC’s address. Studio’s show buttons and Brain use Live Control, so they will stop working from here.' : 'That address won’t be able to open Live Control anymore.', 'Remove', 'danger')) saveFw(FW.ips.filter((x) => x !== ip));
});
$('fw-add-btn').addEventListener('click', () => { const ip = $('fw-add').value.trim(); if (ip) saveFw([...FW.ips, ip]).then(() => { $('fw-add').value = ''; }); });
$('fw-mine').addEventListener('click', () => saveFw([...FW.ips, FW.myIp]));
const loadFw = async () => { try { Object.assign(FW, await call('GET', '/api/firewall')); renderFw(); } catch (e) { $('fw-list').innerHTML = `<span class="bad">${esc(e.message)}</span>`; } };
pages.server = { enter: () => { if (!envDirty()) loadEnv(); loadFw(); } };

/* ---------------- code ---------------- */
const ED = { cm: null, path: '', saved: '', dirty: false, files: [] };
const modeFor = (p) => (/\.json$/.test(p) ? { name: 'javascript', json: true } : /\.(m|c)?js$/.test(p) ? 'javascript' : /\.html$/.test(p) ? 'htmlmixed' : /\.css$/.test(p) ? 'css'
  : /\.(sh|service)$|Dockerfile|\.dockerignore|\.gitignore/.test(p) ? 'shell' : /\.ya?ml$/.test(p) ? 'yaml' : /\.md$/.test(p) ? 'markdown' : null);
const initEditor = () => {
  if (ED.cm || !window.CodeMirror) return;
  ED.cm = CodeMirror($('ed-host'), { value: '', lineNumbers: true, matchBrackets: true, styleActiveLine: true, indentUnit: 2, tabSize: 2, readOnly: 'nocursor',
    extraKeys: { 'Ctrl-S': () => saveFile(), 'Cmd-S': () => saveFile() } });
  ED.cm.on('change', () => {
    ED.dirty = ED.path && ED.cm.getValue() !== ED.saved;
    $('ed-dirty').hidden = !ED.dirty;
    $('ed-save').disabled = !ED.dirty;
  });
};
const renderTree = () => {
  const f = $('file-filter').value.toLowerCase(), onlyChanged = $('file-changed').checked;
  const list = ED.files.filter((x) => (!f || x.path.toLowerCase().includes(f)) && (!onlyChanged || x.status));
  let lastDir = null, html = '';
  for (const x of list) {
    const dir = x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : '(project)';
    if (dir !== lastDir) { html += `<div class="dir">${esc(dir)}</div>`; lastDir = dir; }
    html += `<button data-file="${esc(x.path)}" class="${x.path === ED.path ? 'on' : ''}" title="${esc(x.path)}">${esc(x.path.split('/').pop())}${x.status ? `<em>${esc(x.status)}</em>` : ''}</button>`;
  }
  $('tree').innerHTML = html || '<div class="dir">No files</div>';
  const n = ED.files.filter((x) => x.status).length;
  $('code-badge').hidden = !n; $('code-badge').textContent = n;
};
const loadFiles = async () => {
  try { const r = await call('GET', '/api/files'); ED.files = r.files; $('f-head').textContent = r.head; renderTree(); } catch (e) { $('tree').innerHTML = `<div class="dir bad">${esc(e.message)}</div>`; }
};
const openFile = async (p) => {
  if (ED.dirty && !confirm('Discard unsaved changes to ' + ED.path + '?')) return;
  try {
    const r = await call('GET', '/api/file?path=' + encodeURIComponent(p));
    ED.crlf = /\r\n/.test(r.content);
    ED.path = r.path; ED.saved = r.content.replace(/\r\n/g, '\n');
    ED.cm.setOption('mode', modeFor(p));
    ED.cm.setOption('readOnly', false);
    ED.cm.setValue(ED.saved);
    ED.cm.clearHistory();
    ED.dirty = false; $('ed-dirty').hidden = true; $('ed-save').disabled = true;
    $('ed-path').textContent = p;
    $('ed-revert').disabled = !ED.files.find((x) => x.path === p)?.status;
    $('ed-note').className = 'note';
    $('ed-note').textContent = /^public\//.test(p) ? 'Stream page file: deploys with a quick page reload, no restart.' : /^(src|deploy|scripts)\//.test(p) ? 'Server file: deploying restarts the stream (about 1–2 minutes).' : '';
    renderTree();
    setTimeout(() => ED.cm.refresh(), 0);
  } catch (e) { toast(e.message, 'bad'); }
};
const saveFile = async () => {
  if (!ED.path || !ED.dirty) return;
  const content = ED.cm.getValue();
  try {
    const r = await call('PUT', '/api/file', { path: ED.path, content: ED.crlf ? content.replace(/\n/g, '\r\n') : content });
    ED.saved = content; ED.dirty = false; $('ed-dirty').hidden = true; $('ed-save').disabled = true;
    $('ed-note').className = 'note' + (r.problem ? ' bad' : '');
    $('ed-note').textContent = r.problem ? 'Saved, but it has a mistake (it will NOT deploy until fixed):\n' + r.problem : 'Saved · a backup of the old version is in studio\\.backups';
    toast(r.problem ? 'Saved with a problem: see below the editor' : 'Saved ' + ED.path, r.problem ? 'warn' : '');
    loadFiles().then(() => { $('ed-revert').disabled = !ED.files.find((x) => x.path === ED.path)?.status; });
  } catch (e) { toast(e.message, 'bad'); }
};
$('tree').addEventListener('click', (e) => { const b = e.target.closest('[data-file]'); if (b) openFile(b.dataset.file); });
$('file-filter').addEventListener('input', renderTree);
$('file-changed').addEventListener('change', renderTree);
$('ed-save').addEventListener('click', saveFile);
$('ed-revert').addEventListener('click', async () => {
  if (!(await confirmBox('Undo your changes to ' + ED.path + '?', 'The file goes back to its last saved version. (A backup of your current edit stays in studio\\.backups.)', 'Undo changes', 'danger'))) return;
  try {
    if (ED.dirty) await call('PUT', '/api/file', { path: ED.path, content: ED.crlf ? ED.cm.getValue().replace(/\n/g, '\r\n') : ED.cm.getValue() });
    await call('POST', '/api/file/revert', { path: ED.path }); ED.dirty = false; const p = ED.path; ED.path = ''; await loadFiles(); openFile(p); toast('Changes undone');
  } catch (e) { toast(e.message, 'bad'); }
});
$('git-commit').addEventListener('click', async () => {
  const changed = ED.files.filter((x) => x.status);
  if (!changed.length) return toast('Nothing new to save as a version');
  const go = await modal('Save a version', `<p class="dim">Saves these ${changed.length} changed file(s) as a version you can go back to:</p><pre>${esc(changed.map((x) => x.status.padEnd(3) + x.path).join('\n'))}</pre><div class="field" style="margin-top:12px"><label>What did you change?</label><input type="text" id="commit-msg" placeholder="e.g. New forecast lines"></div>`, [{ label: 'Cancel', value: false }, { label: 'Save version', kind: 'primary', value: true }]);
  if (!go) return;
  try { const r = await call('POST', '/api/git/commit', { message: document.getElementById('commit-msg').value }); toast(r.ok ? 'Version saved' : r.out, r.ok ? '' : 'warn'); loadFiles(); } catch (e) { toast(e.message, 'bad'); }
});
$('git-history').addEventListener('click', async () => {
  try {
    const log = await call('GET', '/api/git/log');
    modal('Saved versions', `<pre>${esc(log.map((c) => `${c.hash}  ${c.date}  ${c.message}`).join('\n'))}</pre><p class="dim" style="margin-top:10px">To go back to an older version of a file, ask for help or use git (<code>git checkout &lt;hash&gt; -- path</code>), then Deploy.</p>`);
  } catch (e) { toast(e.message, 'bad'); }
});
$('deploy-btn').addEventListener('click', async () => {
  if (ED.dirty && !(await confirmBox('Unsaved changes', ED.path + ' has unsaved edits that won’t be deployed. Deploy anyway?', 'Deploy without them'))) return;
  let plan;
  try { plan = await call('GET', '/api/deploy/plan'); } catch (e) { return toast(e.message, 'bad'); }
  if (!plan.files.length) return modal('Nothing to deploy', `<p class="dim">The server already has everything${plan.knownBaseline ? '' : ' Studio knows about'}. ${plan.knownBaseline ? '' : 'Studio has not recorded a deploy yet: if you changed files and saved versions before, use Checks → Mark server up to date only if the server really has them.'}</p>`);
  const how = plan.mode === 'hot' ? '<span class="chip g">Quick</span> Only stream-page files: they go live with a page reload. No restart.' : '<span class="chip a">Restart</span> Server files changed: the stream rebuilds and restarts (about 1–2 minutes off air).';
  const go = await modal('Deploy to the server', `<p>${how}</p><pre>${esc(plan.files.join('\n'))}</pre>${plan.dirty ? '<p class="warn" style="margin-top:10px">Some changes aren’t saved as a version yet. They’ll deploy, but press Save version afterwards so Studio can track what’s on the server.</p>' : ''}`, [{ label: 'Cancel', value: false }, { label: 'Deploy now', kind: 'primary', value: true }]);
  if (!go) return;
  $('m-title').textContent = 'Deploying…';
  $('m-body').innerHTML = '<pre id="deploy-log"></pre>';
  $('m-actions').innerHTML = '';
  $('modal').classList.add('on');
  const out = document.getElementById('deploy-log');
  try {
    const r = await fetch('/api/deploy', { method: 'POST' });
    const reader = r.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; out.textContent += dec.decode(value); out.scrollTop = out.scrollHeight; }
  } catch (e) { out.textContent += '\nERROR: ' + e.message; }
  const ok = /DONE\s*$/.test(out.textContent);
  $('m-title').textContent = ok ? 'Deployed' : 'Deploy stopped';
  const close = document.createElement('button'); close.className = 'btn'; close.textContent = 'Close'; close.onclick = () => $('modal').classList.remove('on');
  $('m-actions').appendChild(close);
  loadFiles(); loadOverview();
});
pages.code = { enter: () => { initEditor(); loadFiles(); setTimeout(() => ED.cm?.refresh(), 0); } };

/* ---------------- logs ---------------- */
const LG = { lines: [], filter: 'all' };
const LOG_FILTERS = { stream: /streaming|ffmpeg|chrome|server is up|stopped|restarting|x11grab/i, chat: /\[chat\]/, err: /(error|failed|fail|stopped|exception|denied|refused|timed out|crash|out of memory)/i };
const renderLogs = () => {
  const q = $('log-search').value.toLowerCase();
  const box = $('logbox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = LG.lines.filter((l) => (LG.filter === 'all' || LOG_FILTERS[LG.filter].test(l)) && (!q || l.toLowerCase().includes(q))).map((l) => {
    const m = l.match(/^(\d{4}-\d\d-\d\dT[\d:]+)\.\d+Z\s?(.*)$/);
    const t = m ? new Date(m[1] + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const text = m ? m[2] : l;
    const cls = LOG_FILTERS.err.test(text) ? 'err' : /\[chat\]/.test(text) ? 'chat' : /streaming \d/.test(text) ? 'str' : '';
    return `<div class="${cls}">${t ? `<time>${t}</time>` : ''}${esc(text)}</div>`;
  }).join('') || '<div class="faint">No lines.</div>';
  if (atBottom) box.scrollTop = box.scrollHeight;
};
const loadLogs = async () => { try { LG.lines = (await call('GET', '/api/logs?n=' + $('log-n').value)).lines; renderLogs(); } catch (e) { $('logbox').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
segClick('log-filter', (v) => { LG.filter = v; document.querySelectorAll('#log-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); renderLogs(); });
$('log-search').addEventListener('input', renderLogs);
$('log-n').addEventListener('change', loadLogs);
$('log-refresh').addEventListener('click', loadLogs);
setInterval(() => { if (S.page === 'logs' && $('log-auto').checked && !document.hidden) loadLogs(); }, 10000);
pages.logs = { enter: () => { loadLogs(); setTimeout(() => { $('logbox').scrollTop = $('logbox').scrollHeight; }, 300); } };

/* ---------------- checks ---------------- */
$('chk-conn').addEventListener('click', async () => {
  $('chk-conn-out').innerHTML = '<dt>…</dt><dd>checking</dd>';
  try {
    const o = await call('GET', '/api/overview');
    const line = (name, part) => `<dt>${name}</dt><dd class="${part?.error ? 'bad' : 'ok'}">${part?.error ? esc(part.error) : 'OK'}</dd>`;
    $('chk-conn-out').innerHTML = line('SSH to server', o.server) + line('Live Control', o.control) + line('Status page', o.status);
  } catch (e) { $('chk-conn-out').innerHTML = `<dt>Studio</dt><dd class="bad">${esc(e.message)}</dd>`; }
});
$('chk-audio').addEventListener('click', async () => {
  $('chk-audio-out').innerHTML = '<dt>…</dt><dd>recording 15 seconds</dd>';
  try {
    const r = await call('POST', '/api/check/audio');
    const loud = r.loudness == null ? 'n/a' : r.loudness.toFixed(1) + ' LUFS';
    $('chk-audio-out').innerHTML = `<dt>Dropouts</dt><dd class="${r.gaps ? 'bad' : 'ok'}">${r.gaps ? r.gaps + ' found: sound is sputtering' : 'none: sound is clean'}</dd><dt>Loudness</dt><dd>${loud}${r.loudness != null && r.loudness < -45 ? ' <span class="warn">(very quiet: is the music off?)</span>' : ''}</dd>`;
  } catch (e) { $('chk-audio-out').innerHTML = `<dt>Error</dt><dd class="bad">${esc(e.message)}</dd>`; }
});
$('chk-mark').addEventListener('click', async () => {
  if (!(await confirmBox('Mark the server up to date?', 'Only do this if the server really has all of the code in your last saved version. The next deploy will only send changes made after this.', 'Mark as deployed'))) return;
  try { const r = await call('POST', '/api/deploy/mark'); $('chk-mark-out').textContent = 'SERVER MARKED AT ' + r.deployed.slice(0, 7); loadOverview(); } catch (e) { toast(e.message, 'bad'); }
});

/* ---------------- start ---------------- */
(async () => {
  try {
    S.cfg = await call('GET', '/api/config');
    $('f-host').textContent = S.cfg.host;
    $('l-status').href = S.cfg.statusBase + '/';
    $('l-control').href = S.cfg.controlBase + '/warningcenter/live/control';
    $('l-stream').href = S.cfg.controlBase + '/warningcenter/live?music=0&voice=0';
  } catch (e) { toast('Studio server not answering: ' + e.message, 'bad'); }
  show((location.hash || '#overview').slice(1));
  if (S.page !== 'overview') loadOverview();
  loadFiles();
})();
