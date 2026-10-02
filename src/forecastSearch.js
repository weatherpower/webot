import { config } from './config.js';
import { fetchDailyForecastCardsForPoint } from './dailyForecasts.js';
import { geocodeMapRequest } from './mapServices.js';
import { publicWarningCenterFeed } from './publicFeed.js';
import { renderWarningCards } from './renderCard.js';

const resultCache = new Map();
const inFlight = new Map();
const requestBuckets = new Map();

const trimCache = (cache, limit = 100) => {
  while (cache.size > limit) cache.delete(cache.keys().next().value);
};

const apiError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const normalizedQuery = (value) => String(value || '')
  .replace(/[;<>]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);

const geographicFeature = (feature = {}) => {
  const coordinates = feature.geometry?.coordinates || feature.properties?.coordinates;
  const lon = Number(Array.isArray(coordinates) ? coordinates[0] : coordinates?.longitude);
  const lat = Number(Array.isArray(coordinates) ? coordinates[1] : coordinates?.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const contexts = [
    ...(Array.isArray(feature.context) ? feature.context : []),
    ...Object.values(feature.properties?.context || {})
  ];
  const regionCode = [feature.properties?.context?.region?.region_code, feature.properties?.region_code]
    .concat(contexts.map((context) => context?.region_code || context?.properties?.short_code || context?.short_code))
    .map((value) => String(value || '').toUpperCase())
    .find((value) => /(?:US-)?[A-Z]{2}$/.test(value));
  const state = regionCode ? regionCode.slice(-2) : '';
  const label = String(feature.properties?.full_address || feature.place_name || feature.name || '').trim();
  const city = String(feature.properties?.name || feature.text || label.split(',')[0] || '').trim();
  return { lon, lat, city, state, label: label || city };
};

const geocodeLocation = async (query) => {
  const body = await geocodeMapRequest({
    q: query,
    limit: 1,
    legacyPath: '/search/geocode/v6/forward'
  });
  const location = geographicFeature(body.features?.[0]);
  if (!location) throw apiError('No U.S. city or ZIP code matched that search', 404);
  return location;
};

const limitRequests = (clientKey) => {
  const now = Date.now();
  const key = String(clientKey || 'public').slice(0, 180);
  const windowStart = now - config.forecastSearch.rateWindowMs;
  const timestamps = (requestBuckets.get(key) || []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= config.forecastSearch.maxRequestsPerWindow) {
    const retrySeconds = Math.max(1, Math.ceil((timestamps[0] + config.forecastSearch.rateWindowMs - now) / 1000));
    const error = apiError(`Forecast card limit reached. Try again in about ${Math.ceil(retrySeconds / 60)} minutes.`, 429);
    error.retryAfterSeconds = retrySeconds;
    throw error;
  }
  timestamps.push(now);
  requestBuckets.set(key, timestamps);
  trimCache(requestBuckets, 3000);
};

const publicForecastItem = (render) => {
  const warning = render.warning;
  return {
    key: warning.key || warning.nwsId,
    status: 'rendered',
    renderedAt: new Date().toISOString(),
    title: warning.title,
    event: warning.event,
    state: warning.state,
    areaDesc: warning.areaDesc,
    office: warning.office,
    expiresAt: warning.expiresAt,
    issuedAt: warning.issuedAt,
    timezone: warning.timezone,
    theme: warning.theme,
    classification: warning.classification,
    hazardStats: warning.hazardStats,
    cardLayout: warning.cardLayout,
    forecast: warning.forecast,
    geometry: warning.geometry,
    polygon: warning.polygon,
    center: warning.center,
    radar: warning.radar,
    nwsId: warning.nwsId,
    card: {
      filename: render.filename,
      path: render.publicPath,
      bytes: render.bytes,
      contentType: render.contentType
    },
    detailUrl: render.publicPath,
    searchResult: true
  };
};

const renderForecastSearch = async ({ query, clientKey }) => {
  const location = await geocodeLocation(query);
  const cacheKey = `${location.lat.toFixed(3)},${location.lon.toFixed(3)}:${config.forecast.days}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.payload, cached: true };
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  limitRequests(clientKey);
  const task = (async () => {
    const forecast = await fetchDailyForecastCardsForPoint({
      lat: location.lat,
      lon: location.lon,
      city: location.city,
      state: location.state,
      days: config.forecast.days
    });
    const renders = await renderWarningCards(forecast.warnings, { priority: 'foreground' });
    const items = renders.map(publicForecastItem);
    const payload = {
      ok: true,
      cached: false,
      generatedAt: new Date().toISOString(),
      location: {
        label: forecast.warnings[0]?.forecast?.location || location.label,
        center: [location.lon, location.lat]
      },
      source: 'National Weather Service forecast',
      items: publicWarningCenterFeed({ items }).items
    };
    resultCache.set(cacheKey, {
      expiresAt: Date.now() + config.forecastSearch.cacheMs,
      payload
    });
    trimCache(resultCache);
    return payload;
  })().finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, task);
  return task;
};

export const generateForecastSearchCards = async ({ query, clientKey } = {}) => {
  if (!config.forecastSearch.enabled) throw apiError('Public forecast card search is unavailable', 503);
  const cleanQuery = normalizedQuery(query);
  if (cleanQuery.length < 2) throw apiError('Enter a city and state or a U.S. ZIP code', 400);
  return renderForecastSearch({ query: cleanQuery, clientKey });
};

export const forecastSearchQuery = normalizedQuery;
