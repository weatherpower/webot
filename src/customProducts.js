import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { projectRoot } from './paths.js';
import { normalizeWarning } from './warning.js';
import { listWeWatches } from './weWatchStore.js';

const IDEBEL_CENTER = [-94.8263, 33.8957];
const SOURCE_HEADERS = {
  'User-Agent': 'weatherpower.app warning-card-service custom-products'
};

const compact = (value) => String(value ?? '').trim();

const isActive = (item, now = Date.now()) => {
  if (item?.active === false || item?.enabled === false || item?.disabled === true) return false;
  const starts = Date.parse(item?.startsAt || item?.startTime || item?.effective || item?.issuedAt || '');
  const expires = Date.parse(item?.expiresAt || item?.expires || item?.ends || item?.endTime || '');
  if (Number.isFinite(starts) && starts > now) return false;
  if (Number.isFinite(expires) && expires <= now) return false;
  return true;
};

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const firestoreValue = (value) => {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return parseMaybeJson(value.stringValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('geoPointValue' in value) {
    return {
      lat: Number(value.geoPointValue.latitude),
      lon: Number(value.geoPointValue.longitude)
    };
  }
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(firestoreValue);
  }
  if ('mapValue' in value) {
    return firestoreFields(value.mapValue.fields || {});
  }
  return value;
};

const firestoreFields = (fields = {}) => Object.fromEntries(
  Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])
);

const normalizeFirebaseBody = (body) => {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.documents)) {
    return body.documents.map((document) => ({
      id: document.name?.split('/').pop(),
      key: document.name,
      ...firestoreFields(document.fields || {})
    }));
  }

  for (const key of ['items', 'warnings', 'watches', 'wewatches', 'alerts', 'products']) {
    if (Array.isArray(body[key])) return body[key];
    if (body[key] && typeof body[key] === 'object') {
      return Object.entries(body[key]).map(([id, value]) => ({ id, key: id, ...(value || {}) }));
    }
  }

  return Object.entries(body)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([id, value]) => ({ id, key: id, ...value }));
};

const withQueryParam = (rawUrl, key, value) => {
  if (!value) return rawUrl;
  const url = new URL(rawUrl);
  if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
};

