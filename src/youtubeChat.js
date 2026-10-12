// YouTube live chat commands for WeatherPower Live: viewers type "!forecast Dallas TX" or "!gas 74745" and
// WeBot does that place next. Reads chat with the YouTube Data API (YOUTUBE_API_KEY) on the channel's
// current live video (YOUTUBE_CHANNEL_ID, or YOUTUBE_VIDEO_ID to force one). Read-only: it never posts.
//
// Quota: the API allows 10,000 units a day and each chat read costs 5, so chat is read about once a
// minute (every 30 s for a few minutes after someone uses a command), with a daily budget guard.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATE_NAMES } from './broadcast.js';
import { applyLiveCommand, liveControl } from './live.js';
import { loadBrain } from './brain.js';
import { replyTo, expandSlang } from './personality.js';
import { aiReplyTo } from './aiBrain.js';
import { dataDir } from './paths.js';

const API = 'https://www.googleapis.com/youtube/v3';
const KEY = () => process.env.YOUTUBE_API_KEY || '';
const DAILY_BUDGET = Number(process.env.YOUTUBE_DAILY_UNITS || 9000);
// Quiet chat is read every 90 s (5 units a read), busy chat every 30 s: a 24/7 stream stays inside the
// 10,000-unit daily YouTube quota.
const BASE_MS = 90 * 1000;
const ACTIVE_MS = 30 * 1000;


/* ---------------- places (U.S. Census Gazetteer, bundled) ---------------- */
let gaz = null;
const loadGaz = () => {
  if (!gaz) gaz = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./places/us-places.json', import.meta.url)), 'utf8'));
  return gaz;
};
const NAME_TO_STATE = Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
const norm = (s) => String(s || '').toLowerCase().replace(/\bsaint\b/g, 'st').replace(/\bst\./g, 'st').replace(/\bfort\b/g, 'ft').replace(/\bft\./g, 'ft')
  .replace(/\bmount\b/g, 'mt').replace(/\bmt\./g, 'mt').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
let byName = null;
const NICKNAMES = { okc: 'oklahoma city ok', nyc: 'new york ny', la: 'los angeles ca', kc: 'kansas city mo', slc: 'salt lake city ut', dc: 'washington dc',
  nola: 'new orleans la', philly: 'philadelphia pa', vegas: 'las vegas nv', 'san fran': 'san francisco ca', sf: 'san francisco ca', atl: 'atlanta ga',
  chi: 'chicago il', boise: 'boise city id', dfw: 'dallas tx', htown: 'houston tx', stl: 'st louis mo', 'the bronx': 'new york ny', brooklyn: 'new york ny', manhattan: 'new york ny' };

// "Dallas TX", "dallas, texas", "St. Louis", "74745" -> { name, state, lat, lon } or null.
export const findPlace = (text) => {
  const { places, zips } = loadGaz();
  const raw = String(text || '').trim().slice(0, 60);
  const zip = raw.match(/^\d{5}$/)?.[0];
  if (zip) {
    const z = zips[zip];
    if (!z) return null;
    // Name a ZIP after the town it's in: nearest center, with big cities reaching farther.
    let best = null, bd = Infinity;
    for (const p of places) {
      const miles = 69 * Math.sqrt((p[2] - z[0]) ** 2 + ((p[3] - z[1]) * Math.cos((z[0] * Math.PI) / 180)) ** 2);
      const d = miles - 0.6 * Math.sqrt(p[4] || 0);
      if (d < bd) { bd = d; best = p; }
    }
    return { name: best ? best[0] : zip, state: best ? best[1] : '', lat: z[0], lon: z[1], zip };
  }
  if (!byName) {
    byName = new Map();
    places.forEach((p) => { const k = norm(p[0]); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); });
  }
  let words = norm(raw);
  if (NICKNAMES[words]) words = NICKNAMES[words];
  let state = '';
  const parts = words.split(' ');
  // Trailing state: full name (one or two words) or the two-letter code.
  for (const n of [2, 1]) {
    const tail = parts.slice(-n).join(' ');
    if (parts.length > n && NAME_TO_STATE[tail]) { state = NAME_TO_STATE[tail]; words = parts.slice(0, -n).join(' '); break; }
  }
  if (!state && parts.length > 1 && STATE_NAMES[parts[parts.length - 1].toUpperCase()]) {
    state = parts[parts.length - 1].toUpperCase();
    words = parts.slice(0, -1).join(' ');
  }
  const list = (byName.get(words) || []).filter((p) => !state || p[1] === state);
  if (!list.length) return null;
  // Same name in several places: incorporated first, then the biggest.
  const p = [...list].sort((a, b) => b[5] - a[5] || b[4] - a[4])[0];
  return { name: p[0], state: p[1], lat: p[2], lon: p[3] };
};

