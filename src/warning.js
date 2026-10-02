import tzLookup from 'tz-lookup';
import { sampleWarning } from './sampleWarning.js';
import { classifyAlert, defaultRadarModeForEvent, themeForAlert } from './themes.js';
import { analyzeTornadoId } from './tornadoId.js';

const formatterCache = new Map();
const STATE_TIMEZONES = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
  AS: 'Pacific/Pago_Pago',
  GU: 'Pacific/Guam',
  MP: 'Pacific/Saipan',
  PR: 'America/Puerto_Rico',
  VI: 'America/St_Thomas'
};

const isValidTimezone = (timezone) => {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const validCenter = (center) => {
  if (!Array.isArray(center) || center.length !== 2) return null;
  const lon = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return null;
  }
  return [lon, lat];
};

const fallbackTimezoneForState = (state = '') => {
  const codes = String(state).toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  return codes.map((code) => STATE_TIMEZONES[code]).find(Boolean) || 'America/Chicago';
};

export const resolveAlertTimezone = ({ timezone, center, polygon, state } = {}) => {
  if (isValidTimezone(timezone)) return timezone;

  const polygonCenter = Array.isArray(polygon) && polygon.length >= 4 ? centroid(polygon) : null;
  const point = validCenter(center) || validCenter(polygonCenter);
  if (point) {
    try {
      return tzLookup(point[1], point[0]);
    } catch {
      // Fall through to the product's state when coordinates are unavailable.
    }
  }

  return fallbackTimezoneForState(state);
};

export const getFormatter = (timezone, options) => {
  const key = `${timezone}:${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/Chicago',
      ...options
    }));
  }
  return formatterCache.get(key);
};

export const compactNumber = (value) => {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-US').format(number);
};

export const normalizeWarning = (input = {}) => {
  const sourcePolygon = Array.isArray(input.polygon) && input.polygon.length >= 4
    ? input.polygon
    : null;
  const sourceCenter = validCenter(input.center) || (sourcePolygon ? centroid(sourcePolygon) : null);
  const classification = classifyAlert({
    event: input.event || sampleWarning.event,
    headline: input.headline,
    description: input.description,
    instruction: input.instruction,
    parameters: input.parameters,
    severity: input.severity
  });
  const theme = themeForAlert({
    event: input.event || sampleWarning.event,
    headline: input.headline,
    description: input.description,
    instruction: input.instruction,
    parameters: input.parameters,
    severity: input.severity
  });
  const tornadoId = input.tornadoId === null
    ? null
    : {
      ...(analyzeTornadoId(input) || {}),
      ...(input.tornadoId || {})
    };
  const warning = {
    ...sampleWarning,
    ...input,
    hazards: input.hazards
      ? { ...input.hazards }
      : { ...sampleWarning.hazards },
    impacts: {
      people: null,
      homes: null,
      ...(input.impacts || {})
    },
    theme: {
      ...theme,
      ...(input.theme || {})
    },
    classification: {
      ...classification,
      ...(input.classification || {})
    },
    tornadoId: tornadoId && Object.keys(tornadoId).length ? tornadoId : null,
    radar: {
      mode: defaultRadarModeForEvent(input.event || sampleWarning.event),
      ...(input.radar || {})
    }
  };

  if (!Array.isArray(warning.polygon) || warning.polygon.length < 4) {
    warning.polygon = sampleWarning.polygon;
  }

  if (!Array.isArray(warning.center) || warning.center.length !== 2) {
    warning.center = centroid(warning.polygon);
  }

  warning.timezone = resolveAlertTimezone({
    timezone: input.timezone,
    center: sourceCenter,
    polygon: sourcePolygon,
    state: input.state || warning.state
  });
  warning.title = String(warning.title || `${warning.event || 'WARNING'} IN ${warning.state || 'YOUR AREA'}`).toUpperCase();
  warning.office = String(warning.office || 'NWS');
  warning.postText = String(warning.postText || `${warning.title}. Take action now.`);
  warning.contentType = warning.classification.renderAsGif ? 'image/gif' : 'image/png';
  return warning;
};

export const centroid = (polygon) => {
  const points = polygon.filter((point) => Array.isArray(point) && point.length === 2);
  if (!points.length) return sampleWarning.center;
  const sum = points.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
};

export const boundsForPolygon = (polygon) => {
  const points = polygon.filter((point) => Array.isArray(point) && point.length === 2);
  if (!points.length) return [[-90, 42], [-88, 43]];
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)]
  ];
};

// Intl falls back to "GMT+10"-style names for U.S. territories; NWS products use these.
const TIMEZONE_ABBREVIATIONS = {
  'Pacific/Guam': 'ChST',
  'Pacific/Saipan': 'ChST',
  'Pacific/Pago_Pago': 'SST',
  'America/Puerto_Rico': 'AST',
  'America/St_Thomas': 'AST'
};

export const timezoneAbbreviation = (timezone, date = new Date()) => {
  if (TIMEZONE_ABBREVIATIONS[timezone]) return TIMEZONE_ABBREVIATIONS[timezone];
  const part = getFormatter(timezone, { hour: 'numeric', timeZoneName: 'short' })
    .formatToParts(date)
    .find((item) => item.type === 'timeZoneName');
  return part?.value || '';
};

export const formatAlertTime = (value, timezone) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const clock = getFormatter(timezone, { hour: 'numeric', minute: '2-digit' }).format(date).replace(/\s/g, ' ');
  return `${clock} ${timezoneAbbreviation(timezone, date)}`.trim();
};

export const displayTimes = (warning) => {
  const timezone = resolveAlertTimezone(warning);
  const expires = new Date(warning.expiresAt || Date.now() + 60 * 60 * 1000);
  const issued = new Date(warning.issuedAt || Date.now());
  const timeFormat = { format: (date) => formatAlertTime(date, timezone) };
  const dateFormat = getFormatter(timezone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return {
    expiresTime: timeFormat.format(expires).replace(/\s/g, ' '),
    expiresDate: dateFormat.format(expires),
    issuedTime: timeFormat.format(issued).replace(/\s/g, ' ')
  };
};
