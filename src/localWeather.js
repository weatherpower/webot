const NWS_HEADERS = {
  Accept: 'application/geo+json',
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};
const IEM_HEADERS = {
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const numberOrNull = (value) => {
  // A missing NWS reading (null) must stay missing, not become 0.
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits = 0) => {
  const number = numberOrNull(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
};

const cToF = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : round((number * 9 / 5) + 32);
};

// NWS observations report wind in km/h (wmoUnit:km_h-1); some stations use m/s.
const speedToMph = (property) => {
  const number = numberOrNull(property?.value);
  if (number === null) return null;
  return round(number * (/m_s-1$/.test(property.unitCode || '') ? 2.236936 : 0.621371));
};

const paToInHg = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : round(number * 0.000295299830714, 2);
};

const mToMi = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : round(number * 0.000621371, 1);
};

const compactText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const fetchJson = async (url, headers = NWS_HEADERS) => {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${url} ${response.status}: ${body.detail || body.title || response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
};

const nwsValue = (property) => property?.value ?? null;

const simplifyAlert = (feature) => {
  const properties = feature.properties || {};
  return {
    id: feature.id || properties.id || properties['@id'],
    event: properties.event,
    headline: properties.headline,
    severity: properties.severity,
    urgency: properties.urgency,
    certainty: properties.certainty,
    areaDesc: properties.areaDesc,
    sent: properties.sent,
    expires: properties.expires || properties.ends,
    instruction: compactText(properties.instruction || '').slice(0, 260)
  };
};

const simplifyForecastPeriod = (period) => ({
  number: period.number,
  name: period.name,
  startTime: period.startTime,
  endTime: period.endTime,
  temperature: period.temperature,
  temperatureUnit: period.temperatureUnit,
  probabilityOfPrecipitation: nwsValue(period.probabilityOfPrecipitation),
  windSpeed: period.windSpeed,
  windDirection: period.windDirection,
  shortForecast: period.shortForecast,
  detailedForecast: period.detailedForecast
});

const REPORT_TYPES = {
  T: 'Tornado', G: 'Wind', H: 'Hail', R: 'Rain', F: 'Flood', D: 'Damage',
  E: 'Flood', M: 'Marine Wind', N: 'Wind', O: 'Damage', C: 'Funnel Cloud', W: 'Waterspout', S: 'Snow', L: 'Lightning'
};

// IEM LSR one-letter codes; anything unlisted falls back to IEM's own type text.
const reportType = (type = '', typetext = '') => {
  const upper = String(type || '').toUpperCase();
  if (REPORT_TYPES[upper]) return REPORT_TYPES[upper];
  const text = String(typetext || '').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return text || upper || 'Report';
};

const formatIemTime = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
};

export const fetchLocalWeather = async ({ lat = 33.8957, lon = -94.8263 } = {}) => {
  const latitude = clamp(Number(lat), -90, 90);
  const longitude = clamp(Number(lon), -180, 180);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const error = new Error('lat and lon must be valid numbers');
    error.status = 400;
    throw error;
  }

  const point = await fetchJson(`https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  const pointProps = point.properties || {};
  const [forecast, hourly, stations, alerts] = await Promise.all([
    fetchJson(pointProps.forecast),
    fetchJson(pointProps.forecastHourly),
    fetchJson(pointProps.observationStations),
    fetchJson(`https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`)
  ]);

  const stationFeature = stations.features?.[0] || null;
  const stationUrl = stationFeature?.id || stationFeature?.properties?.['@id'];
  const observation = stationUrl
    ? await fetchJson(`${stationUrl}/observations/latest`)
    : null;
  const obsProps = observation?.properties || {};

  return {
    updated: new Date().toISOString(),
    point: {
      lat: latitude,
      lon: longitude,
      gridId: pointProps.gridId,
      gridX: pointProps.gridX,
      gridY: pointProps.gridY,
      city: pointProps.relativeLocation?.properties?.city || '',
      state: pointProps.relativeLocation?.properties?.state || '',
      forecastOffice: pointProps.forecastOffice || '',
      radarStation: pointProps.radarStation || '',
      timeZone: pointProps.timeZone || 'America/Chicago'
    },
    station: stationFeature ? {
      id: stationFeature.properties?.stationIdentifier || stationFeature.id?.split('/').pop(),
      name: stationFeature.properties?.name || '',
      distance: stationFeature.properties?.distance?.value || null
    } : null,
    current: observation ? {
      timestamp: obsProps.timestamp,
      textDescription: obsProps.textDescription || '',
      temperatureF: cToF(nwsValue(obsProps.temperature)),
      heatIndexF: cToF(nwsValue(obsProps.heatIndex)),
      windChillF: cToF(nwsValue(obsProps.windChill)),
      dewpointF: cToF(nwsValue(obsProps.dewpoint)),
      humidityPct: round(nwsValue(obsProps.relativeHumidity)),
      windMph: speedToMph(obsProps.windSpeed),
      windGustMph: speedToMph(obsProps.windGust),
      windDirection: nwsValue(obsProps.windDirection),
      pressureInHg: paToInHg(nwsValue(obsProps.barometricPressure)),
      visibilityMi: mToMi(nwsValue(obsProps.visibility))
    } : null,
    daily: (forecast.properties?.periods || []).slice(0, 8).map(simplifyForecastPeriod),
    hourly: (hourly.properties?.periods || []).slice(0, 18).map(simplifyForecastPeriod),
    alerts: (alerts.features || []).map(simplifyAlert)
  };
};

export const fetchStormReports = async ({ hours = 12, limit = 80 } = {}) => {
  const safeHours = clamp(Number(hours) || 12, 1, 48);
  const safeLimit = clamp(Number(limit) || 80, 1, 250);
  const end = new Date();
  const start = new Date(end.getTime() - safeHours * 60 * 60 * 1000);
  const url = new URL('https://mesonet.agron.iastate.edu/geojson/lsr.php');
  url.searchParams.set('sts', formatIemTime(start));
  url.searchParams.set('ets', formatIemTime(end));

  const body = await fetchJson(url, IEM_HEADERS);
  const reports = (body.features || [])
    .slice(0, safeLimit)
    .map((feature) => {
      const properties = feature.properties || {};
      return {
        id: feature.id,
        type: reportType(properties.type, properties.typetext),
        rawType: properties.type || '',
        magnitude: properties.magnitude || properties.magf || '',
        city: properties.city || '',
        county: properties.county || '',
        state: properties.state || '',
        wfo: properties.wfo || '',
        time: properties.valid || properties.utcvalid || '',
        remark: compactText(properties.remark || properties.typetext || properties.typetext || ''),
        geometry: feature.geometry || null
      };
    });

  return {
    updated: new Date().toISOString(),
    hours: safeHours,
    count: reports.length,
    reports
  };
};
