// Shared on-air text and graphics for warning cards and warning shorts.
import { compactNumber, formatAlertTime, getFormatter, resolveAlertTimezone } from './warning.js';

export const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', VI: 'Virgin Islands',
  GU: 'Guam', AS: 'American Samoa', MP: 'Northern Marianas'
};

const VTEC_TAGS = {
  NEW: 'NEW',
  CON: 'CONTINUES',
  EXT: 'EXTENDED',
  EXA: 'EXPANDED',
  EXB: 'EXPANDED',
  UPG: 'UPGRADED',
  COR: 'CORRECTED'
};

export const stateCodesFor = (warning = {}) => {
  const codes = [
    ...(warning.stateCodes || []),
    ...(warning.ugc || []).map((code) => String(code).slice(0, 2)),
    ...(String(warning.areaDesc || '').match(/,\s*([A-Z]{2})(?=;|$)/g) || []).map((match) => match.replace(/[^A-Z]/g, '')),
    ...(String(warning.state || '').match(/\b[A-Z]{2}\b/g) || [])
  ];
  return Array.from(new Set(codes.filter((code) => STATE_NAMES[code])));
};

export const placeFor = (warning = {}) => {
  const codes = stateCodesFor(warning);
  if (codes.length === 1) return STATE_NAMES[codes[0]].toUpperCase();
  if (codes.length === 2) return `${STATE_NAMES[codes[0]]} & ${STATE_NAMES[codes[1]]}`.toUpperCase();
  if (codes.length > 2) return `${codes.length} STATES`;
  const firstArea = String(warning.areaDesc || '').split(';')[0].trim();
  return firstArea ? firstArea.toUpperCase() : 'YOUR AREA';
};

export const eventLabelFor = (warning = {}) => {
  const classification = warning.classification || {};
  const event = String(warning.event || warning.title || 'Weather Alert');
  if (classification.isEmergency && /tornado/i.test(event)) return 'TORNADO EMERGENCY';
  if (classification.isEmergency && /flood/i.test(event)) return 'FLASH FLOOD EMERGENCY';
  return event.toUpperCase();
};

export const headlineFor = (warning = {}) => {
  const event = eventLabelFor(warning);
  const place = placeFor(warning);
  const isForecast = warning.cardLayout === 'forecast' || warning.classification?.isForecast;
  if (isForecast) {
    return { event: 'DAILY FORECAST', place: String(warning.forecast?.location || warning.areaDesc || '').toUpperCase(), full: String(warning.title || 'DAILY FORECAST').toUpperCase() };
  }
  if (warning.classification?.isOutlook || warning.outlookDetails) {
    const day = warning.outlookDetails?.day || String(warning.title || '').match(/DAY\s*(\d)/i)?.[1] || '';
    const risk = String(warning.outlookDetails?.labelText || warning.hazards?.value || '').replace(/^day \d+ \w+ outlook\s*·?\s*/i, '').toUpperCase();
    const label = `SPC DAY ${day} OUTLOOK`.replace('  ', ' ');
    return { event: label, place: risk, full: risk ? `${label}: ${risk}` : label };
  }
  if (warning.classification?.isDiscussion || /mesoscale discussion/i.test(warning.event || '')) {
    const number = warning.mdDetails?.number || String(warning.key || '').match(/spc-md-(\d+)/)?.[1] || '';
    const label = `MESOSCALE DISCUSSION${number ? ` #${number}` : ''}`;
    return { event: label, place, full: `${label} · ${place}` };
  }
  return { event, place, full: `${event} IN ${place}` };
};

const unitWord = (codes = []) => (codes.length === 1 && codes[0] === 'LA' ? ['PARISH', 'PARISHES'] : ['COUNTY', 'COUNTIES']);

