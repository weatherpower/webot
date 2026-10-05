// Porch Weather: WeatherPower's own "how nice is it outside" score, 7 days out, from Open-Meteo (free, no key).
// Two sets of points: ~390 cities (rankings, your city) and a 1.75° grid over the country (the colored zones
// the website paints). The scoring, tiers and names are ours. Refreshed every 3 hours (Open-Meteo budget).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const DAILY = 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,cloud_cover_mean,wind_speed_10m_max,wind_gusts_10m_max,dew_point_2m_mean';
const PER_STATE = 8;
const HOME = { name: 'Idabel', state: 'OK' };
const GRID = { lat: [24.5, 49.5], lon: [-125, -66.5], step: 2 };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const REFRESH_MS = 3 * 60 * 60 * 1000;
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

export const TIERS = [
  { tier: 'Porch Perfect', min: 90, floor: 80, color: '#ffd23f' },
  { tier: 'Mighty Fine', min: 80, floor: 65, color: '#3ee08f' },
  { tier: 'Nice', min: 70, floor: 50, color: '#33d4ff' },
  { tier: 'Fair', min: 55, floor: 0, color: '#8b6cff' },
  { tier: 'Stay In', min: 0, floor: 0, color: '#5a6478' }
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r1 = (n) => Math.round(n * 10) / 10;

// One day's sub-scores (0–100) and tier. Temperatures °F, wind mph.
export const scoreDay = (d) => {
  const { hi, dew, cloud, pop, wind, gust, feels } = d;
  if (![hi, cloud, pop, wind].every(Number.isFinite)) return null;
  let temp = 100 - Math.abs(hi - 72) * 2.4;
  if (hi > 92) temp -= (hi - 92) * 3;
  if (hi < 45) temp -= (45 - hi) * 2;
  const dewS = !Number.isFinite(dew) ? 85 : dew <= 55 ? 100 : dew <= 65 ? 100 - (dew - 55) * 2.5 : dew <= 75 ? 75 - (dew - 65) * 3.5 : 40 - (dew - 75) * 4;
  const sky = 100 - cloud * 0.6;
  const rain = 100 - pop * 1.15;
  let windS = wind <= 8 ? 100 : wind <= 22 ? 100 - (wind - 8) * 2.9 : 60 - (wind - 22) * 3;
  if (Number.isFinite(gust) && gust > 30) windS -= (gust - 30) * 1.2;
  const subs = { temp: clamp(temp, 0, 100), dew: clamp(dewS, 0, 100), sky: clamp(sky, 0, 100), rain: clamp(rain, 0, 100), wind: clamp(windS, 0, 100) };
  let score = subs.temp * 0.32 + subs.dew * 0.16 + subs.sky * 0.2 + subs.rain * 0.2 + subs.wind * 0.12;
  // Hard caps: a likely-wet day is never better than Fair; dangerous heat is a Stay In day.
  if (pop >= 60) score = Math.min(score, 69);
  if (Number.isFinite(feels) && feels >= 100) score = Math.min(score, 54);
  const low = Math.min(...Object.values(subs));
  const tier = TIERS.find((t) => score >= t.min && low >= t.floor) || TIERS[TIERS.length - 1];
  return { score: r1(score), tier: tier.tier, color: tier.color, subs: Object.fromEntries(Object.entries(subs).map(([k, v]) => [k, Math.round(v)])) };
};

let cities = null;
const loadCities = async () => {
  if (cities) return cities;
  const { places } = JSON.parse(await fs.readFile(path.join(here, 'places', 'us-places.json'), 'utf8'));
  const byState = {};
  for (const [name, state, lat, lon, land, inc] of places) if (inc && STATES.includes(state)) (byState[state] ||= []).push({ name, state, lat, lon, land });
  const picked = [];
  for (const list of Object.values(byState)) picked.push(...list.sort((a, b) => b.land - a.land).slice(0, PER_STATE));
  if (!picked.some((c) => c.name === HOME.name && c.state === HOME.state)) {
    const home = places.find(([n, s]) => n === HOME.name && s === HOME.state);
    if (home) picked.push({ name: home[0], state: home[1], lat: home[2], lon: home[3] });
  }
  cities = picked.map(({ land, ...c }) => c);
  return cities;
};
const gridPoints = () => {
  const out = [];
  for (let lat = GRID.lat[0]; lat <= GRID.lat[1]; lat += GRID.step) for (let lon = GRID.lon[0]; lon <= GRID.lon[1]; lon += GRID.step) out.push({ lat: r1(lat), lon: r1(lon) });
  return out;
};

const fetchDays = async (points) => {
  const out = [];
  let days = null;
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const url = `${OPEN_METEO}?latitude=${batch.map((c) => c.lat).join(',')}&longitude=${batch.map((c) => c.lon).join(',')}&daily=${DAILY}&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=7`;
    // Open-Meteo allows about 600 locations a minute: space the batches out and back off on 429.
    if (i) await sleep(9000);
    let body = null;
    for (let tries = 0; tries < 4; tries++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { await sleep(30000); continue; }
      if (!r.ok) throw new Error('Open-Meteo ' + r.status);
      body = await r.json(); break;
    }
    if (!body) throw new Error('Open-Meteo is rate limiting; try later');
    (Array.isArray(body) ? body : [body]).forEach((res, j) => {
      const d = res.daily || {};
      days ||= (d.time || []).map((date) => ({ date }));
      out.push({ ...batch[j], days: (d.time || []).map((_, k) => {
        const day = { hi: d.temperature_2m_max?.[k], lo: d.temperature_2m_min?.[k], feels: d.apparent_temperature_max?.[k], pop: d.precipitation_probability_max?.[k] ?? 0, cloud: d.cloud_cover_mean?.[k], wind: d.wind_speed_10m_max?.[k], gust: d.wind_gusts_10m_max?.[k], dew: d.dew_point_2m_mean?.[k] };
        const s = scoreDay(day);
        return s ? { ...s, hi: Math.round(day.hi), lo: Math.round(day.lo), pop: Math.round(day.pop), cloud: Math.round(day.cloud), wind: Math.round(day.wind), dew: Number.isFinite(day.dew) ? Math.round(day.dew) : null } : null;
      }) });
    });
  }
  return { days, out };
};

