// Train cams for the stream's "Train Cam" segment: the live YouTube cams of SouthWest RailCams
// (used with their permission). One YouTube search every 6 hours finds which cams are live
// (100 + 1 quota units), so it barely touches the chat reader's daily budget.
const CHANNEL = () => process.env.TRAINCAM_CHANNEL_ID || 'UCxaKME3e34j3aTESZZ3h7Sg';
const KEY = () => process.env.YOUTUBE_API_KEY || '';
const API = 'https://www.googleapis.com/youtube/v3';
let cache = { at: 0, cams: [] };

const get = async (path, params) => {
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: KEY() })}`, { signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || 'YouTube ' + r.status);
  return body;
};

// "Tucson, AZ (Wilmot) | UPRR Lordsburg Sub MP 994.7 | SouthWest RailCams LIVE" → place + line.
const parse = (title) => {
  const parts = String(title || '').split('|').map((s) => s.trim()).filter(Boolean);
  return { place: parts[0] || 'Train cam', line: parts.length > 2 ? parts[1] : '' };
};

export const trainCams = async () => {
  if (!KEY()) return [];
  if (cache.cams.length && Date.now() - cache.at < 6 * 3600 * 1000) return cache.cams;
  try {
    const search = await get('search', { part: 'id', channelId: CHANNEL(), eventType: 'live', type: 'video', maxResults: '50' });
    const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
    if (!ids.length) { cache = { at: Date.now(), cams: [] }; return []; }
    const videos = await get('videos', { part: 'snippet,status', id: ids.join(',') });
    const cams = (videos.items || [])
      .filter((v) => v.status?.embeddable !== false && v.snippet?.liveBroadcastContent === 'live')
      .map((v) => ({ id: v.id, title: v.snippet.title, ...parse(v.snippet.title) }));
    cache = { at: Date.now(), cams };
    console.log(`[traincams] ${cams.length} live cams`);
  } catch (error) {
    console.warn('[traincams]', error.message);
    cache.at = Date.now() - 5 * 3600 * 1000;   // try again in an hour
  }
  return cache.cams;
};
