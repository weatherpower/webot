// Emergency declarations for the WeBot 24/7 stream.
//
// Nationwide federal EM declarations come from OpenFEMA. Governor-issued state
// emergencies are separate, so state providers are added from official state
// emergency-management / governor sources. Florida is the first state provider.
const FEMA_URL = 'https://www.fema.gov/api/open/v1/DisasterDeclarationsSummaries';
const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const FLORIDA_INDEX_URLS = [
  'https://www.floridadisaster.org/news-media/',
  'https://www.floridadisaster.org/news-media/news/',
  'https://www.flgov.com/eog/news',
  'https://www.flgov.com/eog/news/executive-orders'
];
// Keep the current official article as a bootstrap while the index pages update.
// It naturally ages out of the requested time window.
const FLORIDA_BOOTSTRAP_URLS = [
  'https://flgov.com/eog/news/press/2026/governor-ron-desantis-issues-executive-order-preparation-tropical-depression-nine',
  'https://www.floridadisaster.org/news-media/news/icymi-governor-ron-desantis-issues-executive-order-in-preparation-for-tropical-depression-nine/'
];

// Time-limited source-backed bootstrap for Alabama's October 7, 2026
// emergency proclamation ahead of Isaias. Expire after October 14 CDT.
const ALABAMA_ISAIAS_SOURCE = 'https://alabamareflector.com/2026/10/07/gov-kay-ivey-declares-state-of-emergency-as-isaias-approaches-gulf-coast/';
const ALABAMA_ISAIAS_COUNTIES = ["Autauga","Baldwin","Barbour","Bibb","Bullock","Butler","Chambers","Chilton","Clarke","Choctaw","Coffee","Conecuh","Coosa","Covington","Crenshaw","Dale","Dallas","Elmore","Escambia","Geneva","Greene","Hale","Henry","Houston","Lee","Lowndes","Macon","Marengo","Mobile","Monroe","Montgomery","Perry","Pickens","Pike","Russell","Sumter","Tallapoosa","Tuscaloosa","Washington","Wilcox"];
const ALABAMA_ISAIAS_DATE = '2026-10-07T21:00:00.000Z'; // State of emergency took effect at 4 PM CDT.
const ALABAMA_ISAIAS_END = '2026-10-15T04:59:59.000Z'; // October 14, 11:59pm CDT.
const ALABAMA_OFFICIAL_INDEXES = [
  'https://governor.alabama.gov/newsroom/category/state-of-emergency/',
  'https://governor.alabama.gov/newsroom/category/press-releases/'
];

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

