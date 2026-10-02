import { gunzipSync } from 'node:zlib';

const CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const NHC_MAP_SERVICE_URL = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const ATCF_AID_URL = 'https://ftp.nhc.noaa.gov/atcf/aid_public';
const TROPICAL_EVENT_RE = /\b(hurricane|tropical storm|storm surge|extreme wind|typhoon|tropical cyclone|post-tropical cyclone)\b/i;
const CACHE_MS = 3 * 60 * 1000;
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

const MODEL_COLORS = [
  '#00e5ff',
  '#ffdc2e',
  '#ff5f57',
  '#a78bfa',
  '#22d3a6',
  '#fb7185',
  '#60a5fa',
  '#f59e0b',
  '#e879f9',
  '#34d399',
  '#f472b6',
  '#93c5fd',
  '#facc15',
  '#2dd4bf',
  '#c084fc',
  '#fb923c',
  '#4ade80',
  '#fda4af'
];

const MODEL_PRIORITY = [
  'AVNI',
  'AVNO',
  'AEMI',
  'CMC2',
  'CMCI',
  'UKX2',
  'UKXI',
  'NVG2',
  'NVGI',
  'CTCI',
  'HFAI',
  'HFBI',
  'HMNI',
  'HCCA',
  'TVCN'
];

let currentStormsCache;
let layerDirectoryCache;
const tropicalGeometryCache = new Map();
const aidDeckCache = new Map();

const cacheValue = async (cache, key, loader, ttl = CACHE_MS) => {
  const current = cache instanceof Map ? cache.get(key) : cache;
  if (current && current.expiresAt > Date.now()) return current.promise;

  const entry = {
    expiresAt: Date.now() + ttl,
    promise: Promise.resolve().then(loader)
  };
  entry.promise.catch(() => {
    if (cache instanceof Map) cache.delete(key);
  });

  if (cache instanceof Map) {
    cache.set(key, entry);
  }
  return entry.promise;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJson = async (url) => {
  const response = await fetchWithTimeout(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(`NHC data ${response.status}: ${body.error?.message || response.statusText}`);
  }
  return body;
};

const parseCoordinate = (value, negativeHemisphere) => {
  const match = String(value || '').trim().match(/^(\d+)([NSEW])$/i);
  if (!match) return null;
  const numeric = Number(match[1]) / 10;
  return negativeHemisphere.includes(match[2].toUpperCase()) ? -numeric : numeric;
};

const cycleToTime = (cycle) => {
  const match = String(cycle || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]));
};

const compassDirection = (degrees) => {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return '';
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return labels[Math.round((((value % 360) + 360) % 360) / 22.5) % 16];
};

const classificationLabel = (code) => {
  const labels = {
    DB: 'Disturbance',
    LO: 'Low',
    WV: 'Tropical Wave',
    TD: 'Tropical Depression',
    SD: 'Subtropical Depression',
    TS: 'Tropical Storm',
    SS: 'Subtropical Storm',
    HU: 'Hurricane',
    TY: 'Typhoon',
    ST: 'Super Typhoon',
    EX: 'Post-Tropical Cyclone',
    PT: 'Post-Tropical Cyclone'
  };
  return labels[String(code || '').toUpperCase()] || 'Tropical Cyclone';
};