// "FORD COUNTY, KS" / "BOSQUE & HILL COUNTIES, TX" / "DALLAS, TARRANT + 4 MORE COUNTIES, TX"
export const areaLineFor = (warning = {}, { maxNames = 3 } = {}) => {
  const parts = String(warning.areaDesc || '').split(';').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return String(warning.state || '').toUpperCase();
  const parsed = parts.map((part) => {
    const match = part.match(/^(.*?),\s*([A-Z]{2})$/);
    return match ? { name: match[1], state: match[2] } : { name: part, state: '' };
  });
  const states = Array.from(new Set(parsed.map((item) => item.state).filter(Boolean)));
  const isCountyBased = (warning.ugc || []).length
    ? (warning.ugc || []).every((code) => String(code)[2] === 'C')
    : false;
  const names = parsed.map((item) => item.name.toUpperCase());
  const suffix = states.length ? `, ${states.join(' / ')}` : '';
  if (!isCountyBased) {
    const shown = names.slice(0, maxNames).join(', ');
    return `${shown}${names.length > maxNames ? ` + ${names.length - maxNames} MORE` : ''}${suffix}`;
  }
  const [single, plural] = unitWord(states);
  if (names.length === 1) return `${names[0]} ${single}${suffix}`;
  if (names.length === 2) return `${names[0]} & ${names[1]} ${plural}${suffix}`;
  if (names.length <= maxNames) return `${names.slice(0, -1).join(', ')} & ${names.at(-1)} ${plural}${suffix}`;
  return `${names.slice(0, maxNames - 1).join(', ')} + ${names.length - maxNames + 1} MORE ${plural}${suffix}`;
};

export const statusTagFor = (warning = {}) => {
  if (warning.classification?.isForecast) return 'FORECAST';
  if (VTEC_TAGS[warning.vtecAction]) return VTEC_TAGS[warning.vtecAction];
  if (/update/i.test(warning.messageType || '')) return 'UPDATED';
  const issued = Date.parse(warning.issuedAt || '');
  return Number.isFinite(issued) && Date.now() - issued < 30 * 60 * 1000 ? 'NEW' : 'ACTIVE';
};

export const threatTagFor = (warning = {}) => {
  const classification = warning.classification || {};
  if (classification.isEmergency) return 'EMERGENCY';
  if (classification.isPds) return 'PDS';
  if (classification.isDestructive) return 'DESTRUCTIVE';
  if (classification.isConsiderable) return 'CONSIDERABLE';
  const detection = String(warning.parameters?.tornadoDetection?.[0] || warning.parameters?.tornadoDetection || '');
  if (/observed/i.test(detection)) return 'OBSERVED';
  return '';
};

export const timeLabelsFor = (warning = {}) => {
  const timezone = resolveAlertTimezone(warning);
  const expires = Date.parse(warning.expiresAt || '');
  const issued = Date.parse(warning.issuedAt || '');
  const dayFormat = getFormatter(timezone, { weekday: 'long', month: 'short', day: 'numeric' });
  return {
    timezone,
    expires: Number.isFinite(expires) ? formatAlertTime(expires, timezone) : '',
    expiresDay: Number.isFinite(expires) ? dayFormat.format(new Date(expires)).toUpperCase() : '',
    issued: Number.isFinite(issued) ? formatAlertTime(issued, timezone) : '',
    issuedDay: Number.isFinite(issued) ? dayFormat.format(new Date(issued)).toUpperCase() : ''
  };
};

export const peopleFor = (warning = {}) => {
  const people = Number(warning.impacts?.people);
  if (!Number.isFinite(people) || people <= 0) return '';
  return compactNumber(Math.round(people));
};

export const hazardChipsFor = (warning = {}) => {
  const chips = [];
  for (const stat of warning.hazardStats || []) {
    if (!stat?.value || /^threat$/i.test(stat.label || '')) continue;
    chips.push({ label: String(stat.label || '').toUpperCase(), value: String(stat.value).toUpperCase() });
  }
  return chips.slice(0, 3);
};

const ICON_PATHS = {
  tornado: '<path d="M3 5h18M5 9h14M7 13h9M9 17h5M11 21h2" stroke-linecap="round"/>',
  flood: '<path d="M2 8c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 13c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 18c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" stroke-linecap="round"/>',
  storm: '<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8z" stroke-linejoin="round"/>',
  winter: '<path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 3.5 12 6l3-2.5M9 20.5 12 18l3 2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  fire: '<path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-5.7-4.2-8.2-.6 2-1.6 3.2-2.8 3.7.3-3.3-1.2-6.4-4-8.7.2 3.6-3 6.3-3 10.9C5 19.6 8 22 12 22z" stroke-linejoin="round"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" stroke-linecap="round"/>',
  tropical: '<circle cx="12" cy="12" r="3"/><path d="M12 9c0-4 3-7 8-7-2 2-3 4-3 6M12 15c0 4-3 7-8 7 2-2 3-4 3-6" stroke-linecap="round"/>',
  outlook: '<path d="M12 3 2 20h20L12 3zM12 10v4M12 17v.5" stroke-linecap="round" stroke-linejoin="round"/>',
  forecast: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke-linecap="round"/>',
  alert: '<path d="M12 3 2 20h20L12 3zM12 10v4M12 17v.5" stroke-linecap="round" stroke-linejoin="round"/>'
};

