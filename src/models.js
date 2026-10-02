// Model segments for WeatherPower Live, built on Model Studio (WeatherPower Radar 3.1): HRRR, NAM 3km,
// GFS and ECMWF fields rendered by the WeatherPower render service. Hours or fields the service reports
// as unavailable stay unavailable; nothing is interpolated or substituted.
import { config } from './config.js';

const MODEL_API = String(process.env.WP_MODEL_API_BASE || 'https://weatherpower.app/wpcc-render/api/models').replace(/\/$/, '');
const HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service', Accept: 'application/json' };
const HOUR = 3600 * 1000;

const getJson = async (path, timeoutMs = 20000) => {
  const response = await fetch(`${MODEL_API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Model service ${response.status}`), { status: 502 });
  return body;
};

const runKey = (iso) => new Date(iso).toISOString().slice(0, 13).replace(/[-T]/g, '');
const runTime = (key) => Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), +key.slice(8, 10));

let catalogCache = { at: 0, body: null };
export const modelCatalog = async () => {
  if (catalogCache.body && Date.now() - catalogCache.at < HOUR) return catalogCache.body;
  catalogCache = { at: Date.now(), body: await getJson('/catalog') };
  return catalogCache.body;
};

// Newest run that already reaches `needHour`; otherwise the newest run with the most hours.
const runsCache = new Map();
const pickRun = async (model, needHour) => {
  let cached = runsCache.get(model);
  if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
    cached = { at: Date.now(), runs: await getJson(`/runs/${model}`) };
    runsCache.set(model, cached);
  }
  const runs = (cached.runs || []).filter((run) => (run.hours || []).length);
  if (!runs.length) return null;
  const reaching = runs.find((run) => Math.max(...run.hours) >= needHour);
  const chosen = reaching || [...runs].sort((a, b) => b.hours.length - a.hours.length)[0];
  return { key: runKey(chosen.run), label: chosen.label, hours: chosen.hours };
};

const prefetched = new Map();
const prefetch = (model, run, field, first) => {
  const id = `${model}/${run}/${field}`;
  if (Date.now() - (prefetched.get(id) || 0) < 10 * 60 * 1000) return;
  prefetched.set(id, Date.now());
  getJson(`/prefetch?model=${model}&run=${run}&field=${field}&first=${first}`).catch(() => prefetched.delete(id));
};

// Hours of `run` that fall inside [now, now + horizonH], thinned to at most `max`.
const windowHours = (run, horizonH, max, minFhr = 0) => {
  const t0 = runTime(run.key);
  const nowF = (Date.now() - t0) / HOUR;
  let hours = run.hours.filter((h) => h >= minFhr && h >= Math.floor(nowF) && h <= nowF + horizonH);
  if (!hours.length) hours = run.hours.filter((h) => h >= minFhr).slice(-1);
  if (hours.length > max) {
    const step = (hours.length - 1) / (max - 1);
    hours = Array.from({ length: max }, (_, i) => hours[Math.round(i * step)]);
  }
  return [...new Set(hours)];
};

const valueCache = new Map();
const valueAt = async (model, run, field, fhr, lat, lon) => {
  const id = `${model}/${run}/${field}/${fhr}/${lat.toFixed(2)}/${lon.toFixed(2)}`;
  if (valueCache.has(id)) return valueCache.get(id);
  const promise = getJson(`/value?model=${model}&run=${run}&field=${field}&fhr=${fhr}&lat=${lat}&lon=${lon}`, 60000)
    .then((body) => (body.unavailable || body.value == null ? null : Number(body.value)))
    .catch(() => null);
  valueCache.set(id, promise);
  if (valueCache.size > 2000) valueCache.delete(valueCache.keys().next().value);
  return promise;
};

const ACCUMULATED = new Set(['qpf', 'snow']);

