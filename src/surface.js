// Surface analysis for WeatherPower Live's national radar: highs, lows and fronts from the NWS Weather
// Prediction Center's coded surface bulletin (CODSUS, product ASUS01 KWBC), refreshed every 15 minutes.
const CODSUS_URL = process.env.WPC_CODSUS_URL || 'https://tgftp.nws.noaa.gov/data/raw/as/asus01.kwbc.cod.sus.txt';
const HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app' };
const FRONT_TYPES = new Set(['COLD', 'WARM', 'STNRY', 'OCFNT', 'TROF', 'DRYLINE']);
let cache = { at: 0, body: null };

// "51117" = 51N 117W, "4596" = 45N 96W: two latitude digits, then 2-3 longitude digits (west).
export const decodePoint = (code) => {
  if (!/^\d{4,5}$/.test(code)) return null;
  const lat = Number(code.slice(0, 2));
  const lon = -Number(code.slice(2));
  return lat > 90 || -lon > 180 ? null : [lon, lat];
};

// Two passes of Chaikin corner cutting so whole-degree fronts don't look jagged.
const smooth = (points) => {
  let pts = points;
  for (let pass = 0; pass < 2 && pts.length > 2; pass++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
};

export const parseCodsus = (text) => {
  const body = String(text || '');
  const valid = body.match(/VALID\s+(\d{2})(\d{2})(\d{2})Z/);
  const tokens = body.slice(valid ? valid.index + valid[0].length : 0).replace(/\$\$[\s\S]*$/, '').split(/\s+/).filter(Boolean);
  const highs = [];
  const lows = [];
  const fronts = [];
  let mode = null;
  let current = null;
  let pendingPressure = null;
  for (const token of tokens) {
    if (token === 'HIGHS' || token === 'LOWS') { mode = token; current = null; pendingPressure = null; continue; }
    if (FRONT_TYPES.has(token)) { mode = 'FRONT'; current = { type: token, points: [] }; fronts.push(current); continue; }
    if (!/^\d+$/.test(token)) { mode = null; current = null; continue; }
    if (mode === 'HIGHS' || mode === 'LOWS') {
      if (pendingPressure == null) { pendingPressure = Number(token); continue; }
      const point = decodePoint(token);
      if (point) (mode === 'HIGHS' ? highs : lows).push({ lon: point[0], lat: point[1], mb: pendingPressure });
      pendingPressure = null;
    } else if (mode === 'FRONT' && current) {
      const point = decodePoint(token);
      const last = current.points[current.points.length - 1];
      if (point && !(last && last[0] === point[0] && last[1] === point[1])) current.points.push(point);
    }
  }
  const dedupe = (list) => list.filter((p, i) => list.findIndex((q) => q.lat === p.lat && q.lon === p.lon && q.mb === p.mb) === i);
  let validAt = null;
  if (valid) {
    const now = new Date();
    const month = Number(valid[1]) - 1;
    const year = now.getUTCMonth() === 0 && month === 11 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    validAt = new Date(Date.UTC(year, month, Number(valid[2]), Number(valid[3]))).toISOString();
  }
  return {
    validAt,
    highs: dedupe(highs),
    lows: dedupe(lows),
    fronts: {
      type: 'FeatureCollection',
      features: fronts.filter((f) => f.points.length >= 2).map((f) => ({ type: 'Feature', properties: { type: f.type }, geometry: { type: 'LineString', coordinates: smooth(f.points) } }))
    }
  };
};

export const surfaceAnalysis = async () => {
  if (cache.body && Date.now() - cache.at < 15 * 60 * 1000) return cache.body;
  const response = await fetch(CODSUS_URL, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Object.assign(new Error(`WPC surface bulletin ${response.status}`), { status: 502 });
  const body = { ...parseCodsus(await response.text()), source: 'NWS Weather Prediction Center surface analysis' };
  cache = { at: Date.now(), body };
  return body;
};
