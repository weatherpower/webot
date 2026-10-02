import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { dataDir, ensureRuntimeDirs, projectRoot } from './paths.js';
import { fetchActiveWarnings } from './nws.js';
import { fetchActiveMesoscaleDiscussions } from './spc.js';
import { fetchActiveSpcOutlooks } from './spcOutlooks.js';
import { fetchActiveCustomProducts } from './customProducts.js';
import { fetchDailyForecastCards } from './dailyForecasts.js';
import { renderWarningCards } from './renderCard.js';
import { cleanupUnusedCards } from './cardCleanup.js';
import { appendLog } from './logStore.js';
import { postCardToDiscord } from './posters/discord.js';
import { enrichWarningTropical } from './nhc.js';
import { queueAutoShorts } from './shorts.js';

const statePath = path.join(dataDir, 'rendered-alerts.json');
const RENDER_INDEX_VERSION = '2026-10-02-broadcast-cards-v5';

let state = {
  status: 'idle',
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  items: []
};

let refreshPromise = null;
let timer = null;

const stableStringify = (value) => JSON.stringify(value, (key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.keys(item)
      .sort()
      .reduce((sorted, itemKey) => {
        sorted[itemKey] = item[itemKey];
        return sorted;
      }, {});
  }
  return item;
});

const isCurrentItem = (item, now = Date.now()) => {
  const expires = Date.parse(item?.expiresAt || '');
  return !Number.isFinite(expires) || expires > now;
};

const pruneExpiredItems = (items = []) => items.filter((item) => isCurrentItem(item));
const hasPendingRender = (items = []) => items.some((item) => item.status === 'pending');

const stateWithCurrentItems = (currentState, { updateCounts = true } = {}) => {
  const items = pruneExpiredItems(currentState.items || []);
  const nextState = {
    ...currentState,
    items
  };

  if (updateCounts) {
    nextState.count = items.length;
    nextState.renderedCount = items.filter((item) => item.status === 'rendered').length;
    nextState.errorCount = items.filter((item) => item.status === 'error').length;
  }

  return nextState;
};

const simplifyRing = (ring = [], maxPoints = 120) => {
  if (!Array.isArray(ring) || ring.length <= maxPoints) return ring;
  const closed = ring.length > 2 && ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1];
  const usableLength = closed ? ring.length - 1 : ring.length;
  const step = Math.max(1, Math.ceil(usableLength / Math.max(2, maxPoints - 1)));
  const simplified = [];
  for (let index = 0; index < usableLength; index += step) {
    simplified.push(ring[index]);
  }
  if (ring[usableLength - 1] && simplified.at(-1) !== ring[usableLength - 1]) {
    simplified.push(ring[usableLength - 1]);
  }
  if (closed && simplified.length) simplified.push(simplified[0]);
  return simplified;
};

const simplifyGeometryForState = (geometry) => {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: (geometry.coordinates || []).map((ring) => simplifyRing(ring))
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: (geometry.coordinates || []).map((polygon) => (
        (polygon || []).map((ring) => simplifyRing(ring))
      ))
    };
  }
  return geometry;
};

const compactWatchDetails = (details) => {
  if (!details) return undefined;
  return {
    number: details.number,
    pds: Boolean(details.pds),
    pdsText: details.pdsText,
    maxHail: details.maxHail,
    maxWind: details.maxWind,
    probabilities: details.probabilities || [],
    spcWatchUrl: details.spcWatchUrl,
    spcOutlineUrl: details.spcOutlineUrl,
    spcProbabilityUrl: details.spcProbabilityUrl
  };
};

