import { centroid, normalizeWarning } from './warning.js';
import { warningThemes } from './themes.js';

const SPC_OUTLOOK_MAPSERVER = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';
const SPC_HEADERS = {
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

const OUTLOOK_LAYERS = [
  { day: 1, layer: 1, kind: 'Categorical' },
  { day: 2, layer: 9, kind: 'Categorical' },
  { day: 3, layer: 17, kind: 'Categorical' },
  { day: 4, layer: 21, kind: 'Probabilistic' },
  { day: 5, layer: 22, kind: 'Probabilistic' },
  { day: 6, layer: 23, kind: 'Probabilistic' },
  { day: 7, layer: 24, kind: 'Probabilistic' },
  { day: 8, layer: 25, kind: 'Probabilistic' }
];

const RISK_COLORS = {
  TSTM: ['#55bb55', '#143d18', '#72d172', '85, 187, 85'],
  MRGL: ['#2f9e44', '#123818', '#66c27a', '47, 158, 68'],
  SLGT: ['#e6b800', '#735400', '#ffe066', '230, 184, 0'],
  ENH: ['#ff7a00', '#7a3300', '#ffad5c', '255, 122, 0'],
  MDT: ['#ff2d2d', '#7c0b0b', '#ff7070', '255, 45, 45'],
  HIGH: ['#d946ef', '#63116f', '#f08cff', '217, 70, 239']
};

const clean = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const parseSpcTime = (value) => {
  const text = String(value || '');
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  )).toISOString();
};

const sourceDate = (source = '') => {
  const match = String(source).match(/day(\d)otlk_(\d{8})/i);
  if (!match) return null;
  return {
    day: Number(match[1]),
    date: match[2]
  };
};

const inferredValid = ({ properties, day }) => {
  const direct = parseSpcTime(properties.valid);
  if (direct) return direct;

  const source = sourceDate(properties.idp_source);
  if (!source) return new Date(properties.idp_filedate || Date.now()).toISOString();

  const year = Number(source.date.slice(0, 4));
  const month = Number(source.date.slice(4, 6)) - 1;
  const date = Number(source.date.slice(6, 8)) + Math.max(0, Number(day || source.day) - 1);
  return new Date(Date.UTC(year, month, date, 12, 0)).toISOString();
};

const inferredExpire = ({ properties, validAt }) => {
  const direct = parseSpcTime(properties.expire);
  if (direct) return direct;
  return new Date(Date.parse(validAt) + 24 * 60 * 60 * 1000).toISOString();
};

const ringsFromGeometry = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates || [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
  return [];
};

const largestRing = (geometry) => ringsFromGeometry(geometry)
  .filter((ring) => Array.isArray(ring) && ring.length >= 4)
  .sort((a, b) => b.length - a.length)[0] || [];

const themeForRisk = (properties, kind) => {
  const label = clean(properties.label).toUpperCase();
  const colors = RISK_COLORS[label] || (Number(properties.dn || 0) >= 30
    ? RISK_COLORS.MDT
    : Number(properties.dn || 0) >= 15
      ? RISK_COLORS.SLGT
      : RISK_COLORS.MRGL);
  const [primary, primaryDark, accent, rgb] = colors;
  return {
    ...warningThemes.outlook,
    name: kind === 'Probabilistic' ? 'SPC Probability' : `SPC ${label || 'Outlook'}`,
    primary,
    primaryDark,
    accent,
    rgb,
    polygon: accent,
    type: 'spc-outlook'
  };
};

const riskLabel = (properties, kind) => {
  if (properties.label2) return clean(properties.label2);
  const dn = Number(properties.dn || 0);
  if (kind === 'Probabilistic' && dn > 0) return `${dn}% Any Severe Risk`;
  return clean(properties.label || 'SPC Outlook');
};

const shouldKeepFeature = (feature, kind) => {
  const properties = feature.properties || {};
  if (!feature.geometry) return false;
  if (kind === 'Probabilistic' && Number(properties.dn || 0) <= 0) return false;
  return true;
};

const fetchLayer = async ({ day, layer, kind }) => {
  const url = new URL(`${SPC_OUTLOOK_MAPSERVER}/${layer}/query`);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');

  const response = await fetch(url, { headers: SPC_HEADERS });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`SPC outlook layer ${layer} ${response.status}: ${body.error?.message || response.statusText}`);
  }

  return (body.features || [])
    .filter((feature) => shouldKeepFeature(feature, kind))
    .map((feature) => {
      const properties = feature.properties || {};
      const label = riskLabel(properties, kind);
      const shortLabel = clean(properties.label || (Number(properties.dn || 0) ? `${properties.dn}%` : 'OUTLOOK')).toUpperCase();
      const validAt = inferredValid({ properties, day });
      const expiresAt = inferredExpire({ properties, validAt });
      const issuedAt = parseSpcTime(properties.issue) || new Date(properties.idp_filedate || Date.now()).toISOString();
      const polygon = largestRing(feature.geometry);
      const center = centroid(polygon);
      const theme = themeForRisk(properties, kind);

      return normalizeWarning({
        key: `spc-outlook-day${day}-${kind.toLowerCase()}-${properties.objectid || shortLabel}-${properties.idp_source || issuedAt}`,
        nwsId: `${SPC_OUTLOOK_MAPSERVER}/${layer}`,
        title: `SPC DAY ${day} ${label} OUTLOOK`,
        event: 'SPC Convective Outlook',
        state: 'UNITED STATES',
        areaDesc: `Day ${day} ${kind} Outlook · ${label}`,
        office: 'SPC',
        expiresAt,
        issuedAt,
        hazards: {
          label: `Day ${day}`,
          value: shortLabel,
          subtext: label,
          hail: '',
          wind: ''
        },
        hazardStats: [
          { label: 'Risk', value: shortLabel },
          { label: 'Day', value: `Day ${day}` }
        ],
        impactLine: `${kind.toUpperCase()} · ${label.toUpperCase()}`,
        sourceText: `${label} · Valid ${validAt}`,
        whatToDo: 'SPC outlooks highlight where severe thunderstorms are possible. Stay weather aware and monitor watches or warnings if storms develop.',
        polygon,
        geometry: feature.geometry,
        center,
        locations: ['SPC'],
        outlookDetails: {
          day,
          kind,
          label: shortLabel,
          labelText: label,
          layer,
          source: properties.idp_source
        },
        classification: {
          family: 'outlook',
          isWatch: false,
          isWarning: false,
          isEmergency: false,
          isPds: false,
          isDestructive: false,
          isDiscussion: false,
          isOutlook: true,
          alertTag: 'OUTLOOK',
          renderAsGif: false,
          theme
        },
        theme,
        radar: {
          mode: 'reflectivity'
        },
        postText: `SPC Day ${day} ${label} Outlook. Valid until ${expiresAt}.`.slice(0, 260)
      });
    });
};

export const fetchActiveSpcOutlooks = async () => {
  const groups = await Promise.all(OUTLOOK_LAYERS.map(fetchLayer));
  const warnings = groups.flat();
  return {
    updated: new Date().toISOString(),
    count: warnings.length,
    warnings
  };
};

export const SPC_OUTLOOK_SOURCES = {
  mapService: SPC_OUTLOOK_MAPSERVER,
  layers: OUTLOOK_LAYERS
};