const normalizeStorm = (storm) => {
  const intensityKt = Number(storm.intensity);
  const movementSpeedMph = Number(storm.movementSpeed);
  const advisory = storm.publicAdvisory || storm.forecastAdvisory || storm.forecastTrack || {};
  const advisoryNumber = String(advisory.advNum || '').trim();
  return {
    id: String(storm.id || '').toLowerCase(),
    binNumber: String(storm.binNumber || '').toUpperCase(),
    name: String(storm.name || '').trim(),
    classification: String(storm.classification || '').toUpperCase(),
    classificationLabel: classificationLabel(storm.classification),
    intensityKt: Number.isFinite(intensityKt) ? intensityKt : null,
    intensityMph: Number.isFinite(intensityKt) ? Math.round(intensityKt * 1.15078) : null,
    pressureMb: Number.isFinite(Number(storm.pressure)) ? Number(storm.pressure) : null,
    latitude: Number(storm.latitudeNumeric),
    longitude: Number(storm.longitudeNumeric),
    movementDir: Number.isFinite(Number(storm.movementDir)) ? Number(storm.movementDir) : null,
    movementCompass: compassDirection(storm.movementDir),
    movementSpeedMph: Number.isFinite(movementSpeedMph) ? movementSpeedMph : null,
    lastUpdate: storm.lastUpdate || advisory.issuance || null,
    advisoryNumber: advisoryNumber ? advisoryNumber.padStart(3, '0') : null,
    advisoryUrl: advisory.url || storm.forecastDiscussion?.url || storm.forecastGraphics?.url || null
  };
};

export const isTropicalEvent = (event = '') => TROPICAL_EVENT_RE.test(String(event || ''));

export const fetchCurrentTropicalStorms = async () => {
  if (currentStormsCache?.expiresAt > Date.now()) return currentStormsCache.promise;
  currentStormsCache = {
    expiresAt: Date.now() + CACHE_MS,
    promise: fetchJson(CURRENT_STORMS_URL)
      .then((body) => (body.activeStorms || []).map(normalizeStorm).filter((storm) => storm.id && storm.binNumber))
  };
  currentStormsCache.promise.catch(() => {
    currentStormsCache = null;
  });
  return currentStormsCache.promise;
};

const fetchLayerDirectory = async () => {
  if (layerDirectoryCache?.expiresAt > Date.now()) return layerDirectoryCache.promise;
  layerDirectoryCache = {
    expiresAt: Date.now() + 60 * 60 * 1000,
    promise: fetchJson(`${NHC_MAP_SERVICE_URL}?f=pjson`).then((body) => {
      const directory = new Map();
      for (const layer of body.layers || []) {
        const match = String(layer.name || '').match(/^([A-Z]{2}\d+)\s+(.+)$/i);
        if (!match) continue;
        const bin = match[1].toUpperCase();
        const label = match[2].toLowerCase();
        const entry = directory.get(bin) || {};
        if (label.includes('forecast points')) entry.forecastPoints = layer.id;
        if (label.includes('forecast track')) entry.forecastTrack = layer.id;
        if (label.includes('forecast cone')) entry.forecastCone = layer.id;
        if (label.includes('watch-warning')) entry.watchWarning = layer.id;
        directory.set(bin, entry);
      }
      return directory;
    })
  };
  layerDirectoryCache.promise.catch(() => {
    layerDirectoryCache = null;
  });
  return layerDirectoryCache.promise;
};

const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });

const queryGeoJsonLayer = async (layerId) => {
  if (!Number.isFinite(Number(layerId))) return emptyFeatureCollection();
  const url = new URL(`${NHC_MAP_SERVICE_URL}/${layerId}/query`);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'geojson');
  const body = await fetchJson(url);
  return {
    type: 'FeatureCollection',
    features: (body.features || []).filter((feature) => feature?.geometry)
  };
};

const fetchTropicalGeometry = async (storm) => {
  const key = `${storm.id}:${storm.binNumber}:${storm.advisoryNumber || ''}`;
  return cacheValue(tropicalGeometryCache, key, async () => {
    const directory = await fetchLayerDirectory();
    const layers = directory.get(storm.binNumber);
    if (!layers) {
      return {
        cone: emptyFeatureCollection(),
        forecastTrack: emptyFeatureCollection(),
        forecastPoints: emptyFeatureCollection(),
        watchWarning: emptyFeatureCollection()
      };
    }
    const [forecastPoints, forecastTrack, cone, watchWarning] = await Promise.all([
      queryGeoJsonLayer(layers.forecastPoints),
      queryGeoJsonLayer(layers.forecastTrack),
      queryGeoJsonLayer(layers.forecastCone),
      queryGeoJsonLayer(layers.watchWarning)
    ]);
    return { cone, forecastTrack, forecastPoints, watchWarning };
  });
};

