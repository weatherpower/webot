// Public Warning Center API v3: one clean alert schema shared by the center, detail page and apps.
import express from 'express';
import { config } from './config.js';
import { requireControllerToken } from './auth.js';
import { getRenderedState } from './autoRenderer.js';
import { compactPublicGeometry } from './publicFeed.js';
import { compositeValidTime } from './shortVideo.js';
import { getShort, listShorts, queueShort, requestShort, shortsByKey, shortsStatus } from './shorts.js';
import {
  SATELLITE_STYLE, areaLineFor, hazardChipsFor, headlineFor, iconKeyFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';

const IEM_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
const GROUP_ORDER = ['warnings', 'watches', 'statements', 'discussions', 'outlooks', 'forecasts'];

export const groupFor = (item = {}) => {
  const c = item.classification || {};
  if (c.isForecast || item.cardLayout === 'forecast') return 'forecasts';
  if (c.isOutlook) return 'outlooks';
  if (c.isDiscussion) return 'discussions';
  if (c.isWatch) return 'watches';
  if (c.isWarning || /warning/i.test(item.event || '')) return 'warnings';
  return 'statements';
};

const severityRank = (item = {}) => {
  const c = item.classification || {};
  if (c.isEmergency) return 0;
  if (c.isPds) return 1;
  if (c.family === 'tornado' && c.isWarning) return 2;
  if (c.isDestructive) return 3;
  if (c.family === 'tropical-storm' || c.family === 'hurricane') return 4;
  if (c.isConsiderable) return 5;
  if (c.isWarning) return 6;
  if (c.isWatch) return 7;
  if (c.isDiscussion) return 8;
  if (c.isOutlook) return 9;
  return 10;
};

const publicPath = (relative) => (relative ? `${config.publicBaseUrl}${relative}` : null);

export const toV3Alert = (item = {}, short = null, { detail = false } = {}) => {
  const times = timeLabelsFor(item);
  const people = Number(item.impacts?.people);
  const homes = Number(item.impacts?.homes);
  const alert = {
    key: item.key,
    event: item.event,
    eventLabel: headlineFor(item).event,
    headline: headlineFor(item).full,
    place: headlineFor(item).place,
    area: areaLineFor(item),
    areaDesc: item.areaDesc,
    states: item.stateCodes || [],
    office: item.office,
    group: groupFor(item),
    family: item.classification?.family || 'weather',
    icon: iconKeyFor(item),
    status: statusTagFor(item),
    threat: threatTagFor(item) || null,
    rank: severityRank(item),
    color: item.theme?.primary,
    accent: item.theme?.polygon || item.theme?.accent,
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt,
    timezone: times.timezone,
    times: { issued: times.issued, expires: times.expires, expiresDay: times.expiresDay },
    people: Number.isFinite(people) && item.impacts?.people !== null ? people : null,
    homes: Number.isFinite(homes) && item.impacts?.homes !== null ? homes : null,
    hazards: hazardChipsFor(item),
    center: item.center,
    geometry: detail ? item.geometry || null : compactPublicGeometry(item.geometry) || (item.polygon?.length ? { type: 'Polygon', coordinates: [item.polygon] } : null),
    card: item.card ? { url: publicPath(item.card.path), path: item.card.path, stale: Boolean(item.staleCard) } : null,
    cardStatus: item.status,
    short: short?.path ? { path: short.path, posterPath: short.posterPath, url: publicPath(short.path), posterUrl: publicPath(short.posterPath), renderedAt: short.renderedAt } : null,
    shortStatus: short?.status || null,
    detailUrl: `/warningcenter/warningdetail?key=${encodeURIComponent(item.key || '')}`
  };
  if (detail) {
    Object.assign(alert, {
      whatToDo: item.whatToDo,
      sourceText: item.sourceText,
      impactLine: item.impactLine,
      locations: item.locations || [],
      hazardStats: item.hazardStats || [],
      radar: item.radar ? { mode: item.radar.mode, site: item.radar.site } : null,
      watchDetails: item.watchDetails || null,
      outlookDetails: item.outlookDetails || null,
      tropical: item.tropical || null,
      forecast: item.forecast || null,
      nwsId: item.nwsId
    });
  }
  return alert;
};

const matchesQuery = (alert, query) => {
  if (!query) return true;
  const haystack = [alert.event, alert.areaDesc, alert.place, alert.office, ...(alert.states || [])].join(' ').toLowerCase();
  return String(query).toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
};

const currentAlerts = async () => {
  const state = await getRenderedState();
  const shorts = await shortsByKey();
  const now = Date.now();
  const alerts = (state.items || [])
    .filter((item) => !Date.parse(item.expiresAt || '') || Date.parse(item.expiresAt) > now)
    .map((item) => toV3Alert(item, shorts.get(item.key)))
    .sort((a, b) => a.rank - b.rank || Date.parse(b.issuedAt || 0) - Date.parse(a.issuedAt || 0));
  return { state, alerts };
};

let radarCache = { at: 0, body: null };
const radarFrames = async () => {
  if (radarCache.body && Date.now() - radarCache.at < 60 * 1000) return radarCache.body;
  const valid = await compositeValidTime();
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const frames = Array.from({ length: 12 }, (_, index) => {
    const time = valid - (11 - index) * 5 * 60 * 1000;
    return { time: new Date(time).toISOString(), tiles: `${IEM_TILES}/ridge::USCOMP-N0Q-${stamp(time)}/{z}/{x}/{y}.png` };
  });
  radarCache = {
    at: Date.now(),
    body: {
      validAt: new Date(valid).toISOString(),
      reflectivity: frames,
      rainfall24h: `${IEM_TILES}/q2-p24h-900913/{z}/{x}/{y}.png`,
      velocityTemplate: `${IEM_TILES}/ridge::{site}-N0U-0/{z}/{x}/{y}.png`,
      attribution: 'NEXRAD via Iowa Environmental Mesonet'
    }
  };
  return radarCache.body;
};

export const apiV3Router = () => {
  const router = express.Router();

  router.get('/alerts', async (req, res, next) => {
    try {
      const { state, alerts } = await currentAlerts();
      const group = String(req.query.group || 'all');
      const stateCode = String(req.query.state || '').toUpperCase();
      const filtered = alerts
        .filter((alert) => group === 'all' || alert.group === group)
        .filter((alert) => !stateCode || alert.states.includes(stateCode))
        .filter((alert) => matchesQuery(alert, req.query.q));
      const counts = Object.fromEntries(GROUP_ORDER.map((name) => [name, alerts.filter((alert) => alert.group === name).length]));
      res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');
      res.json({
        generatedAt: new Date().toISOString(),
        renderer: {
          status: state.status,
          lastFinishedAt: state.lastFinishedAt,
          renderedCount: state.renderedCount,
          count: state.count
        },
        shorts: shortsStatus(),
        counts: { all: alerts.length, ...counts },
        alerts: filtered
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/alerts.geojson', async (req, res, next) => {
    try {
      const { alerts } = await currentAlerts();
      res.set('Cache-Control', 'public, max-age=10');
      res.type('application/geo+json').json({
        type: 'FeatureCollection',
        features: alerts.filter((alert) => alert.geometry).map((alert) => ({
          type: 'Feature',
          id: alert.key,
          geometry: alert.geometry,
          properties: {
            key: alert.key, event: alert.event, group: alert.group, family: alert.family,
            color: alert.color, accent: alert.accent, rank: alert.rank, expiresAt: alert.expiresAt, area: alert.area
          }
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/alert', async (req, res, next) => {
    try {
      const state = await getRenderedState({ kick: false });
      const item = (state.items || []).find((entry) => entry.key === String(req.query.key || '') || entry.nwsId === String(req.query.key || ''));
      if (!item) {
        res.status(404).json({ ok: false, error: 'Alert not found or expired' });
        return;
      }
      const short = await getShort(item.key);
      const alert = toV3Alert(item, short?.short ? { ...short.short, status: short.status } : { status: short?.status }, { detail: true });
      res.set('Cache-Control', 'public, max-age=5');
      res.json(alert);
    } catch (error) {
      next(error);
    }
  });

  router.get('/config', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      darkStyleUrl: config.maps.styleUrl,
      satelliteStyle: SATELLITE_STYLE,
      shorts: { enabled: config.shorts.enabled, format: config.shorts.format, publicRequests: config.shorts.publicRequestsPerWindow > 0 }
    });
  });

  router.get('/radar', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await radarFrames());
    } catch (error) {
      next(error);
    }
  });

  router.get('/shorts', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=10');
      res.json({ ...shortsStatus(), items: await listShorts() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/short', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json((await getShort(String(req.query.key || ''))) || { key: String(req.query.key || ''), status: 'none', short: null });
    } catch (error) {
      next(error);
    }
  });

  const findLiveWarning = async (key) => {
    const state = await getRenderedState({ kick: false });
    return (state.items || []).find((entry) => entry.key === key || entry.nwsId === key) || null;
  };

  router.post('/short/request', async (req, res, next) => {
    try {
      const item = await findLiveWarning(String(req.query.key || ''));
      if (!item) {
        res.status(404).json({ ok: false, error: 'Alert not found or expired' });
        return;
      }
      const result = await requestShort(item, req.ip);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, ...result, short: await getShort(item.key) });
    } catch (error) {
      if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
      next(error);
    }
  });

  router.post('/short/render', requireControllerToken, async (req, res, next) => {
    try {
      const item = await findLiveWarning(String(req.query.key || ''));
      if (!item) {
        res.status(404).json({ ok: false, error: 'Alert not found or expired' });
        return;
      }
      res.json({ ok: true, ...(await queueShort(item, { reason: 'controller', force: Boolean(req.body?.force) })) });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