let cache = { at: 0, body: null, pending: null };
export const niceSummary = async () => {
  // Stale-while-refresh: an old picture comes back at once while a fresh one loads (it takes about a minute).
  if (cache.body && Date.now() - cache.at < REFRESH_MS) return cache.body;
  if (cache.pending) return cache.body || cache.pending;
  const old = cache.body;
  cache.pending = (async () => {
    const { days, out } = await fetchDays(await loadCities());
    const grid = (await fetchDays(gridPoints())).out.map((g) => ({ lat: g.lat, lon: g.lon, s: g.days.map((d) => (d ? Math.round(d.score) : null)) }));
    const top = (days || []).map((_, k) => out.filter((c) => c.days[k]).sort((a, b) => b.days[k].score - a.days[k].score).slice(0, 10)
      .map((c) => ({ name: c.name, state: c.state, score: c.days[k].score, tier: c.days[k].tier })));
    const counts = (days || []).map((_, k) => Object.fromEntries(TIERS.map((t) => [t.tier, out.filter((c) => c.days[k]?.tier === t.tier).length])));
    const home = out.find((c) => c.name === HOME.name && c.state === HOME.state) || null;
    const body = { generatedAt: new Date().toISOString(), source: 'Open-Meteo', tiers: TIERS, days, cities: out, grid, top, counts, home };
    cache = { at: Date.now(), body, pending: null };
    return body;
  })().catch((e) => { cache.pending = null; console.warn('[nice]', e.message); throw e; });
  return old || cache.pending;
};