export const iconKeyFor = (warning = {}) => {
  const family = warning.classification?.family || '';
  if (family === 'tornado') return 'tornado';
  if (family === 'flash-flood' || family === 'flood' || family === 'storm-surge') return 'flood';
  if (family === 'severe') return 'storm';
  if (family === 'winter') return 'winter';
  if (family === 'fire') return 'fire';
  if (family === 'wind' || family === 'extreme-wind' || family === 'marine') return 'wind';
  if (['hurricane', 'tropical-storm', 'tropical-cyclone'].includes(family)) return 'tropical';
  if (family === 'outlook' || family === 'discussion') return 'outlook';
  if (family === 'forecast') return 'forecast';
  return 'alert';
};

export const iconSvg = (key, { size = 24, stroke = 2.2 } = {}) => (
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" aria-hidden="true">${ICON_PATHS[key] || ICON_PATHS.alert}</svg>`
);

// Readable text color on top of a theme color.
export const inkFor = (hex = '#000000') => {
  const value = String(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#0b0d12' : '#ffffff';
};

export const embeddedFontCss = (fontDataUrls = {}) => [
  fontDataUrls.oswald ? `@font-face { font-family: "WP Display"; src: url("${fontDataUrls.oswald}") format("woff2"); font-weight: 400 700; font-display: block; }` : '',
  fontDataUrls.inter ? `@font-face { font-family: "WP Sans"; src: url("${fontDataUrls.inter}") format("woff2"); font-weight: 400 900; font-display: block; }` : '',
  fontDataUrls.ibmPlexMono600 ? `@font-face { font-family: "WP Mono"; src: url("${fontDataUrls.ibmPlexMono600}") format("woff2"); font-weight: 400 700; font-display: block; }` : ''
].filter(Boolean).join('\n');

// USGS public-domain imagery over NASA Blue Marble (covers territories and oceans).
export const SATELLITE_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'blue-marble': {
      type: 'raster',
      tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'],
      tileSize: 256,
      maxzoom: 8
    },
    'usgs-imagery': {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      bounds: [-180, 17, -64, 72]
    },
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet'
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
    { id: 'blue-marble', type: 'raster', source: 'blue-marble' },
    { id: 'usgs-imagery', type: 'raster', source: 'usgs-imagery', paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.25, 'raster-contrast': 0.05 } },
    {
      id: 'county-lines', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 6], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': 'rgba(255,255,255,0.32)', 'line-width': 0.9, 'line-dasharray': [3, 2] }
    },
    {
      id: 'state-lines', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': 'rgba(255,255,255,0.7)', 'line-width': 1.6 }
    },
    {
      id: 'highways', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
      paint: { 'line-color': 'rgba(255,255,255,0.28)', 'line-width': 1.2 }
    },
    {
      id: 'places', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, ['match', ['get', 'class'], 'city', 15, 11], 10, ['match', ['get', 'class'], 'city', 24, 17]],
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        'text-padding': 6
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.8 }
    }
  ]
};

export const REFLECTIVITY_LEGEND = 'linear-gradient(90deg, #04e9e7 0%, #019ff4 12%, #02fd02 26%, #01c501 36%, #fdf802 50%, #fd9500 62%, #fd0000 74%, #d40000 82%, #f800fd 92%, #ffffff 100%)';
export const VELOCITY_LEGEND = 'linear-gradient(90deg, #00ff7f 0%, #00a050 30%, #2a3a2a 48%, #3a2a2a 52%, #a00000 70%, #ff3c3c 100%)';
export const RAINFALL_LEGEND = 'linear-gradient(90deg, #8be28b 0%, #2eb82e 18%, #f5f53d 36%, #f59b2e 52%, #e62e2e 68%, #b82eb8 84%, #f2a6f2 100%)';

export const brandMarkup = (logoDataUrl = '') => `
  <div class="wp-brand">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '<b>WP</b>'}
    <span>See it on <strong>WEATHERPOWER.APP</strong></span>
  </div>`;