// One number per model for the hot spot: the window total for accumulated fields, the peak otherwise.
const compareModels = async (catalog, fieldKey, horizonH, lat, lon) => {
  const field = catalog.fields.find((f) => f.key === fieldKey);
  const models = catalog.models.filter((m) => field.models.includes(m.key));
  return Promise.all(models.map(async (m) => {
    const run = await pickRun(m.key, 0).catch(() => null);
    if (!run) return { model: m.key, name: m.name, value: null, note: 'no run' };
    const nowF = (Date.now() - runTime(run.key)) / HOUR;
    if (Math.max(...run.hours) < nowF + horizonH * 0.75) return { model: m.key, name: m.name, run: run.label, value: null, note: 'out of range' };
    if (ACCUMULATED.has(fieldKey)) {
      const hours = windowHours(run, horizonH, 400, 0);
      const startH = hours[0];
      const endH = hours[hours.length - 1];
      const [start, end] = await Promise.all([
        startH < field.min_fhr ? 0 : valueAt(m.key, run.key, fieldKey, startH, lat, lon),
        valueAt(m.key, run.key, fieldKey, endH, lat, lon)
      ]);
      const value = start == null || end == null ? null : Math.max(0, end - start);
      return { model: m.key, name: m.name, run: run.label, value, hours: [startH, endH] };
    }
    const hours = windowHours(run, horizonH, 5, field.min_fhr);
    const values = (await Promise.all(hours.map((h) => valueAt(m.key, run.key, fieldKey, h, lat, lon)))).filter((v) => v != null);
    return { model: m.key, name: m.name, run: run.label, value: values.length ? Math.max(...values) : null, hours };
  }));
};

const fmt = (value, units) => {
  if (value == null) return 'n/a';
  if (units === 'in') return `${value.toFixed(value >= 10 ? 0 : value >= 1 ? 1 : 2)}"`;
  if (units === '°F') return `${Math.round(value)}°F`;
  if (units === 'J/kg') return `${(Math.round(value / 50) * 50).toLocaleString('en-US')} J/kg`;
  return `${Math.round(value)} ${units}`;
};

const describe = (fieldKey, v) => {
  switch (fieldKey) {
    case 'refc':
      return v < 20 ? 'keeps it dry' : v < 40 ? 'brings in some light rain or showers' : v < 50 ? 'shows thunderstorms moving through' : 'shows strong storms with intense cores';
    case 'ptype':
      return v < 20 ? 'keeps precipitation away' : 'brings in precipitation';
    case 'cape':
      return v < 250 ? 'shows very little instability' : v < 1000 ? 'shows some instability' : v < 2500 ? 'shows moderate instability, enough for thunderstorms' : 'shows very unstable air, fuel for strong storms';
    case 'uh':
      return v < 25 ? 'shows no organized rotating storms' : v < 75 ? 'shows some rotating updrafts' : 'shows strong rotating storms, a supercell signal';
    case 'qpf':
      return v < 0.05 ? 'keeps it mostly dry' : v < 0.5 ? `brings light rain, about ${fmt(v, 'in')}` : v < 1.5 ? `brings a soaking, about ${fmt(v, 'in')}` : `brings heavy rain, around ${fmt(v, 'in')}`;
    case 'snow':
      return v < 0.1 ? 'shows no snow' : `shows about ${fmt(v, 'in')} of snow`;
    case 't2m':
      return `tops out near ${Math.round(v)} degrees`;
    case 'td2m':
      return `peaks with dew points near ${Math.round(v)}`;
    case 'gust':
      return v < 25 ? 'keeps winds light' : `shows gusts up to ${Math.round(v)} miles per hour`;
    case 'wind10':
      return `shows winds up to ${Math.round(v)} miles per hour`;
    case 'pwat':
      return `shows precipitable water near ${v.toFixed(1)} inches`;
    default:
      return `shows ${fmt(v, '')}`;
  }
};

const windowWords = (horizonH) => (horizonH <= 24 ? `the next ${horizonH} hours` : `the next ${Math.round(horizonH / 24)} days`);