const parseAidDeck = (text) => {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const fields = line.split(',').map((field) => field.trim());
    if (fields.length < 9) continue;
    const cycle = fields[2];
    const model = fields[4].toUpperCase();
    const tau = Number(fields[5]);
    const lat = parseCoordinate(fields[6], 'S');
    const lon = parseCoordinate(fields[7], 'W');
    if (!cycleToTime(cycle) || !model || !Number.isFinite(tau) || tau < 0 || tau > 120 || lat === null || lon === null) {
      continue;
    }
    rows.push({ cycle, model, tau, lat, lon });
  }
  return rows;
};

const buildModelTracks = (rows) => {
  if (!rows.length) return emptyFeatureCollection();
  const newestTime = Math.max(...rows.map((row) => cycleToTime(row.cycle)));
  const newestAllowed = newestTime - 12 * 60 * 60 * 1000;
  const latestCycleByModel = new Map();
  for (const row of rows) {
    const time = cycleToTime(row.cycle);
    if (time < newestAllowed) continue;
    if (!latestCycleByModel.has(row.model) || row.cycle > latestCycleByModel.get(row.model)) {
      latestCycleByModel.set(row.model, row.cycle);
    }
  }

  const available = Array.from(latestCycleByModel.keys());
  const selected = [];
  for (const model of MODEL_PRIORITY) {
    if (available.includes(model) && !selected.includes(model)) selected.push(model);
  }
  for (const model of available.filter((name) => /^AP\d{2}$/.test(name)).sort().slice(0, 8)) {
    if (!selected.includes(model)) selected.push(model);
  }
  for (const model of available.sort()) {
    if (selected.length >= 18) break;
    if (!selected.includes(model) && !/^(CARQ|OFCL|OFCI|CLP5|XTRP|TABS?|TABM|TABD|DSHP|LGEM|SHIP|SHF5|IVCN|RVCN|NNI|OCD5)/.test(model)) {
      selected.push(model);
    }
  }

  const features = selected.slice(0, 18).map((model, index) => {
    const cycle = latestCycleByModel.get(model);
    const pointsByTau = new Map();
    for (const row of rows) {
      if (row.model === model && row.cycle === cycle && !pointsByTau.has(row.tau)) {
        pointsByTau.set(row.tau, row);
      }
    }
    const points = Array.from(pointsByTau.values()).sort((a, b) => a.tau - b.tau);
    const coordinates = [];
    for (const point of points) {
      let longitude = point.lon;
      const previousLongitude = coordinates.at(-1)?.[0];
      if (Number.isFinite(previousLongitude)) {
        while (longitude - previousLongitude > 180) longitude -= 360;
        while (longitude - previousLongitude < -180) longitude += 360;
      }
      coordinates.push([longitude, point.lat]);
    }
    return {
      type: 'Feature',
      properties: {
        model,
        cycle,
        color: MODEL_COLORS[index % MODEL_COLORS.length],
        kind: /^AP\d{2}$/.test(model) ? 'ensemble' : 'model'
      },
      geometry: { type: 'LineString', coordinates }
    };
  }).filter((feature) => feature.geometry.coordinates.length >= 3);

  return { type: 'FeatureCollection', features };
};