/* ---------------- who can show up on the stream ---------------- */
// Slurs and profanity are caught even inside other letters ("f.u.c.k", "xXshitXx"); other risky words only
// as whole words, so weather talk like "cumulus" or "analysis" still gets read.
const HARD = /(nigg|faggot|retard|fuck|fuk|fck|shit|bitch|cunt|whore|slut|porn|pussy|kike|chink|tranny|onlyfans|kkk|hitler)/i;
const WORDS = /\b(fag|fags|rape|raped|rapist|nazi|nazis|sex|sexy|dick|cock|penis|vagina|boob|boobs|tits|anal|cum|jizz|kys|suicide|die|dead|murder|shoot|gun|guns|bomb|terror|isis|jew|jews|muslim|spic|wetback|dyke|homo|gay|lesbian|crypto|bitcoin|giveaway|telegram|whatsapp|discord|sub4sub)\b|\bkill (yo)?u|\bkill your|hang yourself|check out my|my channel|subscribe to/i;
export const blockedText = (t) => HARD.test(t) || HARD.test(String(t).replace(/[^a-z]/gi, '')) || WORDS.test(t);
export const safeName = (name) => {
  const n = String(name || '').replace(/^@/, '').trim();
  return n.length >= 2 && n.length <= 24 && /^[\p{L}\p{N} ._'-]+$/u.test(n) && !blockedText(n) ? n : '';
};

// A chat message WeBot may read out loud, or '' when it shouldn't be (bad words, links, phone numbers,
// emoji-only, spam, too long). YouTube's own chat filter runs first; this is a second, stricter one.
export const readableChat = (raw, extraBlocked = []) => {
  let t = String(raw || '')
    .replace(/:[a-z0-9_-]+:/gi, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, ' ')
    .replace(/(.)\1{3,}/g, '$1$1$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3 || t.length > 160 || t.split(' ').length > 30) return '';
  if (/(https?:|www\.|\.(com|net|org|gg|io|ly|tv|xyz|me|co|us|info|live)\b|@[\w.-]+\.\w+)/i.test(t)) return '';
  if (/\d{3}[\s.()-]*\d{3}[\s.-]*\d{4}/.test(t) || /\d{6,}/.test(t)) return '';
  if (blockedText(t)) return '';
  const lower = t.toLowerCase();
  if (extraBlocked.some((w) => w && lower.includes(String(w).toLowerCase()))) return '';
  if (!/[a-z]{2,}/i.test(t)) return '';
  if (t.split(' ').length < 2 && t.length < 8) return '';
  // Shouting is fine to read, but not as a wall of capitals.
  if (t.length > 20 && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t;
};
// Timing and limits come from WeBot's brain (WeBot Studio → Brain → Chat).

/* ---------------- chat reader ---------------- */
const state = {
  enabled: false, videoId: '', chatId: '', pageToken: '', primed: false, viewers: null, viewersAt: 0,
  subscribers: null, subscribersAt: 0,
  lastFind: 0, activeUntil: 0, lastCommandAt: null, units: 0, unitsDay: '', timer: null, users: new Map(), recent: [],
  lastReadAt: 0, readUsers: new Map(), commandSeq: 0, commandLog: []
};
const ptDay = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
const spend = (units) => {
  if (state.unitsDay !== ptDay()) { state.unitsDay = ptDay(); state.units = 0; }
  state.units += units;
};
const overBudget = () => state.unitsDay === ptDay() && state.units >= DAILY_BUDGET;

const api = async (path, params, units) => {
  spend(units);
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: KEY() })}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error?.errors?.[0]?.reason || body?.error?.message || 'YouTube ' + r.status), { status: r.status });
  return body;
};

// Channel subscriber count for WeBot Studio. Keep this separate from live-video lookup so
// a temporary channel-stat failure can never knock chat / !forecast offline.
const refreshChannelStats = async (channel) => {
  if (!/^UC[\w-]{22}$/.test(channel || '')) return;
  if (Date.now() - state.subscribersAt < 10 * 60 * 1000) return;
  try {
    const body = await api('channels', { part: 'statistics', id: channel }, 1);
    const stats = body.items?.[0]?.statistics;
    state.subscribers = stats && !stats.hiddenSubscriberCount && stats.subscriberCount != null
      ? Number(stats.subscriberCount)
      : null;
    state.subscribersAt = Date.now();
  } catch (error) {
    console.warn('[chat] subscriber count:', error.message);
    // Retry sooner after a failure without affecting the rest of YouTube chat.
    state.subscribersAt = Date.now() - 8 * 60 * 1000;
  }
};

