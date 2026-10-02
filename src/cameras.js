// Live cameras for WeatherPower Live, from the WeatherPower Traffic camera network (the Camera Wall's
// /api/cameras). The stream shows the nearest camera during an alert zoom.
// Only public feeds (absolute http(s) URLs, e.g. state DOT cameras) are passed on by default; local
// feeds served by WeatherPower Traffic itself stay private unless CAMERA_ALLOW_LOCAL=true.
import fs from 'node:fs/promises';
import { config } from './config.js';

let cache = { at: 0, cameras: null, error: null };

const pick = (obj, ...keys) => {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  return null;
};
const num = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

const AGENCY_HINTS = [[/idrivearkansas|ardot/i, 'ARDOT'], [/dot\.ca\.gov/i, 'Caltrans'], [/modot/i, 'MoDOT'], [/oktraffic|odot/i, 'ODOT'], [/wsdot/i, 'WSDOT']];

// Same field handling as the Camera Wall's normalizeOne().
export const normalizeCamera = (raw, idx) => {
  if (!raw || typeof raw !== 'object') return null;
  const loc = raw.location || raw.coords || raw.position || {};
  let lat = num(pick(raw, 'lat', 'latitude', 'Lat', 'Latitude') ?? pick(loc, 'lat', 'latitude', 'y'));
  let lon = num(pick(raw, 'lon', 'lng', 'longitude', 'Lon', 'Longitude') ?? pick(loc, 'lon', 'lng', 'longitude', 'x'));
  const pair = pick(raw, 'camera_coordinates', 'coordinates');
  if ((lat == null || lon == null) && Array.isArray(pair) && pair.length >= 2) { lon = num(pair[0]); lat = num(pair[1]); }
  if ((lat == null || lon == null) && pair && typeof pair === 'object' && !Array.isArray(pair)) {
    lon = num(pick(pair, 'lon', 'lng', 'longitude', 'x'));
    lat = num(pick(pair, 'lat', 'latitude', 'y'));
  }
  if ((lat == null || lon == null) && Array.isArray(raw.geometry?.coordinates)) { lon = num(raw.geometry.coordinates[0]); lat = num(raw.geometry.coordinates[1]); }
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  const mediaType = String(pick(raw, 'media_type', 'mediaType', 'type') || '').toLowerCase();
  const playlist = pick(raw, 'playlist_url', 'playlistUrl', 'stream_url', 'streamUrl', 'hls', 'hlsUrl');
  const snapshot = pick(raw, 'snapshot_url', 'snapshotUrl', 'image_url', 'imageUrl', 'image', 'img', 'fallback_source');
  const source = pick(raw, 'source', 'feed', 'feed_url', 'feedUrl', 'url');
  // A live stream wins over its still-image fallback.
  const streamSource = source && (/\.m3u8(\?|$)/i.test(String(source)) || mediaType === 'hls') ? source : null;
  const feed = String(playlist || streamSource || snapshot || source || '');
  if (!feed || mediaType === 'youtube') return null;
  const isStream = Boolean(playlist) || /\.m3u8(\?|$)/i.test(feed) || /hls|video|stream/.test(mediaType);
  const name = String(pick(raw, 'camera_name', 'cameraName', 'name', 'title', 'label', 'description') || `Camera ${idx + 1}`);
  const hay = `${feed} ${raw.agency || ''} ${name}`;
  const agency = String(raw.agency || (AGENCY_HINTS.find(([re]) => re.test(hay)) || [])[1] || '');
  return {
    id: String(pick(raw, 'slug', 'id', 'camera_id', 'cameraId') ?? idx).replace(/[^\w.-]/g, '_'),
    name,
    agency,
    roadway: String(pick(raw, 'roadway', 'route', 'road') || ''),
    state: String(pick(raw, 'state') || '').toUpperCase().slice(0, 2),
    place: String(pick(raw, 'market', 'camera_location_label', 'district') || ''),
    view: String(pick(raw, 'camera_view', 'view') || ''),
    lat,
    lon,
    feed,
    // A still image the stream can always show, even when the main feed is a video stream.
    snapshot: snapshot && snapshot !== feed ? String(snapshot) : null,
    kind: isStream ? 'hls' : 'image',
    // Some agencies only serve their streams to requests from their own site (Origin/Referer).
    // These stay on the server and are only used by the stream proxy below.
    headers: raw.source_headers && typeof raw.source_headers === 'object' ? raw.source_headers : null
  };
};

