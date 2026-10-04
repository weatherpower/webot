// WPC Excessive Rainfall Outlooks (flash flood risk) for days 1-3, from the NWS map service
// (mapservices.weather.noaa.gov, hazards/wpc_precip_hazards). Cached 30 minutes.
const BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';
const NAMES = { 1: 'Marginal', 2: 'Slight', 3: 'Moderate', 4: 'High' };
let cache = { at: 0, body: null };

const day = async (n) => {
  const url = `${BASE}/${n - 1}/query?where=1%3D1&outFields=dn,outlook,valid_time,issue_time&f=geojson`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('WPC day ' + n + ': ' + r.status);
  const fc = await r.json();
  const features = (fc.features || []).filter((f) => f.geometry && NAMES[f.properties?.dn])
    .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { dn: f.properties.dn, day: n } }))
    .sort((a, b) => a.properties.dn - b.properties.dn);
  const p = fc.features?.[0]?.properties || {};
  const max = features.reduce((m, f) => Math.max(m, f.properties.dn), 0);
  return { day: n, max, maxName: NAMES[max] || '', valid: p.valid_time || '', issued: p.issue_time || '', features };
};

export const wpcOutlook = async () => {
  if (cache.body && Date.now() - cache.at < 30 * 60 * 1000) return cache.body;
  try {
    cache = { at: Date.now(), body: { days: await Promise.all([1, 2, 3].map(day)) } };
  } catch (error) {
    console.warn('[wpc]', error.message);
    if (!cache.body) throw error;
    cache.at = Date.now() - 25 * 60 * 1000;   // keep the old one, try again in 5 minutes
  }
  return cache.body;
};