// The channel's live video: the one already found, the public /live page (no quota; YouTube sometimes
// leaves the link out for servers), or the channel's uploads list (2 units). Each candidate
// must be live and on this channel. Then its chat id and viewer count.
const liveVideo = async (videoId, channel) => {
  if (!videoId) return null;
  const body = await api('videos', { part: 'snippet,liveStreamingDetails,statistics', id: videoId }, 1);
  const v = body.items?.[0];
  if (!v || v.snippet?.liveBroadcastContent !== 'live' || (channel && v.snippet?.channelId !== channel)) return null;
  return { videoId, live: v.liveStreamingDetails || {}, stats: v.statistics || {} };
};
const findLive = async () => {
  state.lastFind = Date.now();
  const channel = process.env.YOUTUBE_CHANNEL_ID || '';
  await refreshChannelStats(channel);
  let found = await liveVideo(process.env.YOUTUBE_VIDEO_ID || state.videoId, channel);
  if (!found && channel) {
    const html = await fetch(`https://www.youtube.com/channel/${encodeURIComponent(channel)}/live`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WeatherPower Live chat)', 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(15000)
    }).then((r) => r.text()).catch(() => '');
    found = await liveVideo(html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1], channel);
  }
  // The channel's newest uploads (live streams are listed there too): 1 unit, plus 1 to check them all.
  if (!found && /^UC[\w-]{22}$/.test(channel)) {
    const list = await api('playlistItems', { part: 'contentDetails', playlistId: 'UU' + channel.slice(2), maxResults: '5' }, 1);
    const ids = (list.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const body = await api('videos', { part: 'snippet,liveStreamingDetails,statistics', id: ids.join(',') }, 1);
      const v = (body.items || []).find((x) => x.snippet?.liveBroadcastContent === 'live' && x.snippet?.channelId === channel);
      if (v) found = { videoId: v.id, live: v.liveStreamingDetails || {}, stats: v.statistics || {} };
    }
  }
  if (!found) { state.videoId = ''; state.chatId = ''; return; }
  const { videoId, live, stats } = found;
  // Total views of this live broadcast (YouTube counts everyone who has watched it).
  state.totalViews = stats?.viewCount != null ? Number(stats.viewCount) : state.totalViews ?? null;
  state.viewers = live?.concurrentViewers != null ? Number(live.concurrentViewers) : null;
  state.viewersAt = Date.now();
  // When this YouTube broadcast went live (for the "live for" timers in Studio and Live Control).
  state.startedAt = live?.actualStartTime || null;
  const chatId = live?.activeLiveChatId || '';
  if (videoId !== state.videoId || chatId !== state.chatId) {
    state.videoId = videoId;
    state.chatId = chatId;
    state.pageToken = '';
    state.primed = false;
    if (chatId) console.log(`[chat] reading live chat on ${videoId}`);
  }
};

// How long the YouTube broadcast has been live, in words ("1 day and 5 hours").
const uptimeWords = () => {
  const ms = state.startedAt ? Date.now() - Date.parse(state.startedAt) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  const part = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  return d ? part(d, 'day') + (h ? ' and ' + part(h, 'hour') : '') : h ? part(h, 'hour') + (min ? ' and ' + part(min, 'minute') : '') : part(min, 'minute');
};

// Is this message meant for someone other than WeBot? Mentions of WeBot always count as his.
//  - an @mention of someone else, or another chatter's name (from this batch or the regulars list)
//  - talking to the streamer / mods ("josh", "weatherpower", "mod", "streamer", "owner")
//  - a bare "same" / "true" / "facts" / "agreed" reply, which is almost always to another viewer
const talkingToSomeoneElse = (raw, author, batch) => {
  const t = String(raw || '');
  if (/\bwe ?bot\b/i.test(t)) return false;
  if (/@(?!we ?bot\b)[\w.-]{2,}/i.test(t)) return true;
  if (/\b(josh|weatherpower|streamer|owner|mods?|admin)\b/i.test(t)) return true;
  if (/^\s*(same|same here|true|so true|facts|agreed|agree|exactly|fr|for real|ikr|yep|yeah|yea|nah|no way|real|this)\s*[!.]*\s*$/i.test(t)) return true;
  const me = String(author?.displayName || '').replace(/^@/, '').toLowerCase();
  const names = new Set();
  for (const m of batch || []) { const n = String(m.authorDetails?.displayName || '').replace(/^@/, ''); if (n) names.add(n); }
  for (const r of Object.values(loadRegulars())) if (r.name) names.add(r.name);
  const lower = t.toLowerCase();
  for (const n of names) {
    const ln = n.toLowerCase();
    if (ln === me || ln.length < 4) continue;
    // Whole name, or its first word / letters before digits ("dragon" for "dragonoftexas" also counts).
    const short = ln.split(/[\s_.\d-]+/)[0];
    if (lower.includes(ln) || (short.length >= 5 && new RegExp('\\b' + short.replace(/[^a-z]/g, '') + '\\b').test(lower))) return true;
  }
  return false;
};