const isPublicUrl = (url) => /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);

export const camerasConfigured = () => Boolean(config.cameras.catalogFile) || Boolean(config.cameras.username && config.cameras.password) || config.cameras.noAuth;

const listFromList = (list) => list.map(normalizeCamera).filter(Boolean).filter((c) => config.cameras.allowLocal || isPublicUrl(c.feed));

// The WeatherPower Traffic catalog file on this PC (configs/railfan_cameras.json). Reloaded when it changes.
let fileCache = { mtime: 0, cameras: null };
const listFromFile = async () => {
  const stat = await fs.stat(config.cameras.catalogFile);
  if (fileCache.cameras && stat.mtimeMs === fileCache.mtime) return fileCache.cameras;
  const data = JSON.parse(await fs.readFile(config.cameras.catalogFile, 'utf8'));
  const list = Array.isArray(data) ? data : Array.isArray(data.cameras) ? data.cameras : [];
  fileCache = { mtime: stat.mtimeMs, cameras: listFromList(list) };
  return fileCache.cameras;
};

export const listCameras = async () => {
  if (!camerasConfigured()) return [];
  if (config.cameras.catalogFile) {
    try {
      const cameras = await listFromFile();
      cache = { at: Date.now(), cameras, error: null };
      return cameras;
    } catch (error) {
      cache = { at: Date.now(), cameras: cache.cameras || [], error: `Camera catalog file: ${error.message}` };
      if (!config.cameras.username) return cache.cameras;
    }
  }
  if (cache.cameras && Date.now() - cache.at < 10 * 60 * 1000) return cache.cameras;
  const headers = { Accept: 'application/json' };
  if (config.cameras.username) headers.Authorization = `Basic ${Buffer.from(`${config.cameras.username}:${config.cameras.password}`).toString('base64')}`;
  try {
    const response = await fetch(`${config.cameras.baseUrl.replace(/\/+$/, '')}/api/cameras`, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Camera network said ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data
      : Array.isArray(data.cameras) ? data.cameras
        : Array.isArray(data.features) ? data.features.map((f) => ({ ...(f.properties || {}), geometry: f.geometry }))
          : Array.isArray(data.results) ? data.results
            : Array.isArray(data.data) ? data.data : [];
    cache = { at: Date.now(), cameras: listFromList(list), error: null };
  } catch (error) {
    cache = { at: Date.now() - 8 * 60 * 1000, cameras: cache.cameras || [], error: error.message };
  }
  return cache.cameras;
};

const milesBetween = (lat1, lon1, lat2, lon2) => {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
};

export const camerasNear = async ({ lat, lon, miles = 30, limit = 3 }) => {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) throw Object.assign(new Error('lat and lon are required'), { status: 400 });
  // No broadcast permission yet: nothing goes to the stream.
  if (!config.cameras.onAir) return { configured: camerasConfigured(), onAir: false, total: 0, cameras: [] };
  const radius = Math.min(100, Math.max(1, Number(miles) || 30));
  const cameras = (await listCameras())
    .map((c) => ({ ...c, miles: Math.round(milesBetween(la, lo, c.lat, c.lon) * 10) / 10 }))
    .filter((c) => c.miles <= radius && !(c.kind === 'hls' && siteRefused(c.feed)))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 3)))
    .map(forClient);
  return { configured: camerasConfigured(), total: cache.cameras?.length || 0, error: cache.error || undefined, cameras };
};

// Video goes through the stream proxy (agency headers, no CORS trouble); stills load directly.
// Agency request headers never leave the server.
const forClient = ({ headers, ...c }) => ({
  ...c,
  refused: c.kind === 'hls' && siteRefused(c.feed),
  feed: c.kind === 'hls' ? `/api/v3/cameras/stream/${encodeURIComponent(c.id)}/index.m3u8` : c.feed
});