// WeBot's spoken take, built only from the returned numbers.
export const modelTake = (fieldKey, fieldName, units, compare, leadModel, place, horizonH) => {
  const known = compare.filter((c) => c.value != null);
  const lead = known.find((c) => c.model === leadModel) || known[0];
  if (!lead) return `I checked the models for ${place}, but the model service doesn't have ${fieldName.toLowerCase()} there right now.`;
  let text = `Let me check the models for ${place} over ${windowWords(horizonH)}. The ${lead.name} ${describe(fieldKey, lead.value)}.`;
  const others = known.filter((c) => c !== lead);
  if (others.length) {
    const values = known.map((c) => c.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const spread = hi - lo;
    const tight = units === 'in' ? spread <= Math.max(0.25, hi * 0.3) : units === '°F' ? spread <= 4 : spread <= Math.max(10, hi * 0.3);
    if (tight) text += ` The ${others.map((c) => c.name).join(' and ')} agree${others.length === 1 ? 's' : ''}.`;
    else {
      const min = known.find((c) => c.value === lo);
      const max = known.find((c) => c.value === hi);
      text += ` The models disagree, though: the ${min.name} shows ${fmt(lo, units)} while the ${max.name} shows ${fmt(hi, units)}.`;
    }
  }
  return text;
};

/* ---------------- national model checks ---------------- */

// Big cities spread across the lower 48. A national check scans all of them with the lead model.
export const NATIONAL_SPOTS = [
  ['Seattle, Washington', 47.61, -122.33], ['San Francisco, California', 37.77, -122.42], ['Los Angeles, California', 34.05, -118.24],
  ['Phoenix, Arizona', 33.45, -112.07], ['Salt Lake City, Utah', 40.76, -111.89], ['Billings, Montana', 45.78, -108.5],
  ['Denver, Colorado', 39.74, -104.99], ['Bismarck, North Dakota', 46.81, -100.78], ['Oklahoma City, Oklahoma', 35.47, -97.52],
  ['Dallas, Texas', 32.78, -96.8], ['Houston, Texas', 29.76, -95.37], ['Kansas City, Missouri', 39.1, -94.58],
  ['Minneapolis, Minnesota', 44.98, -93.27], ['New Orleans, Louisiana', 29.95, -90.07], ['Chicago, Illinois', 41.88, -87.63],
  ['Nashville, Tennessee', 36.16, -86.78], ['Atlanta, Georgia', 33.75, -84.39], ['Detroit, Michigan', 42.33, -83.05],
  ['Miami, Florida', 25.76, -80.19], ['Charlotte, North Carolina', 35.23, -80.84], ['Washington, D.C.', 38.91, -77.04],
  ['New York City, New York', 40.71, -74.01], ['Boston, Massachusetts', 42.36, -71.06]
].map(([place, lat, lon]) => ({ place, lat, lon }));

// Runs async jobs a few at a time so a national scan doesn't flood Model Studio.
const pool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
};

// One number per city from the lead model: the window total for accumulated fields, the peak otherwise.
const scanNation = async (field, model, run, horizonH, spots = NATIONAL_SPOTS) => {
  const accumulated = ACCUMULATED.has(field.key);
  const hours = accumulated ? windowHours(run, horizonH, 400, 0) : windowHours(run, horizonH, 3, field.min_fhr);
  const startH = hours[0];
  const endH = hours[hours.length - 1];
  return pool(spots, 6, async (spot) => {
    let value = null;
    if (accumulated) {
      const [start, end] = await Promise.all([
        startH < field.min_fhr ? 0 : valueAt(model, run.key, field.key, startH, spot.lat, spot.lon),
        valueAt(model, run.key, field.key, endH, spot.lat, spot.lon)
      ]);
      value = start == null || end == null ? null : Math.max(0, end - start);
    } else {
      const values = (await Promise.all(hours.map((h) => valueAt(model, run.key, field.key, h, spot.lat, spot.lon)))).filter((v) => v != null);
      value = values.length ? Math.max(...values) : null;
    }
    return { ...spot, value };
  });
};

const QUIET_BELOW = { refc: 20, ptype: 20, cape: 250, uh: 25, qpf: 0.05, snow: 0.1, gust: 25 };
const LEAD_IN = {
  refc: 'The strongest storms', ptype: 'The most precipitation', cape: 'The most unstable air', uh: 'The strongest rotating storms',
  qpf: 'The heaviest rain', snow: 'The most snow', t2m: 'The warmest spot', td2m: 'The most humid air', gust: 'The strongest wind gusts',
  wind10: 'The strongest winds', pwat: 'The deepest moisture'
};
const NUMERIC_FIELDS = new Set(['cape', 'qpf', 'snow', 't2m', 'td2m', 'gust', 'wind10', 'pwat']);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const listJoin = (items) => (items.length <= 1 ? items[0] || '' : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);
const isQuiet = (fieldKey, v) => fieldKey in QUIET_BELOW && v < QUIET_BELOW[fieldKey];
const cityOf = (place) => place.split(',')[0];