// WeBot answers regular chat (anything, not just messages about him): up to maxRepliesPerRead messages
// from each chat read (oldest first), each viewer at most every sameViewerMinutes, and at most
// maxRepliesPerHour in all (his voice costs Puter usage). Live Control can turn this off.
const readOne = async (messages) => {
  const now = Date.now();
  const brain = await loadBrain();
  const { chat } = brain;
  if (!messages.length || !chat.readAloud || now - state.lastReadAt < chat.readEverySeconds * 1000) return;
  state.replies = (state.replies || []).filter((t) => now - t < 3600 * 1000);
  let sent = 0;
  for (const message of messages) {
    if (sent >= chat.maxRepliesPerRead || state.replies.length >= chat.maxRepliesPerHour) break;
    if (!['textMessageEvent', 'superChatEvent'].includes(message.snippet?.type)) continue;
    const author = message.authorDetails || {};
    const userKey = author.channelId || author.displayName;
    if (now - (state.readUsers.get(userKey) || 0) < chat.sameViewerMinutes * 60 * 1000) continue;
    const text = readableChat(message.snippet?.displayMessage, chat.blockedWords);
    if (!text) continue;
    // Viewers talking to each other (or to the streamer) aren't talking to WeBot: those still show in
    // the chat box, but he doesn't answer them as if they were.
    if (talkingToSomeoneElse(message.snippet?.displayMessage || '', author, messages)) continue;
    const control = await liveControl().catch(() => null);
    if (!control || control.chatRead === false) return;
    state.lastReadAt = now;
    state.replies.push(now);
    sent += 1;
    state.readUsers.set(userKey, now);
    if (state.readUsers.size > 500) state.readUsers.delete(state.readUsers.keys().next().value);
    const user = safeName(author.displayName);
    // WeBot's comeback: usually his AI brain (src/aiBrain.js, filtered like chat), otherwise his written
    // lines (src/personality.js). Personality off means the plain written replies only.
    const ctx = { uptime: uptimeWords() };
    const ai = brain.personality?.on === false ? null : await aiReplyTo(text, user, brain, ctx);
    await applyLiveCommand({ action: 'chat-say', user, text, speak: expandSlang(text), reply: ai || replyTo(text, user, brain, ctx) });
    console.log('[chat] answering a viewer message');
  }
};

/* ---------------- regulars: WeBot remembers who keeps coming back ---------------- */
// data/regulars.json: per viewer, how many visits (a visit = chatting again after 3+ hours away) and messages.
// A viewer who chatted on an earlier visit gets a "welcome back" by name on their first message of a new
// visit (personality → welcomeBack). It counts toward the hourly answer cap.
const REG_FILE = () => dataDir + '/regulars.json';
const VISIT_GAP = 3 * 3600 * 1000;
let regulars = null, regSaveTimer = null;
const loadRegulars = () => {
  if (regulars) return regulars;
  try { regulars = JSON.parse(fs.readFileSync(REG_FILE(), 'utf8')); } catch { regulars = {}; }
  return regulars;
};
const saveRegulars = () => {
  clearTimeout(regSaveTimer);
  regSaveTimer = setTimeout(() => { try { fs.writeFileSync(REG_FILE(), JSON.stringify(regulars)); } catch (e) { console.warn('[chat] regulars:', e.message); } }, 2000);
};
const welcomeRegulars = async (items) => {
  const reg = loadRegulars();
  const now = Date.now();
  const brain = await loadBrain();
  const { chat } = brain;
  for (const message of items) {
    if (!['textMessageEvent', 'superChatEvent'].includes(message.snippet?.type)) continue;
    const author = message.authorDetails || {};
    const key = author.channelId || author.displayName;
    if (!key || author.isChatOwner) continue;
    const r = reg[key] || (reg[key] = { name: '', first: now, last: 0, visits: 0, messages: 0 });
    const newVisit = now - (r.last || 0) > VISIT_GAP;
    const wasRegular = r.visits >= 1 && r.messages >= 3;
    r.name = safeName(author.displayName) || r.name;
    if (newVisit) r.visits += 1;
    r.messages += 1;
    r.last = now;
    if (!newVisit || !wasRegular || !r.name) continue;
    const text = readableChat(message.snippet?.displayMessage, chat.blockedWords);
    const lines = brain.personality?.replies?.welcomeBack || [];
    state.replies = (state.replies || []).filter((t) => now - t < 3600 * 1000);
    if (!text || !lines.length || state.replies.length >= chat.maxRepliesPerHour) continue;
    const control = await liveControl().catch(() => null);
    if (!control || control.chatRead === false) continue;
    const line = lines[Math.floor(Math.random() * lines.length)].replace(/\{name\}/g, r.name);
    state.replies.push(now);
    state.readUsers.set(key, now);   // so the regular answer loop doesn't answer them again right away
    await applyLiveCommand({ action: 'chat-say', user: r.name, text, reply: line });
    console.log('[chat] welcomed back a regular');
  }
  // Forget viewers not seen for 60 days.
  for (const [k, v] of Object.entries(reg)) if (now - v.last > 60 * 86400000) delete reg[k];
  saveRegulars();
};

