// Hurricane Hunter (aircraft reconnaissance) data from the National Hurricane Center's recon archive:
//   HDOB  (high-density observations, one line every 30 s along the flight track)  AHONT1 Atlantic, AHOPN1 East Pacific
//   VDM   (vortex data message, the measured center fix)                           REPNT2 Atlantic, REPPN2 East Pacific
// Files never change once posted, so parsed files are kept in memory and only new ones are fetched.

const BASE = 'https://www.nhc.noaa.gov/archive/recon';
const HEADERS = { 'User-Agent': 'WeatherPower (weatherpower.app)', Accept: 'text/plain, text/html' };
const HDOB_DIRS = ['AHONT1', 'AHOPN1'];
const VDM_DIRS = ['REPNT2', 'REPPN2'];
const WINDOW_MS = 10 * 3600 * 1000; // missions from the last 10 hours
const VDM_WINDOW_MS = 24 * 3600 * 1000;
const CACHE_MS = 4 * 60 * 1000;
const FLYING_MS = 45 * 60 * 1000; // a plane counts as "in the storm now" if its last ob is this fresh

const parsed = new Map(); // file URL -> parsed result (immutable files)
let cache = { at: 0, promise: null };

const get = async (url, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`NHC recon ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

// "AHONT1-KWBC.202610092121.txt" -> Date (UTC)
const fileTime = (name) => {
  const m = name.match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.txt$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
};

const listFiles = async (dir, sinceMs) => {
  const year = new Date().getUTCFullYear();
  const html = await get(`${BASE}/${year}/${dir}/`);
  return [...new Set(html.match(/[A-Z0-9]+-[A-Z]{4}\.\d{12}\.txt/g) || [])]
    .map((name) => ({ name, url: `${BASE}/${year}/${dir}/${name}`, at: fileTime(name) }))
    .filter((f) => f.at >= sinceMs)
    .sort((a, b) => a.at - b.at);
};

// 2753N -> 27.883, 08331W -> -83.517
const coord = (s) => {
  const m = String(s).match(/^(\d{2,3})(\d{2})([NSEW])$/);
  if (!m) return null;
  const v = +m[1] + +m[2] / 60;
  return m[3] === 'S' || m[3] === 'W' ? -v : v;
};
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
// Extrapolated surface pressure in tenths of a millibar with the leading 1 dropped: 9581 -> 958.1, 0084 -> 1008.4
const extrapMb = (s) => {
  const v = num(s);
  if (v == null) return null;
  const mb = v / 10;
  return mb < 100 ? mb + 1000 : mb;
};

export const parseHdob = (text, fileAt) => {
  const lines = text.split(/\r?\n/);
  const head = lines.find((l) => /\bHDOB\b/.test(l));
  if (!head) return null;
  const [aircraft, mission, ...rest] = head.trim().split(/\s+/);
  const storm = rest.slice(0, rest.indexOf('HDOB')).join(' ');
  const fileDate = new Date(fileAt);
  const obs = [];
  for (const line of lines) {
    const f = line.trim().split(/\s+/);
    if (f.length < 12 || !/^\d{6}$/.test(f[0])) continue;
    const lat = coord(f[1]);
    const lon = coord(f[2]);
    if (lat == null || lon == null) continue;
    let at = Date.UTC(fileDate.getUTCFullYear(), fileDate.getUTCMonth(), fileDate.getUTCDate(), +f[0].slice(0, 2), +f[0].slice(2, 4), +f[0].slice(4, 6));
    if (at > fileAt + 3600000) at -= 86400000; // ob from just before midnight in a file posted after it
    const wind = f[8].match(/^(\d{3})(\d{3})$/);
    obs.push({
      at,
      lat: +lat.toFixed(3),
      lon: +lon.toFixed(3),
      flKt: wind ? +wind[2] : null,
      peakFlKt: num(f[9]),
      sfmrKt: num(f[10]),
      // Above 550 mb (ferry legs, high-altitude flights) that column is a D-value, not surface pressure.
      sfcMb: (num(f[3]) ?? 0) >= 5500 ? extrapMb(f[5]) : null
    });
  }
  return { aircraft, mission, storm: storm === 'INVEST' ? 'Invest' : storm, obs };
};

export const parseVdm = (text) => {
  const pick = (re) => (text.match(re) || [])[1];
  const id = pick(/VORTEX DATA MESSAGE\s+([A-Z]{2}\d{6})/);
  const time = text.match(/^A\.\s*(\d{2})\/(\d{2}):(\d{2}):(\d{2})Z/m);
  const pos = text.match(/^B\.\s*([\d.]+) deg ([NS])\s+([\d.]+) deg ([EW])/m);
  if (!id || !time || !pos) return null;
  const unit = (pick(/^U\.\s*(.+)$/m) || '').trim().split(/\s+/);
  return {
    stormId: id,
    day: +time[1],
    hms: [+time[2], +time[3], +time[4]],
    lat: +(pos[2] === 'S' ? -pos[1] : +pos[1]).toFixed(2),
    lon: +(pos[4] === 'W' ? -pos[3] : +pos[3]).toFixed(2),
    pressureMb: num(pick(/^D\.\s*(\d+) mb/m) || ''),
    maxFlWindKt: num(pick(/MAX FL WIND (\d+) KT/) || '') ?? num(pick(/^J\.\s*\d+ deg (\d+) kt/m) || ''),
    aircraft: unit[0] || '',
    mission: unit[1] || '',
    storm: unit.slice(2, unit.indexOf('OB') > 0 ? unit.indexOf('OB') : undefined).join(' ')
  };
};

const fetchParsed = async (file, parse) => {
  if (parsed.has(file.url)) return parsed.get(file.url);
  const value = parse(await get(file.url), file.at);
  parsed.set(file.url, value);
  return value;
};

const prune = (now) => {
  for (const url of parsed.keys()) if (now - fileTime(url) > VDM_WINDOW_MS + 3600000) parsed.delete(url);
};

const build = async () => {
  const now = Date.now();
  prune(now);
  const [hdobFiles, vdmFiles] = await Promise.all([
    Promise.all(HDOB_DIRS.map((d) => listFiles(d, now - WINDOW_MS).catch(() => []))).then((x) => x.flat()),
    Promise.all(VDM_DIRS.map((d) => listFiles(d, now - VDM_WINDOW_MS).catch(() => []))).then((x) => x.flat())
  ]);

  const missions = new Map();
  for (const file of hdobFiles.slice(-150)) {
    const msg = await fetchParsed(file, parseHdob).catch(() => null);
    if (!msg?.obs.length) continue;
    const key = `${msg.aircraft} ${msg.mission}`;
    const m = missions.get(key) || { id: key, aircraft: msg.aircraft, mission: msg.mission, storm: msg.storm, obs: [] };
    m.obs.push(...msg.obs);
    missions.set(key, m);
  }

  const vdms = [];
  for (const file of vdmFiles.slice(-30)) {
    const v = await fetchParsed(file, (text) => parseVdm(text)).catch(() => null);
    if (!v) continue;
    // The VDM only carries day-of-month; the file's posting time gives the month and year.
    const posted = new Date(file.at);
    let at = Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth(), v.day, ...v.hms);
    if (at > file.at + 3600000) at = Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth() - 1, v.day, ...v.hms);
    vdms.push({ ...v, at: new Date(at).toISOString(), day: undefined, hms: undefined });
  }
  vdms.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const out = [...missions.values()].map((m) => {
    m.obs.sort((a, b) => a.at - b.at);
    const last = m.obs[m.obs.length - 1];
    const peakFl = m.obs.reduce((best, o) => ((o.peakFlKt ?? o.flKt ?? -1) > (best?.kt ?? -1) ? { kt: o.peakFlKt ?? o.flKt, at: o.at, lat: o.lat, lon: o.lon } : best), null);
    const peakSfmr = m.obs.reduce((best, o) => (o.sfmrKt != null && o.sfmrKt > (best?.kt ?? -1) ? { kt: o.sfmrKt, at: o.at, lat: o.lat, lon: o.lon } : best), null);
    const minMb = m.obs.reduce((best, o) => (o.sfcMb != null && o.sfcMb < (best?.mb ?? 9999) ? { mb: o.sfcMb, at: o.at, lat: o.lat, lon: o.lon } : best), null);
    return {
      id: m.id,
      aircraft: m.aircraft,
      aircraftLabel: /^NOAA/.test(m.aircraft) ? 'NOAA Hurricane Hunters' : /^AF/.test(m.aircraft) ? 'Air Force Reserve Hurricane Hunters' : 'Recon aircraft',
      mission: m.mission,
      storm: m.storm,
      flying: now - last.at < FLYING_MS,
      firstAt: new Date(m.obs[0].at).toISOString(),
      lastAt: new Date(last.at).toISOString(),
      last,
      peakFl,
      peakSfmr,
      minMb,
      // One point a minute is plenty for the map: [lon, lat, flight-level wind kt, SFMR surface wind kt]
      track: m.obs.filter((_, i) => i % 2 === 0 || i === m.obs.length - 1).map((o) => [o.lon, o.lat, o.flKt, o.sfmrKt])
    };
  }).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

  return { updatedAt: new Date(now).toISOString(), flying: out.some((m) => m.flying), missions: out, vdms: vdms.slice(0, 8) };
};

export const reconOverview = async () => {
  if (cache.promise && Date.now() - cache.at < CACHE_MS) return cache.promise;
  cache = { at: Date.now(), promise: build() };
  cache.promise.catch(() => { cache = { at: 0, promise: null }; });
  return cache.promise;
};
