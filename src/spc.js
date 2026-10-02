import { centroid, normalizeWarning } from './warning.js';
import { warningThemes } from './themes.js';

const SPC_MD_QUERY_URL = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query';
const SPC_RSS_URL = 'https://www.spc.noaa.gov/products/spcmdrss.xml';
const SPC_HEADERS = {
  'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app'
};

const STATE_NAMES = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY'
};

const stripHtml = (value = '') => String(value)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#039;/gi, "'");

const cleanText = (value = '') => stripHtml(value)
  .replace(/\r/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const compact = (value = '') => cleanText(value)
  .replace(/\s+/g, ' ')
  .trim();

const titleText = (value = '') => compact(value)
  .replace(/\b([a-z])/g, (match) => match.toUpperCase());

const extractBlock = (text, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\.\\.\\.([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*[A-Z][A-Z ]+\\.\\.\\.|$)`, 'i');
  return compact(text.match(pattern)?.[1] || '');
};

const extractMesoscaleText = async (url) => {
  const response = await fetch(url, { headers: SPC_HEADERS });
  const html = await response.text();
  if (!response.ok) throw new Error(`SPC discussion ${response.status}: ${response.statusText}`);
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || html;
  return cleanText(pre);
};

const formatStateList = (states) => {
  const unique = Array.from(new Set(states)).filter(Boolean);
  if (!unique.length) return 'THE UNITED STATES';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} AND ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, AND ${unique.at(-1)}`;
};

const statesFromArea = (area = '') => {
  const lower = area.toLowerCase();
  return Object.entries(STATE_NAMES)
    .map(([name, code]) => ({ code, index: lower.search(new RegExp(`\\b${name}\\b`, 'i')) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ code }) => code);
};

const parseValidEnd = (text, referenceMs) => {
  const match = text.match(/Valid\s+(\d{2})(\d{2})(\d{2})Z\s*-\s*(\d{2})(\d{2})(\d{2})Z/i);
  if (!match) return new Date(Number(referenceMs || Date.now()) + 6 * 60 * 60 * 1000).toISOString();

  const ref = new Date(Number(referenceMs || Date.now()));
  const startDay = Number(match[1]);
  const endDay = Number(match[4]);
  const endHour = Number(match[5]);
  const endMinute = Number(match[6]);
  const year = ref.getUTCFullYear();
  let month = ref.getUTCMonth();

  if (endDay < startDay && startDay >= 28) month += 1;

  return new Date(Date.UTC(year, month, endDay, endHour, endMinute)).toISOString();
};

const watchBadge = (text) => {
  const probability = text.match(/Probability of Watch Issuance\.\.\.([^\n]+)/i)?.[1];
  if (probability) {
    const percent = probability.match(/\d{1,3}/)?.[0];
    return percent ? `${percent}% WATCH` : 'WATCH POSSIBLE';
  }
  if (/watch unlikely/i.test(text)) return 'WATCH UNLIKELY';
  if (/watch possible|watch may be needed|watch issuance/i.test(text)) return 'WATCH POSSIBLE';
  if (/watch \d+/i.test(text)) return 'WATCH';
  return 'DISCUSSION';
};

const hazardStatsFromText = (text) => {
  const stats = [
    ['Peak Hail', text.match(/MOST PROBABLE PEAK HAIL SIZE\.\.\.([^\n]+)/i)?.[1]],
    ['Peak Wind', text.match(/MOST PROBABLE PEAK WIND GUST\.\.\.([^\n]+)/i)?.[1]],
    ['Peak Tor', text.match(/MOST PROBABLE PEAK TORNADO INTENSITY\.\.\.([^\n]+)/i)?.[1]]
  ];
  return stats
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value: compact(value).toUpperCase() }));
};