const fetchAidDeck = async (stormId) => cacheValue(aidDeckCache, stormId, async () => {
  const response = await fetchWithTimeout(`${ATCF_AID_URL}/a${stormId}.dat.gz`, {
    headers: { Accept: 'application/gzip, application/octet-stream' }
  });
  if (!response.ok) throw new Error(`NHC ATCF aid deck ${response.status}: ${response.statusText}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const text = compressed[0] === 0x1f && compressed[1] === 0x8b
    ? gunzipSync(compressed).toString('utf8')
    : compressed.toString('utf8');
  return buildModelTracks(parseAidDeck(text));
});

const radians = (degrees) => Number(degrees) * Math.PI / 180;

const distanceMiles = (a, b) => {
  if (!Array.isArray(a) || a.length < 2 || !Number.isFinite(Number(b?.longitude)) || !Number.isFinite(Number(b?.latitude))) {
    return Number.POSITIVE_INFINITY;
  }
  const [lon1, lat1] = a.map(Number);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const matchStorm = (warning, storms) => {
  const requestedId = String(warning.tropical?.stormId || '').toLowerCase();
  if (requestedId) {
    const exact = storms.find((storm) => storm.id === requestedId);
    if (exact) return exact;
  }

  const text = [
    warning.title,
    warning.headline,
    warning.description,
    warning.sourceText,
    warning.areaDesc
  ].filter(Boolean).join(' ');
  const named = storms.find((storm) => (
    storm.name &&
    new RegExp(`\\b${storm.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
  ));
  if (named) return named;

  const nearest = storms
    .map((storm) => ({ storm, distance: distanceMiles(warning.center, storm) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance <= 1500 ? nearest.storm : null;
};

const mergeTropicalStats = (warning, storm) => {
  const tropicalStats = [
    storm.intensityMph ? { label: 'Current Wind', value: `${storm.intensityMph} MPH` } : null,
    storm.pressureMb ? { label: 'Pressure', value: `${storm.pressureMb} MB` } : null,
    storm.movementCompass && storm.movementSpeedMph !== null
      ? { label: 'Movement', value: `${storm.movementCompass} ${storm.movementSpeedMph} MPH` }
      : null
  ].filter(Boolean);
  const labels = new Set(tropicalStats.map((stat) => stat.label.toLowerCase()));
  const existing = (warning.hazardStats || []).filter((stat) => (
    !labels.has(String(stat.label || '').toLowerCase()) &&
    !/hail/i.test(String(stat.label || ''))
  ));
  return [...tropicalStats, ...existing].slice(0, 3);
};

export const enrichWarningTropical = async (warning) => {
  if (!isTropicalEvent(warning?.event || warning?.title)) return warning;
  if (warning.tropical?.cone && warning.tropical?.forecastTrack && warning.tropical?.modelTracks) {
    return warning;
  }

  try {
    const storms = await fetchCurrentTropicalStorms();
    const storm = matchStorm(warning, storms);
    if (!storm) {
      return {
        ...warning,
        tropical: {
          ...(warning.tropical || {}),
          source: 'NHC',
          unavailable: true
        }
      };
    }

    const [geometry, modelTracks] = await Promise.all([
      fetchTropicalGeometry(storm),
      fetchAidDeck(storm.id).catch(() => emptyFeatureCollection())
    ]);
    const modelNames = modelTracks.features.map((feature) => feature.properties.model);
    const movement = storm.movementCompass && storm.movementSpeedMph !== null
      ? `${storm.movementCompass} at ${storm.movementSpeedMph} mph`
      : '';
    const tropical = {
      ...storm,
      ...geometry,
      modelTracks,
      modelCount: modelTracks.features.length,
      modelNames,
      movement,
      source: 'NOAA / National Hurricane Center'
    };

    return {
      ...warning,
      tropical,
      hazards: {
        ...(warning.hazards || {}),
        label: String(warning.event || 'Tropical Cyclone').replace(/\s+(Warning|Watch|Local Statement)$/i, ''),
        value: warning.classification?.isWatch ? 'WATCH' : warning.classification?.isWarning ? 'WARNING' : 'ADVISORY',
        subtext: `${storm.classificationLabel} ${storm.name}`.trim(),
        hail: ''
      },
      hazardStats: mergeTropicalStats(warning, storm),
      sourceText: `${storm.classificationLabel} ${storm.name} · NHC ADVISORY ${storm.advisoryNumber || 'CURRENT'}`.toUpperCase()
    };
  } catch (error) {
    console.warn(`Tropical enrichment failed for ${warning?.event || 'alert'}: ${error.message}`);
    return {
      ...warning,
      tropical: {
        ...(warning.tropical || {}),
        source: 'NHC',
        unavailable: true,
        error: error.message
      }
    };
  }
};