const fetchJson = async (rawUrl, { auth = '', apiKey = '', bearer = '', timeoutMs = config.customProducts.requestTimeoutMs } = {}) => {
  if (!rawUrl) return null;
  let url = rawUrl;
  url = withQueryParam(url, 'auth', auth);
  url = withQueryParam(url, 'key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        ...SOURCE_HEADERS,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail = body?.error?.message || body?.error || response.statusText;
      throw new Error(`${response.status}: ${detail}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
};

const readJsonFile = async (relativePath) => {
  if (!relativePath) return null;
  const filePath = path.resolve(projectRoot, relativePath);
  if (!filePath.startsWith(projectRoot)) throw new Error('Custom product file must stay inside the project folder');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const roundedIso = (date = Date.now(), minutes = 5) => {
  const bucket = minutes * 60 * 1000;
  return new Date(Math.floor(Number(date) / bucket) * bucket).toISOString();
};

const defaultExpires = (hours = 6) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const pointFromItem = (item = {}) => {
  const geo = item.geo || item.location || item.centerPoint || {};
  if (Array.isArray(item.center) && item.center.length === 2) return item.center.map(Number);
  if (Array.isArray(item.coordinates) && item.coordinates.length === 2) return item.coordinates.map(Number);
  const lat = Number(item.lat ?? item.latitude ?? geo.lat ?? geo.latitude);
  const lon = Number(item.lon ?? item.lng ?? item.longitude ?? geo.lon ?? geo.lng ?? geo.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];
  return IDEBEL_CENTER;
};

const polygonAround = ([lon, lat], radiusMiles = 22) => {
  const milesPerDegreeLat = 69;
  const latDelta = radiusMiles / milesPerDegreeLat;
  const lonDelta = radiusMiles / (milesPerDegreeLat * Math.max(0.25, Math.cos((lat * Math.PI) / 180)));
  return [
    [lon - lonDelta, lat - latDelta],
    [lon + lonDelta, lat - latDelta],
    [lon + lonDelta, lat + latDelta],
    [lon - lonDelta, lat + latDelta],
    [lon - lonDelta, lat - latDelta]
  ];
};

const polygonFromItem = (item = {}, center) => {
  const polygon = item.polygon || item.path || item.points;
  if (Array.isArray(polygon) && polygon.length >= 4) {
    return polygon.map((point) => Array.isArray(point)
      ? point.map(Number)
      : [Number(point.lon ?? point.lng ?? point.longitude), Number(point.lat ?? point.latitude)]);
  }
  const geometry = item.geometry || item.geojson;
  const ring = geometry?.type === 'Polygon'
    ? geometry.coordinates?.[0]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates?.[0]?.[0]
      : null;
  if (Array.isArray(ring) && ring.length >= 4) return ring.map((point) => point.map(Number));
  return polygonAround(center, Number(item.radiusMiles || item.radius || 22));
};

const stateFromItem = (item = {}, fallback = 'OK') => compact(
  item.state ||
  item.stateCode ||
  item.areaState ||
  item.region ||
  fallback
);

const titleFor = (item, event, state) => compact(item.title || item.headline || `${event} in ${state}`).toUpperCase();

const normalizeCustomProduct = (rawItem = {}, { source, fallbackEvent, fallbackOffice, fallbackTag, funny = false } = {}) => {
  const item = parseMaybeJson(rawItem) || {};
  if (!isActive(item)) return null;

  const center = pointFromItem(item);
  const polygon = polygonFromItem(item, center);
  const event = compact(item.event || item.product || item.type || fallbackEvent || 'WeatherPower Watch');
  const state = stateFromItem(item, center === IDEBEL_CENTER ? 'OK' : 'US');
  const issuedAt = item.issuedAt || item.sent || item.effective || item.createdAt || roundedIso();
  const expiresAt = item.expiresAt || item.expires || item.ends || item.endTime || defaultExpires(funny ? 2 : 6);
  const keyPart = compact(item.key || item.id || item.slug || item.uuid || titleFor(item, event, state)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const alertTag = compact(item.alertTag || item.tag || fallbackTag || (funny ? 'TEMU WARNING' : 'WATCH'));
  const description = compact(item.description || item.summary || item.body || item.message || item.sourceText);
  const sourceText = description || (funny
    ? 'Dollar Store Half Off Temu warning. Still take it seriously.'
    : 'WeatherPower Firebase watch product.');
  const whatToDo = compact(item.whatToDo || item.instruction) || (funny
    ? 'This is WeatherPower funny-mode, but still take it seriously: stay weather aware and keep your snack drawer prepared.'
    : 'Stay weather aware and be ready to act quickly if a warning is issued.');
  const geometry = item.geometry?.type ? item.geometry : { type: 'Polygon', coordinates: [polygon] };
  const hazardStats = Array.isArray(item.hazardStats)
    ? item.hazardStats
    : [
      item.wind || item.maxWind ? { label: 'Wind', value: compact(item.wind || item.maxWind) } : null,
      item.hail || item.maxHail ? { label: 'Hail', value: compact(item.hail || item.maxHail) } : null
    ].filter(Boolean);

  return normalizeWarning({
    key: `weatherpower-${source}-${keyPart || crypto.randomUUID()}`,
    nwsId: `weatherpower-${source}-${keyPart || crypto.randomUUID()}`,
    title: titleFor(item, event, state),
    event,
    state,
    areaDesc: compact(item.areaDesc || item.area || item.counties || item.locationName || item.name || state),
    office: compact(item.office || item.source || fallbackOffice || 'WeatherPower'),
    expiresAt,
    issuedAt,
    timezone: item.timezone,
    headline: compact(item.headline || item.title || event),
    description: sourceText,
    instruction: whatToDo,
    severity: item.severity || (funny ? 'Minor' : 'Moderate'),
    hazards: item.hazards || {
      label: compact(item.hazardLabel || (funny ? 'Funny' : 'Watch')),
      value: compact(item.hazardValue || (funny ? 'Dollar Store' : 'Issued')),
      subtext: compact(item.hazardSubtext || (funny ? 'Still take it seriously' : 'WeatherPower')),
      hail: compact(item.hail || item.maxHail),
      wind: compact(item.wind || item.maxWind)
    },
    hazardStats,
    sourceText,
    whatToDo,
    polygon,
    geometry,
    center,
    locations: Array.isArray(item.locations) ? item.locations : compact(item.locations).split(/[;,]/).map((part) => part.trim()).filter(Boolean),
    theme: item.theme || (funny ? {
      name: 'Funny WeatherPower',
      primary: '#8b5cf6',
      primaryDark: '#301266',
      accent: '#22d3ee',
      rgb: '34, 211, 238',
      polygon: '#22d3ee',
      type: 'funny-weatherpower'
    } : undefined),
    classification: {
      ...(item.classification || {}),
      isCustom: true,
      isFunny: funny,
      customSource: source,
      alertTag
    },
    radar: {
      ...(item.radar || {}),
      mode: item.radar?.mode || 'reflectivity'
    },
    postText: compact(item.postText) || `${titleFor(item, event, state)}. ${whatToDo}`.slice(0, 260)
  });
};

const fetchFunnyWarnings = async () => {
  if (!config.customProducts.funnyWarningsEnabled) return [];
  const fileBody = await readJsonFile(config.customProducts.funnyWarningsFile);
  const urlBody = await fetchJson(config.customProducts.funnyWarningsUrl).catch((error) => {
    console.warn(`Funny warning feed failed: ${error.message}`);
    return null;
  });
  const rawItems = [
    ...normalizeFirebaseBody(fileBody),
    ...normalizeFirebaseBody(urlBody)
  ];
  return rawItems
    .map((item) => normalizeCustomProduct(item, {
      source: 'funny',
      fallbackEvent: 'Funny Weather Statement',
      fallbackOffice: 'WeatherPower Fun Desk',
      fallbackTag: 'TEMU WARNING',
      funny: true
    }))
    .filter(Boolean);
};

const fetchFirebaseWeWatches = async () => {
  if (!config.customProducts.firebaseWeWatchesUrl) return [];
  const body = await fetchJson(config.customProducts.firebaseWeWatchesUrl, {
    auth: config.customProducts.firebaseWeWatchesAuth,
    apiKey: config.customProducts.firebaseWeWatchesApiKey,
    bearer: config.customProducts.firebaseWeWatchesBearer
  }).catch((error) => {
    console.warn(`Firebase WeWatches feed failed: ${error.message}`);
    return null;
  });
  return normalizeFirebaseBody(body)
    .map((item) => normalizeCustomProduct(item, {
      source: 'wewatch',
      fallbackEvent: 'WeatherPower Watch',
      fallbackOffice: 'WeatherPower Firebase',
      fallbackTag: 'WATCH'
    }))
    .filter(Boolean);
};

const fetchLocalWeWatches = async () => {
  const items = await listWeWatches();
  return items
    .map((item) => normalizeCustomProduct(item, {
      source: 'wewatch',
      fallbackEvent: 'WeatherPower Watch',
      fallbackOffice: 'WeatherPower Builder',
      fallbackTag: 'WEWATCH'
    }))
    .filter(Boolean);
};

export const fetchActiveCustomProducts = async () => {
  const [funnyWarnings, localWeWatches, firebaseWeWatches] = await Promise.all([
    fetchFunnyWarnings(),
    fetchLocalWeWatches(),
    fetchFirebaseWeWatches()
  ]);
  const warnings = [...funnyWarnings, ...localWeWatches, ...firebaseWeWatches];
  return {
    updated: new Date().toISOString(),
    count: warnings.length,
    warnings
  };
};
