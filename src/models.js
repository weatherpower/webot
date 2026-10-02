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

// A complete segment: animation frames for one model/field plus the hot-spot comparison and WeBot's take.
const segmentCache = new Map();
export const modelSegment = async ({ model = 'hrrr', field = 'refc', lat, lon, place = 'your area', horizon } = {}) => {
  const catalog = await modelCatalog();
  const m = catalog.models.find((x) => x.key === model);
  const f = catalog.fields.find((x) => x.key === field);
  if (!m || !f || !f.models.includes(model) || f.kind === 'contour') throw Object.assign(new Error('Unknown model or field'), { status: 400 });
  const horizonH = Math.min(240, Math.max(6, Number(horizon) || (m.regional ? 18 : 120)));
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
