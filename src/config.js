import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
const mapStyleRevision = '20260809-v6-tribal-hard-gate';
const defaultOpenMeteoGeocodingUrl = 'https://geocoding-api.open-meteo.com/v1/search';
const openMeteoGeocodingUrl = process.env.OPEN_METEO_GEOCODING_URL || defaultOpenMeteoGeocodingUrl;
const openMeteoApiKey = process.env.OPEN_METEO_API_KEY || '';
const usesPublicOpenMeteoGeocoding = (() => {
  try {
    return new URL(openMeteoGeocodingUrl).hostname === 'geocoding-api.open-meteo.com';
  } catch {
    return true;
  }
})();
const openMeteoProductionReady = Boolean(openMeteoApiKey) || !usesPublicOpenMeteoGeocoding;

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8787}`,
  homePage: process.env.HOME_PAGE || 'controller',
  publicWarningCenterOnly: bool(process.env.PUBLIC_WARNINGCENTER_ONLY, false),
  useServerlessChromium: bool(process.env.USE_SERVERLESS_CHROMIUM, false),
  renderer: {
    browserChannel: process.env.RENDER_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : ''),
    workerTimeoutMs: Math.round(clamp(number(process.env.RENDER_WORKER_TIMEOUT_MS, 180000), 30000, 300000))
  },
  maps: {
    styleUrl: process.env.MAPLIBRE_STYLE_URL || `https://weatherpower.app/maps/weatherpower/style.json?v=${mapStyleRevision}`,
    satelliteStyleUrl: process.env.MAPLIBRE_SATELLITE_STYLE_URL || `https://weatherpower.app/maps/weatherpower/satellite-style.json?v=${mapStyleRevision}`,
    geocodingProvider: process.env.WP_GEOCODING_PROVIDER || 'weatherpower-us',
    openMeteoGeocodingUrl,
    openMeteoApiKey,
    openMeteoProductionReady,
    routingBaseUrl: String(process.env.WP_OSRM_BASE_URL || '').replace(/\/+$/, ''),
    routingProvider: process.env.WP_ROUTING_PROVIDER || (process.env.WP_OSRM_BASE_URL ? 'osrm' : ''),
    requestTimeoutMs: Math.round(clamp(number(process.env.WP_MAP_SERVICE_TIMEOUT_MS, 12000), 3000, 30000))
  },
  x: {
    apiKey: process.env.X_API_KEY || '',
    apiSecret: process.env.X_API_SECRET || '',
    userAccessToken: process.env.X_USER_ACCESS_TOKEN || '',
    oauth1AccessToken: process.env.X_ACCESS_TOKEN || '',
    oauth1AccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || ''
  },
  pageEndpoint: {
    url: process.env.PAGE_ENDPOINT_URL || 'https://weatherpower.app/warningcenter',
    token: process.env.PAGE_ENDPOINT_TOKEN || '',
    mode: process.env.PAGE_POST_MODE || 'json'
  },
  discord: {
    webhookUrl: discordWebhookUrl,
    enabled: bool(process.env.DISCORD_ENABLED, Boolean(discordWebhookUrl)),
    autoPostEnabled: bool(process.env.DISCORD_AUTO_POST_ENABLED, false),
    autoPostMaxPerRefresh: number(process.env.DISCORD_AUTO_POST_MAX_PER_REFRESH, 1),
    autoPostMinSeconds: number(process.env.DISCORD_AUTO_POST_MIN_SECONDS, 3600),
    autoPostSuppressBackfill: bool(process.env.DISCORD_AUTO_POST_SUPPRESS_BACKFILL, true),
    username: process.env.DISCORD_USERNAME || 'WeatherPower',
    avatarUrl: process.env.DISCORD_AVATAR_URL || ''
  },
  autoRender: {
    enabled: bool(process.env.AUTO_RENDER_ENABLED, true),
    intervalMs: Math.round(clamp(number(process.env.AUTO_RENDER_INTERVAL_MS, 60000), 60000, 60 * 60 * 1000)),
    limit: Math.round(Math.max(0, number(process.env.AUTO_RENDER_LIMIT, 0))),
    concurrency: Math.round(clamp(number(process.env.AUTO_RENDER_CONCURRENCY, 2), 1, 4)),
    renderBatchSize: Math.round(clamp(number(process.env.AUTO_RENDER_BATCH_SIZE, 4), 1, 12)),
    maxRendersPerCycle: Math.round(clamp(number(process.env.AUTO_RENDER_MAX_PER_CYCLE, 8), 1, 48)),
    batchCooldownMs: Math.round(clamp(number(process.env.AUTO_RENDER_BATCH_COOLDOWN_MS, 2000), 0, 30000))
  },
  cardCleanup: {
    // On by default; set CARD_CLEANUP_ENABLED=false only to keep every historical card file.
    enabled: bool(process.env.CARD_CLEANUP_ENABLED, true),
    retentionHours: Math.max(1, number(process.env.CARD_RETENTION_HOURS, 24))
  },
  forecast: {
    enabled: bool(process.env.FORECAST_CARDS_ENABLED, true),
    lat: number(process.env.FORECAST_CARDS_LAT, 33.8957),
    lon: number(process.env.FORECAST_CARDS_LON, -94.8263),
    city: process.env.FORECAST_CARDS_CITY || 'Idabel',
    state: process.env.FORECAST_CARDS_STATE || 'OK',
    days: Math.round(clamp(number(process.env.FORECAST_CARDS_DAYS, 7), 1, 7)),
    cacheMs: Math.round(clamp(number(process.env.FORECAST_CARDS_CACHE_MS, 15 * 60 * 1000), 60 * 1000, 60 * 60 * 1000))
  },
  forecastSearch: {
    enabled: bool(process.env.PUBLIC_FORECAST_SEARCH_ENABLED, true),
    cacheMs: Math.round(clamp(number(process.env.PUBLIC_FORECAST_SEARCH_CACHE_MS, 30 * 60 * 1000), 5 * 60 * 1000, 2 * 60 * 60 * 1000)),
    maxRequestsPerWindow: Math.round(clamp(number(process.env.PUBLIC_FORECAST_SEARCH_MAX_REQUESTS, 3), 1, 12)),
    rateWindowMs: Math.round(clamp(number(process.env.PUBLIC_FORECAST_SEARCH_WINDOW_MS, 10 * 60 * 1000), 60 * 1000, 60 * 60 * 1000)),
    renderConcurrency: Math.round(clamp(number(process.env.PUBLIC_FORECAST_SEARCH_RENDER_CONCURRENCY, 1), 1, 1))
  },
  population: {
    enabled: bool(process.env.POPULATION_DATA_ENABLED, true),
    timeoutMs: Math.round(clamp(number(process.env.POPULATION_DATA_TIMEOUT_MS, 9000), 2000, 20000)),
    blockMaxArea: clamp(number(process.env.POPULATION_BLOCK_MAX_AREA, 2.5), 0.05, 25),
    cacheEntries: Math.round(clamp(number(process.env.POPULATION_CACHE_ENTRIES, 2000), 100, 10000))
  },
  customProducts: {
    funnyWarningsEnabled: bool(process.env.FUNNY_WARNINGS_ENABLED, false),
    funnyWarningsUrl: process.env.FUNNY_WARNINGS_URL || '',
    funnyWarningsFile: process.env.FUNNY_WARNINGS_FILE || 'custom-products/funny-warnings.json',
    firebaseWeWatchesUrl: process.env.FIREBASE_WEWATCHES_URL || '',
    firebaseWeWatchesAuth: process.env.FIREBASE_WEWATCHES_AUTH || '',
    firebaseWeWatchesApiKey: process.env.FIREBASE_WEWATCHES_API_KEY || '',
    firebaseWeWatchesBearer: process.env.FIREBASE_WEWATCHES_BEARER || '',
    requestTimeoutMs: number(process.env.CUSTOM_PRODUCTS_TIMEOUT_MS, 7000)
  },
  shorts: {
    enabled: bool(process.env.SHORTS_ENABLED, true),
    autoEnabled: bool(process.env.SHORTS_AUTO_ENABLED, true),
    format: ['vertical', 'square'].includes(process.env.SHORTS_FORMAT) ? process.env.SHORTS_FORMAT : 'vertical',
    autoEvents: new RegExp(process.env.SHORTS_AUTO_EVENTS || 'tornado warning|flash flood warning|severe thunderstorm warning|hurricane warning|extreme wind warning|storm surge warning', 'i'),
    autoMaxPerCycle: Math.round(clamp(number(process.env.SHORTS_AUTO_MAX_PER_CYCLE, 2), 0, 10)),
    maxQueue: Math.round(clamp(number(process.env.SHORTS_MAX_QUEUE, 8), 1, 50)),
    publicRequestsPerWindow: Math.round(clamp(number(process.env.SHORTS_PUBLIC_REQUESTS_PER_WINDOW, 2), 0, 10)),
    retentionHours: Math.max(1, number(process.env.SHORTS_RETENTION_HOURS, 24)),
    timeoutMs: Math.round(clamp(number(process.env.SHORTS_TIMEOUT_MS, 15 * 60 * 1000), 60000, 60 * 60 * 1000))
  },
  // WeatherPower Developers API (https://weatherpower.app/developers/): HRRR/GFS soundings and charts.
  // The key stays server-side; the live stream only sees proxied results.
  weatherPowerApi: {
    key: process.env.WEATHERPOWER_API_KEY || '',
    dataBase: process.env.WEATHERPOWER_API_BASE || 'https://weatherpower.app/wpcc-api',
    renderBase: process.env.WEATHERPOWER_RENDER_BASE || 'https://weatherpower.app/wpcc-render'
  },
  // Optional WeBot voice through an OpenAI-compatible /audio/speech endpoint. OpenAI itself is paid;
  // OPENAI_TTS_BASE_URL can point at a free self-hosted server (e.g. Kokoro-FastAPI) instead.
  openaiTts: {
    key: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_TTS_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: process.env.OPENAI_TTS_VOICE || 'alloy',
    instructions: process.env.OPENAI_TTS_INSTRUCTIONS || 'You are WeBot, a friendly robot weather broadcaster on a live stream. Speak clearly and calmly, upbeat but serious about dangerous weather.',
    dailyChars: Math.round(Math.max(0, number(process.env.OPENAI_TTS_DAILY_CHARS, 150000)))
  },
  // WeatherPower Traffic camera network (Camera Wall). Use a viewer account from that app.
  cameras: {
    // Path to WeatherPower Traffic's camera catalog (configs/railfan_cameras.json). No login needed.
    catalogFile: process.env.CAMERA_CATALOG_FILE || '',
    baseUrl: process.env.CAMERA_API_BASE || 'http://127.0.0.1:8778',
    username: process.env.CAMERA_API_USER || '',
    password: process.env.CAMERA_API_PASS || '',
    noAuth: bool(process.env.CAMERA_API_NO_AUTH, false),
    allowLocal: bool(process.env.CAMERA_ALLOW_LOCAL, false)
  },
  controllerToken: process.env.CONTROLLER_TOKEN || '',
  dryRunDefault: bool(process.env.DRY_RUN_DEFAULT, false)
};

