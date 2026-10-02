import { classifyAlert } from './themes.js';

const SPC_WATCH_BASE = 'https://www.spc.noaa.gov/products/watch';
const SPC_HEADERS = {
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

const stripHtml = (value = '') => String(value)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/\s+/g, ' ')
  .trim();

const watchNumberFromWarning = (warning) => {
  const text = [
    warning.event,
    warning.headline,
    warning.description,
    warning.feature?.properties?.headline,
    warning.feature?.properties?.description,
    ...(warning.parameters?.VTEC || [])
  ].filter(Boolean).join(' ');
  return text.match(/\b(?:watch(?: number)?|WW|[A-Z]{2}\.A\.)\s*0*(\d{1,4})\b/i)?.[1] ||
    text.match(/\b(?:TO|SV)\.A\.0*(\d{1,4})\b/i)?.[1] ||
    '';
};

const parseLatLonGroups = (text) => {
  const block = String(text || '').match(/LAT\.\.\.LON\s+([0-9\s]+)/i)?.[1] || '';
  const points = block
    .trim()
    .split(/\s+/)
    .filter((group) => /^\d{8}$/.test(group))
    .map((group) => {
      const lat = Number(group.slice(0, 4)) / 100;
      const lon = Number(group.slice(4, 8)) / -100;
      return [lon, lat];
    });

  if (points.length && (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) {
    points.push(points[0]);
  }

  return points.length >= 4 ? points : null;
};

const fetchText = async (url) => {
  const response = await fetch(url, { headers: SPC_HEADERS });
  const text = await response.text();
  if (!response.ok) throw new Error(`SPC watch ${response.status}: ${response.statusText}`);
  return text;
};

const parseWatchText = (html) => {
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || html;
  return stripHtml(pre);
};

const parseWatchTitle = (html) => stripHtml(
  String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
);

export const hasPdsWatchTag = (...values) => (
  /\bPDS\b|THIS IS A PARTICULARLY DANGEROUS SITUATION/i.test(values.filter(Boolean).join(' '))
);

const pdsWatchSafetyText = (event = '') => (
  /tornado/i.test(event)
    ? 'This is a particularly dangerous situation. Be ready to take shelter immediately if a warning is issued. Review your safe place now.'
    : 'This is a particularly dangerous situation. Prepare for widespread destructive winds or very large hail and be ready to shelter immediately.'
);

const parseMaxHail = (text) => {
  const match = text.match(/(?:hail(?:stones)?|hail events).*?(?:to|>|greater than)\s*(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b)/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b).*?hail/i);
  return match ? `${Number(match[1]).toFixed(1).replace(/\.0$/, '')}"` : '';
};

const parseMaxWind = (text) => {
  const knot = text.match(/wind gusts? to\s*(\d{2,3})\s*knots/i);
  if (knot) return `${Math.round(Number(knot[1]) * 1.15078)} mph`;
  const mph = text.match(/(?:wind|gusts?).*?(?:to|>|greater than)\s*(\d{2,3})\s*mph/i) ||
    text.match(/(\d{2,3})\s*mph.*?(?:wind|gusts?)/i);
  return mph ? `${mph[1]} mph` : '';
};

const probability = (text, pattern, group, label) => {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    group,
    label,
    value: `${match[1]}%`
  };
};

const parseProbabilities = (html) => {
  const text = stripHtml(html);
  return [
    probability(text, /Probability of 2 or more tornadoes\s+\w+\s+\((\d+)%\)/i, 'Tornado', '2+ tornadoes'),
    probability(text, /Probability of 1 or more strong .*? tornadoes\s+\w+\s+\((\d+)%\)/i, 'Tornado', '1+ EF2+'),
    probability(text, /Probability of 10 or more severe hail events\s+\w+\s+\((\d+)%\)/i, 'Hail', '10+ severe'),
    probability(text, /Probability of 1 or more hailstones .*?2 inches\s+\w+\s+\((\d+)%\)/i, 'Hail', '2"+'),
    probability(text, /Probability of 10 or more severe wind events\s+\w+\s+\((\d+)%\)/i, 'Wind', '10+ severe'),
    probability(text, /Probability of 1 or more wind events .*?65 knots\s+\w+\s+\((\d+)%\)/i, 'Wind', '>=75 mph'),
    probability(text, /Probability of 6 or more combined severe hail\/wind events\s+\w+\s+\((\d+)%\)/i, 'Combined', '6+ combined')
  ].filter(Boolean);
};

