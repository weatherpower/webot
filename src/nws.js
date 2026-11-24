import { centroid, normalizeWarning } from './warning.js';
import { classifyAlert, defaultRadarModeForEvent } from './themes.js';
import { enrichConvectiveWatch } from './spcWatch.js';

const NWS_ACTIVE_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const TARGET_ALERT_RE = /\b(warning|watch|special weather statement|tropical cyclone local statement|hurricane local statement)\b/i;
const NON_WEATHER_ALERT_RE = /\b(civil emergency message|civil danger warning|law enforcement warning|shelter in place warning|hazardous materials warning|nuclear power plant warning|radiological hazard warning|911 telephone outage emergency|blue alert|amber alert|child abduction emergency)\b/i;
const NWS_HEADERS = {
  Accept: 'application/geo+json',
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};
const DEFAULT_AREA_POLYGON = [
  [-125, 24],
  [-125, 49],
  [-66, 49],
  [-66, 24],
  [-125, 24]
];
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
]);
const zoneGeometryCache = new Map();

const formatStateList = (states) => {
  const unique = Array.from(new Set(states)).filter(Boolean);
  if (!unique.length) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} AND ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, AND ${unique.at(-1)}`;
};

const firstParam = (parameters, key) => {
  const value = parameters?.[key];
  return Array.isArray(value) ? value[0] : value;
};

const clipText = (value = '', max = 260) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
};

const titleCaseState = (areaDesc = '') => {
  const state = String(areaDesc).split(',').pop()?.trim();
  return state || 'Your Area';
};

const statesFromAreaDesc = (areaDesc = '') => {
  const states = [];
  const pattern = /,\s*([A-Z]{2})(?=;|$)/g;
  let match;
  while ((match = pattern.exec(String(areaDesc)))) {
    states.push(match[1]);
  }
  const text = String(areaDesc);
  const codePattern = /\b[A-Z]{2}\b/g;
  let codeMatch;
  while ((codeMatch = codePattern.exec(text))) {
    const code = codeMatch[0];
    const preceding = text.slice(0, codeMatch.index).trimEnd().at(-1) || '';
    if (code === 'NM' && /\d/.test(preceding)) continue;
    if (US_STATE_CODES.has(code)) states.push(code);
  }
  return Array.from(new Set(states));
};

const statesFromGeocode = (geocode = {}) => Array.from(new Set(
  (geocode.UGC || [])
    .map((code) => String(code || '').match(/^([A-Z]{2})/)?.[1])
    .filter((code) => US_STATE_CODES.has(code))
));

const extractPolygon = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] || null;
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates || [];
    const largest = polygons
      .map((polygon) => polygon?.[0] || [])
      .sort((a, b) => b.length - a.length)[0];
    return largest || null;
  }
  return null;
};

const pointsFromGeometry = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates || []).flat();
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).flat(2);
  }
  return [];
};

const polygonsFromGeometry = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
};

const boundsPolygonForPoints = (points) => {
  const valid = points.filter((point) => (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1]))
  )).map(([lon, lat]) => [Number(lon), Number(lat)]);

  if (!valid.length) return null;

  const lons = valid.map(([lon]) => lon);
  const lats = valid.map(([, lat]) => lat);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);

  if (minLon === maxLon) {
    minLon -= 0.25;
    maxLon += 0.25;
  }
  if (minLat === maxLat) {
    minLat -= 0.25;
    maxLat += 0.25;
  }

  return [
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, maxLat],
    [maxLon, minLat],
    [minLon, minLat]
  ];
};

const mapLimit = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
};

const isFeatureActive = (feature, now = Date.now()) => {
  const properties = feature.properties || {};
  const expires = Date.parse(properties.expires || properties.ends || '');
  return !Number.isFinite(expires) || expires > now;
};

const isTargetAlertEvent = (event = '') => {
  const text = String(event || '');
  return TARGET_ALERT_RE.test(text) && !NON_WEATHER_ALERT_RE.test(text);
};

const fetchZoneGeometry = async (zoneUrl) => {
  if (!zoneUrl) return [];
  if (!zoneGeometryCache.has(zoneUrl)) {
    zoneGeometryCache.set(zoneUrl, (async () => {
      const response = await fetch(zoneUrl, { headers: NWS_HEADERS, signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return null;
      return body.geometry || null;
    })());
  }
  try {
    const geometry = await zoneGeometryCache.get(zoneUrl);
    if (!geometry) zoneGeometryCache.delete(zoneUrl);
    return geometry;
  } catch (error) {
    zoneGeometryCache.delete(zoneUrl);
    throw error;
  }
};

const hydrateFeatureGeometry = async (feature) => {
  const zones = feature.properties?.affectedZones || [];
  const shouldUseZoneGeometry = zones.length && /\bwatch\b/i.test(feature.properties?.event || '');
  if (feature.geometry && !shouldUseZoneGeometry) return feature;

  const geometries = await mapLimit(zones, 6, async (zoneUrl) => {
    try {
      return await fetchZoneGeometry(zoneUrl);
    } catch {
      return null;
    }
  });
  const polygons = geometries.flatMap(polygonsFromGeometry);
  if (polygons.length && geometries.every((geometry) => polygonsFromGeometry(geometry).length > 0)) {
    return {
      ...feature,
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: {
        ...(feature.properties || {}),
        weatherPowerGeometrySource: 'affectedZones'
      }
    };
  }

  if (feature.geometry) return feature;

  return {
    ...feature,
    geometry: null,
    properties: {
      ...(feature.properties || {}),
      weatherPowerGeometrySource: 'unavailable'
    }
  };
};

const extractLine = (description = '', label) => {
  const pattern = new RegExp(`${label}\\\\.\\\\.\\\\.([^\\\\n]+(?:\\\\n(?![A-Z ]+\\\\.\\\\.\\\\.).+)*)`, 'i');
  const match = String(description).match(pattern);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
};

const parseStormMotion = (parameters = {}) => {
  const motion = firstParam(parameters, 'stormMotion') || firstParam(parameters, 'eventMotionDescription');
  if (!motion) return '';
  const text = String(motion).replace(/\s+/g, ' ').trim();
  const kt = text.match(/(\d{1,3})\s*(?:KT|KTS)\b/i);
  if (kt) return `${kt[1]} kt`;
  const mph = text.match(/(\d{1,3})\s*MPH\b/i);
  if (mph) return `${mph[1]} mph`;
  return text;
};

const parseWind = (description = '', parameters = {}) => {
  const param = firstParam(parameters, 'maxWindGust');
  if (param) {
    const text = String(param).trim();
    const mph = text.match(/(\d{2,3})/);
    if (mph) return `${mph[1]} MPH`;
  }

  const desc = String(description || '');
  const match = desc.match(/(?:wind gusts? (?:up to |of )?|winds? (?:up to |of )?)(\d{2,3})\s*MPH/i) ||
    desc.match(/(\d{2,3})\s*MPH\s*(?:wind|gust)/i);
  return match ? `${match[1]} MPH` : '';
};

const parseHail = (description = '', parameters = {}) => {
  const param = firstParam(parameters, 'maxHailSize');
  if (param && !Number.isNaN(Number(param))) {
    return `${Number(param).toFixed(2).replace(/\.00$/, '')} IN`;
  }

  const desc = String(description || '');
  const match = desc.match(/(\d+(?:\.\d+)?)\s*(?:INCH|INCHES|IN\.?)\s*(?:HAIL|DIAMETER)?/i);
  if (match) return `${Number(match[1]).toFixed(2).replace(/\.00$/, '')} IN`;
  if (/quarter size hail/i.test(desc)) return '1.00 IN';
  if (/golf ball size hail/i.test(desc)) return '1.75 IN';
  if (/baseball size hail/i.test(desc)) return '2.75 IN';
  return '';
};

const safetyTextForEvent = (event = '', classification = {}) => {
  const lower = String(event).toLowerCase();
  if (lower.includes('storm surge')) {
    return lower.includes('watch')
      ? 'Know your evacuation zone and be ready to leave low-lying coastal areas if officials issue an order.'
      : 'Move away from the coast and low-lying areas if ordered. Never enter flood water or drive around barricades.';
  }
  if (lower.includes('hurricane') || lower.includes('typhoon')) {
    return lower.includes('watch')
      ? 'Finish preparations, know your evacuation zone, charge devices, and be ready to act if a warning is issued.'
      : 'Complete preparations now. Shelter away from windows and follow evacuation instructions from local officials.';
  }
  if (lower.includes('tropical storm')) {
    return lower.includes('watch')
      ? 'Secure loose outdoor items, review your plan, and be ready for damaging wind, flooding, and power outages.'
      : 'Stay indoors away from windows. Prepare for damaging wind, flooding, and power outages.';
  }
  if (lower.includes('extreme wind')) {
    return 'Take shelter now in a sturdy interior room away from windows. Treat this like a tornado warning.';
  }
  if (lower.includes('tropical cyclone') || lower.includes('post-tropical cyclone')) {
    return 'Review the latest official forecast, finish preparations, and follow instructions from local officials.';
  }
  if (lower.includes('watch')) {
    return 'Stay weather aware and be ready to act quickly if warnings are issued.';
  }
  if (classification.isEmergency && lower.includes('tornado')) {
    return 'TORNADO EMERGENCY. Take cover now in a basement or interior room on the lowest floor. Protect your head.';
  }
  if (classification.isEmergency && lower.includes('flood')) {
    return 'FLOOD EMERGENCY. Move to higher ground now. Never drive through flooded roads.';
  }
  if (lower.includes('special weather statement')) {
    return 'This is not a warning, but conditions may still be hazardous. Stay weather aware and take it seriously.';
  }
  if (lower.includes('tornado')) {
    return 'Take cover now. Move to a basement or interior room on the lowest floor and stay away from windows.';
  }
  if (lower.includes('severe thunderstorm')) {
    return 'Seek shelter inside a sturdy building. Stay away from windows and prepare for damaging wind or large hail.';
  }
  if (lower.includes('flood')) {
    return 'Move to higher ground. Do not walk or drive through flood water.';
  }
  if (lower.includes('winter') || lower.includes('blizzard') || lower.includes('ice')) {
    return 'Avoid travel if possible. Keep emergency supplies nearby and follow local road guidance.';
  }
  if (lower.includes('fire') || lower.includes('red flag')) {
    return 'Avoid outdoor burning and follow local evacuation or fire-weather instructions.';
  }
  if (lower.includes('watch')) {
    return 'Stay weather aware and be ready to act if warnings are issued.';
  }
  return 'Follow instructions from local officials and stay weather aware.';
};

const extractLocations = (description = '', areaDesc = '') => {
  const near = String(description).match(/(?:will be near|will impact|locations impacted include)\.\.\.([\s\S]*?)(?:\n\n|$)/i)?.[1];
  const raw = near || areaDesc;
  return raw
    .replace(/\baround\s+\d+.*$/i, '')
    .replace(/\band\b/g, ',')
    .split(/[;,]/)
    .map((value) => value.replace(/\s+/g, ' ').trim().replace(/\.$/, ''))
    .filter(Boolean)
    .slice(0, 6);
};

const hazardForAlert = (properties) => {
  const parameters = properties.parameters || {};
  const event = properties.event || 'Warning';
  const lower = event.toLowerCase();
  const productType = lower.includes('watch') ? 'Watch' : lower.includes('warning') ? 'Warning' : 'Advisory';
  const canShowHail = lower.includes('severe thunderstorm');
  const canShowWind = lower.includes('severe thunderstorm') ||
    lower.includes('marine') ||
    lower.includes('wind') ||
    lower.includes('hurricane') ||
    lower.includes('tropical storm') ||
    lower.includes('typhoon');
  const hail = !lower.includes('watch') && canShowHail ? parseHail(properties.description, parameters) : '';
  const wind = !lower.includes('watch') && canShowWind ? parseWind(properties.description, parameters) : '';
  const tornadoDetection = firstParam(parameters, 'tornadoDetection');
  const damageThreat = firstParam(parameters, 'thunderstormDamageThreat') || firstParam(parameters, 'flashFloodDamageThreat');
  const source = extractLine(properties.description, 'SOURCE') || tornadoDetection || damageThreat || properties.senderName;

  if (lower.includes('tornado')) {
    return {
      label: 'Tornado',
      value: tornadoDetection || productType,
      subtext: lower.includes('watch') ? 'Stay weather aware' : 'Take shelter now',
      source,
      hail: '',
      wind: ''
    };
  }

  if (lower.includes('severe thunderstorm')) {
    return {
      label: 'Wind / Hail',
      value: wind || (hail ? `${hail} hail` : productType),
      subtext: damageThreat || (lower.includes('watch') ? 'Conditions are favorable' : 'Damaging storm warning'),
      source,
      hail,
      wind
    };
  }

  if (lower.includes('storm surge')) {
    return {
      label: 'Storm Surge',
      value: productType,
      subtext: lower.includes('watch') ? 'Coastal flooding possible' : 'Life-threatening inundation',
      source,
      hail: '',
      wind: ''
    };
  }

  if (lower.includes('hurricane') || lower.includes('typhoon')) {
    return {
      label: lower.includes('typhoon') ? 'Typhoon' : 'Hurricane',
      value: wind || productType,
      subtext: lower.includes('watch') ? 'Hurricane conditions possible' : 'Hurricane conditions expected',
      source,
      hail: '',
      wind
    };
  }

  if (lower.includes('tropical storm')) {
    return {
      label: 'Tropical Storm',
      value: wind || productType,
      subtext: lower.includes('watch') ? 'Tropical storm conditions possible' : 'Tropical storm conditions expected',
      source,
      hail: '',
      wind
    };
  }

  if (lower.includes('extreme wind')) {
    return {
      label: 'Extreme Wind',
      value: wind || productType,
      subtext: 'Shelter immediately',
      source,
      hail: '',
      wind
    };
  }

  if (lower.includes('tropical cyclone') || lower.includes('post-tropical cyclone')) {
    return {
      label: 'Tropical Cyclone',
      value: productType,
      subtext: 'Official local statement',
      source,
      hail: '',
      wind: ''
    };
  }

  if (lower.includes('flood')) {
    return {
      label: lower.includes('flash') ? 'Flash Flood' : 'Flood',
      value: damageThreat || productType,
      subtext: 'Move to higher ground',
      source,
      hail,
      wind
    };
  }

  if (lower.includes('winter') || lower.includes('blizzard') || lower.includes('ice')) {
    return {
      label: 'Winter',
      value: productType,
      subtext: properties.severity || 'Hazardous travel',
      source,
      hail,
      wind
    };
  }

  if (lower.includes('fire') || lower.includes('red flag')) {
    return {
      label: 'Fire',
      value: productType,
      subtext: properties.urgency || 'Critical fire weather',
      source,
      hail,
      wind
    };
  }

  if (lower.includes('marine') || lower.includes('wind')) {
    return {
      label: lower.includes('marine') ? 'Marine' : 'Wind',
      value: wind || productType,
      subtext: properties.severity || properties.urgency || 'Hazardous winds possible',
      source,
      hail: '',
      wind
    };
  }

  if (lower.includes('special weather statement')) {
    return {
      label: 'Statement',
      value: 'Special',
      subtext: 'Still take it seriously',
      source: properties.headline || source || 'Special weather statement',
      hail: '',
      wind: ''
    };
  }

  return {
    label: 'Weather',
    value: productType,
    subtext: properties.severity || '',
    source,
    hail,
    wind
  };
};

export const nwsFeatureToWarning = (feature) => {
  const properties = feature.properties || {};
  const rawPolygon = extractPolygon(feature.geometry);
  const polygon = Array.isArray(rawPolygon) && rawPolygon.length >= 4 ? rawPolygon : null;
  const center = polygon ? centroid(polygon) : undefined;
  const hazard = hazardForAlert(properties);
  const event = properties.event || 'Warning';
  const areaDesc = properties.areaDesc || 'your area';
  const stateCodes = Array.from(new Set([
    ...statesFromGeocode(properties.geocode),
    ...statesFromAreaDesc(areaDesc)
  ]));
  const stateList = formatStateList(stateCodes);
  const vtecAction = String(firstParam(properties.parameters, 'VTEC') || '').split('.')[1] || '';
  const state = stateList || titleCaseState(areaDesc);
  const office = properties.senderName?.replace(/^NWS\s+/i, '') || properties.sender || 'NWS';
  const impact = extractLine(properties.description, 'IMPACT');
  const classification = classifyAlert({
    event,
    headline: properties.headline,
    description: properties.description,
    instruction: properties.instruction,
    parameters: properties.parameters,
    severity: properties.severity
  });
  const motion = parseStormMotion(properties.parameters);
  const thunderstormDamageThreat = firstParam(properties.parameters, 'thunderstormDamageThreat');
  const threatStat = /severe thunderstorm/i.test(event) && thunderstormDamageThreat
    ? { label: 'Threat', value: String(thunderstormDamageThreat).toUpperCase() }
    : null;
  const safety = safetyTextForEvent(event, classification);
  const rawInstruction = String(properties.instruction || '').trim();
  const cardInstruction = rawInstruction && rawInstruction.length <= 210 && !/watch remains in effect/i.test(rawInstruction)
    ? rawInstruction
    : safety;

  const warning = normalizeWarning({
    key: feature.id || properties.id || properties['@id'],
    nwsId: feature.id || properties.id,
    feature,
    parameters: properties.parameters || {},
    headline: properties.headline || event,
    description: properties.description || '',
    instruction: properties.instruction || '',
    severity: properties.severity || '',
    certainty: properties.certainty || '',
    title: `${event} in ${state}`,
    event,
    state,
    stateCodes,
    ugc: properties.geocode?.UGC || [],
    vtecAction,
    messageType: properties.messageType || '',
    areaDesc,
    office,
    expiresAt: properties.expires || properties.ends,
    issuedAt: properties.sent || properties.effective,
    hazards: hazard,
    hazardStats: [
      threatStat,
      hazard.wind ? { label: 'Wind', value: hazard.wind } : null,
      hazard.hail ? { label: 'Hail', value: hazard.hail } : null,
      motion ? { label: 'Motion', value: motion } : null
    ].filter(Boolean),
    impactLine: `${properties.severity || 'Alert'} · ${properties.urgency || 'Issued'} · ${properties.certainty || 'Observed'}`,
    sourceText: hazard.source || properties.headline || event,
    whatToDo: clipText(cardInstruction || impact || safety, 220),
    polygon,
    geometry: feature.geometry,
    center,
    locations: extractLocations(properties.description, areaDesc),
    classification,
    radar: {
      mode: defaultRadarModeForEvent(event)
    },
    postText: `${event} for ${areaDesc} until ${properties.expires || properties.ends}. ${properties.instruction || 'Take action now.'}`.slice(0, 260)
  });
  // normalizeWarning has sample defaults for the demo renderer. Never use them for real alerts without geometry.
  return polygon ? warning : { ...warning, polygon: [], geometry: null, center: null };
};

export const fetchActiveWarnings = async ({ area, event, point, warningOnly = false, limit = 0 } = {}) => {
  const url = new URL(NWS_ACTIVE_ALERTS_URL);
  url.searchParams.set('status', 'actual');
  url.searchParams.set('message_type', 'alert,update');
  if (area) url.searchParams.set('area', String(area).toUpperCase());
  if (event) url.searchParams.set('event', event);
  if (point) url.searchParams.set('point', point);

  const response = await fetch(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(20000) });
  const body = await response.json();

  if (!response.ok) {
    const error = new Error(`NWS alerts ${response.status}: ${body.detail || body.title || response.statusText}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  if (!Array.isArray(body.features)) throw new Error('NWS response did not contain a valid features array');
  let features = body.features.filter((feature) => (
    isTargetAlertEvent(feature.properties?.event || '') &&
    isFeatureActive(feature)
  ));
  if (warningOnly) {
    features = features.filter((feature) => /\bwarning\b/i.test(feature.properties?.event || ''));
  }

  const maxItems = Number(limit);
  const limitedFeatures = maxItems > 0 ? features.slice(0, maxItems) : features;
  const hydratedFeatures = await mapLimit(limitedFeatures, 6, hydrateFeatureGeometry);
  const warnings = await mapLimit(hydratedFeatures, 6, async (feature) => enrichConvectiveWatch(nwsFeatureToWarning(feature)));

  return {
    updated: body.updated || new Date().toISOString(),
    count: features.length,
    warnings
  };
};
