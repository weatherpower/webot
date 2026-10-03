// Gas prices for WeatherPower Live, from the same sources as the WeatherPower radar's gas layer:
// prices are the U.S. EIA weekly retail survey (API v2; EIA_API_KEY, or the shared DEMO_KEY), and
// station locations are the OpenStreetMap tiles built on the render service (gas_build.py).
// EIA publishes state / regional weekly averages, not each station's posted price.
import { FORECAST_CITIES } from './cityForecast.js';

const EIA = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';
const GAS_BASE = String(process.env.GAS_STATIONS_BASE || 'https://weatherpower.app/wpcc-render/gas/').replace(/\/?$/, '/');
const PRICE_TTL = 3 * 3600 * 1000;
const TILE_TTL = 24 * 3600 * 1000;
const HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service (gas prices)' };

export const GAS_PRODUCTS = { EPMR: 'Regular', EPMM: 'Midgrade', EPMP: 'Premium', EPD2D: 'Diesel' };
// States EIA prices on their own; everyone else gets their PADD region.
const STATE_SERIES = { CA: 'SCA', CO: 'SCO', FL: 'SFL', MA: 'SMA', MN: 'SMN', NY: 'SNY', OH: 'SOH', TX: 'STX', WA: 'SWA' };
const PADD = {
  R1X: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'], R1Y: ['DE', 'DC', 'MD', 'NJ', 'NY', 'PA'], R1Z: ['FL', 'GA', 'NC', 'SC', 'VA', 'WV'],
  R20: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'MO', 'NE', 'ND', 'SD', 'OH', 'OK', 'TN', 'WI'], R30: ['AL', 'AR', 'LA', 'MS', 'NM', 'TX'],
  R40: ['CO', 'ID', 'MT', 'UT', 'WY'], R5XCA: ['AK', 'AZ', 'HI', 'NV', 'OR', 'WA'], SCA: ['CA']
};
export const GAS_AREAS = {
  NUS: 'U.S. average', R1X: 'New England', R1Y: 'Central Atlantic', R1Z: 'Lower Atlantic', R20: 'Midwest', R30: 'Gulf Coast',
  R40: 'Rocky Mountains', R5XCA: 'West Coast', SCA: 'California', SCO: 'Colorado', SFL: 'Florida', SMA: 'Massachusetts',
  SMN: 'Minnesota', SNY: 'New York', SOH: 'Ohio', STX: 'Texas', SWA: 'Washington'
};
const REGIONS = ['R1X', 'R1Y', 'R1Z', 'R20', 'R30', 'R40', 'R5XCA', 'SCA'];
const STATE_TO_PADD = {};
Object.entries(PADD).forEach(([area, states]) => states.forEach((s) => { STATE_TO_PADD[s] = STATE_TO_PADD[s] || area; }));

let priceCache = { at: 0, body: null };
let pricePending = null;

// { area: { period, prev, EPMR: { price, change }, ... } } from the last few weeks of the survey.
const loadPrices = async () => {
  if (priceCache.body && Date.now() - priceCache.at < PRICE_TTL) return priceCache.body;
  if (pricePending) return pricePending;
  const start = new Date(Date.now() - 35 * 86400 * 1000).toISOString().slice(0, 10);
  const params = ['frequency=weekly', 'data[0]=value', 'facets[process][]=PTE', ...Object.keys(GAS_PRODUCTS).map((p) => 'facets[product][]=' + p),
    'start=' + start, 'sort[0][column]=period', 'sort[0][direction]=desc', 'length=1000', 'api_key=' + encodeURIComponent(process.env.EIA_API_KEY || 'DEMO_KEY')];
  pricePending = fetch(EIA + '?' + params.join('&'), { headers: HEADERS, signal: AbortSignal.timeout(20000) })
    .then((r) => { if (!r.ok) throw new Error('EIA ' + r.status); return r.json(); })
    .then((j) => {
      const series = {};
      for (const row of j.response?.data || []) {
        const v = Number(row.value);
        if (!GAS_PRODUCTS[row.product] || !Number.isFinite(v)) continue;
        ((series[row.duoarea] ||= {})[row.product] ||= []).push({ period: row.period, v });
      }
      const areas = {};
      for (const [area, products] of Object.entries(series)) {
        const out = { period: null, prev: null };
        for (const [p, rows] of Object.entries(products)) {
          rows.sort((a, b) => (a.period < b.period ? 1 : -1));
          out[p] = { price: rows[0].v, change: rows[1] ? Math.round((rows[0].v - rows[1].v) * 1000) / 1000 : null, period: rows[0].period };
          if (!out.period || rows[0].period > out.period) { out.period = rows[0].period; out.prev = rows[1]?.period || null; }
        }
        areas[area] = out;
      }
      if (!areas.NUS) throw new Error('EIA returned no national prices');
      priceCache = { at: Date.now(), body: areas };
      return areas;
    })
    .catch((error) => { if (priceCache.body) return priceCache.body; throw error; })
    .finally(() => { pricePending = null; });
  return pricePending;
};