const hashWarning = (warning) => crypto
  .createHash('sha1')
  .update(JSON.stringify({
    version: RENDER_INDEX_VERSION,
    key: warning.key,
    nwsId: warning.nwsId,
    event: warning.event,
    headline: warning.headline,
    expiresAt: warning.expiresAt,
    issuedAt: warning.issuedAt,
    timezone: warning.timezone,
    polygon: warning.polygon,
    hazards: stableStringify(warning.hazards),
    hazardStats: stableStringify(warning.hazardStats),
    impactLine: warning.impactLine,
    sourceText: warning.sourceText,
    whatToDo: warning.whatToDo,
    theme: stableStringify(warning.theme),
    radar: stableStringify(warning.radar),
    parameters: stableStringify(warning.parameters),
    classification: stableStringify(warning.classification),
    mdDetails: stableStringify(warning.mdDetails),
    outlookDetails: stableStringify(warning.outlookDetails),
    watchDetails: stableStringify(warning.watchDetails),
    tropical: stableStringify(warning.tropical),
    forecast: stableStringify(warning.forecast),
    cardLayout: warning.cardLayout,
    forecastCardVersion: warning.cardLayout === 'forecast' ? '2026-08-08-marker-v2' : '',
    populationCardVersion: warning.classification?.isWarning || warning.classification?.isWatch ? '2020-census-centroid-v1' : '',
    geometry: stableStringify(warning.geometry)
  }))
  .digest('hex');

const publicUrl = (publicPath) => `${config.publicBaseUrl}${publicPath}`;

