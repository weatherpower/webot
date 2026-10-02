// Live cameras for WeatherPower Live, from the WeatherPower Traffic camera network (the Camera Wall's
// /api/cameras). The stream shows the nearest camera during an alert zoom.
// Only public feeds (absolute http(s) URLs, e.g. state DOT cameras) are passed on by default; local
// feeds served by WeatherPower Traffic itself stay private unless CAMERA_ALLOW_LOCAL=true.
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
  const feed = String(playlist || snapshot || source || '');
  if (!feed) return null;
  const isStream = Boolean(playlist) || /\.m3u8(\?|$)/i.test(feed) || /hls|video|stream/.test(mediaType);
  const name = String(pick(raw, 'camera_name', 'cameraName', 'name', 'title', 'label', 'description') || `Camera ${idx + 1}`);
  const hay = `${feed} ${raw.agency || ''} ${name}`;
  const agency = String(raw.agency || (AGENCY_HINTS.find(([re]) => re.test(hay)) || [])[1] || '');
  return {
    id: String(pick(raw, 'id', 'camera_id', 'cameraId') ?? idx),
    name,
    agency,
    roadway: String(pick(raw, 'roadway', 'route', 'road') || ''),
    lat,
    lon,
    feed,
    // A still image the stream can always show, even when the main feed is a video stream.
    snapshot: snapshot && snapshot !== feed ? String(snapshot) : null,
    kind: isStream ? 'hls' : 'image'
  };
};

const isPublicUrl = (url) => /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);

export const camerasConfigured = () => Boolean(config.cameras.username && config.cameras.password) || config.cameras.noAuth;

export const listCameras = async () => {
  if (!camerasConfigured()) return [];
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
    const cameras = list.map(normalizeCamera).filter(Boolean)
      .filter((c) => config.cameras.allowLocal || isPublicUrl(c.feed));
    cache = { at: Date.now(), cameras, error: null };
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
  const radius = Math.min(100, Math.max(1, Number(miles) || 30));
  const cameras = (await listCameras())
    .map((c) => ({ ...c, miles: Math.round(milesBetween(la, lo, c.lat, c.lon) * 10) / 10 }))
    .filter((c) => c.miles <= radius)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 3)));
  return { configured: camerasConfigured(), total: cache.cameras?.length || 0, error: cache.error || undefined, cameras };
};