// Chat on the stream: the newest messages that pass the filter go up in WeBot's chat box (commands too).
const showChats = async (items) => {
  const { chat } = await loadBrain();
  if (!chat.showOnScreen) return;
  const list = [];
  for (const message of items) {
    if (!['textMessageEvent', 'superChatEvent'].includes(message.snippet?.type)) continue;
    const text = readableChat(message.snippet?.displayMessage, chat.blockedWords);
    if (text) list.push({ user: safeName(message.authorDetails?.displayName), text });
  }
  if (!list.length) return;
  const control = await liveControl().catch(() => null);
  if (!control || control.chatRead === false) return;
  await applyLiveCommand({ action: 'chat-show', messages: list.slice(-8) });
};

// "!roast me": WeBot roasts the viewer who asked (src/personality.js → roastMe). Each viewer once per
// commandCooldownMinutes (owner and mods any time), and it counts toward maxRepliesPerHour.
const roastRequest = async (message) => {
  const author = message.authorDetails || {};
  const userKey = author.channelId || author.displayName;
  const now = Date.now();
  const brain = await loadBrain();
  const { chat } = brain;
  state.activeUntil = now + 5 * 60 * 1000;
  state.roasted ||= new Map();
  if (!(author.isChatOwner || author.isChatModerator) && now - (state.roasted.get(userKey) || 0) < chat.commandCooldownMinutes * 60 * 1000) return;
  state.replies = (state.replies || []).filter((t) => now - t < 3600 * 1000);
  if (state.replies.length >= chat.maxRepliesPerHour) return;
  const control = await liveControl().catch(() => null);
  if (!control || control.chatRead === false) return;
  const list = brain.personality?.replies?.roastMe || [];
  if (!list.length) return;
  const user = safeName(author.displayName);
  const who = user || 'Sugar';
  const line = list[Math.floor(Math.random() * list.length)].replace(/\{name\}/g, who);
  state.roasted.set(userKey, now);
  state.replies.push(now);
  await applyLiveCommand({ action: 'chat-say', user, text: '!roast me', reply: line.charAt(0).toUpperCase() + line.slice(1) });
  console.log('[chat] roast request');
};

// Recent viewer commands for WeBot Studio. This is intentionally in-memory only: it is an
// operations monitor, not a permanent archive of viewers' chat.
const commandStart = (message, kind, query) => {
  const publishedAt = message.snippet?.publishedAt || new Date().toISOString();
  const entry = {
    id: String(Date.now()) + '-' + (++state.commandSeq),
    at: publishedAt,
    receivedAt: new Date().toISOString(),
    user: safeName(message.authorDetails?.displayName) || 'Viewer',
    kind,
    query: String(query || '').trim().slice(0, 60),
    status: 'received',
    reason: '',
    place: null,
    responseMs: null
  };
  state.commandLog.push(entry);
  if (state.commandLog.length > 40) state.commandLog.splice(0, state.commandLog.length - 40);
  return entry;
};
const commandFinish = (entry, status, reason = '', place = null) => {
  entry.status = status;
  entry.reason = reason;
  if (place) entry.place = { name: place.name, state: place.state, lat: place.lat, lon: place.lon };
  const then = Date.parse(entry.at || entry.receivedAt);
  entry.responseMs = Number.isFinite(then) ? Math.max(0, Date.now() - then) : null;
  entry.finishedAt = new Date().toISOString();
  return entry;
};

// Returns true when the message was a ! command (handled or not).
const handle = async (message) => {
  const text = String(message.snippet?.displayMessage || '').trim();
  if (/^!roast\b/i.test(text)) { await roastRequest(message); return true; }
  const m = text.match(/^!(forecast|fc|weather|wx|gas)\b\s*(.*)$/i);
  if (!m) return /^!/.test(text);
  const kind = /^gas$/i.test(m[1]) ? 'gas' : 'forecast';
  const query = m[2] || '';
  const entry = commandStart(message, kind, query);
  const author = message.authorDetails || {};
  const userKey = author.channelId || author.displayName;
  const now = Date.now();
  state.activeUntil = now + 5 * 60 * 1000;

  if (!query) {
    commandFinish(entry, 'rejected', 'Missing place');
    return true;
  }

  const place = findPlace(query);
  if (!place) {
    commandFinish(entry, 'rejected', 'Place not found');
    return true;
  }
  entry.place = { name: place.name, state: place.state, lat: place.lat, lon: place.lon };

  const { chat } = await loadBrain();
  if (!(author.isChatOwner || author.isChatModerator) && now - (state.users.get(userKey) || 0) < chat.commandCooldownMinutes * 60 * 1000) {
    commandFinish(entry, 'rejected', 'Viewer cooldown', place);
    return true;
  }

  state.recent = state.recent.filter((t) => now - t < 20 * 60 * 1000);
  if (state.recent.length >= chat.maxRequestsPer20Minutes) {
    commandFinish(entry, 'rejected', '20-minute request limit', place);
    return true;
  }

  state.users.set(userKey, now);
  state.recent.push(now);
  state.lastCommandAt = new Date().toISOString();
  try {
    await applyLiveCommand({ action: 'chat-request', kind, place, user: safeName(author.displayName) });
    commandFinish(entry, 'queued', 'Sent to the show', place);
    console.log(`[chat] ${kind} request: ${place.name}, ${place.state}`);
  } catch (error) {
    commandFinish(entry, 'failed', error.message || 'Could not queue request', place);
    throw error;
  }
  return true;
};