const fileExists = async (publicPath) => {
  if (!publicPath) return false;
  try {
    await fs.access(path.join(projectRoot, publicPath.replace(/^\//, '')));
    return true;
  } catch {
    return false;
  }
};

const mergeExistingRender = (item, existing) => ({
  ...(item || existing),
  status: 'rendered',
  error: null,
  staleCard: false,
  renderedAt: existing.renderedAt,
  card: existing.card,
  radar: existing.radar || item?.radar,
  impacts: existing.impacts || item?.impacts,
  impactLine: existing.impactLine || item?.impactLine,
  discord: existing.discord || item?.discord
});

const canReuseExistingRender = async (existing, hash) => (
  existing?.status === 'rendered'
  && existing?.staleCard !== true
  && existing?.hash === hash
  && existing?.card?.path
  && await fileExists(existing.card.path)
);

const renderFromStateItem = (item) => {
  if (!item?.card?.path) return null;
  return {
    filePath: path.join(projectRoot, item.card.path.replace(/^\//, '')),
    publicPath: item.card.path,
    filename: item.card.filename || path.basename(item.card.path),
    contentType: item.card.contentType || 'image/png',
    bytes: item.card.bytes
  };
};

const backupCorruptState = async () => {
  const backupPath = path.join(dataDir, `rendered-alerts.corrupt-${Date.now()}.json`);
  await fs.rename(statePath, backupPath).catch(() => {});
  return backupPath;
};

const toItem = ({ warning, render, hash, status = 'rendered', error = null }) => ({
  key: warning.key || warning.nwsId || crypto.randomUUID(),
  hash,
  status,
  error,
  renderedAt: render ? new Date().toISOString() : null,
  title: warning.title,
  event: warning.event,
  state: warning.state,
  stateCodes: warning.stateCodes,
  ugc: (warning.ugc || []).slice(0, 60),
  vtecAction: warning.vtecAction,
  messageType: warning.messageType,
  areaDesc: warning.areaDesc,
  office: warning.office,
  expiresAt: warning.expiresAt,
  issuedAt: warning.issuedAt,
  timezone: warning.timezone,
  theme: warning.theme,
  classification: warning.classification,
  hazardStats: warning.hazardStats || [],
  impacts: warning.impacts,
  impactLine: warning.impactLine,
  hazards: warning.hazards,
  sourceText: warning.sourceText,
  whatToDo: warning.whatToDo,
  postText: warning.postText,
  locations: warning.locations || [],
  outlookDetails: warning.outlookDetails,
  polygon: simplifyRing(warning.polygon || []),
  geometry: simplifyGeometryForState(warning.geometry),
  center: warning.center,
  radar: warning.radar,
  nwsId: warning.nwsId,
  watchDetails: compactWatchDetails(warning.watchDetails),
  cardLayout: warning.cardLayout,
  forecast: warning.forecast ? {
    location: warning.forecast.location,
    dayLabel: warning.forecast.dayLabel,
    periodName: warning.forecast.periodName,
    isDaytime: warning.forecast.isDaytime,
    high: warning.forecast.high,
    low: warning.forecast.low,
    temperature: warning.forecast.temperature,
    temperatureUnit: warning.forecast.temperatureUnit,
    precipitation: warning.forecast.precipitation,
    wind: warning.forecast.wind,
    shortForecast: warning.forecast.shortForecast,
    detailedForecast: warning.forecast.detailedForecast,
    sourceUpdatedAt: warning.forecast.sourceUpdatedAt
  } : undefined,
  tropical: warning.tropical ? {
    stormId: warning.tropical.id || warning.tropical.stormId,
    binNumber: warning.tropical.binNumber,
    name: warning.tropical.name,
    classification: warning.tropical.classification,
    classificationLabel: warning.tropical.classificationLabel,
    intensityKt: warning.tropical.intensityKt,
    intensityMph: warning.tropical.intensityMph,
    pressureMb: warning.tropical.pressureMb,
    movement: warning.tropical.movement,
    advisoryNumber: warning.tropical.advisoryNumber,
    advisoryUrl: warning.tropical.advisoryUrl,
    lastUpdate: warning.tropical.lastUpdate,
    modelCount: warning.tropical.modelCount,
    modelNames: warning.tropical.modelNames,
    source: warning.tropical.source,
    unavailable: warning.tropical.unavailable
  } : undefined,
  card: render ? {
    filename: render.filename,
    path: render.publicPath,
    url: publicUrl(render.publicPath),
    bytes: render.bytes,
    contentType: render.contentType
  } : null,
  detailUrl: `/warningdetail?key=${encodeURIComponent(warning.key || warning.nwsId || '')}`
});

const toPendingItem = async ({ warning, hash, existing, force }) => {
  const item = toItem({ warning, render: null, hash, status: 'pending' });
  if (!force && await canReuseExistingRender(existing, hash)) {
    return mergeExistingRender(item, existing);
  }
  if (existing?.card?.path && await fileExists(existing.card.path)) {
    return {
      ...item,
      renderedAt: existing.renderedAt,
      card: existing.card,
      staleCard: true
    };
  }
  return item;
};

const latestDiscordPostedAt = (items = []) => items.reduce((latest, item) => {
  const timestamp = Date.parse(item?.discord?.postedAt || '');
  return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
}, 0);

const createDiscordAutoPostPolicy = ({ currentItems = [], suppressBackfill = false }) => {
  let postedThisRefresh = 0;
  let lastPostedAt = latestDiscordPostedAt(currentItems);
  return {
    suppressBackfill,
    takeSlot() {
      const maxPerRefresh = Math.max(0, config.discord.autoPostMaxPerRefresh);
      if (maxPerRefresh === 0) {
        return { ok: false, reason: 'Discord auto-post max per refresh is 0' };
      }
      if (postedThisRefresh >= maxPerRefresh) {
        return { ok: false, pending: true, reason: `Discord auto-post refresh limit reached (${maxPerRefresh})` };
      }
      const minMs = Math.max(0, config.discord.autoPostMinSeconds) * 1000;
      const waitMs = lastPostedAt ? minMs - (Date.now() - lastPostedAt) : 0;
      if (waitMs > 0) {
        return { ok: false, pending: true, reason: `Discord auto-post cooldown active for ${Math.ceil(waitMs / 1000)}s` };
      }
      postedThisRefresh += 1;
      lastPostedAt = Date.now();
      return { ok: true };
    }
  };
};

const isDiscordAutoPostTarget = (warning = {}) => {
  if (warning.classification?.isForecast || warning.cardLayout === 'forecast') return false;
  const event = String(warning.event || warning.title || '').toLowerCase();
  return /\bwarning\b/.test(event) ||
    /\bwatch\b/.test(event) ||
    event.includes('spc') ||
    event.includes('mesoscale discussion');
};

const pendingDiscord = ({ hash, reason, existing }) => ({
  ...(existing?.discord || {}),
  skipped: true,
  pending: true,
  pendingHash: hash,
  pendingAt: existing?.discord?.pendingAt || new Date().toISOString(),
  reason
});

const skippedDiscord = ({ hash, reason, existing }) => ({
  ...(existing?.discord || {}),
  skipped: true,
  pending: false,
  postedHash: hash,
  skippedAt: new Date().toISOString(),
  reason
});

const maybePostAutoDiscord = async ({ warning, render, item, hash, existing, policy }) => {
  if (!config.discord.autoPostEnabled) return item;
  if (existing?.discord?.postedHash === hash && !existing.discord.error) {
    return {
      ...item,
      discord: existing.discord
    };
  }
  if (!isDiscordAutoPostTarget(warning)) {
    return {
      ...item,
      discord: skippedDiscord({ hash, reason: 'Event is not selected for Discord auto-posting', existing })
    };
  }
  if (policy?.suppressBackfill && !existing) {
    return {
      ...item,
      discord: skippedDiscord({ hash, reason: 'Initial active-feed backfill suppressed', existing })
    };
  }
  if (existing && existing.hash !== hash && existing.discord?.pendingHash !== hash) {
    return {
      ...item,
      discord: skippedDiscord({
        hash,
        reason: 'Existing alert rerendered; Discord auto-posting is limited to new alerts',
        existing
      })
    };
  }
  if (!render?.filePath) {
    return {
      ...item,
      discord: pendingDiscord({ hash, reason: 'Rendered card file is not available yet', existing })
    };
  }
  const slot = policy?.takeSlot?.() || { ok: true };
  if (!slot.ok) {
    return {
      ...item,
      discord: pendingDiscord({ hash, reason: slot.reason || 'Discord auto-post waiting for the next safe slot', existing })
    };
  }

  try {
    const result = await postCardToDiscord({
      warning,
      render,
      text: warning.postText || item.postText || item.title,
      context: 'auto-render'
    });
    const discord = {
      ...result,
      postedHash: hash,
      pending: false,
      pendingHash: undefined,
      postedAt: new Date().toISOString()
    };
    await appendLog({
      level: 'info',
      action: 'discord-auto-post',
      warningTitle: item.title,
      discord
    });
    return {
      ...item,
      discord
    };
  } catch (error) {
    const discord = {
      skipped: false,
      pending: true,
      pendingHash: hash,
      error: error.message,
      status: error.status,
      attemptedAt: new Date().toISOString()
    };
    await appendLog({
      level: 'error',
      action: 'discord-auto-post',
      warningTitle: item.title,
      message: error.message,
      status: error.status,
      body: error.body
    });
    return {
      ...item,
      discord
    };
  }
};

export const loadRenderedState = async () => {
  await ensureRuntimeDirs();
  try {
    const loadedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state = stateWithCurrentItems(loadedState);
    if ((loadedState.items || []).length !== (state.items || []).length) {
      await saveRenderedState();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return state;
    if (error instanceof SyntaxError) {
      const backupPath = await backupCorruptState();
      console.warn(`Rendered state was corrupt and has been backed up to ${backupPath}`);
      state = {
        status: 'idle',
        lastStartedAt: null,
        lastFinishedAt: null,
        lastError: 'Recovered from corrupt rendered-alerts.json',
        items: []
      };
      await saveRenderedState();
      return state;
    }
    throw error;
  }
  return state;
};

const saveRenderedState = async () => {
  await ensureRuntimeDirs();
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, statePath);
};

const mapLimit = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
};

export const getRenderedState = async ({ kick = true } = {}) => {
  if (!state.lastFinishedAt) await loadRenderedState();
  const currentState = stateWithCurrentItems(state, { updateCounts: state.status !== 'rendering' });
  if ((currentState.items || []).length !== (state.items || []).length) {
    state = currentState;
    await saveRenderedState();
  }
  if (kick && config.autoRender.enabled && !refreshPromise) {
    const stale = !state.lastFinishedAt || Date.now() - new Date(state.lastFinishedAt).getTime() > config.autoRender.intervalMs;
    if (stale) refreshRenderedWarnings().catch(() => {});
  }
  return state;
};

export const getRenderedWarning = async (key) => {
  const current = await getRenderedState({ kick: false });
  return current.items.find((item) => item.key === key || item.nwsId === key) || null;
};

export const refreshRenderedWarnings = async ({ force = false } = {}) => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    await loadRenderedState();
    const suppressDiscordBackfill = config.discord.autoPostSuppressBackfill && !state.lastFinishedAt;
    const currentItems = pruneExpiredItems(state.items || []);
    const discordPolicy = createDiscordAutoPostPolicy({
      currentItems,
      suppressBackfill: suppressDiscordBackfill
    });
    const previous = new Map(currentItems.map((item) => [item.key, item]));
    state = {
      ...state,
      status: force ? 'rendering' : 'refreshing',
      lastStartedAt: new Date().toISOString(),
      lastError: null,
      items: currentItems,
      renderedCount: currentItems.filter((item) => item.status === 'rendered').length,
      errorCount: currentItems.filter((item) => item.status === 'error').length
    };
    await saveRenderedState();

    try {
      const [active, discussions, outlooks, customProducts, forecasts] = await Promise.all([
        fetchActiveWarnings({
          warningOnly: false,
          limit: config.autoRender.limit
        }),
        fetchActiveMesoscaleDiscussions(),
        fetchActiveSpcOutlooks(),
        fetchActiveCustomProducts(),
        config.forecast.enabled
          ? fetchDailyForecastCards().catch(async (error) => {
            await appendLog({ level: 'warn', action: 'fetch-daily-forecast-cards', message: error.message, status: error.status });
            return { warnings: [] };
          })
          : { warnings: [] }
      ]);
      const sourceWarnings = pruneExpiredItems([
        ...(active.warnings || []),
        ...(discussions.warnings || []),
        ...(outlooks.warnings || []),
        ...(customProducts.warnings || []),
        ...(forecasts.warnings || [])
      ]);
      const activeWarnings = await mapLimit(
        sourceWarnings,
        config.autoRender.concurrency,
        enrichWarningTropical
      );
      activeWarnings.sort((a, b) => {
        const tropicalPriority = Number(Boolean(b.classification?.isTropical)) - Number(Boolean(a.classification?.isTropical));
        if (tropicalPriority) return tropicalPriority;
        const emergencyPriority = Number(Boolean(b.classification?.isEmergency)) - Number(Boolean(a.classification?.isEmergency));
        if (emergencyPriority) return emergencyPriority;
        const pdsPriority = Number(Boolean(b.classification?.isPds)) - Number(Boolean(a.classification?.isPds));
        if (pdsPriority) return pdsPriority;
        const destructivePriority = Number(Boolean(b.classification?.isDestructive)) - Number(Boolean(a.classification?.isDestructive));
        if (destructivePriority) return destructivePriority;
        const considerablePriority = Number(Boolean(b.classification?.isConsiderable)) - Number(Boolean(a.classification?.isConsiderable));
        if (considerablePriority) return considerablePriority;
        const forecastPriority = Number(Boolean(b.classification?.isForecast)) - Number(Boolean(a.classification?.isForecast));
        if (forecastPriority) return forecastPriority;
        return Date.parse(b.issuedAt || '') - Date.parse(a.issuedAt || '');
      });
      // Queue warning videos first so they are not stuck behind a long card backlog.
      queueAutoShorts(activeWarnings).catch((error) => {
        console.warn(`Auto shorts failed: ${error.message}`);
      });
      const pendingItems = pruneExpiredItems(await mapLimit(activeWarnings, config.autoRender.concurrency, async (warning) => {
        const key = warning.key || warning.nwsId;
        return toPendingItem({
          warning,
          hash: hashWarning(warning),
          existing: previous.get(key),
          force
        });
      }));

      state = {
        ...state,
        status: hasPendingRender(pendingItems) ? 'rendering' : 'refreshing',
        count: activeWarnings.length,
        renderedCount: pendingItems.filter((item) => item.status === 'rendered').length,
        errorCount: pendingItems.filter((item) => item.status === 'error').length,
        items: pendingItems
      };
      await saveRenderedState();

      const renderResults = new Array(activeWarnings.length);
      let completed = 0;
      let lastProgressSave = 0;
      let saveProgressPromise = Promise.resolve();
      const mergedProgressItems = () => pruneExpiredItems(pendingItems.map((item, index) => renderResults[index] || item));
      const saveProgress = async (forceSave = false) => {
        if (!forceSave && completed - lastProgressSave < 5) return;
        lastProgressSave = completed;
        const progressItems = mergedProgressItems();
        saveProgressPromise = saveProgressPromise.then(async () => {
          state = {
            ...state,
            status: hasPendingRender(progressItems) ? 'rendering' : 'refreshing',
            count: activeWarnings.length,
            renderedCount: progressItems.filter((item) => item.status === 'rendered').length,
            errorCount: progressItems.filter((item) => item.status === 'error').length,
            items: progressItems
          };
          await saveRenderedState();
        });
        await saveProgressPromise;
      };

      const renderQueue = [];
      for (let index = 0; index < activeWarnings.length; index += 1) {
        const warning = activeWarnings[index];
        const key = warning.key || warning.nwsId;
        const hash = hashWarning(warning);
        const existing = previous.get(key);
        if (!force && await canReuseExistingRender(existing, hash)) {
          let item = mergeExistingRender(pendingItems[index], existing);
          if (existing.discord?.pendingHash === hash && !existing.discord?.postedHash) {
            item = await maybePostAutoDiscord({
              warning: item,
              render: renderFromStateItem(item),
              item,
              hash,
              existing,
              policy: discordPolicy
            });
          }
          renderResults[index] = item;
          completed += 1;
          await saveProgress(completed === activeWarnings.length);
          continue;
        }
        renderQueue.push({ warning, index, hash, existing });
      }

      const boundedRenderQueue = renderQueue.slice(0, config.autoRender.maxRendersPerCycle);
      for (let offset = 0; offset < boundedRenderQueue.length; offset += config.autoRender.renderBatchSize) {
        const batch = boundedRenderQueue.slice(offset, offset + config.autoRender.renderBatchSize);
        try {
          const renders = await renderWarningCards(batch.map(({ warning }) => warning), { priority: 'background' });
          if (renders.length !== batch.length) {
            throw new Error(`Render worker returned ${renders.length} cards for a ${batch.length}-card batch`);
          }
          for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
            const { index, hash, existing } = batch[batchIndex];
            const render = renders[batchIndex];
            let item = toItem({ warning: render.warning, render, hash });
            item = await maybePostAutoDiscord({
              warning: render.warning,
              render,
              item,
              hash,
              existing,
              policy: discordPolicy
            });
            renderResults[index] = item;
            completed += 1;
          }
        } catch (error) {
          for (const { warning, index, hash } of batch) {
            const item = toItem({
              warning,
              render: null,
              hash,
              status: 'error',
              error: error.message
            });
            renderResults[index] = item;
            completed += 1;
          }
        }
        await saveProgress(offset + batch.length >= boundedRenderQueue.length);
        if (
          config.autoRender.batchCooldownMs > 0
          && offset + batch.length < boundedRenderQueue.length
        ) {
          await new Promise((resolve) => setTimeout(resolve, config.autoRender.batchCooldownMs));
        }
      }

      const items = mergedProgressItems();
      await saveProgress(true);

      state = {
        status: hasPendingRender(items) ? 'pending' : 'idle',
        lastStartedAt: state.lastStartedAt,
        lastFinishedAt: new Date().toISOString(),
        lastError: null,
        count: items.length,
        renderedCount: items.filter((item) => item.status === 'rendered').length,
        errorCount: items.filter((item) => item.status === 'error').length,
        items
      };
      await saveRenderedState();
      cleanupUnusedCards(items).catch((error) => {
        console.warn(`Card cleanup failed: ${error.message}`);
      });
      return state;
    } catch (error) {
      state = {
        ...state,
        status: 'error',
        lastFinishedAt: new Date().toISOString(),
        lastError: error.message
      };
      await saveRenderedState();
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

export const startAutoRenderer = () => {
  if (!config.autoRender.enabled || timer) return;
  refreshRenderedWarnings().catch((error) => {
    console.warn(`Initial auto-render failed: ${error.message}`);
  });
  timer = setInterval(() => {
    refreshRenderedWarnings().catch((error) => {
      console.warn(`Auto-render failed: ${error.message}`);
    });
  }, config.autoRender.intervalMs);
};
