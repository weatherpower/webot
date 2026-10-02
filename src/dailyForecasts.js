import { config } from './config.js';
import { normalizeWarning } from './warning.js';

const NWS_HEADERS = {
  Accept: 'application/geo+json',
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

let cachedForecast = null;
let cachedAt = 0;
let loadingForecast = null;

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: NWS_HEADERS });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${url} ${response.status}: ${body.detail || body.title || response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const zonedDateKey = (value, timezone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date(value));

const localDateLabel = (value, timezone) => new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  weekday: 'long',
  month: 'short',
  day: 'numeric'
}).format(new Date(value));

const selectDailyPeriods = (periods, timezone, maxDays) => {
  const byDate = new Map();
  for (const period of periods || []) {
    if (!period?.startTime || !period?.endTime) continue;
    const date = zonedDateKey(period.startTime, timezone);
    const existing = byDate.get(date);
    if (!existing || (period.isDaytime && !existing.isDaytime)) byDate.set(date, period);
  }
  return Array.from(byDate.values()).slice(0, maxDays);
};

const nearbyNightPeriod = (periods, target) => {
  const targetStart = Date.parse(target?.startTime || '');
  if (!Number.isFinite(targetStart)) return null;
  return (periods || []).find((period) => (
    period && !period.isDaytime && Date.parse(period.startTime || '') >= targetStart
  )) || null;
};

const forecastBox = ([lon, lat]) => {
  const longitudeSpan = 0.28;
  const latitudeSpan = 0.20;
  return [
    [lon - longitudeSpan, lat - latitudeSpan],
    [lon + longitudeSpan, lat - latitudeSpan],
    [lon + longitudeSpan, lat + latitudeSpan],
    [lon - longitudeSpan, lat + latitudeSpan],
    [lon - longitudeSpan, lat - latitudeSpan]
  ];
};

const windLabel = (period = {}) => [period.windDirection, period.windSpeed].filter(Boolean).join(' ') || 'Light and variable';

const forecastCardForPeriod = ({ period, night, point, updated }) => {
  const timezone = point.timeZone || 'America/Chicago';
  const high = period.isDaytime ? period.temperature : night?.temperature;
  const low = period.isDaytime ? night?.temperature : period.temperature;
  const temperatureUnit = period.temperatureUnit || night?.temperatureUnit || 'F';
  const location = [point.city || 'Idabel', point.state || 'OK'].filter(Boolean).join(', ');
  const startDate = zonedDateKey(period.startTime, timezone);
  const precipitation = numberOrNull(period.probabilityOfPrecipitation?.value);
  const expiresAt = period.endTime || new Date(Date.parse(period.startTime) + 24 * 60 * 60 * 1000).toISOString();
  const center = [point.lon, point.lat];
  const polygon = forecastBox(center);
  const shortForecast = String(period.shortForecast || 'Forecast').trim();

  return normalizeWarning({
    key: `daily-forecast:${point.lat.toFixed(4)},${point.lon.toFixed(4)}:${startDate}`,
    nwsId: `daily-forecast:${startDate}`,
    cardLayout: 'forecast',
    title: `${location} Forecast - ${localDateLabel(period.startTime, timezone)}`,
    event: 'Daily Forecast',
    state: point.state || 'OK',
    areaDesc: location,
    office: point.forecastOffice || 'NWS',
    issuedAt: updated || period.startTime,
    expiresAt,
    timezone,
    center,
    polygon,
    geometry: { type: 'Polygon', coordinates: [polygon] },
    locations: [location],
    hazards: {
      label: 'Forecast',
      value: shortForecast,
      subtext: period.isDaytime ? 'Daytime period' : 'Nighttime period',
      hail: '',
      wind: windLabel(period)
    },
    hazardStats: [
      high === null || high === undefined ? null : { label: 'High', value: `${high} F` },
      low === null || low === undefined ? null : { label: 'Low', value: `${low} F` },
      precipitation === null ? null : { label: 'Rain', value: `${precipitation}%` }
    ].filter(Boolean),
    impactLine: `NWS FORECAST - ${location.toUpperCase()}`,
    sourceText: shortForecast,
    whatToDo: String(period.detailedForecast || shortForecast).replace(/\s+/g, ' ').trim().slice(0, 300),
    radar: { mode: 'reflectivity' },
    forecast: {
      location,
      dayLabel: localDateLabel(period.startTime, timezone),
      periodName: period.name || localDateLabel(period.startTime, timezone),
      isDaytime: Boolean(period.isDaytime),
      high,
      low,
      temperature: period.temperature,
      temperatureUnit,
      precipitation,
      wind: windLabel(period),
      shortForecast,
      detailedForecast: String(period.detailedForecast || shortForecast).replace(/\s+/g, ' ').trim(),
      sourceUpdatedAt: updated || null
    },
    postText: `${location} daily forecast: ${shortForecast}.`
  });
};

const coordinate = (value, min, max, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Forecast card ${label} must be a valid number`);
  return clamp(parsed, min, max);
};

const fetchDailyForecastCardsUncached = async ({
  lat: requestedLat = config.forecast.lat,
  lon: requestedLon = config.forecast.lon,
  city = config.forecast.city,
  state = config.forecast.state,
  days = config.forecast.days
} = {}) => {
  const lat = coordinate(requestedLat, -90, 90, 'latitude');
  const lon = coordinate(requestedLon, -180, 180, 'longitude');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Forecast card latitude and longitude must be valid numbers');
  }

  const point = await fetchJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const pointProperties = point.properties || {};
  const forecast = await fetchJson(pointProperties.forecast);
  const timezone = pointProperties.timeZone || 'America/Chicago';
  const pointInfo = {
    lat,
    lon,
    city: city || pointProperties.relativeLocation?.properties?.city || config.forecast.city,
    state: state || pointProperties.relativeLocation?.properties?.state || config.forecast.state,
    forecastOffice: pointProperties.forecastOffice || '',
    timeZone: timezone
  };
  const periods = forecast.properties?.periods || [];
  const dailyPeriods = selectDailyPeriods(periods, timezone, Math.round(clamp(Number(days) || config.forecast.days, 1, 7)));

  return {
    updated: forecast.properties?.updated || new Date().toISOString(),
    source: forecast.properties?.generator || pointProperties.forecast || 'api.weather.gov',
    warnings: dailyPeriods.map((period) => forecastCardForPeriod({
      period,
      night: nearbyNightPeriod(periods, period),
      point: pointInfo,
      updated: forecast.properties?.updated
    }))
  };
};

export const fetchDailyForecastCardsForPoint = async (options = {}) => fetchDailyForecastCardsUncached(options);

export const fetchDailyForecastCards = async ({ force = false } = {}) => {
  const fresh = cachedForecast && Date.now() - cachedAt < config.forecast.cacheMs;
  if (!force && fresh) return cachedForecast;
  if (loadingForecast) return loadingForecast;

  loadingForecast = fetchDailyForecastCardsUncached()
    .then((result) => {
      cachedForecast = result;
      cachedAt = Date.now();
      return result;
    })
    .finally(() => {
      loadingForecast = null;
    });
  return loadingForecast;
};
