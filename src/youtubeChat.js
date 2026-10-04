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
import { replyTo } from './personality.js';

const API = 'https://www.googleapis.com/youtube/v3';
const KEY = () => process.env.YOUTUBE_API_KEY || '';
const DAILY_BUDGET = Number(process.env.YOUTUBE_DAILY_UNITS || 9000);
const BASE_MS = 60 * 1000;
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
  lastFind: 0, activeUntil: 0, lastCommandAt: null, units: 0, unitsDay: '', timer: null, users: new Map(), recent: [],
  lastReadAt: 0, readUsers: new Map()
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

// The channel's live video: the one already found, the public /live page (no quota; YouTube sometimes
// leaves the link out for servers), or the channel's uploads list (2 units). Each candidate
// must be live and on this channel. Then its chat id and viewer count.
const liveVideo = async (videoId, channel) => {
  if (!videoId) return null;
  const body = await api('videos', { part: 'snippet,liveStreamingDetails', id: videoId }, 1);
  const v = body.items?.[0];
  if (!v || v.snippet?.liveBroadcastContent !== 'live' || (channel && v.snippet?.channelId !== channel)) return null;
  return { videoId, live: v.liveStreamingDetails || {} };
};
const findLive = async () => {
  state.lastFind = Date.now();
  const channel = process.env.YOUTUBE_CHANNEL_ID || '';
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
      const body = await api('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') }, 1);
      const v = (body.items || []).find((x) => x.snippet?.liveBroadcastContent === 'live' && x.snippet?.channelId === channel);
      if (v) found = { videoId: v.id, live: v.liveStreamingDetails || {} };
    }
  }
  if (!found) { state.videoId = ''; state.chatId = ''; return; }
  const { videoId, live } = found;
  state.viewers = live?.concurrentViewers != null ? Number(live.concurrentViewers) : null;
  state.viewersAt = Date.now();
  const chatId = live?.activeLiveChatId || '';
  if (videoId !== state.videoId || chatId !== state.chatId) {
    state.videoId = videoId;
    state.chatId = chatId;
    state.pageToken = '';
    state.primed = false;
    if (chatId) console.log(`[chat] reading live chat on ${videoId}`);
  }
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
    const control = await liveControl().catch(() => null);
    if (!control || control.chatRead === false) return;
    state.lastReadAt = now;
    state.replies.push(now);
    sent += 1;
    state.readUsers.set(userKey, now);
    if (state.readUsers.size > 500) state.readUsers.delete(state.readUsers.keys().next().value);
    const user = safeName(author.displayName);
    // WeBot's comeback (src/personality.js): written lines only, so it can't come out crude.
    await applyLiveCommand({ action: 'chat-say', user, text, reply: replyTo(text, user, brain) });
    console.log('[chat] answering a viewer message');
  }
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

// Returns true when the message was a ! command (handled or not).
const handle = async (message) => {
  const text = String(message.snippet?.displayMessage || '').trim();
  const m = text.match(/^!(forecast|fc|weather|wx|gas)\b\s*(.*)$/i);
  if (!m) return /^!/.test(text);
  const kind = /^gas$/i.test(m[1]) ? 'gas' : 'forecast';
  const author = message.authorDetails || {};
  const userKey = author.channelId || author.displayName;
  const now = Date.now();
  state.activeUntil = now + 5 * 60 * 1000;
  if (!m[2]) return true;
  const { chat } = await loadBrain();
  if (!(author.isChatOwner || author.isChatModerator) && now - (state.users.get(userKey) || 0) < chat.commandCooldownMinutes * 60 * 1000) return true;
  state.recent = state.recent.filter((t) => now - t < 20 * 60 * 1000);
  if (state.recent.length >= chat.maxRequestsPer20Minutes) return true;
  const place = findPlace(m[2]);
  if (!place) return true;
  state.users.set(userKey, now);
  state.recent.push(now);
  state.lastCommandAt = new Date().toISOString();
  await applyLiveCommand({ action: 'chat-request', kind, place, user: safeName(author.displayName) });
  console.log(`[chat] ${kind} request: ${place.name}, ${place.state}`);
  return true;
};

const readChat = async () => {
  const params = { liveChatId: state.chatId, part: 'snippet,authorDetails', maxResults: '200' };
  if (state.pageToken) params.pageToken = state.pageToken;
  const body = await api('liveChat/messages', params, 5);
  state.pageToken = body.nextPageToken || state.pageToken;
  // The first read returns recent history: skip it so old commands don't replay after a restart.
  if (state.primed) {
    const regular = [];
    for (const message of body.items || []) {
      const command = await handle(message).catch((e) => { console.warn('[chat]', e.message); return true; });
      if (!command) regular.push(message);
    }
    await showChats(body.items || []).catch((e) => console.warn('[chat]', e.message));
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
      else if (state.chatId && Date.now() - state.viewersAt > 3 * 60 * 1000) await findLive();
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
  lastCommandAt: state.lastCommandAt
});
