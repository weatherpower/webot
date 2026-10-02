// Weather Intensity Score (WIS), ported from the WeatherPower WIS page (wis.html) so the page and the
// live stream show one live number. Same inputs as the page: every active NWS alert plus active
// WeWatch alerts from the WeatherPower Firebase database. Same scoring, labels, caps and forecast.
// History is real (one point a minute, kept 24 hours) instead of the page's seeded 60 minutes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, ensureRuntimeDirs, replaceFile } from './paths.js';

const NWS_ACTIVE_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const NWS_HEADERS = { 'User-Agent': 'weatherpower.app warning-card-service contact@weatherpower.app', Accept: 'application/geo+json' };
const WEWATCH_URL = process.env.WIS_WEWATCH_URL || 'https://weatherpower-54c84-default-rtdb.firebaseio.com/wewatches.json';
const historyPath = path.join(dataDir, 'wis-history.json');

export const WIS_CONFIG = {
  alertPollMs: 60_000,
  historyIntervalMs: 60_000,
  maxHistoryPoints: 61,
  keepHistoryMs: 24 * 60 * 60 * 1000,
  quietScoreFloor: 20,
  normalScoreCap: 260,
  extremeScoreCap: 340
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

/* ---------------- scoring engine (same as wis.html) ---------------- */

const getAlertText = (a = {}) => {
  const ev = String(a.event || '').toLowerCase();
  const hl = String(a.headline || '').toLowerCase();
  const desc = String(a.raw?.description || a.description || a.raw?.instruction || '').toLowerCase();
  const sev = String(a.severity || '').toLowerCase();
  return `${ev} ${hl} ${desc} ${sev}`.replace(/\s+/g, ' ').trim();
};

export const analyzeAlertType = (a = {}) => {
  const full = getAlertText(a);
  const event = String(a.event || '').toLowerCase();
  const isTornadoEmergency = full.includes('tornado emergency');
  const isTornadoWarning = event.includes('tornado warning') || full.includes('tornado warning');
  const isPdsTornadoWarning = isTornadoWarning && (
    full.includes('particularly dangerous situation')
    || full.includes('pds tornado')
    || full.includes('pds tornado warning')
    || full.includes('observed large and extremely dangerous tornado')
  );
  const isSevereThunderstormWarning = event.includes('severe thunderstorm warning') || full.includes('severe thunderstorm warning');
  const isDestructiveSevereThunderstorm = isSevereThunderstormWarning && (
    full.includes('destructive') || full.includes('considerable') || full.includes('80 mph') || full.includes('90 mph')
    || full.includes('100 mph') || full.includes('baseball') || full.includes('softball')
  );
  const isTornadoWatch = event.includes('tornado watch') || full.includes('tornado watch');
  const isSevereThunderstormWatch = event.includes('severe thunderstorm watch') || full.includes('severe thunderstorm watch');
  const isFlashFloodEmergency = full.includes('flash flood emergency');
  const isFlashFloodWarning = !isFlashFloodEmergency && (event.includes('flash flood warning') || full.includes('flash flood warning'));
  const isFloodWarning = !isFlashFloodWarning && !isFlashFloodEmergency && (event.includes('flood warning') || full.includes('flood warning'));
  const isFloodAdvisory = event.includes('flood advisory') || full.includes('flood advisory');
  const isStatement = event.includes('special weather statement') || event.includes('short term forecast') || full.includes('special weather statement') || full.includes('short term forecast');
  const isWarning = event.includes('warning') || full.includes('warning');
  return {
    isTornadoEmergency,
    isPdsTornadoWarning,
    isTornadoWarning: isTornadoWarning && !isPdsTornadoWarning && !isTornadoEmergency,
    isSevereThunderstormWarning: isSevereThunderstormWarning && !isDestructiveSevereThunderstorm,
    isDestructiveSevereThunderstorm,
    isTornadoWatch,
    isSevereThunderstormWatch,
    isFlashFloodEmergency,
    isFlashFloodWarning,
    isFloodWarning,
    isFloodAdvisory,
    isStatement,
    isWarning
  };
};

// The page's SPC/NWS product scan is switched off ("SPC/NWS product scan quiet"), so SPC adds 0 there too.
const QUIET_SPC = { riskScore: 0, label: 'SPC/NWS product scan quiet', riskKey: 'none' };

export const getWISDetails = (alerts = [], spcContext = QUIET_SPC) => {
  const C = WIS_CONFIG;
  const d = {
    totalAlerts: alerts.length,
    tornadoEmergencyCount: 0,
    pdsTornadoWarningCount: 0,
    tornadoWarningCount: 0,
    severeThunderstormWarningCount: 0,
    destructiveSevereThunderstormCount: 0,
    tornadoWatchCount: 0,
    severeThunderstormWatchCount: 0,
    flashFloodEmergencyCount: 0,
    flashFloodWarningCount: 0,
    floodWarningCount: 0,
    floodAdvisoryCount: 0,
    statementCount: 0,
    otherWarningCount: 0,
    otherCount: 0,
    spcRiskScore: spcContext?.riskScore || 0,
    spcRiskLabel: spcContext?.label || 'No organized risk',
    spcRiskKey: spcContext?.riskKey || 'none',
    hasSevereCore: false,
    hasFloodOnly: false,
    allowExtreme: false,
    cap: C.normalScoreCap,
    score: C.quietScoreFloor
  };
  for (const alert of alerts || []) {
    const t = analyzeAlertType(alert);
    if (t.isTornadoEmergency) d.tornadoEmergencyCount++;
    else if (t.isPdsTornadoWarning) d.pdsTornadoWarningCount++;
    else if (t.isTornadoWarning) d.tornadoWarningCount++;
    else if (t.isDestructiveSevereThunderstorm) d.destructiveSevereThunderstormCount++;
    else if (t.isSevereThunderstormWarning) d.severeThunderstormWarningCount++;
    else if (t.isTornadoWatch) d.tornadoWatchCount++;
    else if (t.isSevereThunderstormWatch) d.severeThunderstormWatchCount++;
    else if (t.isFlashFloodEmergency) d.flashFloodEmergencyCount++;
    else if (t.isFlashFloodWarning) d.flashFloodWarningCount++;
    else if (t.isFloodWarning) d.floodWarningCount++;
    else if (t.isFloodAdvisory) d.floodAdvisoryCount++;
    else if (t.isStatement) d.statementCount++;
    else if (t.isWarning) d.otherWarningCount++;
    else d.otherCount++;
  }
  d.allowExtreme = d.tornadoEmergencyCount > 0 || d.pdsTornadoWarningCount > 0;
  d.cap = d.allowExtreme ? C.extremeScoreCap : C.normalScoreCap;
  d.hasSevereCore = d.allowExtreme || d.tornadoWarningCount > 0 || d.severeThunderstormWarningCount > 0 || d.destructiveSevereThunderstormCount > 0;
  const floodTotal = d.flashFloodEmergencyCount + d.flashFloodWarningCount + d.floodWarningCount + d.floodAdvisoryCount;
  const watchTotal = d.tornadoWatchCount + d.severeThunderstormWatchCount;
  const lowOnlyTotal = floodTotal + watchTotal + d.statementCount + d.otherWarningCount + d.otherCount;
  d.hasFloodOnly = floodTotal > 0 && !d.hasSevereCore && d.tornadoWatchCount === 0 && d.severeThunderstormWatchCount === 0;

  let score = C.quietScoreFloor + d.spcRiskScore;

  if (d.allowExtreme) {
    score = 260;
    score += d.pdsTornadoWarningCount * 14;
    score += d.tornadoEmergencyCount * 28;
    score += d.tornadoWarningCount * 8;
    score += d.destructiveSevereThunderstormCount * 5;
    score += d.severeThunderstormWarningCount * 2;
    score = Math.max(score, d.tornadoEmergencyCount > 0 ? 285 : 265);
    d.score = round1(clamp(score, 261, d.cap));
    return d;
  }
  if (d.tornadoWarningCount > 0) {
    score += 62;
    score += Math.max(0, d.tornadoWarningCount - 1) * 26;
    score += d.destructiveSevereThunderstormCount * 13;
    score += d.severeThunderstormWarningCount * 5;
    score += d.tornadoWatchCount * 8;
    score += d.severeThunderstormWatchCount * 3;
    score += d.flashFloodEmergencyCount * 5;
    score += d.flashFloodWarningCount * 2;
    score = Math.max(score, 100);
    d.score = round1(clamp(score, 100, C.normalScoreCap));
    return d;
  }
  if (d.destructiveSevereThunderstormCount > 0 || d.severeThunderstormWarningCount > 0) {
    score += d.severeThunderstormWarningCount * 4.5;
    score += d.destructiveSevereThunderstormCount * 18;
    score += Math.max(0, d.severeThunderstormWarningCount - 2) * 3;
    score += d.tornadoWatchCount * 9;
    score += d.severeThunderstormWatchCount * 5;
    score += d.flashFloodEmergencyCount * 5;
    score += d.flashFloodWarningCount * 2;
    if (d.destructiveSevereThunderstormCount > 0) score = Math.max(score, 52);
    d.score = round1(clamp(score, C.quietScoreFloor, C.normalScoreCap));
    return d;
  }
  if (floodTotal > 0) {
    score += d.flashFloodEmergencyCount * 12;
    score += d.flashFloodWarningCount * 5;
    score += d.floodWarningCount * 3;
    score += d.floodAdvisoryCount * 1.5;
  }
  if (watchTotal > 0) {
    score += d.tornadoWatchCount * 14;
    score += d.severeThunderstormWatchCount * 7;
  }
  if (d.statementCount > 0) score += d.statementCount * 2;
  if (d.otherWarningCount > 0 || d.otherCount > 0) score += d.otherWarningCount * 2 + d.otherCount * 0.8;
  if (lowOnlyTotal > 0) score = clamp(score, C.quietScoreFloor, 65);
  d.score = round1(clamp(score, C.quietScoreFloor, 65));
  return d;
};

export const classifyWIS = (score) => {
  if (score < 25) return { level: 'quiet', label: 'Very Quiet' };
  if (score < 40) return { level: 'quiet', label: 'Low / Isolated' };
  if (score < 55) return { level: 'low', label: 'Low Activity' };
  if (score < 70) return { level: 'low', label: 'Monitoring' };
  if (score < 100) return { level: 'elevated', label: 'Elevated' };
  if (score < 150) return { level: 'active', label: 'Tornado Warning Ops' };
  if (score <= 260) return { level: 'intense', label: 'Intense' };
  return { level: 'extreme', label: 'Extreme / PDS' };
};

export const primaryHazardFor = (d) => {
  if (!d) return 'None';
  if (d.tornadoEmergencyCount > 0) return 'Tornado Emergency';
  if (d.pdsTornadoWarningCount > 0) return 'PDS Tornado Warning';
  if (d.tornadoWarningCount > 0) return 'Tornado Warning';
  if (d.destructiveSevereThunderstormCount > 0) return 'Destructive Severe Thunderstorm Warning';
  if (d.severeThunderstormWarningCount > 0) return 'Severe Thunderstorm Warning';
  if (d.flashFloodEmergencyCount > 0) return 'Flash Flood Emergency';
  if (d.flashFloodWarningCount > 0) return 'Flash Flood Warning';
  if (d.floodWarningCount > 0) return 'Flood Warning';
  if (d.tornadoWatchCount > 0) return 'Tornado Watch';
  if (d.severeThunderstormWatchCount > 0) return 'Severe Thunderstorm Watch';
  if (d.statementCount > 0) return 'Statement / Forecast';
  if (d.totalAlerts === 0 && (d.spcRiskScore || 0) > 0) return `SPC ${d.spcRiskLabel}`;
  return d.totalAlerts > 0 ? 'Low-End Alerts' : 'None';
};

const lowEndTarget = (d) => {
  const C = WIS_CONFIG;
  const spc = d?.spcRiskScore || 0;
  if (!d || d.totalAlerts === 0) return clamp(C.quietScoreFloor + spc * 0.35, C.quietScoreFloor, 42);
  if (d.allowExtreme) return d.tornadoEmergencyCount > 0 ? 285 : 265;
  if (d.tornadoWarningCount > 0) return 100;
  if (d.hasFloodOnly) return clamp(24 + spc * 0.35 + d.flashFloodWarningCount * 4 + d.floodWarningCount * 2, 20, 65);
  if (d.hasSevereCore) return clamp(24 + spc + d.severeThunderstormWarningCount * 4.5 + d.destructiveSevereThunderstormCount * 16, 24, 88);
  return clamp(22 + spc * 0.5 + d.totalAlerts * 1.5, 20, 65);
};

// Next 30 minutes in 5-minute steps: recent trend, damped, pulled toward the severity target.
export const buildForecast = (score, d, history) => {
  const C = WIS_CONFIG;
  const recent = history.slice(-8);
  const cap = d?.allowExtreme ? C.extremeScoreCap : C.normalScoreCap;
  const target = lowEndTarget(d);
  const now = Date.now();
  if (recent.length < 2) {
    return Array.from({ length: 7 }, (_, i) => ({ t: now + i * 5 * 60_000, v: round1(clamp(score + (target - score) * (i / 8), C.quietScoreFloor, cap)) }));
  }
  let weightedChange = 0;
  let weightSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const dtMin = (recent[i].t - recent[i - 1].t) / 60_000;
    if (dtMin > 0) {
      weightedChange += i * (recent[i].v - recent[i - 1].v) / dtMin;
      weightSum += i;
    }
  }
  const dampened = (weightSum > 0 ? weightedChange / weightSum : 0) * (d?.allowExtreme ? 0.22 : 0.32);
  return Array.from({ length: 7 }, (_, i) => {
    const minutes = i * 5;
    return { t: now + minutes * 60_000, v: round1(clamp(score + dampened * minutes + (target - score) * (i / 10), C.quietScoreFloor, cap)) };
  });
};

