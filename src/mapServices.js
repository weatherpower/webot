import { config } from './config.js';

const geocodeCache = new Map();
const CACHE_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 500;

const US_STATE_CODES = new Map(Object.entries({
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
  'Puerto Rico': 'PR', Guam: 'GU', 'American Samoa': 'AS', 'Northern Mariana Islands': 'MP',
  'U.S. Virgin Islands': 'VI'
}).map(([name, code]) => [name.toUpperCase(), code]));
const US_STATE_NAMES = new Map([...US_STATE_CODES].map(([name, code]) => [code, name]));

const apiError = (message, status = 500, body) => {
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
};

const clean = (value, max = 180) => String(value || '')
  .replace(/[<>]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const stateCodeFor = (value) => {
  const normalized = clean(value, 64).toUpperCase().replace(/^US-/, '');
  if (/^[A-Z]{2}$/.test(normalized) && US_STATE_NAMES.has(normalized)) return normalized;
  return US_STATE_CODES.get(normalized) || '';
};

const parsePlaceQuery = (query) => {
  const text = clean(query);
  const commaMatch = text.match(/^(.*?),\s*([A-Za-z. ]+)$/);
  if (commaMatch) {
    const state = stateCodeFor(commaMatch[2].replace(/\./g, ''));
    if (state && commaMatch[1].trim()) return { search: commaMatch[1].trim(), state };
  }
  const upper = text.toUpperCase();
  const stateMatches = [...US_STATE_CODES.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([name, code]) => ({ name, code }))
    .concat([...US_STATE_NAMES.keys()].map((code) => ({ name: code, code })));
  for (const candidate of stateMatches) {
    if (!upper.endsWith(` ${candidate.name}`)) continue;
    const search = text.slice(0, -(candidate.name.length + 1)).trim().replace(/,$/, '').trim();
    if (search) return { search, state: candidate.code };
  }
  return { search: text, state: '' };
};

const trimCache = () => {
  while (geocodeCache.size > CACHE_LIMIT) geocodeCache.delete(geocodeCache.keys().next().value);
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WeatherPower/1.0 (+https://weatherpower.app)'
    },
    signal: AbortSignal.timeout(config.maps.requestTimeoutMs)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(`Map service request failed (${response.status})`, response.status, body);
  }
  return body;
};