const concernLines = ({ concerning, text, summary }) => {
  const lines = [];
  if (concerning) lines.push(concerning.replace(/\.\.\.$/, ''));
  const probability = watchBadge(text);
  if (probability && probability !== 'DISCUSSION' && probability !== 'WATCH') lines.push(probability);
  if (!lines.length && summary) lines.push(summary);
  return lines.slice(0, 3);
};

export const fetchActiveMesoscaleDiscussions = async () => {
  const url = new URL(SPC_MD_QUERY_URL);
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');

  const response = await fetch(url, { headers: SPC_HEADERS });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`SPC mesoscale discussions ${response.status}: ${body.error?.message || response.statusText}`);
  }

  const features = (body.features || []).filter((feature) => {
    const properties = feature.properties || {};
    return feature.geometry && properties.popupinfo && !/^noarea$/i.test(String(properties.name || ''));
  });
  const discussions = await Promise.all(features.map(async (feature) => {
    const properties = feature.properties || {};
    const number = String(properties.name || '').match(/\d+/)?.[0] || String(feature.id || '');
    const text = await extractMesoscaleText(properties.popupinfo);
    const area = extractBlock(text, 'Areas affected');
    const concerning = extractBlock(text, 'Concerning');
    const summary = extractBlock(text, 'SUMMARY');
    const validUntil = parseValidEnd(text, properties.idp_filedate);
    const states = statesFromArea(area);
    const stateLabel = formatStateList(states);
    const hazardStats = hazardStatsFromText(text);
    const badge = watchBadge(text);
    const polygon = feature.geometry?.coordinates?.[0] || [];
    const center = centroid(polygon);
    const isWinter = /snow|blizzard|freezing|winter/i.test([concerning, summary, text].join(' '));
    const theme = isWinter ? warningThemes.winter : warningThemes.discussion;
    const compactArea = compact(area).toUpperCase();

    return normalizeWarning({
      key: `spc-md-${number || feature.id}`,
      nwsId: properties.popupinfo,
      feature,
      title: `${isWinter ? 'WINTER WEATHER' : 'SEVERE WEATHER'} DISCUSSION IN ${stateLabel}`,
      event: 'Mesoscale Discussion',
      state: stateLabel,
      areaDesc: titleText(area),
      office: 'SPC',
      expiresAt: validUntil,
      issuedAt: new Date(properties.idp_filedate || Date.now()).toISOString(),
      hazards: {
        label: 'SPC',
        value: isWinter ? 'Discussion' : 'Severe WX',
        subtext: badge,
        hail: '',
        wind: ''
      },
      hazardStats,
      impactLine: compactArea,
      sourceText: compactArea,
      whatToDo: /watch \d+/i.test(concerning)
        ? 'A severe weather watch is in effect. Stay weather aware and be ready to act quickly if warnings are issued.'
        : 'Conditions are being monitored by SPC. Stay weather aware and have a plan to take shelter if warnings are issued.',
      mdDetails: {
        number,
        badges: ['SPC', isWinter ? 'WINTER WX' : 'SEVERE WX', badge],
        concerning: concernLines({ concerning, text, summary }),
        summary,
        area: compactArea,
        link: properties.popupinfo
      },
      polygon,
      center,
      locations: states.length ? states : [stateLabel],
      classification: {
        family: 'discussion',
        isWatch: false,
        isWarning: false,
        isEmergency: false,
        isPds: false,
        isDestructive: false,
        isDiscussion: true,
        alertTag: 'SPC',
        renderAsGif: false,
        theme
      },
      theme,
      radar: {
        mode: 'reflectivity'
      },
      postText: `SPC Mesoscale Discussion ${number || ''} for ${stateLabel}. ${summary || concerning}`.slice(0, 260)
    });
  }));

  return {
    updated: new Date().toISOString(),
    count: discussions.length,
    warnings: discussions
  };
};

export const SPC_MESOSCALE_DISCUSSION_SOURCES = {
  mapService: SPC_MD_QUERY_URL,
  rss: SPC_RSS_URL
};