// Camera picker for Live Control: search by name/road/place, filter by state, agency and type.
export const searchCameras = async ({ q = '', state = '', agency = '', kind = '', offset = 0, limit = 60 } = {}) => {
  const all = await listCameras();
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const st = String(state).toUpperCase();
  const matches = all.filter((c) => (!st || c.state === st)
    && (!agency || c.agency === agency)
    && (!kind || c.kind === kind)
    && terms.every((t) => `${c.name} ${c.roadway} ${c.place} ${c.agency} ${c.state} ${c.view}`.toLowerCase().includes(t)));
  const count = (key) => Object.entries(all.reduce((m, c) => { if (c[key]) m[c[key]] = (m[c[key]] || 0) + 1; return m; }, {}))
    .sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  const start = Math.max(0, Number(offset) || 0);
  return {
    configured: camerasConfigured(),
    onAir: config.cameras.onAir,
    total: all.length,
    matches: matches.length,
    states: count('state'),
    agencies: count('agency'),
    error: cache.error || undefined,
    cameras: matches.slice(start, start + Math.min(200, Math.max(1, Number(limit) || 60))).map(forClient)
  };
};

// Used by the stream for a pinned camera, so it is refused while cameras are off air.
export const getCamera = async (id) => {
  if (!config.cameras.onAir) throw Object.assign(new Error('Cameras are off air (CAMERA_ON_AIR is not enabled)'), { status: 403 });
  const cam = (await listCameras()).find((c) => c.id === String(id));
  if (!cam) throw Object.assign(new Error('Unknown camera'), { status: 404 });
  return forClient(cam);
};

/* ---------------- HLS stream proxy ---------------- */

const b64url = (text) => Buffer.from(text).toString('base64url');
const unb64url = (text) => Buffer.from(String(text || ''), 'base64url').toString('utf8');

// Rewrites every URI in a playlist to come back through this proxy (relative, so it works under /warningcenter).
const rewritePlaylist = (text, baseUrl) => text.split(/\r?\n/).map((line) => {
  const toProxy = (uri) => `seg?u=${b64url(new URL(uri, baseUrl).href)}`;
  if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${toProxy(uri)}"`);
  return line.trim() ? toProxy(line.trim()) : line;
}).join('\n');

// Same site = same last two host labels (live-cdn.idrivearkansas.com ~ actis.idrivearkansas.com).
const siteOf = (host) => host.toLowerCase().split('.').slice(-2).join('.');
const refusedSites = new Map();
const siteRefused = (feed) => {
  try { return (refusedSites.get(siteOf(new URL(feed).hostname)) || 0) > Date.now(); } catch { return false; }
};

// Only fetches from the camera's own site (agencies redirect to their CDN), so this is not an open proxy.
export const cameraStream = async ({ id, file, u }) => {
  const cameras = await listCameras();
  const cam = cameras.find((c) => c.id === id && c.kind === 'hls');
  if (!cam) throw Object.assign(new Error('Unknown camera'), { status: 404 });
  const target = file === 'index.m3u8' ? cam.feed : unb64url(u);
  let url;
  try { url = new URL(target); } catch { throw Object.assign(new Error('Bad stream URL'), { status: 400 }); }
  if (siteOf(url.hostname) !== siteOf(new URL(cam.feed).hostname) || !/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Stream host not allowed'), { status: 403 });
  const response = await fetch(url, { headers: { 'User-Agent': 'WeatherPower Live camera player', ...(cam.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    // Sites that refuse us (e.g. feeds that need the agency's own session) are skipped for an hour.
    if ([401, 403].includes(response.status)) refusedSites.set(siteOf(url.hostname), Date.now() + 60 * 60 * 1000);
    throw Object.assign(new Error(`Camera feed said ${response.status}`), { status: 502 });
  }
  const finalUrl = new URL(response.url || url.href);
  if (siteOf(finalUrl.hostname) !== siteOf(url.hostname)) throw Object.assign(new Error('Stream redirected off site'), { status: 403 });
  const type = response.headers.get('content-type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8$/i.test(finalUrl.pathname)) {
    // Segments are relative to where the playlist really came from (after any redirect).
    return { type: 'application/vnd.apple.mpegurl', body: rewritePlaylist(await response.text(), finalUrl.href), playlist: true };
  }
  return { type: type || 'video/mp2t', body: Buffer.from(await response.arrayBuffer()), playlist: false };
};
