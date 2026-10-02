// Public Warning Center API v3: one clean alert schema shared by the center, detail page and apps.
import express from 'express';
import { config } from './config.js';
import { requireControllerToken } from './auth.js';
import { getRenderedState } from './autoRenderer.js';
import { compactPublicGeometry } from './publicFeed.js';
import { compositeValidTime } from './shortVideo.js';
import { getShort, listShorts, queueShort, requestShort, shortsByKey, shortsStatus } from './shorts.js';
import {
  SATELLITE_STYLE, STATE_NAMES, areaLineFor, hazardChipsFor, headlineFor, iconKeyFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';
import {
  applyLiveCommand, indexSummary, liveControl, musicTracks, NEURAL_VOICES, nexradSites, noteStreamBeat, OPENAI_VOICES, puterTokenFor, streamKey,
  recentReports, requireLiveToken, siteRadar, talliesFor
} from './live.js';
import { openaiSpeech, openaiTtsStatus } from './voice.js';
import { wisSummary } from './wis.js';
import { tropicalOverview } from './nhc.js';
import { surfaceAnalysis } from './surface.js';
import { cameraStream, camerasNear, getCamera, searchCameras } from './cameras.js';
import { modelCatalog, modelFrame, modelSegment, soundingAvailable, soundingPng } from './models.js';

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
    summary: item.summary || '',
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
      home: {
        lat: config.forecast.lat,
        lon: config.forecast.lon,
        place: `${config.forecast.city}, ${STATE_NAMES[config.forecast.state] || config.forecast.state}`
      },
      soundings: soundingAvailable(),
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

  /* ---------- live stream ---------- */
  router.get('/live', async (req, res, next) => {
    try {
      noteStreamBeat(req.query);
      const { alerts } = await currentAlerts();
      const [index, control, reports] = await Promise.all([indexSummary(alerts), liveControl(), recentReports()]);
      res.set('Cache-Control', 'no-store');
      res.json({ generatedAt: new Date().toISOString(), tallies: talliesFor(alerts), index, wis: wisSummary(), control, reports });
    } catch (error) {
      next(error);
    }
  });

  router.get('/live/radar', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await siteRadar(req.query.site));
    } catch (error) {
      next(error);
    }
  });

  // WPC surface analysis (highs, lows, fronts) for the national radar shot.
  router.get('/surface', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await surfaceAnalysis());
    } catch (error) {
      next(error);
    }
  });

  // Camera picker (Live Control) and single camera lookup (pinned camera on stream).
  router.get('/cameras', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await searchCameras({ q: String(req.query.q || '').slice(0, 80), state: req.query.state, agency: req.query.agency, kind: req.query.kind, offset: req.query.offset, limit: req.query.limit }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/cameras/item/:id', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await getCamera(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  // OBS can't open Puter's sign-in popup: the stream fetches the token Live Control linked, with its stream key.
  router.get('/live/puter', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await puterTokenFor(req.query.key));
    } catch (error) {
      next(error);
    }
  });

  // Nearest live cameras from the WeatherPower Traffic camera network.
  router.get('/cameras/near', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await camerasNear({ lat: req.query.lat, lon: req.query.lon, miles: req.query.miles, limit: req.query.limit }));
    } catch (error) {
      next(error);
    }
  });

  // Camera video through this server: index.m3u8 for the camera, then seg?u=… for everything it references.
  router.get('/cameras/stream/:id/:file', async (req, res, next) => {
    try {
      if (!['index.m3u8', 'seg'].includes(req.params.file)) throw Object.assign(new Error('Not found'), { status: 404 });
      const out = await cameraStream({ id: req.params.id, file: req.params.file, u: req.query.u });
      res.set('Cache-Control', out.playlist ? 'no-store' : 'public, max-age=30');
      res.type(out.type).send(out.body);
    } catch (error) {
      next(error);
    }
  });

  // Active hurricanes/tropical storms (cone, tracks, models, watches) plus the NHC 7-day outlook.
  router.get('/tropics', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=120');
      res.json(await tropicalOverview());
    } catch (error) {
      next(error);
    }
  });

  // Weather Intensity Score shared by the WIS page and the live stream. ?alerts=N adds the top N alerts.
  router.get('/wis', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(wisSummary({ alerts: Math.min(50, Math.max(0, Number(req.query.alerts) || 0)) }));
  });

  router.get('/live/music', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ tracks: await musicTracks() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/live/voice', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ neural: NEURAL_VOICES, openai: { ...openaiTtsStatus(), voices: OPENAI_VOICES } });
  });

  router.get('/live/tts', async (req, res, next) => {
    try {
      const audio = await openaiSpeech({ text: req.query.text, voice: req.query.voice, speed: req.query.speed });
      res.set('Cache-Control', 'public, max-age=86400');
      res.type('audio/mpeg').send(audio);
    } catch (error) {
      next(error);
    }
  });

  router.get('/nexrad', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=86400');
      res.json({ sites: await nexradSites() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/models/catalog', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=600');
      res.json({ ...(await modelCatalog()), soundings: soundingAvailable() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/models/segment', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=120');
      res.json(await modelSegment({
        model: String(req.query.model || 'hrrr'),
        field: String(req.query.field || 'refc'),
        lat: req.query.lat,
        lon: req.query.lon,
        place: String(req.query.place || '').slice(0, 80) || undefined,
        horizon: req.query.horizon,
        // State focus: sample points inside the state ("lat,lon,label;…") and the state's name.
        points: String(req.query.points || '').slice(0, 4000),
        region: String(req.query.region || '').slice(0, 40)
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/models/frame/:model/:run/:field/:hour.webp', async (req, res, next) => {
    try {
      const frame = await modelFrame(req.params);
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('image/webp').send(frame);
    } catch (error) {
      next(error);
    }
  });

  router.get('/models/sounding.png', async (req, res, next) => {
    try {
      const sounding = await soundingPng({ lat: req.query.lat, lon: req.query.lon, fhr: req.query.fhr });
      res.set('Cache-Control', 'public, max-age=900');
      if (sounding.run) res.set('X-HRRR-Run', sounding.run);
      res.type('image/png').send(sounding.png);
    } catch (error) {
      next(error);
    }
  });

  router.post('/live/control', requireLiveToken, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      // The stream key only goes to token holders: it's what lets the OBS stream fetch the Puter sign-in.
      res.json({ ok: true, control: await applyLiveCommand(req.body || {}), streamKey: streamKey() });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
