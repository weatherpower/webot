// Public Warning Center API v3: one clean alert schema shared by the center, detail page and apps.
import express from 'express';
import { config } from './config.js';
import { requireControllerToken } from './auth.js';
import { getRenderedState } from './autoRenderer.js';
import { compactPublicGeometry } from './publicFeed.js';
import { compositeValidTime } from './shortVideo.js';
import { getShort, listShorts, queueShort, requestShort, shortSig, shortsByKey, shortsStatus } from './shorts.js';
import {
  SATELLITE_STYLE, STATE_NAMES, areaLineFor, hazardChipsFor, headlineFor, iconKeyFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';
import {
  applyLiveCommand, fromHomeNetwork, streamKeyOk, indexSummary, liveControl, musicTracks, NEURAL_VOICES, nexradSites, noteStreamBeat, OPENAI_VOICES, puterTokenFor, streamKey,
  recentReports, requireLiveToken, siteRadar, talliesFor, webotActivity
} from './live.js';
import { openaiSpeech, openaiTtsStatus } from './voice.js';
import { localSpeech, localVoiceStatus, warmLocalVoice } from './localVoice.js';
import { wisSummary } from './wis.js';
import { tropicalOverview } from './nhc.js';
import { surfaceAnalysis } from './surface.js';
import { cityForecast, randomCityForecast } from './cityForecast.js';
import { chatCommandStatus, chatStatus, retryChatCommand } from './youtubeChat.js';
import { loadBrain } from './brain.js';
import { getHeadlines } from './headlines.js';
import { gasSegment } from './gasPrices.js';
import { trainCams } from './trainCams.js';
import { wpcOutlook } from './wpcOutlook.js';
import { cameraStream, camerasNear, getCamera, searchCameras } from './cameras.js';
import { modelCatalog, modelFrame, modelSegment, soundingAvailable, soundingPng } from './models.js';
import { emergencyDeclarations } from './emergencyDeclarations.js';

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
    .map((item) => {
      const own = shorts.get(item.key);
      return toV3Alert(item, own?.path ? own : shorts.get(`sig:${shortSig(item)}`) || own);
    })
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

// Public WeBot status: what's on, what's next, what he said, and the weather he's watching. Nothing private.
let webotCache = { at: 0, body: null };
export const webotStatus = async () => {
  if (webotCache.body && Date.now() - webotCache.at < 3000) return webotCache.body;
  const { alerts } = await currentAlerts();
  const control = await liveControl();
  const wis = wisSummary();
  const body = {
    generatedAt: new Date().toISOString(),
    ...webotActivity(),
    brb: control.brb ? { message: control.brb.message || '', since: control.brb.since } : null,
    mode: control.mode || 'auto',
    focus: control.state || '',
    talk: control.talk || 'auto',
    pinned: Boolean(control.pin),
    chat: (({ enabled, live, viewers, startedAt, totalViews, subscribers }) => ({ enabled, live, viewers, startedAt, totalViews, subscribers }))(chatStatus()),
    wis: wis?.loaded ? { score: Math.round(wis.score), label: wis.label, trend: wis.trend ?? null } : null,
    tallies: talliesFor(alerts),
    // Same warning type in the same place (one per county zone) shows once, with a count.
    watching: [...alerts.filter((a) => a.group === 'warnings').reduce((map, a) => {
      const key = [a.eventLabel, a.place, (a.states || []).join()].join('|');
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { label: a.eventLabel, place: a.place || '', states: a.states || [], color: a.color, expiresAt: a.expiresAt || null, count: 1 });
      return map;
    }, new Map()).values()].slice(0, 6)
  };
  webotCache = { at: Date.now(), body };
  return body;
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
      const short = await getShort(item.key, item);
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
      res.json({ ok: true, ...result, short: await getShort(item.key, item) });
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
      res.json({ generatedAt: new Date().toISOString(), tallies: talliesFor(alerts), index, wis: wisSummary(), control, reports, chat: chatStatus() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/webot/status', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=3');
      res.json(await webotStatus());
    } catch (error) {
      next(error);
    }
  });

  // Private operations feed for WeBot Studio. Viewer command history is intentionally not exposed
  // through the public /webot/status endpoint.
  router.get('/live/chat-commands', requireLiveToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(chatCommandStatus());
  });
  router.post('/live/chat-commands/retry', requireLiveToken, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await retryChatCommand(req.body?.id));
    } catch (error) {
      next(error);
    }
  });

  // WeBot's brain settings (lines, timing, chat rules, radio): read by the stream page; saved from WeBot Studio.
  router.get('/live/brain', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await loadBrain());
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

  // Recent FEMA federal emergency declarations for WeBot's emergency-declaration segment.
  router.get('/emergencies', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await emergencyDeclarations({ days: req.query.days }));
    } catch (error) {
      next(error);
    }
  });

  // Top-bar headlines: weather news and top US news (headline + source only).
  router.get('/headlines', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await getHeadlines());
    } catch (error) {
      next(error);
    }
  });

  // Daily forecast for a random city (inside ?state= when the stream is focused on a state).
  router.get('/forecast/random', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await randomCityForecast({ state: String(req.query.state || '').toUpperCase() }));
    } catch (error) {
      next(error);
    }
  });

  // A city picked by name and point (viewer requests from YouTube chat); ?lat=&lon=&name=&state=.
  const cityParam = (q) => {
    const lat = Number(q.lat), lon = Number(q.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { name: String(q.name || '').slice(0, 60) || 'That spot', state: String(q.state || '').toUpperCase().slice(0, 2), lat, lon };
  };

  router.get('/forecast/city', async (req, res, next) => {
    try {
      const city = cityParam(req.query);
      if (!city) return res.status(400).json({ ok: false, error: 'lat and lon are required' });
      res.set('Cache-Control', 'no-store');
      res.json(await cityForecast(city));
    } catch (error) {
      next(error);
    }
  });

  // Gas prices segment: EIA weekly averages + stations near a random city (inside ?state= when focused),
  // or near ?lat=&lon=&name=&state= for a viewer request.
  // SouthWest RailCams live cams for the Train Cam segment (src/trainCams.js).
  // WPC Excessive Rainfall Outlooks, days 1-3 (src/wpcOutlook.js).
  router.get('/wpc', async (req, res, next) => {
    try { res.json(await wpcOutlook()); } catch (error) { next(error); }
  });

  router.get('/traincams', async (req, res, next) => {
    try { res.json({ cams: await trainCams() }); } catch (error) { next(error); }
  });

  router.get('/gas', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await gasSegment({ state: String(req.query.state || '').toUpperCase(), city: cityParam(req.query) }));
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
      res.json(await puterTokenFor(req.query.key, { homeNetwork: fromHomeNetwork(req) }));
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
    // Only screens on the home network (or with the private stream key) may use this PC's free voice.
    // LOCAL_VOICE=off skips the free voice model (~1 GB of RAM) on small servers; Puter's Alloy still works.
    const local = process.env.LOCAL_VOICE !== 'off' && (fromHomeNetwork(req) || streamKeyOk(req.query.key));
    if (local) warmLocalVoice();
    res.json({ neural: NEURAL_VOICES, openai: { ...openaiTtsStatus(), voices: OPENAI_VOICES }, local: local ? { ...localVoiceStatus(), voices: NEURAL_VOICES } : { available: false } });
  });

  // WeBot's free voice, made on this PC (Kokoro). Home network or the private stream key only.
  router.get('/live/tts-local', async (req, res, next) => {
    try {
      if (process.env.LOCAL_VOICE === 'off') throw Object.assign(new Error('Free voice is turned off on this server'), { status: 503 });
      if (!fromHomeNetwork(req) && !streamKeyOk(req.query.key)) throw Object.assign(new Error('Free voice is only for the stream screens'), { status: 403 });
      const audio = await localSpeech({ text: req.query.text, voice: req.query.voice, speed: req.query.speed });
      res.set('Cache-Control', 'private, max-age=86400');
      res.type('audio/wav').send(audio);
    } catch (error) {
      next(error);
    }
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