/* ---------------- live inputs ---------------- */

const fetchNwsAlerts = async () => {
  const response = await fetch(NWS_ACTIVE_ALERTS_URL, { headers: NWS_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`NWS alerts ${response.status}`);
  const body = await response.json();
  return (body.features || []).map((f) => {
    const p = f.properties || {};
    const event = p.event || 'Alert';
    return {
      id: f.id || event,
      source: 'NWS',
      event,
      headline: p.headline || event,
      area: String(p.areaDesc || '').slice(0, 60),
      severity: p.severity || 'Unknown',
      expires: p.expires || p.ends || null,
      // Only the text the scorer reads, so hundreds of alerts stay small in memory.
      raw: { description: String(p.description || '').slice(0, 4000), instruction: String(p.instruction || '').slice(0, 1000) }
    };
  });
};

const toTime = (raw) => {
  if (raw == null || raw === '') return null;
  const ms = typeof raw === 'number' ? (raw > 1e12 ? raw : raw * 1000) : Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const fetchWeWatches = async () => {
  const response = await fetch(WEWATCH_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`WeWatch ${response.status}`);
  const map = await response.json();
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter(([, w]) => w && !['expired', 'cancelled', 'canceled', 'inactive'].includes(String(w.status || w.state || '').toLowerCase()))
    .map(([id, w]) => {
      const event = w.hazardType || w.eventType || w.event || w.title || 'WeWatch Alert';
      return {
        id,
        source: 'WEWATCH',
        event,
        headline: w.headline || event,
        area: String(w.areaText || w.area || w.areaDesc || ''),
        severity: w.severity || w.severityLevel || w.level || 'Unknown',
        expires: toTime(w.expiresAt || w.expires_at || w.expiresISO || w.expires),
        raw: { description: String(w.description || '').slice(0, 4000), instruction: String(w.instruction || '').slice(0, 1000) }
      };
    });
};

const priority = (alert) => {
  const t = analyzeAlertType(alert);
  if (t.isTornadoEmergency) return 1;
  if (t.isPdsTornadoWarning) return 2;
  if (t.isTornadoWarning) return 3;
  if (t.isDestructiveSevereThunderstorm) return 4;
  if (t.isSevereThunderstormWarning) return 5;
  if (t.isFlashFloodEmergency) return 6;
  if (t.isFlashFloodWarning) return 7;
  if (t.isFloodWarning) return 8;
  if (t.isTornadoWatch) return 9;
  if (t.isSevereThunderstormWatch) return 10;
  if (t.isStatement) return 11;
  return 12;
};

/* ---------------- live state ---------------- */

const state = { nws: [], wewatch: [], details: null, score: null, updatedAt: null, history: [], errors: {}, loaded: false };
let lastSavedAt = 0;

const loadHistory = async () => {
  try {
    const saved = JSON.parse(await fs.readFile(historyPath, 'utf8'));
    const cutoff = Date.now() - WIS_CONFIG.keepHistoryMs;
    state.history = (saved.history || []).filter((p) => p.t > cutoff && Number.isFinite(p.v));
  } catch {}
};

const saveHistory = async () => {
  await ensureRuntimeDirs();
  const temp = `${historyPath}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ history: state.history }));
  await replaceFile(temp, historyPath);
  lastSavedAt = Date.now();
};

const recompute = () => {
  const all = [...state.wewatch, ...state.nws];
  state.details = getWISDetails(all);
  state.score = state.details.score;
  state.updatedAt = new Date().toISOString();
};

const appendHistory = () => {
  if (state.score == null) return;
  const cap = state.details?.allowExtreme ? WIS_CONFIG.extremeScoreCap : WIS_CONFIG.normalScoreCap;
  const now = Date.now();
  const last = state.history[state.history.length - 1];
  // One point per minute; a refresh inside the same minute updates that minute's point.
  const point = { t: now, v: round1(clamp(state.score, WIS_CONFIG.quietScoreFloor, cap)) };
  if (last && now - last.t < WIS_CONFIG.historyIntervalMs * 0.9) state.history[state.history.length - 1] = { ...point, t: last.t };
  else state.history.push(point);
  const cutoff = now - WIS_CONFIG.keepHistoryMs;
  while (state.history.length && state.history[0].t < cutoff) state.history.shift();
};

export const refreshWis = async () => {
  const [nws, wewatch] = await Promise.allSettled([fetchNwsAlerts(), fetchWeWatches()]);
  // A failed source keeps its last good list, the same as the page.
  if (nws.status === 'fulfilled') { state.nws = nws.value; delete state.errors.nws; } else state.errors.nws = nws.reason?.message || 'failed';
  if (wewatch.status === 'fulfilled') { state.wewatch = wewatch.value; delete state.errors.wewatch; } else state.errors.wewatch = wewatch.reason?.message || 'failed';
  if (nws.status === 'fulfilled' || wewatch.status === 'fulfilled' || state.loaded) {
    state.loaded = state.loaded || nws.status === 'fulfilled';
    recompute();
    appendHistory();
    if (Date.now() - lastSavedAt > 5 * 60 * 1000) await saveHistory().catch(() => {});
  }
};

let started = false;
export const startWis = async () => {
  if (started) return;
  started = true;
  await loadHistory();
  const tick = () => refreshWis().catch((error) => { state.errors.loop = error.message; });
  await tick();
  setInterval(tick, WIS_CONFIG.alertPollMs);
};

const pointNear = (targetT) => {
  let best = null;
  for (const p of state.history) if (!best || Math.abs(p.t - targetT) < Math.abs(best.t - targetT)) best = p;
  return best && Math.abs(best.t - targetT) <= 10 * 60 * 1000 ? best.v : null;
};

export const wisSummary = ({ alerts = 0 } = {}) => {
  if (state.score == null) return { loaded: false, score: null, errors: state.errors };
  const history = state.history.slice(-WIS_CONFIG.maxHistoryPoints);
  const forecast = buildForecast(state.score, state.details, state.history);
  const { level, label } = classifyWIS(state.score);
  const combined = alerts ? [...state.wewatch, ...state.nws].sort((a, b) => priority(a) - priority(b)).slice(0, alerts) : undefined;
  return {
    loaded: true,
    score: state.score,
    scoreText: state.score.toFixed(1),
    level,
    label,
    hazard: primaryHazardFor(state.details),
    details: state.details,
    counts: { total: state.nws.length + state.wewatch.length, nws: state.nws.length, wewatch: state.wewatch.length },
    ago30: pointNear(Date.now() - 30 * 60 * 1000),
    projected30: forecast[forecast.length - 1]?.v ?? null,
    history,
    forecast,
    updatedAt: state.updatedAt,
    errors: Object.keys(state.errors).length ? state.errors : undefined,
    ...(combined ? { alerts: combined.map(({ raw, ...a }) => a) } : {})
  };
};