/* ---------- "not a Ryan copy" rule: downgrading the stream gets a timeout ---------- */
// WeBot is a passion project. Calling it a Ryan Hall copy, fake, "Yallbot", a rip-off and so on gets one
// firm line from WeBot on air, then that viewer is hidden from the on-screen chat and ignored for
// TIMEOUT_MINUTES. With YouTube moderation linked (YOUTUBE_OAUTH_* in .env) they also get a real YouTube
// timeout. The owner and moderators are exempt, and fans saying "not a Ryan copy" don't count.
const TIMEOUT_MINUTES = 10;
const timeouts = new Map(); // channelId -> until (ms)
const NAMECALL = /\by'?all\s*-?\s*bot\b|\byallbot\b|\bfake\s*(we\s*-?\s*bot|webot|ryan)\b|ryan\s*hall\s*(copy|clone|knock\s*-?\s*off|rip\s*-?\s*off|wannabe|wanna\s*be)/i;
const INSULT = /\b(fake|copy\s*-?\s*cat|cop(y|ied|ies|ying)|clone|rip\s*-?\s*off|knock\s*-?\s*off|wanna\s*-?\s*be|bootleg|off\s*-?\s*brand|cheap\s+(version|ryan|copy))\b/i;
const TARGET = /\b(we\s*-?\s*bot|webot|ryan|this\s+(stream|channel|bot)|weather\s*power)\b/i;
const FAN = /\bnot\s+a\s+(ryan\s+)?(copy|clone|rip\s*-?\s*off|knock\s*-?\s*off)\b/i;
export const downgrades = (text) => {
  const t = String(text || '');
  return !FAN.test(t) && (NAMECALL.test(t) || (INSULT.test(t) && TARGET.test(t)));
};
// One line per timeout (voice credits): the timeout plus the main rule for everybody watching. During a
// pile-on (another timeout within 3 minutes) the rule was just said, so the next ones get the short line.
const RULE_TIMEOUT_LINES = [
  "{name}, that's a ten minute timeout. Y'all listen up: the number one rule here is do not call me a copy. Not a Ryan copy, not fake, not Yallbot. Say it and you're next, sugar.",
  "Ten minute timeout, {name}. And for everybody else: I am not a Ryan copy, I'm not fake, and my name ain't Yallbot. That's the number one rule, and it gets you a timeout every time.",
  "{name}, sit down, ten minute timeout. Rule number one in this chat: do not call me a copy. This is a passion project built from scratch. Call it fake and you're in timeout too, darlin."
];
const TIMEOUT_LINES = [
  '{name}, ten minute timeout. Rules are rules, sugar.',
  'You too, {name}. Ten minutes. Bless your heart.',
  '{name}, timeout. Did you not just hear me, darlin?'
];
let lastRuleLine = 0;
// "Gonna report this fake", "y'all should report him", "mass report": WeBot calls it weak. Weather reports
// ("report hail", "any tornado reports") never count.
const REPORT_THREAT = /\b(gotta|gonna|going\s+to|will|i'?ll|i'?m|im|about\s+to|bout\s+to|finna|should|need\s+to|y'?all|everybody|everyone|go)\s+(go\s+)?report(ing)?\b|\breport(ing|ed)?\s+(this|that|you|u|him|it|we\s*-?\s*bot|webot|fakes?|the\s+(stream|channel|bot|fakes?))\b|\bmass\s*-?\s*report|\breport(ing)?\s+(button|spam)/i;
const WEATHER_WORDS = /\b(tornado|hail|storm|damage|flood|wind|funnel|rain|snow|lightning|weather|spotter|nws|spc)\b/i;
const NOT_A_THREAT = /\breport(ing)?\s+(back|in|live|from)\b/i;
const threatensReport = (text) => { const t = String(text || ''); return REPORT_THREAT.test(t) && !WEATHER_WORDS.test(t) && !NOT_A_THREAT.test(t); };
const WEAK_LINES = [
  'Report me? {name}, that is weak. Real weak. Go on and click it, sugar, I will still be right here doing the weather.',
  '{name} talking about reporting the stream. Weak, darlin. Report a tornado if you want to report something useful.',
  'Oh, you gonna report me, {name}? That is the weakest thing I have heard all day, and I read the overnight forecast discussions.'
];
const REPORT_TIMEOUT_LINES = [
  '{name}, calling me a copy AND threatening to report me? That is weak. Ten minute timeout, sugar.',
  'Ten minute timeout, {name}. And reporting a passion project because you are bored? Weak. Bless your heart.'
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
let lastWeak = 0;

let ytAccess = { token: '', until: 0 };
// The channel's permission: YOUTUBE_OAUTH_* in .env, or data/youtube-oauth.json (written by scripts/youtube-auth.mjs,
// takes effect without a restart).
const ytCreds = () => {
  const env = process.env;
  if (env.YOUTUBE_OAUTH_REFRESH_TOKEN) return { id: env.YOUTUBE_OAUTH_CLIENT_ID, secret: env.YOUTUBE_OAUTH_CLIENT_SECRET, refresh: env.YOUTUBE_OAUTH_REFRESH_TOKEN };
  try {
    const f = JSON.parse(fs.readFileSync(dataDir + '/youtube-oauth.json', 'utf8'));
    return { id: f.client_id, secret: f.client_secret, refresh: f.refresh_token };
  } catch {
    return {};
  }
};
export const ytLinked = () => Boolean(ytCreds().refresh);
export const ytToken = async () => {
  const { id, secret, refresh } = ytCreds();
  if (!id || !secret || !refresh) return '';
  if (ytAccess.token && Date.now() < ytAccess.until) return ytAccess.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) throw new Error('YouTube sign-in: ' + (body.error_description || body.error || r.status));
  ytAccess = { token: body.access_token, until: Date.now() + (Number(body.expires_in || 3600) - 120) * 1000 };
  return ytAccess.token;
};
// Real YouTube timeout (needs the channel's moderation permission; costs 50 quota units).
const youtubeTimeout = async (channelId) => {
  const token = await ytToken();
  if (!token || !state.chatId) return false;
  spend(50);
  const r = await fetch('https://www.googleapis.com/youtube/v3/liveChat/bans?part=snippet', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { liveChatId: state.chatId, type: 'temporary', banDurationSeconds: TIMEOUT_MINUTES * 60, bannedUserDetails: { channelId } } }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('YouTube timeout ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return true;
};

// Phone heads-up (ntfy, same NTFY_TOPIC as the warning alerts) whenever WeBot times somebody out.
const notifyTimeout = async (name, text, real) => {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const said = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  // JSON publish (not headers) so emoji in names and messages come through.
  const msg = {
    topic, title: 'WeBot timed out ' + name, priority: 3, tags: ['no_entry', 'robot'],
    message: 'They said: "' + said + '"\n' + (real ? '10-minute YouTube timeout.' : 'Hidden from the stream for 10 minutes (the YouTube timeout did not go through).')
  };
  if (state.videoId) msg.click = 'https://www.youtube.com/watch?v=' + state.videoId;
  await fetch(server, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg), signal: AbortSignal.timeout(15000) });
};