// A state's prices: its own series when EIA has one, filling missing grades from its region, then the U.S.
const pricesFor = (areas, state) => {
  const chain = [STATE_SERIES[state], STATE_TO_PADD[state], 'NUS'].filter(Boolean);
  const out = { area: chain[0], areaName: GAS_AREAS[chain[0]], products: {} };
  for (const p of Object.keys(GAS_PRODUCTS)) {
    const from = chain.find((a) => areas[a]?.[p]);
    if (from) out.products[p] = { ...areas[from][p], area: from };
  }
  return out;
};

// Station tiles are JSONP: WPGasTile("33_-95",[[lat, lon, name, brand, street, city, state, zip], ...])
const tiles = new Map();
const loadTile = async (key) => {
  const hit = tiles.get(key);
  if (hit && Date.now() - hit.at < TILE_TTL) return hit.rows;
  let rows = [];
  try {
    const r = await fetch(GAS_BASE + 't/' + key + '.js', { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const text = await r.text();
      const start = text.indexOf('[');
      rows = JSON.parse(text.slice(start, text.lastIndexOf(']') + 1));
    }
  } catch { rows = hit?.rows || []; }
  tiles.set(key, { at: Date.now(), rows });
  if (tiles.size > 200) tiles.delete(tiles.keys().next().value);
  return rows;
};

const milesBetween = (lat1, lon1, lat2, lon2) => {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
};

// Gas stations within `radius` miles of a city: count, the biggest brands, and points for the map.
const stationsNear = async (city, radius = 25) => {
  const dLat = radius / 69, dLon = radius / (69 * Math.cos((city.lat * Math.PI) / 180));
  const keys = [];
  for (let y = Math.floor(city.lat - dLat); y <= Math.floor(city.lat + dLat); y++) {
    for (let x = Math.floor(city.lon - dLon); x <= Math.floor(city.lon + dLon); x++) keys.push(y + '_' + x);
  }
  const rows = (await Promise.all(keys.map(loadTile))).flat().filter((s) => milesBetween(city.lat, city.lon, s[0], s[1]) <= radius);
  const brands = new Map();
  rows.forEach((s) => { const b = String(s[3] || s[2] || '').trim(); if (b) brands.set(b, (brands.get(b) || 0) + 1); });
  return {
    radius,
    count: rows.length,
    brands: [...brands].sort((a, b) => b[1] - a[1]).slice(0, 5),
    points: rows.slice(0, 1500).map((s) => [Math.round(s[1] * 1e5) / 1e5, Math.round(s[0] * 1e5) / 1e5])
  };
};

const OFF_CONUS = new Set(['AK', 'HI']);
let recent = [];

// The gas price segment: national + regional averages, and a spotlight city (in `state` when focused).
export const gasSegment = async ({ state = '' } = {}) => {
  const areas = await loadPrices();
  const st = /^[A-Z]{2}$/.test(state) ? state : '';
  const pool = FORECAST_CITIES.filter((c) => (st ? c.state === st : !OFF_CONUS.has(c.state)));
  const fresh = pool.filter((c) => !recent.includes(c.name + ',' + c.state));
  const list = fresh.length ? fresh : pool;
  const { name, state: cityState, lat, lon } = list[Math.floor(Math.random() * list.length)] || { name: 'Kansas City', state: 'MO', lat: 39.0997, lon: -94.5786 };
  recent = [...recent, name + ',' + cityState].slice(-12);
  const city = { name, state: cityState, lat, lon };
  const regions = REGIONS.filter((a) => areas[a]?.EPMR).map((a) => ({ area: a, name: GAS_AREAS[a], regular: areas[a].EPMR.price, change: areas[a].EPMR.change }))
    .sort((a, b) => a.regular - b.regular);
  const stations = await stationsNear(city).catch(() => ({ radius: 25, count: 0, brands: [], points: [] }));
  return {
    source: 'U.S. EIA weekly retail gasoline and diesel prices',
    period: areas.NUS.period,
    prevPeriod: areas.NUS.prev,
    national: Object.fromEntries(Object.entries(GAS_PRODUCTS).map(([p]) => [p, areas.NUS[p] || null])),
    regions,
    city,
    local: pricesFor(areas, cityState),
    stations
  };
};
