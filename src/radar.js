import { defaultRadarModeForEvent } from './themes.js';

const IEM_RADAR_LOOKUP = 'https://mesonet.agron.iastate.edu/json/radar.py';
const IEM_TILE_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';

export const reflectivityTileUrl = `${IEM_TILE_BASE}/nexrad-n0q-900913/{z}/{x}/{y}.png`;

export const velocityTileUrlForSite = (site) => {
  if (!site) return '';
  return `${IEM_TILE_BASE}/ridge::${site}-N0U-0/{z}/{x}/{y}.png`;
};

export const resolveNearestRadar = async ({ center, issuedAt }) => {
  if (!Array.isArray(center) || center.length !== 2) return null;

  const url = new URL(IEM_RADAR_LOOKUP);
  url.searchParams.set('operation', 'available');
  url.searchParams.set('lat', String(center[1]));
  url.searchParams.set('lon', String(center[0]));
  url.searchParams.set('start', new Date(issuedAt || Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'));

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'weatherpower.app warning-card-service'
    }
  });

  if (!response.ok) {
    throw new Error(`IEM radar lookup ${response.status}: ${response.statusText}`);
  }

  const body = await response.json();
  return body.radars?.find((radar) => radar.type === 'NEXRAD') || body.radars?.[0] || null;
};

export const enrichWarningRadar = async (warning) => {
  const requestedMode = warning.radar?.mode || defaultRadarModeForEvent(warning.event);
  const needsVelocity = requestedMode === 'velocity' || requestedMode === 'both';
  let site = warning.radar?.site || '';
  let siteName = warning.radar?.siteName || '';

  if (needsVelocity && !site) {
    try {
      const nearest = await resolveNearestRadar({
        center: warning.center,
        issuedAt: warning.issuedAt
      });
      if (nearest?.id && nearest.id !== 'USCOMP') {
        site = nearest.id;
        siteName = nearest.name || nearest.id;
      }
    } catch (error) {
      console.warn(`Unable to resolve velocity radar site: ${error.message}`);
    }
  }

  const velocityTileUrl = needsVelocity ? velocityTileUrlForSite(site) : '';
  const mode = needsVelocity && !velocityTileUrl ? 'reflectivity' : requestedMode;

  return {
    ...warning,
    radar: {
      ...(warning.radar || {}),
      mode,
      site,
      siteName,
      reflectivityTileUrl,
      velocityTileUrl: mode === 'velocity' || mode === 'both' ? velocityTileUrl : '',
      reflectivityOpacity: mode === 'both' ? 0.48 : 0.68,
      velocityOpacity: mode === 'both' ? 0.62 : 0.76
    }
  };
};