// True = drop this message (viewer is in timeout, or just earned one).
const timeoutCheck = async (message) => {
  const author = message.authorDetails || {};
  const id = author.channelId || author.displayName || '';
  const now = Date.now();
  if (!id || author.isChatOwner || author.isChatModerator) return false;
  if ((timeouts.get(id) || 0) > now) return true;
  if (!['textMessageEvent', 'superChatEvent'].includes(message.snippet?.type)) return false;
  const text = message.snippet?.displayMessage;
  const name = safeName(author.displayName) || 'Partner';
  if (!downgrades(text)) {
    // "I gotta report fakes": no timeout, just WeBot calling it weak (once every 2 minutes at most).
    if (!threatensReport(text)) return false;
    if (now - lastWeak > 2 * 60 * 1000) {
      lastWeak = now;
      await applyLiveCommand({ action: 'say', text: pick(WEAK_LINES).replace('{name}', name) }).catch(() => {});
      console.log('[chat] called a report threat weak');
    }
    return true;
  }
  timeouts.set(id, now + TIMEOUT_MINUTES * 60 * 1000);
  const withRule = now - lastRuleLine > 3 * 60 * 1000;
  if (withRule) lastRuleLine = now;
  const line = pick(threatensReport(text) ? REPORT_TIMEOUT_LINES : withRule ? RULE_TIMEOUT_LINES : TIMEOUT_LINES).replace('{name}', name);
  await applyLiveCommand({ action: 'say', text: line }).catch(() => {});
  const real = await youtubeTimeout(author.channelId).catch((e) => { console.warn('[chat]', e.message); return false; });
  console.log('[chat] timeout for downgrading the stream' + (real ? ' (YouTube timeout too)' : ' (on-stream only)'));
  notifyTimeout(name, message.snippet?.displayMessage, real).catch((e) => console.warn('[chat] ntfy', e.message));
  return true;
};