export const enrichConvectiveWatch = async (warning) => {
  if (!warning.classification?.isWatch || !/tornado watch|severe thunderstorm watch/i.test(warning.event || '')) {
    return warning;
  }

  const number = watchNumberFromWarning(warning);
  if (!number) return warning;

  const padded = number.padStart(4, '0');
  try {
    const [watchHtml, outlineHtml, probabilityHtml] = await Promise.all([
      fetchText(`${SPC_WATCH_BASE}/ww${padded}.html`).catch(() => ''),
      fetchText(`${SPC_WATCH_BASE}/wou${padded}.html`).catch(() => ''),
      fetchText(`${SPC_WATCH_BASE}/ww${padded}_prob.html`).catch(() => '')
    ]);
    const watchText = parseWatchText(watchHtml);
    const watchTitle = parseWatchTitle(watchHtml);
    const isPds = hasPdsWatchTag(watchText, watchTitle);
    const outline = parseLatLonGroups(outlineHtml || watchHtml);
    const maxHail = parseMaxHail(watchText);
    const maxWind = parseMaxWind(watchText);
    const probabilities = probabilityHtml ? parseProbabilities(probabilityHtml) : [];
    const hasShapedGeometry = Boolean(
      warning.geometry &&
      warning.feature?.properties?.weatherPowerGeometrySource === 'affectedZones'
    );
    const classification = isPds
      ? classifyAlert({
          event: warning.event,
          headline: warning.headline,
          description: [warning.description, watchText].filter(Boolean).join(' '),
          instruction: warning.instruction,
          parameters: warning.parameters,
          severity: warning.severity
        })
      : warning.classification;

    return {
      ...warning,
      title: isPds && !/^PDS\b/i.test(warning.title || '') ? `PDS ${warning.title}` : warning.title,
      theme: classification?.theme || warning.theme,
      classification,
      polygon: hasShapedGeometry ? warning.polygon : (outline || warning.polygon),
      geometry: hasShapedGeometry
        ? warning.geometry
        : outline
          ? { type: 'Polygon', coordinates: [outline] }
          : warning.geometry,
      hazards: {
        ...(warning.hazards || {}),
        hail: maxHail || warning.hazards?.hail || '',
        wind: maxWind || warning.hazards?.wind || ''
      },
      hazardStats: [
        maxHail ? { label: 'Max Hail', value: maxHail } : null,
        maxWind ? { label: 'Max Wind', value: maxWind } : null
      ].filter(Boolean),
      impactLine: isPds && !/\bPDS\b/i.test(warning.impactLine || '')
        ? `PDS · ${warning.impactLine || 'PARTICULARLY DANGEROUS SITUATION'}`
        : warning.impactLine,
      sourceText: isPds ? `SPC PDS WATCH ${number} · PARTICULARLY DANGEROUS SITUATION` : warning.sourceText,
      whatToDo: isPds ? pdsWatchSafetyText(warning.event) : warning.whatToDo,
      watchDetails: {
        number,
        pds: isPds,
        pdsText: isPds ? 'Particularly Dangerous Situation' : '',
        maxHail,
        maxWind,
        probabilities,
        outline,
        spcWatchUrl: `${SPC_WATCH_BASE}/ww${padded}.html`,
        spcOutlineUrl: `${SPC_WATCH_BASE}/wou${padded}.html`,
        spcProbabilityUrl: `${SPC_WATCH_BASE}/ww${padded}_prob.html`
      }
    };
  } catch {
    return warning;
  }
};