const mapFeature = ({ id, lon, lat, name, label, type = 'place', state = '', country = 'United States' }) => {
  const longitude = Number(lon);
  const latitude = Number(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const text = clean(name || label || 'Location', 120);
  const placeName = clean(label || [text, state, country].filter(Boolean).join(', '), 240);
  const stateCode = clean(state, 8).toUpperCase();
  const context = stateCode
    ? [{ id: `region.wp-${stateCode.toLowerCase()}`, text: stateCode, short_code: `US-${stateCode}` }]
    : [];
  return {
    id: clean(id || `wp.${type}.${longitude},${latitude}`, 180),
    type: 'Feature',
    place_type: [type],
    text,
    place_name: placeName,
    center: [longitude, latitude],
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    context,
    properties: {
      name: text,
      full_address: placeName,
      feature_type: type,
      coordinates: { longitude, latitude },
      region_code: stateCode ? `US-${stateCode}` : '',
      context: stateCode ? { region: { name: stateCode, region_code: `US-${stateCode}` } } : {}
    }
  };
};

const censusAddressSearch = async (query) => {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', query);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const body = await fetchJson(url);
  return (body.result?.addressMatches || []).slice(0, 6).map((match, index) => mapFeature({
    id: `census.address.${index}.${match.coordinates?.x},${match.coordinates?.y}`,
    lon: match.coordinates?.x,
    lat: match.coordinates?.y,
    name: match.addressComponents?.city || match.matchedAddress,
    label: match.matchedAddress,
    type: 'address',
    state: match.addressComponents?.state
  })).filter(Boolean);
};

const openMeteoPlaceSearch = async (query, limit) => {
  if (process.env.NODE_ENV === 'production' && !config.maps.openMeteoProductionReady) {
    throw apiError(
      'Place search requires a production geocoder. Configure OPEN_METEO_GEOCODING_URL and OPEN_METEO_API_KEY for a commercial Open-Meteo customer endpoint, or use a WeatherPower-controlled endpoint.',
      503
    );
  }
  const parsed = parsePlaceQuery(query);
  const url = new URL(config.maps.openMeteoGeocodingUrl);
  url.searchParams.set('name', parsed.search);
  url.searchParams.set('count', String(parsed.state ? 10 : Math.min(10, Math.max(1, limit || 6))));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  if (config.maps.openMeteoApiKey) url.searchParams.set('apikey', config.maps.openMeteoApiKey);
  const body = await fetchJson(url);
  return (body.results || [])
    .filter((item) => String(item.country_code || '').toUpperCase() === 'US')
    .map((item) => ({ item, state: stateCodeFor(item.admin1) }))
    .filter(({ state }) => !parsed.state || state === parsed.state)
    .slice(0, Math.min(10, Math.max(1, limit || 6)))
    .map(({ item, state }) => mapFeature({
      id: `openmeteo.${item.id || `${item.longitude},${item.latitude}`}`,
      lon: item.longitude,
      lat: item.latitude,
      name: item.name,
      label: [item.name, state || item.admin1, item.country].filter(Boolean).join(', '),
      type: item.feature_code === 'PPL' ? 'locality' : 'place',
      state
    })).filter(Boolean);
};

const reverseNwsPoint = async (lon, lat) => {
  const url = new URL(`https://api.weather.gov/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`);
  const body = await fetchJson(url);
  const relative = body.properties?.relativeLocation?.properties || {};
  const city = clean(relative.city || 'Selected location');
  const state = clean(relative.state || '').toUpperCase();
  return mapFeature({
    id: `nws.point.${Number(lon).toFixed(4)},${Number(lat).toFixed(4)}`,
    lon,
    lat,
    name: city,
    label: [city, state].filter(Boolean).join(', '),
    type: 'place',
    state
  });
};

const parseGeocodeRequest = (query = {}) => {
  const legacyPath = clean(query.legacyPath, 400);
  const v6Reverse = /\/search\/geocode\/v6\/reverse/i.test(legacyPath);
  if (v6Reverse) {
    return { reverse: true, lon: Number(query.longitude), lat: Number(query.latitude) };
  }

  const pathTail = legacyPath.split('/').filter(Boolean).pop() || '';
  const decodedTail = decodeURIComponent(pathTail.replace(/\.json$/i, ''));
  const coordinateMatch = decodedTail.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (coordinateMatch) {
    return { reverse: true, lon: Number(coordinateMatch[1]), lat: Number(coordinateMatch[2]) };
  }

  return {
    reverse: false,
    text: clean(query.q || decodedTail),
    limit: Math.min(10, Math.max(1, Number(query.limit || 6)))
  };
};

export const geocodeMapRequest = async (query = {}) => {
  const request = parseGeocodeRequest(query);
  const cacheKey = JSON.stringify(request);
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.body, cached: true };

  let features = [];
  if (request.reverse) {
    if (!Number.isFinite(request.lon) || !Number.isFinite(request.lat)) {
      throw apiError('Valid longitude and latitude are required', 400);
    }
    const feature = await reverseNwsPoint(request.lon, request.lat).catch(() => mapFeature({
      lon: request.lon,
      lat: request.lat,
      name: `${request.lat.toFixed(4)}, ${request.lon.toFixed(4)}`,
      label: `${request.lat.toFixed(4)}, ${request.lon.toFixed(4)}`,
      type: 'coordinate',
      country: ''
    }));
    if (feature) features = [feature];
  } else {
    if (request.text.length < 2) throw apiError('Enter a city, ZIP code, or U.S. address', 400);
    if (/\d/.test(request.text)) {
      features = await censusAddressSearch(request.text).catch(() => []);
    }
    if (!features.length) features = await openMeteoPlaceSearch(request.text, request.limit);
  }

  const body = {
    type: 'FeatureCollection',
    features,
    attribution: 'WeatherPower search · U.S. Census Bureau · Open-Meteo · National Weather Service',
    cached: false
  };
  geocodeCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, body });
  trimCache();
  return body;
};