const readChat = async () => {
  const params = { liveChatId: state.chatId, part: 'snippet,authorDetails', maxResults: '200' };
  if (state.pageToken) params.pageToken = state.pageToken;
  const body = await api('liveChat/messages', params, 5);
  state.pageToken = body.nextPageToken || state.pageToken;
  let items = body.items || [];
  // The first read after a restart contains recent history. Do not replay normal chat, but DO rescue
  // fresh commands posted while the service was restarting/deploying. Otherwise viewers can type
  // !forecast right after a refresh and WeBot silently drops it.
  if (!state.primed) {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const message of items) {
      const published = Date.parse(message.snippet?.publishedAt || '');
      if (!Number.isFinite(published) || published < cutoff) continue;
      const text = String(message.snippet?.displayMessage || '').trim();
      if (!/^!(forecast|fc|weather|wx|gas|roast)\b/i.test(text)) continue;
      await handle(message).catch((e) => console.warn('[chat]', e.message));
    }
  } else {
    // Viewers in timeout (or earning one now) are dropped before anything shows on screen or gets an answer.
    const kept = [];
    for (const message of items) {
      if (!(await timeoutCheck(message).catch(() => false))) kept.push(message);
    }
    items = kept;
    const regular = [];
    for (const message of items) {
      const command = await handle(message).catch((e) => { console.warn('[chat]', e.message); return true; });
      if (!command) regular.push(message);
    }
    await showChats(items).catch((e) => console.warn('[chat]', e.message));
    await welcomeRegulars(items).catch((e) => console.warn('[chat]', e.message));
    await readOne(regular).catch((e) => console.warn('[chat]', e.message));
  }
  state.primed = true;
  return Number(body.pollingIntervalMillis) || 0;
};

const loop = async () => {
  let wait = BASE_MS;
  try {
    if (overBudget()) wait = 15 * 60 * 1000;
    else {
      if (!state.chatId && Date.now() - state.lastFind > 5 * 60 * 1000) await findLive();
      // Viewer counts and the live check every 5 minutes. (This used to key off viewersAt, which never
      // updates when YouTube hides the viewer count, so it ran on every read and burned the quota by midday.)
      else if (state.chatId && Date.now() - state.lastFind > 5 * 60 * 1000) await findLive();
      if (state.chatId) {
        const min = await readChat();
        wait = Math.max(min, Date.now() < state.activeUntil ? ACTIVE_MS : BASE_MS);
      } else wait = 5 * 60 * 1000;
    }
  } catch (error) {
    // Chat ended / stream changed: look for the live video again. Out of quota: wait it out.
    if (/quota/i.test(error.message)) { state.units = DAILY_BUDGET; wait = 30 * 60 * 1000; }
    else { state.chatId = ''; state.lastFind = 0; wait = 2 * 60 * 1000; }
    console.warn('[chat]', error.message);
  }
  state.timer = setTimeout(loop, wait);
};

export const startYoutubeChat = () => {
  if (!KEY() || !(process.env.YOUTUBE_CHANNEL_ID || process.env.YOUTUBE_VIDEO_ID) || process.env.YOUTUBE_CHAT === 'off') return;
  state.enabled = true;
  console.log('[chat] YouTube chat commands on');
  state.timer = setTimeout(loop, 5000);
};

export const chatStatus = () => ({
  enabled: state.enabled,
  live: Boolean(state.chatId),
  viewers: Date.now() - state.viewersAt < 10 * 60 * 1000 ? state.viewers : null,
  startedAt: state.startedAt || null,
  totalViews: state.totalViews ?? null,
  subscribers: Date.now() - state.subscribersAt < 30 * 60 * 1000 ? state.subscribers : null,
  lastCommandAt: state.lastCommandAt
});

export const chatCommandStatus = () => ({
  enabled: state.enabled,
  live: Boolean(state.chatId),
  lastCommandAt: state.lastCommandAt,
  commands: state.commandLog.slice(-30).reverse().map((entry) => ({
    ...entry,
    place: entry.place ? { ...entry.place } : null
  }))
});

export const retryChatCommand = async (id) => {
  const entry = state.commandLog.find((item) => item.id === String(id || ''));
  if (!entry) throw Object.assign(new Error('That chat command is no longer in the monitor'), { status: 404 });
  if (!['forecast', 'gas'].includes(entry.kind) || !entry.place) {
    throw Object.assign(new Error('This command does not have a valid place to answer'), { status: 400 });
  }
  await applyLiveCommand({ action: 'chat-request', kind: entry.kind, place: entry.place, user: entry.user === 'Viewer' ? '' : entry.user });
  commandFinish(entry, 'manual', 'Manually queued from Studio', entry.place);
  return { ok: true, command: { ...entry, place: { ...entry.place } } };
};

// The live broadcast the chat reader is on (empty when none is found yet).
export const liveVideoId = () => state.videoId;