// WeBot's national take, built only from the returned numbers.
// region: a state name when the stream is focused on one state (its spots are "southeastern Oklahoma" etc.).
export const nationalTake = (fieldKey, fieldName, units, spots, compare, leadModel, leadName, horizonH, region = '') => {
  const known = spots.filter((s) => s.value != null).sort((a, b) => b.value - a.value);
  const area = region || 'the whole country';
  if (!known.length) return `I checked the ${leadName} across ${region || 'the country'}, but the model service doesn't have ${fieldName.toLowerCase()} right now.`;
  const top = known[0];
  const at = (place) => (region ? 'in ' + place : 'near ' + place);
  const short = (place) => (region ? place.replace(new RegExp('\\s*' + region + '$'), '') || place : cityOf(place));
  let text = `Let me check the models across ${area} over ${windowWords(horizonH)}.`;
  if (isQuiet(fieldKey, top.value)) return `${text} The ${leadName} ${describe(fieldKey, top.value)} ${region ? 'across ' + region : 'from coast to coast'}.`;
  // Fields people know by the number get the number; radar-style fields get described.
  text += NUMERIC_FIELDS.has(fieldKey)
    ? ` ${LEAD_IN[fieldKey]} in the ${leadName} is ${at(top.place)}, around ${fmt(top.value, units)}.`
    : ` The ${leadName} ${describe(fieldKey, top.value)} ${at(top.place)}.`;
  const next = known.slice(1, 3).filter((s) => !isQuiet(fieldKey, s.value));
  if (next.length) text += ` ${cap(listJoin(next.map((s) => short(s.place))))} ${region ? 'parts of the state' : ''}${next.length === 1 ? (region ? ' are' : 'is') : ' are'} next.`.replace('  ', ' ');
  const others = compare.filter((c) => c.value != null && c.model !== leadModel);
  const lead = compare.find((c) => c.model === leadModel && c.value != null);
  if (lead && others.length) {
    const values = [lead, ...others].map((c) => c.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const tight = units === 'in' ? hi - lo <= Math.max(0.25, hi * 0.3) : units === '°F' ? hi - lo <= 4 : hi - lo <= Math.max(10, hi * 0.3);
    if (tight) text += ` The ${others.map((c) => c.name).join(' and ')} agree${others.length === 1 ? 's' : ''} ${region ? 'in ' + top.place : 'near ' + cityOf(top.place)}.`;
    else {
      const all = [lead, ...others];
      text += ` ${region ? 'In ' + top.place : 'Near ' + cityOf(top.place)} the models disagree, though: the ${all.find((c) => c.value === lo).name} shows ${fmt(lo, units)} while the ${all.find((c) => c.value === hi).name} shows ${fmt(hi, units)}.`;
    }
  }
  return text;
};

// A complete segment: animation frames for one model/field plus the comparison and WeBot's take.
// With no lat/lon it is a national check (the default for the live stream).
const segmentCache = new Map();
export const modelSegment = async ({ model = 'hrrr', field = 'refc', lat, lon, place = 'your area', horizon, points, region } = {}) => {
  const catalog = await modelCatalog();
  const m = catalog.models.find((x) => x.key === model);
  const f = catalog.fields.find((x) => x.key === field);
  if (!m || !f || !f.models.includes(model) || f.kind === 'contour') throw Object.assign(new Error('Unknown model or field'), { status: 400 });
  const horizonH = Math.min(240, Math.max(6, Number(horizon) || (m.regional ? 18 : 120)));
  // A focused state sends its own sample points ("lat,lon,label;…").
  const spots = parsePoints(points);
  if (spots.length) return nationalSegment(catalog, m, f, horizonH, { spots, region: String(region || '').slice(0, 40) });
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || lat === '' || lon === '') return nationalSegment(catalog, m, f, horizonH);
  const pointLat = Number.isFinite(Number(lat)) ? Number(lat) : config.forecast.lat;
  const pointLon = Number.isFinite(Number(lon)) ? Number(lon) : config.forecast.lon;
  const id = [model, field, horizonH, pointLat.toFixed(1), pointLon.toFixed(1)].join('/');
  const cached = segmentCache.get(id);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
    return { ...cached.body, place, take: modelTake(field, f.name, f.units, cached.body.compare, model, place, cached.body.horizonH) };
  }

  const run = await pickRun(model, Math.min(horizonH, m.regional ? 18 : horizonH));
  if (!run) throw Object.assign(new Error(`No ${m.name} runs are published right now`), { status: 503 });
  const hours = windowHours(run, horizonH, 20, f.min_fhr);
  prefetch(model, run.key, field, hours[0] ?? 0);
  const compare = await compareModels(catalog, field, horizonH, pointLat, pointLon);
  const [west, east, south, north] = m.extent;
  const body = {
    model: m.key,
    modelName: m.name,
    source: m.source,
    run: run.key,
    runLabel: run.label,
    field: { key: f.key, name: f.name, units: f.units, legend: f.legend || [], kind: f.kind, note: (f.notes || {})[model] || '' },
    horizonH,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    // Served through this service (/api/v3/models/frame/...) so new hours render from any origin.
    frames: hours.map((h) => ({ fhr: h, valid: new Date(runTime(run.key) + h * HOUR).toISOString(), path: `/api/v3/models/frame/${model}/${run.key}/${field}/${h}.webp` })),
    point: { lat: pointLat, lon: pointLon },
    compare: compare.map((c) => ({ ...c, display: fmt(c.value, f.units) })),
    take: modelTake(field, f.name, f.units, compare, model, place, horizonH),
    credit: `Models: ${m.source || m.name} via WeatherPower Model Studio`
  };
  segmentCache.set(id, { at: Date.now(), body });
  if (segmentCache.size > 100) segmentCache.delete(segmentCache.keys().next().value);
  return { ...body, take: modelTake(field, f.name, f.units, compare, model, place, horizonH), place };
};