const instructionForStep = (step = {}) => {
  const maneuver = step.maneuver || {};
  const type = clean(maneuver.type || 'continue').replace(/_/g, ' ');
  const modifier = clean(maneuver.modifier || '');
  const road = clean(step.name || '');
  let lead = 'Continue';
  if (type === 'depart') lead = 'Start';
  else if (type === 'arrive') lead = 'Arrive';
  else if (type.includes('roundabout') || type === 'rotary') lead = 'Enter the roundabout';
  else if (type === 'turn') lead = `Turn${modifier ? ` ${modifier}` : ''}`;
  else if (type === 'fork') lead = `Keep${modifier ? ` ${modifier}` : ''}`;
  else if (type === 'merge') lead = `Merge${modifier ? ` ${modifier}` : ''}`;
  else if (type === 'on ramp') lead = `Take the ramp${modifier ? ` ${modifier}` : ''}`;
  else if (type === 'off ramp') lead = `Take the exit${modifier ? ` ${modifier}` : ''}`;
  else if (modifier) lead = `Continue ${modifier}`;
  return road && type !== 'arrive' ? `${lead} onto ${road}` : lead;
};

const adaptOsrm = (body) => {
  for (const route of body.routes || []) {
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        step.maneuver ||= {};
        step.maneuver.instruction ||= instructionForStep(step);
        step.voiceInstructions ||= [{
          distanceAlongGeometry: Number(step.distance || 0),
          announcement: step.maneuver.instruction,
          ssmlAnnouncement: step.maneuver.instruction
        }];
      }
    }
  }
  return body;
};

const parseRouteRequest = (query = {}) => {
  const legacyPath = clean(query.legacyPath, 2000);
  const marker = '/directions/v5/mapbox/';
  const tail = legacyPath.includes(marker) ? legacyPath.split(marker)[1] : '';
  const slash = tail.indexOf('/');
  const requestedProfile = clean(slash >= 0 ? tail.slice(0, slash) : query.profile || 'driving', 40);
  const coordinates = clean(slash >= 0 ? tail.slice(slash + 1) : query.coordinates, 1800);
  return { requestedProfile, coordinates };
};

export const routeMapRequest = async (query = {}) => {
  if (!config.maps.routingBaseUrl || config.maps.routingProvider !== 'osrm') {
    throw apiError(
      'Route Weather is awaiting a configured production router. Set WP_OSRM_BASE_URL to a WeatherPower-controlled OSRM-compatible service.',
      503
    );
  }
  const { requestedProfile, coordinates } = parseRouteRequest(query);
  if (!/^(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)(;(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?))+$/i.test(coordinates)) {
    throw apiError('At least two valid route coordinates are required', 400);
  }
  const profile = ['driving', 'driving-traffic'].includes(requestedProfile) ? 'driving' : requestedProfile;
  const url = new URL(`${config.maps.routingBaseUrl}/route/v1/${encodeURIComponent(profile)}/${coordinates}`);
  url.searchParams.set('steps', query.steps || 'true');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', query.overview || 'full');
  if (query.alternatives) url.searchParams.set('alternatives', query.alternatives);
  const body = adaptOsrm(await fetchJson(url));
  body.wpRequestedProfile = requestedProfile;
  body.wpRoutingProvider = config.maps.routingProvider;
  return body;
};

export const publicMapConfig = () => ({
  renderer: 'MapLibre GL JS',
  styleUrl: config.maps.styleUrl,
  satelliteStyleUrl: config.maps.satelliteStyleUrl,
  geocodingProvider: config.maps.geocodingProvider,
  routing: {
    configured: Boolean(config.maps.routingBaseUrl),
    provider: config.maps.routingProvider || 'not configured'
  }
});

