const roundCoordinate = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : value;
};

const compactRing = (ring = [], maxPoints = 40) => {
  if (!Array.isArray(ring) || !ring.length) return [];
  const closed = ring.length > 2
    && Number(ring[0]?.[0]) === Number(ring.at(-1)?.[0])
    && Number(ring[0]?.[1]) === Number(ring.at(-1)?.[1]);
  const usable = closed ? ring.slice(0, -1) : ring;
  const step = Math.max(1, Math.ceil(usable.length / Math.max(3, maxPoints - 1)));
  const sampled = [];

  for (let index = 0; index < usable.length; index += step) {
    sampled.push([roundCoordinate(usable[index]?.[0]), roundCoordinate(usable[index]?.[1])]);
  }
  if (usable.length && sampled.at(-1) !== usable.at(-1)) {
    const last = usable.at(-1);
    sampled.push([roundCoordinate(last?.[0]), roundCoordinate(last?.[1])]);
  }
  if (sampled.length && closed) sampled.push([...sampled[0]]);
  return sampled;
};

export const compactPublicGeometry = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates?.[0];
    return outer ? { type: 'Polygon', coordinates: [compactRing(outer, 48)] } : null;
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: (geometry.coordinates || [])
        .map((polygon) => polygon?.[0] ? [compactRing(polygon[0], 8)] : null)
        .filter(Boolean)
    };
  }
  return geometry;
};

const compactPublicItem = (item = {}) => ({
  key: item.key,
  status: item.status,
  renderedAt: item.renderedAt,
  title: item.title,
  event: item.event,
  state: item.state,
  areaDesc: item.areaDesc,
  office: item.office,
  expiresAt: item.expiresAt,
  issuedAt: item.issuedAt,
  timezone: item.timezone,
  theme: item.theme,
  classification: item.classification ? {
    family: item.classification.family,
    isWatch: item.classification.isWatch,
    isWarning: item.classification.isWarning,
    isDiscussion: item.classification.isDiscussion,
    isOutlook: item.classification.isOutlook,
    isForecast: item.classification.isForecast,
    alertTag: item.classification.alertTag
  } : undefined,
  hazardStats: item.hazardStats,
  impacts: item.impacts,
  cardLayout: item.cardLayout,
  forecast: item.forecast,
  geometry: compactPublicGeometry(item.geometry),
  polygon: item.geometry ? undefined : compactRing(item.polygon || [], 48),
  center: item.center,
  radar: item.radar,
  nwsId: item.nwsId,
  card: item.card,
  detailUrl: item.detailUrl,
  searchResult: Boolean(item.searchResult)
});

export const publicWarningCenterFeed = (state = {}) => ({
  status: state.status,
  lastStartedAt: state.lastStartedAt,
  lastFinishedAt: state.lastFinishedAt,
  lastError: state.lastError,
  count: state.count,
  renderedCount: state.renderedCount,
  errorCount: state.errorCount,
  items: (state.items || []).map(compactPublicItem)
});