const absoluteUrl = (href, base) => {
  try {
    const url = new URL(decodeHtml(href), base);
    if (!['www.floridadisaster.org', 'floridadisaster.org', 'www.flgov.com', 'flgov.com'].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
};

const linksFromHtml = (html, base) => {
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlText(m[2]);
    if (!/state of emergency|issues executive order|emergency management/i.test(label)) continue;
    const url = absoluteUrl(m[1], base);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
};

const parseFloridaEmergencyPage = (html, sourceUrl, windowDays) => {
  const text = htmlText(html);
  const declaration = text.match(
    /Executive Order\s+([0-9]{2,4}-\d{1,3})\s+declaring a state of emergency for\s+(\d+)\s+Florida counties\s+in preparation for\s+([^,.]+)(?:,|\.)/i
  );
  if (!declaration) return null;

  const orderNumber = clean(declaration[1], 24);
  const expectedAreas = Number(declaration[2]) || 0;
  const incidentType = clean(declaration[3], 100);
  // Florida's October 6 order was reposted by Florida Disaster on October 7.
  const declarationDate = orderNumber === '26-202'
    ? '2026-10-06T16:00:00.000Z' // Date known, clock time not asserted.
    : parseUsDate(text);
  if (!declarationDate) return null;

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  if (Date.parse(declarationDate) < cutoff) return null;

  const countyMatch = text.match(
    /State of Emergency for the following counties:\s*([A-Za-z .,'-]+?)\.\s*(?:To continue|Visit|Updated:|$)/i
  );
  const counties = countyMatch
    ? countyMatch[1].split(',').map((s) => clean(s.replace(/\band\s+/i, ''), 80)).filter(Boolean)
    : [];

  return {
    id: `FL-EO-${orderNumber}`,
    sourceType: 'state',
    source: sourceUrl.includes('floridadisaster.org')
      ? 'Florida Division of Emergency Management'
      : 'Executive Office of the Governor of Florida',
    sourceUrl,
    orderNumber,
    declaringAuthority: 'Governor Ron DeSantis',
    state: 'FL',
    title: clean(`State of Emergency — ${incidentType}`, 120),
    incidentType,
    declarationDate,
    incidentBeginDate: declarationDate,
    incidentEndDate: null,
    designatedAreas: counties,
    areaCount: counties.length || expectedAreas,
    fresh: Date.now() - Date.parse(declarationDate) < 48 * 60 * 60 * 1000
  };
};

const floridaStateEmergency = async (windowDays) => {
  const pages = new Map();
  const candidates = [...FLORIDA_BOOTSTRAP_URLS];

  for (const url of FLORIDA_INDEX_URLS) {
    try {
      const html = await fetchTimed(url);
      pages.set(url, html);
      for (const candidate of linksFromHtml(html, url)) {
        if (!candidates.includes(candidate) && candidates.length < 10) candidates.push(candidate);
      }
      const direct = parseFloridaEmergencyPage(html, url, windowDays);
      if (direct) return [direct];
    } catch {
      // One official Florida page being unavailable should not take out the whole emergency feed.
    }
  }

  for (const url of candidates) {
    try {
      const html = pages.get(url) || await fetchTimed(url);
      const item = parseFloridaEmergencyPage(html, url, windowDays);
      if (item) return [item];
    } catch {
      // Keep trying the remaining official source pages.
    }
  }
  return [];
};


const alabamaStateEmergency = async (windowDays) => {
  const declarationTime = Date.parse(ALABAMA_ISAIAS_DATE);
  const now = Date.now();
  // Historic declarations must not be presented as active state emergencies.
  if (now < declarationTime || now > Date.parse(ALABAMA_ISAIAS_END) ||
      declarationTime < now - windowDays * 24 * 60 * 60 * 1000) return [];

  let sourceUrl = ALABAMA_ISAIAS_SOURCE;
  let source = 'Alabama Reflector (verified reporting)';
  // Prefer the Governor's official posting when one becomes available.
  // An EMA storm forecast or NWS watch does NOT count as a proclamation.
  const indexes = await Promise.allSettled(ALABAMA_OFFICIAL_INDEXES.map(fetchTimed));
  const officialLinks = [];
  for (let i = 0; i < indexes.length; i++) {
    const result = indexes[i];
    if (result.status !== 'fulfilled') continue;
    for (const match of String(result.value).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = htmlText(match[2]);
      if (!/isaias|state of emergency/i.test(label)) continue;
      try {
        const url = new URL(decodeHtml(match[1]), ALABAMA_OFFICIAL_INDEXES[i]);
        if (url.hostname === 'governor.alabama.gov' &&
            /^\/newsroom\/2026\/10\//.test(url.pathname) &&
            !officialLinks.includes(url.href)) officialLinks.push(url.href);
      } catch { /* Ignore malformed index links. */ }
    }
  }
  for (const url of officialLinks.slice(0, 6)) {
    try {
      const text = htmlText(await fetchTimed(url));
      if (/\bIsaias\b/i.test(text) && /\bstate of emergency\b/i.test(text) &&
          /\bGovernor (?:Kay )?Ivey\b|\bKay Ivey\b/i.test(text) &&
          /\b40\b/.test(text) && !/termination of (?:the )?state of emergency/i.test(text)) {
        sourceUrl = url;
        source = 'Office of the Governor of Alabama';
        break;
      }
    } catch { /* Keep the independently reported declaration until official posting. */ }
  }
  return [{
    id: 'AL-SOE-ISAIAS-2026-10-07',
    sourceType: 'state',
    source,
    sourceUrl,
    state: 'AL',
    declaringAuthority: 'Governor Kay Ivey',
    title: 'State of Emergency — Tropical Storm Isaias',
    incidentType: 'Tropical Storm Isaias',
    declarationDate: ALABAMA_ISAIAS_DATE,
    incidentBeginDate: ALABAMA_ISAIAS_DATE,
    incidentEndDate: ALABAMA_ISAIAS_END,
    designatedAreas: ALABAMA_ISAIAS_COUNTIES,
    areaCount: ALABAMA_ISAIAS_COUNTIES.length,
    fresh: now - declarationTime < 48 * 60 * 60 * 1000
  }];
};

// The governor's order keeps its original wording; NHC supplies the current
// name/classification for broadcast when AL092026 is active.
const nhcIsaias = async () => {
  const body = await fetchTimed(NHC_URL, {json:true});
  const storm = (body?.activeStorms || []).find((s) =>
    String(s?.id || '').toLowerCase() === 'al092026' &&
    String(s?.name || '').toLowerCase() === 'isaias');
  if (!storm) return null;
  const type = ({HU:'Hurricane',TS:'Tropical Storm',TD:'Tropical Depression',
    SS:'Subtropical Storm',SD:'Subtropical Depression'})[String(storm.classification || '').toUpperCase()];
  return type ? {incidentType: type + ' Isaias', sourceUrl:'https://www.nhc.noaa.gov/'} : null;
};

export const emergencyDeclarations = async ({ days = 45 } = {}) => {
  const windowDays = Math.max(7, Math.min(120, Math.round(Number(days) || 45)));
  if (cache.body && cache.windowDays === windowDays && Date.now() - cache.at < 5 * 60 * 1000) {
    return cache.body;
  }

  const [settled, nhc] = await Promise.all([
    Promise.allSettled([federalDeclarations(windowDays), floridaStateEmergency(windowDays), alabamaStateEmergency(windowDays)]),
    nhcIsaias().catch(() => null)
  ]);

  const declarations = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') declarations.push(...result.value);
    else errors.push(clean(result.reason?.message || result.reason, 200));
  }

  for (const item of declarations) {
    if (item.state === 'FL' && item.orderNumber === '26-202') {
      item.originalIncidentType = item.incidentType;
      item.incidentType = nhc?.incidentType || 'Isaias'; // When NHC is offline, use current name without guessing storm strength.
      item.title = clean('State of Emergency — ' + item.incidentType, 120);
      if (nhc) item.stormSourceUrl = nhc.sourceUrl;
    }
    if (item.state === 'AL' && item.id === 'AL-SOE-ISAIAS-2026-10-07' && nhc) {
      item.incidentType = nhc.incidentType;
      item.title = clean('State of Emergency — ' + item.incidentType, 120);
      item.stormSourceUrl = nhc.sourceUrl;
    }
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
    source: 'State emergency sources (official and attributed reporting) + FEMA OpenFEMA',
    windowDays,
    fetchedAt: new Date().toISOString(),
    declarations: unique,
    errors
  };

  cache = { at: Date.now(), windowDays, body };
  return body;
};