const parsePoints = (text) => String(text || '').split(';').slice(0, 40).map((part) => {
  const [la, lo, ...label] = part.split(',');
  const lat = Number(la);
  const lon = Number(lo);
  const placeName = label.join(',').replace(/[^\w .'-]/g, '').trim().slice(0, 60);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && placeName ? { lat, lon, place: placeName } : null;
}).filter(Boolean);

const nationalSegment = async (catalog, m, f, horizonH, { spots = NATIONAL_SPOTS, region = '' } = {}) => {
  const id = [region ? 'region:' + region + ':' + spots.length : 'national', m.key, f.key, horizonH].join('/');
  const cached = segmentCache.get(id);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.body;
  const run = await pickRun(m.key, Math.min(horizonH, m.regional ? 18 : horizonH));
  if (!run) throw Object.assign(new Error(`No ${m.name} runs are published right now`), { status: 503 });
  const hours = windowHours(run, horizonH, 20, f.min_fhr);
  prefetch(m.key, run.key, f.key, hours[0] ?? 0);
  // Several sample points share an area label in a state: keep the strongest per area.
  const best = new Map();
  for (const s of await scanNation(f, m.key, run, horizonH, spots)) {
    if (s.value == null) continue;
    if (!best.has(s.place) || s.value > best.get(s.place).value) best.set(s.place, s);
  }
  const scanned = [...best.values()].sort((a, b) => b.value - a.value);
  const top = scanned[0] || spots[Math.floor(spots.length / 2)] || NATIONAL_SPOTS.find((s) => s.place.startsWith('Kansas City'));
  const compare = await compareModels(catalog, f.key, horizonH, top.lat, top.lon);
  const [west, east, south, north] = m.extent;
  const body = {
    model: m.key,
    modelName: m.name,
    source: m.source,
    run: run.key,
    runLabel: run.label,
    field: { key: f.key, name: f.name, units: f.units, legend: f.legend || [], kind: f.kind, note: (f.notes || {})[m.key] || '' },
    horizonH,
    scope: 'national',
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    frames: hours.map((h) => ({ fhr: h, valid: new Date(runTime(run.key) + h * HOUR).toISOString(), path: `/api/v3/models/frame/${m.key}/${run.key}/${f.key}/${h}.webp` })),
    point: { lat: top.lat, lon: top.lon },
    place: region || 'the whole country',
    region: region || null,
    topPlace: scanned[0]?.place || null,
    spots: scanned.slice(0, 5).map((s) => ({ place: s.place, lat: s.lat, lon: s.lon, value: s.value, display: fmt(s.value, f.units) })),
    compare: compare.map((c) => ({ ...c, display: fmt(c.value, f.units) })),
    take: nationalTake(f.key, f.name, f.units, scanned, compare, m.key, m.name, horizonH, region),
    credit: `Models: ${m.source || m.name} via WeatherPower Model Studio`
  };
  segmentCache.set(id, { at: Date.now(), body });
  if (segmentCache.size > 100) segmentCache.delete(segmentCache.keys().next().value);
  return body;
};

// Model Studio frame passthrough with a small in-memory cache. Model Studio only renders a new hour for
// weatherpower.app pages or keyed requests, so the stream asks through here (with the key when configured).
const frameCache = new Map();
const frameInflight = new Map();
export const modelFrame = async ({ model, run, field, hour }) => {
  const catalog = await modelCatalog();
  const h = Number(hour);
  if (!catalog.models.some((m) => m.key === model) || !catalog.fields.some((f) => f.key === field) || !/^\d{10}$/.test(run) || !Number.isInteger(h) || h < 0 || h > 384) {
    throw Object.assign(new Error('Unknown model frame'), { status: 400 });
  }
  const id = `${model}/${run}/${field}/${h}`;
  const cached = frameCache.get(id);
  if (cached) {
    frameCache.delete(id);
    frameCache.set(id, cached);
    return cached;
  }
  if (frameInflight.has(id)) return frameInflight.get(id);
  const promise = (async () => {
    const headers = { 'User-Agent': HEADERS['User-Agent'] };
    if (config.weatherPowerApi.key) headers['X-API-Key'] = config.weatherPowerApi.key;
    const response = await fetch(`${MODEL_API}/frame/${id}.webp`, { headers, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Object.assign(new Error(`Model frame ${response.status}`), { status: response.status === 404 ? 404 : 502 });
    const body = Buffer.from(await response.arrayBuffer());
    frameCache.set(id, body);
    while (frameCache.size > 40) frameCache.delete(frameCache.keys().next().value);
    return body;
  })().finally(() => frameInflight.delete(id));
  frameInflight.set(id, promise);
  return promise;
};

/* ---------------- WeatherPower Developers API: sounding chart (needs WEATHERPOWER_API_KEY) ---------------- */

const soundingCache = new Map();
export const soundingAvailable = () => Boolean(config.weatherPowerApi.key);
export const soundingPng = async ({ lat, lon, fhr = 0 }) => {
  if (!config.weatherPowerApi.key) throw Object.assign(new Error('Set WEATHERPOWER_API_KEY to show soundings'), { status: 503 });
  const la = Number(lat).toFixed(2);
  const lo = Number(lon).toFixed(2);
  const hour = Math.min(18, Math.max(0, Math.round(Number(fhr) || 0)));
  const id = `${la}/${lo}/${hour}`;
  const cached = soundingCache.get(id);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.body;
  const response = await fetch(`${config.weatherPowerApi.renderBase}/v1/sounding.png?lat=${la}&lon=${lo}&fhr=${hour}`, {
    headers: { 'X-API-Key': config.weatherPowerApi.key, 'User-Agent': HEADERS['User-Agent'] },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw Object.assign(new Error(`Sounding service ${response.status}`), { status: 502 });
  const body = { png: Buffer.from(await response.arrayBuffer()), run: response.headers.get('x-hrrr-run'), valid: response.headers.get('x-hrrr-valid') };
  soundingCache.set(id, { at: Date.now(), body });
  if (soundingCache.size > 40) soundingCache.delete(soundingCache.keys().next().value);
  return body;
};
