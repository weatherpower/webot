// Recent FEMA federal emergency declarations for the WeBot 24/7 stream.
// OpenFEMA is the official nationwide source here. These are federal EM declarations,
// not a claim that every governor-issued state emergency is represented.
const FEMA_URL = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';
const FEMA_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'weatherpower.app WeatherPower Live contact@weatherpower.app'
};

let cache = { at: 0, windowDays: 0, body: null };

const clean = (value, max = 180) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const iso = (value) => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export const emergencyDeclarations = async ({ days = 45 } = {}) => {
  const windowDays = Math.max(7, Math.min(120, Math.round(Number(days) || 45)));
  if (cache.body && cache.windowDays === windowDays && Date.now() - cache.at < 10 * 60 * 1000) {
    return cache.body;
  }

  const params = new URLSearchParams({
    '$filter': "declarationType eq 'EM'",
    '$orderby': 'declarationDate desc',
    '$top': '1000'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${FEMA_URL}?${params}`, {
      headers: FEMA_HEADERS,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (cache.body) return { ...cache.body, stale: true };
    throw new Error(`FEMA emergency declarations ${response.status}`);
  }

  const json = await response.json();
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const grouped = new Map();

  for (const row of json.DisasterDeclarationsSummaries || []) {
    const declarationDate = iso(row.declarationDate);
    if (!declarationDate || Date.parse(declarationDate) < cutoff) continue;

    const state = clean(row.state, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) continue;

    const disasterNumber = Number(row.disasterNumber) || 0;
    const key = `EM-${disasterNumber}-${state}`;
    let item = grouped.get(key);

    if (!item) {
      item = {
        id: key,
        disasterNumber,
        state,
        title: clean(row.declarationTitle || row.title || 'Emergency Declaration', 120),
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

    const area = clean(row.designatedArea, 100);
    if (area && !item.designatedAreas.includes(area) && item.designatedAreas.length < 12) {
      item.designatedAreas.push(area);
    }
    item.areaCount += 1;
  }

  const body = {
    source: 'FEMA OpenFEMA',
    sourceUrl: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
    windowDays,
    fetchedAt: new Date().toISOString(),
    declarations: [...grouped.values()]
      .sort((a, b) => Date.parse(b.declarationDate) - Date.parse(a.declarationDate))
      .slice(0, 40)
  };

  cache = { at: Date.now(), windowDays, body };
  return body;
};
