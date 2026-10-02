import crypto from 'node:crypto';
import { config } from './config.js';

const CENSUS_LAYER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer';
const cache = new Map();

const finiteImpact = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const geometryPolygons = (geometry) => {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
};

const validRing = (ring = []) => ring
  .filter((point) => Array.isArray(point) && point.length >= 2)
  .map(([lon, lat]) => [Number(lon), Number(lat)])
  .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

const usablePolygons = (geometry) => geometryPolygons(geometry)
  .map((polygon) => (polygon || []).map(validRing).filter((ring) => ring.length >= 4))
  .filter((polygon) => polygon.length && polygon[0].length >= 4);

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (point, polygon) => (
  pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))
);

const pointInGeometry = (point, polygons) => polygons.some((polygon) => pointInPolygon(point, polygon));

const boundingArea = (polygons) => {
  const points = polygons.flat(2);
  if (!points.length) return Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const [longitude, latitude] of points) {
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }
  return (maxLongitude - minLongitude) * (maxLatitude - minLatitude);
};

const trimCache = () => {
  while (cache.size > config.population.cacheEntries) cache.delete(cache.keys().next().value);
};

const queryCensusLayer = async ({ polygons, layer }) => {
  const body = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify({
      rings: polygons.flatMap((polygon) => polygon),
      spatialReference: { wkid: 4326 }
    }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'POP100,HU100,CENTLON,CENTLAT',
    returnGeometry: 'false',
    resultRecordCount: '100000'
  });
  const response = await fetch(`${CENSUS_LAYER_URL}/${layer}/query`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(config.population.timeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Census population query failed (${response.status})`);
  }
  return payload;
};

const estimatePopulation = async (geometry) => {
  const polygons = usablePolygons(geometry);
  if (!polygons.length) return null;
  let layer = boundingArea(polygons) <= config.population.blockMaxArea ? 2 : 1;
  let payload = await queryCensusLayer({ polygons, layer });
  if (payload.exceededTransferLimit && layer === 2) {
    layer = 1;
    payload = await queryCensusLayer({ polygons, layer });
  }

  let people = 0;
  let homes = 0;
  let geographyCount = 0;
  for (const feature of payload.features || []) {
    const attributes = feature.attributes || {};
    const point = [Number(attributes.CENTLON), Number(attributes.CENTLAT)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !pointInGeometry(point, polygons)) continue;
    people += Number(attributes.POP100) || 0;
    homes += Number(attributes.HU100) || 0;
    geographyCount += 1;
  }

  return {
    people: Math.max(0, Math.round(people)),
    homes: Math.max(0, Math.round(homes)),
    source: 'U.S. Census Bureau 2020 Census',
    sourceLabel: '2020 CENSUS ESTIMATE',
    vintage: 2020,
    estimated: true,
    method: layer === 2 ? 'census-block-centroid' : 'census-block-group-centroid',
    geographyCount
  };
};

export const enrichWarningPopulation = async (warning = {}) => {
  if (!config.population.enabled) return warning;
  if (finiteImpact(warning.impacts?.people) || finiteImpact(warning.impacts?.homes)) return warning;
  const classification = warning.classification || {};
  const shouldEstimate = (classification.isWarning || classification.isWatch)
    && !classification.isForecast
    && !classification.isDiscussion
    && !classification.isOutlook
    && !classification.isTropical;
  if (!shouldEstimate || !warning.geometry || warning.feature?.properties?.weatherPowerGeometrySource === 'fallback') {
    return warning;
  }

  const key = crypto.createHash('sha1').update(JSON.stringify(warning.geometry)).digest('hex');
  if (!cache.has(key)) {
    const estimate = estimatePopulation(warning.geometry).catch(() => {
      cache.delete(key);
      return null;
    });
    cache.set(key, estimate);
    trimCache();
  }
  const impacts = await cache.get(key);
  return impacts ? { ...warning, impacts: { ...(warning.impacts || {}), ...impacts } } : warning;
};

export const clearPopulationCache = () => cache.clear();
