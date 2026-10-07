// Emergency declarations for the WeBot 24/7 stream.
//
// Nationwide federal EM declarations come from OpenFEMA. Governor-issued state
// emergencies are separate, so state providers are added from official state
// emergency-management / governor sources. Florida is the first state provider.
const FEMA_URL = 'https://www.fema.gov/api/open/v1/DisasterDeclarationsSummaries';
const FLORIDA_NEWS_URL = 'https://www.floridadisaster.org/news-media/';
const HEADERS = {
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  'User-Agent': 'weatherpower.app WeatherPower Live contact@weatherpower.app'
};

let cache = { at: 0, windowDays: 0, body: null };

const clean = (value, max = 180) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const iso = (value) => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

const fetchTimed = async (url, { json = false } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return json ? response.json() : response.text();
  } finally {
    clearTimeout(timer);
  }
};

const decodeHtml = (value) => String(value || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&ndash;|&#8211;/gi, '–')
  .replace(/&mdash;|&#8212;/gi, '—')
  .replace(/&#(d+);/g, (_m, n) => String.fromCharCode(Number(n) || 32));

const htmlText = (html) => clean(
  decodeHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')),
  200000
);

const parseUsDate = (text) => {
  const m = String(text || '').match(/\b(1[0-2]|0?[1-9])\/([0-3]?\d)\/(20\d{2})\b/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 16));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

const federalDeclarations = async (windowDays) => {
  const params = new URLSearchParams({
    '$filter': "disasterType eq 'EM'",
    '$orderby': 'declarationDate desc',
    '$top': '1000'
  });
  const json = await fetchTimed(`${FEMA_URL}?${params}`, { json: true });
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const grouped = new Map();

  for (const row of json.DisasterDeclarationsSummaries || []) {
    const declarationDate = iso(row.declarationDate);
    if (!declarationDate || Date.parse(declarationDate) < cutoff) continue;

    const state = clean(row.state, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) continue;

    const disasterNumber = Number(row.disasterNumber) || 0;
    const key = `FEMA-EM-${disasterNumber}-${state}`;
    let item = grouped.get(key);
    if (!item) {
      item = {
        id: key,
        sourceType: 'federal',
        source: 'FEMA OpenFEMA',
        sourceUrl: 'https://www.fema.gov/about/openfema/disaster-declarations-summaries',
        disasterNumber,
        state,
        title: clean(row.title || row.declarationTitle || 'Federal Emergency Declaration', 120),
        incidentType: clean(row.incidentType || 'Emergency', 80),
        declarationDate,
        incidentBeginDate: iso(row.incidentBeginDate),
        incidentEndDate: iso(row.incidentEndDate),
        designatedAreas: [],
        areaCount: 0,
        fresh: Date.now() - Date.parse(declarationDate) < 24 * 60 * 60 * 1000
      };
      grouped.set(key, item);
    }

    const area = clean(row.declaredCountyArea || row.designatedArea, 100);
    if (area && !item.designatedAreas.includes(area) && item.designatedAreas.length < 24) {
      item.designatedAreas.push(area);
    }
    item.areaCount += 1;
  }
  return [...grouped.values()];
};

const floridaStateEmergency = async (windowDays) => {
  const html = await fetchTimed(FLORIDA_NEWS_URL);
  const text = htmlText(html);

  // FDEM publishes current governor state-of-emergency announcements on its News & Media page.
  // Example wording: "Executive Order 26-202 declaring a state of emergency for 25 Florida counties
  // in preparation for Tropical Depression Nine..."
  const declaration = text.match(
    /Executive Order\s+([0-9]{2,4}-\d{1,3})\s+declaring a state of emergency for\s+(\d+)\s+Florida counties\s+in preparation for\s+([^,.]+)(?:,|\.)/i
  );
  if (!declaration) return [];

  const orderNumber = clean(declaration[1], 24);
  const expectedAreas = Number(declaration[2]) || 0;
  const incidentType = clean(declaration[3], 100);
  const declarationDate = parseUsDate(text);
  if (!declarationDate) return [];

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  if (Date.parse(declarationDate) < cutoff) return [];

  const countyMatch = text.match(
    /State of Emergency for the following counties:\s*([A-Za-z .,'-]+?)\.\s*(?:To continue|Visit|Updated:|$)/i
  );
  const counties = countyMatch
    ? countyMatch[1].split(',').map((s) => clean(s.replace(/\band\s+/i, ''), 80)).filter(Boolean)
    : [];

  return [{
    id: `FL-EO-${orderNumber}`,
    sourceType: 'state',
    source: 'Florida Division of Emergency Management',
    sourceUrl: FLORIDA_NEWS_URL,
    orderNumber,
    state: 'FL',
    title: clean(`State of Emergency — ${incidentType}`, 120),
    incidentType,
    declarationDate,
    incidentBeginDate: declarationDate,
    incidentEndDate: null,
    designatedAreas: counties,
    areaCount: counties.length || expectedAreas,
    fresh: Date.now() - Date.parse(declarationDate) < 48 * 60 * 60 * 1000
  }];
};

export const emergencyDeclarations = async ({ days = 45 } = {}) => {
  const windowDays = Math.max(7, Math.min(120, Math.round(Number(days) || 45)));
  if (cache.body && cache.windowDays === windowDays && Date.now() - cache.at < 5 * 60 * 1000) {
    return cache.body;
  }

  const settled = await Promise.allSettled([
    federalDeclarations(windowDays),
    floridaStateEmergency(windowDays)
  ]);

  const declarations = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') declarations.push(...result.value);
    else errors.push(clean(result.reason?.message || result.reason, 200));
  }

  if (!declarations.length && cache.body) return { ...cache.body, stale: true, errors };
  if (!declarations.length && errors.length === settled.length) {
    throw new Error(`Emergency declaration sources unavailable: ${errors.join('; ')}`);
  }

  const unique = [...new Map(declarations.map((item) => [item.id, item])).values()]
    .sort((a, b) => {
      if (a.sourceType !== b.sourceType) return a.sourceType === 'state' ? -1 : 1;
      return Date.parse(b.declarationDate || 0) - Date.parse(a.declarationDate || 0);
    })
    .slice(0, 50);

  const body = {
    source: 'Official state emergency-management sources + FEMA OpenFEMA',
    windowDays,
    fetchedAt: new Date().toISOString(),
    declarations: unique,
    errors
  };

  cache = { at: Date.now(), windowDays, body };
  return body;
};