export const readiness = () => ({
  ok: true,
  time: new Date().toISOString(),
  renderer: {
    playwright: true,
    browserChannel: config.renderer.browserChannel || 'playwright-default',
    workerTimeoutMs: config.renderer.workerTimeoutMs
  },
  maps: {
    renderer: 'MapLibre GL JS',
    styleUrl: config.maps.styleUrl,
    satelliteStyleUrl: config.maps.satelliteStyleUrl,
    geocodingProvider: config.maps.geocodingProvider,
    geocodingProductionReady: config.maps.openMeteoProductionReady,
    routingProvider: config.maps.routingProvider || 'not configured',
    routingConfigured: Boolean(config.maps.routingBaseUrl)
  },
  x: {
    appCredentialsPresent: Boolean(config.x.apiKey && config.x.apiSecret),
    userTokenPresent: Boolean(config.x.userAccessToken || (config.x.oauth1AccessToken && config.x.oauth1AccessTokenSecret)),
    readyToPost: Boolean(config.x.userAccessToken || (config.x.oauth1AccessToken && config.x.oauth1AccessTokenSecret))
  },
  pageEndpoint: {
    configured: Boolean(config.pageEndpoint.url),
    url: config.pageEndpoint.url,
    mode: config.pageEndpoint.mode,
    tokenPresent: Boolean(config.pageEndpoint.token)
  },
  discord: {
    configured: Boolean(config.discord.webhookUrl),
    enabled: config.discord.enabled && Boolean(config.discord.webhookUrl),
    readyToPost: config.discord.enabled && Boolean(config.discord.webhookUrl),
    autoPostEnabled: config.discord.autoPostEnabled,
    autoPostMaxPerRefresh: config.discord.autoPostMaxPerRefresh,
    autoPostMinSeconds: config.discord.autoPostMinSeconds,
    autoPostSuppressBackfill: config.discord.autoPostSuppressBackfill,
    username: config.discord.username
  },
  nws: {
    configured: true,
    activeAlertsUrl: 'https://api.weather.gov/alerts/active'
  },
  spc: {
    outlooks: 'NOAA SPC outlook MapServer Day 1-8 layers',
    discussions: 'SPC mesoscale discussion GeoJSON feed'
  },
  radar: {
    reflectivity: 'IEM NEXRAD n0q tile service',
    velocity: 'IEM single-site NEXRAD N0U velocity tiles'
  },
  autoRender: {
    enabled: config.autoRender.enabled,
    intervalMs: config.autoRender.intervalMs,
    limit: config.autoRender.limit,
    concurrency: config.autoRender.concurrency,
    renderBatchSize: config.autoRender.renderBatchSize,
    maxRendersPerCycle: config.autoRender.maxRendersPerCycle,
    batchCooldownMs: config.autoRender.batchCooldownMs
  },
  cardCleanup: {
    enabled: config.cardCleanup.enabled,
    retentionHours: config.cardCleanup.retentionHours
  },
  forecast: {
    enabled: config.forecast.enabled,
    location: `${config.forecast.city}, ${config.forecast.state}`,
    days: config.forecast.days,
    cacheMs: config.forecast.cacheMs
  },
  forecastSearch: {
    enabled: config.forecastSearch.enabled,
    cacheMs: config.forecastSearch.cacheMs,
    maxRequestsPerWindow: config.forecastSearch.maxRequestsPerWindow,
    rateWindowMs: config.forecastSearch.rateWindowMs
  },
  population: {
    enabled: config.population.enabled,
    source: 'U.S. Census Bureau 2020 Census blocks and block groups',
    method: 'alert-polygon centroid estimate'
  },
  customProducts: {
    funnyWarningsEnabled: config.customProducts.funnyWarningsEnabled,
    funnyWarningsUrlConfigured: Boolean(config.customProducts.funnyWarningsUrl),
    funnyWarningsFile: config.customProducts.funnyWarningsFile,
    firebaseWeWatchesConfigured: Boolean(config.customProducts.firebaseWeWatchesUrl),
    requestTimeoutMs: config.customProducts.requestTimeoutMs
  },
  controller: {
    tokenRequired: Boolean(config.controllerToken),
    host: config.host,
    port: config.port,
    homePage: config.homePage,
    publicWarningCenterOnly: config.publicWarningCenterOnly,
    useServerlessChromium: config.useServerlessChromium,
    publicBaseUrl: config.publicBaseUrl,
    xCallbackUrl: `${config.publicBaseUrl}/api/x/auth/callback`
  }
});
