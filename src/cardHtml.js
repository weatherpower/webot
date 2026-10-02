// WeatherPower broadcast warning card (1600x900). Shares its look with the warning shorts.
import { boundsForPolygon, compactNumber, normalizeWarning } from './warning.js';
import {
  REFLECTIVITY_LEGEND, SATELLITE_STYLE, VELOCITY_LEGEND,
  areaLineFor, embeddedFontCss, escapeHtml, hazardChipsFor, headlineFor, iconKeyFor, iconSvg,
  inkFor, peopleFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';

export const CARD_SIZE = { width: 1600, height: 900 };

const geometryPoints = (value) => {
  if (!value) return [];
  if (value.type === 'FeatureCollection') return (value.features || []).flatMap(geometryPoints);
  if (value.type === 'Feature') return geometryPoints(value.geometry);
  const collect = (coordinates) => {
    if (!Array.isArray(coordinates)) return [];
    if (coordinates.length >= 2 && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))) {
      return [[Number(coordinates[0]), Number(coordinates[1])]];
    }
    return coordinates.flatMap(collect);
  };
  return collect(value.coordinates);
};

const row = (label, value, extra = '') => (value === '' || value === null || value === undefined)
  ? ''
  : `<div class="row ${extra}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;

const panelFor = ({ warning, layout, times, people }) => {
  const hazards = hazardChipsFor(warning);
  const homes = Number(warning.impacts?.homes);
  const hazardRows = hazards.map((chip) => row(chip.label, chip.value, 'hazard')).join('');
  const action = warning.whatToDo
    ? `<div class="action"><span>What to do</span><p>${escapeHtml(warning.whatToDo)}</p></div>`
    : '';
  const expires = times.expires
    ? `<div class="expires"><span>${layout === 'warning' ? 'Expires' : 'Valid until'}</span><strong>${escapeHtml(times.expires)}</strong><small>${escapeHtml(times.expiresDay)}</small></div>`
    : '';
  const impact = people
    ? `<div class="impact"><strong>${escapeHtml(people)}</strong><span>people in the warned area${Number.isFinite(homes) && homes > 0 ? ` · ${escapeHtml(compactNumber(homes))} homes` : ''}</span><small>${escapeHtml(warning.impacts?.sourceLabel || '2020 Census estimate')}</small></div>`
    : '';

  if (layout === 'forecast') {
    const f = warning.forecast || {};
    const temp = (value) => (value === null || value === undefined || value === '' ? '--' : `${value}°`);
    return `
      <div class="forecast-hero"><span>${escapeHtml(f.dayLabel || f.periodName || '')}</span><strong>${escapeHtml(f.shortForecast || 'Forecast')}</strong></div>
      <div class="temps"><div><span>High</span><strong>${escapeHtml(temp(f.high))}</strong></div><div><span>Low</span><strong>${escapeHtml(temp(f.low))}</strong></div></div>
      ${row('Rain chance', f.precipitation === null || f.precipitation === undefined ? '--' : `${f.precipitation}%`)}
      ${row('Wind', f.wind || 'Light')}
      <div class="action"><span>Details</span><p>${escapeHtml(f.detailedForecast || warning.whatToDo || '')}</p></div>`;
  }
  if (layout === 'tropical') {
    const t = warning.tropical || {};
    const name = [t.classificationLabel, t.name].filter(Boolean).join(' ') || 'Tropical Cyclone';
    return `
      ${expires}
      <div class="storm"><span>NHC ${t.advisoryNumber ? `advisory ${escapeHtml(t.advisoryNumber)}` : 'latest advisory'}</span><strong>${escapeHtml(name)}</strong></div>
      ${(warning.hazardStats || []).slice(0, 3).map((stat) => row(stat.label, stat.value, 'hazard')).join('')}
      ${row('Guidance', t.modelCount ? `${t.modelCount} model tracks` : 'Official cone')}
      ${action}
      <p class="note">The cone shows the likely path of the center, not the size of the storm.</p>`;
  }
  if (layout === 'watch') {
    const groups = (warning.watchDetails?.probabilities || []).reduce((acc, item) => {
      (acc[item.group] ||= []).push(item);
      return acc;
    }, {});
    const probs = Object.entries(groups).slice(0, 2).map(([group, items]) => `
      <div class="probs"><span>${escapeHtml(group)}</span><div>${items.slice(0, 4).map((item) => `<b>${escapeHtml(item.value)}</b><i>${escapeHtml(item.label)}</i>`).join('')}</div></div>`).join('');
    return `${expires}${impact}${hazardRows}${probs}${probs ? '' : action}`;
  }
  if (layout === 'discussion') {
    const concern = (warning.mdDetails?.concerning || []).filter(Boolean).slice(0, 3);
    return `
      ${expires}
      ${(warning.hazardStats || []).slice(0, 2).map((stat) => row(stat.label, stat.value, 'hazard')).join('')}
      ${concern.length ? `<div class="action"><span>Concerning</span><p>${concern.map(escapeHtml).join('<br>')}</p></div>` : action}`;
  }
  if (layout === 'outlook') {
    const o = warning.outlookDetails || {};
    return `
      ${expires}
      <div class="storm"><span>SPC Day ${escapeHtml(o.day || '')} outlook</span><strong>${escapeHtml(warning.hazards?.value || o.label || 'Outlook')}</strong></div>
      ${o.labelText ? `<p class="note">${escapeHtml(o.labelText)}</p>` : ''}
      ${action}`;
  }
  return `${expires}${impact}${hazardRows}${action}`;
};

export const warningCardHtml = ({ warning: rawWarning, mapConfig = {}, logoDataUrl = '', fontDataUrls = {}, staticMapDataUrl = '' }) => {
  const warning = normalizeWarning(rawWarning);
  const classification = warning.classification || {};
  const layout = classification.isForecast || warning.forecast || warning.cardLayout === 'forecast' ? 'forecast'
    : classification.isTropical || warning.tropical ? 'tropical'
      : classification.isDiscussion || warning.mdDetails || warning.cardLayout === 'discussion' ? 'discussion'
        : classification.isOutlook || warning.outlookDetails || warning.cardLayout === 'outlook' ? 'outlook'
          : classification.isWatch ? 'watch' : 'warning';
  const theme = warning.theme || {};
  const color = theme.primary || '#e40000';
  const accent = theme.polygon || theme.accent || color;
  const ink = inkFor(color);
  const headline = headlineFor(warning);
  const area = layout === 'forecast' ? (warning.forecast?.location || warning.areaDesc || '') : areaLineFor(warning, { maxNames: 4 });
  const times = timeLabelsFor(warning);
  const people = peopleFor(warning);
  const status = statusTagFor(warning);
  const threat = threatTagFor(warning);
  const icon = iconSvg(iconKeyFor(warning), { size: 46, stroke: 2.4 });
  const flash = Boolean(warning.emergencyFlashFrame);
  const geometry = warning.geometry || { type: 'Polygon', coordinates: [[...warning.polygon]] };
  const referenceLongitude = Number(warning.center?.[0]);
  const normalizeLongitude = (longitude) => {
    let value = Number(longitude);
    if (!Number.isFinite(referenceLongitude)) return value;
    while (value - referenceLongitude > 180) value -= 360;
    while (value - referenceLongitude < -180) value += 360;
    return value;
  };
  const tropical = warning.tropical || {};
  const boundPoints = [geometry, tropical.cone, tropical.forecastTrack, tropical.forecastPoints, tropical.watchWarning]
    .flatMap(geometryPoints)
    .map(([lon, lat]) => [normalizeLongitude(lon), lat]);
  const bounds = boundPoints.length ? boundsForPolygon(boundPoints) : boundsForPolygon(warning.polygon);
  const radarMode = warning.radar?.mode || 'reflectivity';
  const isVelocity = (radarMode === 'velocity' || radarMode === 'both') && warning.radar?.velocityTileUrl;
  const legend = layout === 'forecast'
    ? ''
    : `<div class="legend">
        <div class="lhead"><span>${escapeHtml(isVelocity ? `${warning.radar.site || 'NEXRAD'} velocity` : 'Radar reflectivity')}</span><b>${escapeHtml(times.issued ? `Issued ${times.issued}` : '')}</b></div>
        <div class="lbar" style="background:${isVelocity ? VELOCITY_LEGEND : REFLECTIVITY_LEGEND}"></div>
        <div class="llabels">${(isVelocity ? ['Toward', 'Away'] : ['Light', 'Moderate', 'Heavy', 'Extreme']).map((label) => `<span>${label}</span>`).join('')}</div>
      </div>`;
  const style = JSON.parse(JSON.stringify(SATELLITE_STYLE));
  style.transition = { duration: 0, delay: 0 };
  const payload = JSON.stringify({
    warning: {
      center: warning.center,
      radar: warning.radar || {},
      tropical,
      isForecast: layout === 'forecast',
      isWatch: layout === 'watch' || layout === 'outlook' || layout === 'discussion'
    },
    geometry,
    accent,
    style,
    overviewStyle: mapConfig.style || mapConfig.styleUrl || null,
    bounds,
    maxZoom: layout === 'tropical' ? 6.6 : layout === 'outlook' ? 6 : 10.2
  }).replaceAll('</script', '<\\/script');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(headline.full)}</title>
${staticMapDataUrl ? '' : '<link href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">'}
<style>
${embeddedFontCss(fontDataUrls)}
:root { --theme: ${color}; --theme-dark: ${theme.primaryDark || '#300'}; --accent: ${accent}; --ink: ${ink}; --panel: rgba(12,15,23,.93); }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1600px; height: 900px; overflow: hidden; background: #05070b; }
body { font-family: "WP Display", "Arial Narrow", sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
#card { position: relative; width: 1600px; height: 900px; overflow: hidden; background: #0b1220; }
#map, .static-map { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.maplibregl-ctrl-container { display: none; }
.shade { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 30%), linear-gradient(270deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 34%), linear-gradient(0deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 22%); }
.forecast-pin { position: absolute; left: 800px; top: 450px; width: 28px; height: 28px; margin: -14px; border-radius: 50%; background: #fff; border: 7px solid var(--accent); box-shadow: 0 0 0 14px rgba(255,255,255,.18); }

.header { position: absolute; left: 36px; top: 32px; width: 1060px; }
.bar { display: flex; align-items: stretch; border-radius: 14px 14px 0 0; overflow: hidden; color: var(--ink);
  background: linear-gradient(100deg, var(--theme) 0%, var(--theme) 60%, var(--theme-dark) 140%); box-shadow: 0 16px 44px rgba(0,0,0,.45); }
.bar.flash { background: #fff; color: #000; }
.lead { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; min-width: 132px; padding: 16px 18px; border-right: 2px solid color-mix(in srgb, var(--ink) 25%, transparent); }
.lead b { font-size: 21px; letter-spacing: .1em; font-weight: 600; }
.title { flex: 1; min-width: 0; padding: 14px 24px; display: flex; flex-direction: column; justify-content: center; }
.title h1 { margin: 0; font-size: 58px; line-height: 1; font-weight: 700; text-transform: uppercase; }
.title .tag { align-self: flex-start; margin-top: 8px; padding: 3px 12px; border-radius: 7px; background: rgba(0,0,0,.82); color: #fff; font-size: 20px; letter-spacing: .1em; }
.bar.flash .title .tag { background: var(--theme); color: var(--ink); }
.sub { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 14px 24px; background: var(--panel); border-radius: 0 0 14px 14px; box-shadow: 0 16px 44px rgba(0,0,0,.45); }
.sub .area { font-size: 30px; font-weight: 600; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub .office { font-family: "WP Mono", monospace; font-size: 17px; color: #b9c0cd; letter-spacing: .06em; white-space: nowrap; text-transform: uppercase; }

.panel { position: absolute; top: 32px; right: 36px; bottom: 32px; width: 420px; display: flex; flex-direction: column; gap: 12px; }
.panel > * { background: var(--panel); border-radius: 12px; box-shadow: 0 12px 34px rgba(0,0,0,.42); }
.expires { padding: 16px 20px; border-top: 6px solid var(--accent); }
.expires span, .row span, .action span, .storm span, .forecast-hero span, .temps span, .probs > span, .impact small {
  display: block; font-family: "WP Mono", monospace; font-size: 15px; letter-spacing: .1em; color: #a9b1c0; text-transform: uppercase; }
.expires strong { display: block; font-size: 52px; line-height: 1.05; font-weight: 700; }
.expires small { font-family: "WP Mono", monospace; font-size: 15px; color: #cfd5df; letter-spacing: .06em; }
.impact { padding: 14px 20px; }
.impact strong { font-size: 46px; font-weight: 700; color: var(--accent); line-height: 1; }
.impact span { display: block; font-family: "WP Sans", sans-serif; font-size: 18px; font-weight: 600; color: #e9edf3; margin-top: 4px; }
.impact small { margin-top: 6px; font-size: 12px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 12px 20px; }
.row strong { font-size: 30px; font-weight: 700; text-align: right; text-transform: uppercase; }
.row.hazard { border-left: 6px solid var(--accent); }
.storm, .forecast-hero { padding: 14px 20px; }
.storm strong, .forecast-hero strong { display: block; font-size: 36px; line-height: 1.05; font-weight: 700; text-transform: uppercase; }
.temps { display: grid; grid-template-columns: 1fr 1fr; padding: 14px 20px; gap: 12px; }
.temps strong { font-size: 60px; font-weight: 700; line-height: 1; }
.probs { padding: 12px 20px; }
.probs div { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin-top: 8px; font-family: "WP Sans", sans-serif; }
.probs b { font-size: 20px; color: var(--accent); }
.probs i { font-style: normal; font-size: 16px; color: #dfe4ec; align-self: center; }
.action { padding: 14px 20px; flex: 0 1 auto; min-height: 0; overflow: hidden; }
.action p { margin: 8px 0 0; font-family: "WP Sans", sans-serif; font-size: 19px; line-height: 1.38; font-weight: 600; color: #eef1f6; }
.note { margin: 0; padding: 12px 20px; font-family: "WP Sans", sans-serif; font-size: 14px; line-height: 1.4; color: #b9c0cd; }
.locator { flex: 0 0 150px; margin-top: auto; position: relative; overflow: hidden; }
#overview { position: absolute; inset: 0; }

.bottom { position: absolute; left: 36px; bottom: 32px; right: 492px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.wp-brand { display: flex; align-items: center; gap: 14px; padding: 12px 22px 12px 12px; background: var(--panel); border-radius: 12px; box-shadow: 0 12px 34px rgba(0,0,0,.42);
  font-family: "WP Sans", sans-serif; font-size: 23px; font-weight: 600; color: #d9dee8; }
.wp-brand img { width: 50px; height: 50px; border-radius: 10px; }
.wp-brand strong { font-weight: 900; color: #fff; }
.legend { width: 400px; padding: 12px 18px; background: var(--panel); border-radius: 12px; box-shadow: 0 12px 34px rgba(0,0,0,.42); }
.lhead { display: flex; justify-content: space-between; gap: 12px; font-family: "WP Mono", monospace; font-size: 14px; letter-spacing: .06em; color: #c9cfdb; text-transform: uppercase; margin-bottom: 8px; white-space: nowrap; }
.lhead b { color: #fff; font-weight: 600; }
.lbar { height: 14px; border-radius: 7px; }
.llabels { display: flex; justify-content: space-between; margin-top: 6px; font-family: "WP Mono", monospace; font-size: 13px; color: #b9c0cd; text-transform: uppercase; }
</style>
</head>
<body>
<div id="card" data-layout="${layout}">
  ${staticMapDataUrl ? `<img class="static-map" src="${escapeHtml(staticMapDataUrl)}" alt=""><span class="forecast-pin"></span>` : '<div id="map"></div>'}
  <div class="shade"></div>
  <header class="header">
    <div class="bar ${flash ? 'flash' : ''}">
      <div class="lead">${icon}<b>${escapeHtml(status)}</b></div>
      <div class="title">
        <h1 id="title">${escapeHtml(headline.full)}</h1>
        ${threat ? `<span class="tag">${escapeHtml(threat === 'PDS' ? 'PARTICULARLY DANGEROUS SITUATION' : threat)}</span>` : ''}
      </div>
    </div>
    <div class="sub">
      <div class="area">${escapeHtml(area)}</div>
      <div class="office">${escapeHtml(layout === 'forecast' ? 'NWS point forecast' : `NWS ${warning.office || ''}`)}</div>
    </div>
  </header>
  <aside class="panel">
    ${panelFor({ warning, layout, times, people })}
    ${layout === 'forecast' || staticMapDataUrl ? '' : '<div class="locator"><div id="overview"></div></div>'}
  </aside>
  <div class="bottom">
    <div class="wp-brand">${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}<span>See on <strong>WEATHERPOWER.APP</strong></span></div>
    ${legend}
  </div>
</div>
<script>window.__CARD__ = ${payload};</script>
${staticMapDataUrl ? '' : '<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>'}
<script>
(() => {
  const data = window.__CARD__;
  const warning = data.warning;
  const warningColor = data.accent;
  const tropical = warning.tropical || {};
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.__CARD_READY = true;
  };

  const fitTitle = () => {
    const title = document.getElementById('title');
    let size = parseFloat(getComputedStyle(title).fontSize);
    while ((title.scrollHeight > size * 2.08 || title.scrollWidth > title.clientWidth + 1) && size > 26) {
      size -= 2;
      title.style.fontSize = size + 'px';
    }
  };
  fitTitle();
  document.fonts?.ready?.then(fitTitle);

  if (!window.maplibregl || !document.getElementById('map')) {
    setTimeout(finish, 120);
    return;
  }

  const hasFeatures = (collection) => Boolean(collection?.features?.some((feature) => feature?.geometry));
  const addTropicalLayers = (map) => {
    if (hasFeatures(tropical.cone)) {
      map.addSource('nhc-cone', { type: 'geojson', data: tropical.cone });
      map.addLayer({ id: 'nhc-cone-fill', type: 'fill', source: 'nhc-cone', paint: { 'fill-color': warningColor, 'fill-opacity': 0.24 } });
      map.addLayer({ id: 'nhc-cone-shadow', type: 'line', source: 'nhc-cone', paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'nhc-cone-outline', type: 'line', source: 'nhc-cone', paint: { 'line-color': '#fff', 'line-width': 5 } });
      map.addLayer({ id: 'nhc-cone-accent', type: 'line', source: 'nhc-cone', paint: { 'line-color': warningColor, 'line-width': 2.2 } });
    }
    if (hasFeatures(tropical.modelTracks)) {
      map.addSource('nhc-model-tracks', { type: 'geojson', data: tropical.modelTracks });
      map.addLayer({ id: 'nhc-model-tracks', type: 'line', source: 'nhc-model-tracks', paint: {
        'line-color': ['coalesce', ['get', 'color'], '#00e5ff'],
        'line-width': ['match', ['get', 'kind'], 'ensemble', 1.2, 2],
        'line-opacity': ['match', ['get', 'kind'], 'ensemble', 0.48, 0.78] } });
    }
    if (hasFeatures(tropical.forecastTrack)) {
      map.addSource('nhc-forecast-track', { type: 'geojson', data: tropical.forecastTrack });
      map.addLayer({ id: 'nhc-track-shadow', type: 'line', source: 'nhc-forecast-track', paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.92 } });
      map.addLayer({ id: 'nhc-track', type: 'line', source: 'nhc-forecast-track', paint: { 'line-color': '#fff', 'line-width': 4.5 } });
    }
    if (hasFeatures(tropical.forecastPoints)) {
      map.addSource('nhc-forecast-points', { type: 'geojson', data: tropical.forecastPoints });
      map.addLayer({ id: 'nhc-forecast-points', type: 'circle', source: 'nhc-forecast-points', paint: {
        'circle-radius': ['case', ['==', ['get', 'tau'], 0], 9, 5],
        'circle-color': ['match', ['get', 'stormtype'], 'HU', '#ef1743', 'MH', '#ef1743', 'TY', '#ef1743', 'TS', '#ff9500', 'TD', '#27c7e7', '#ffffff'],
        'circle-stroke-color': '#05080d', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'nhc-current-storm-label', type: 'symbol', source: 'nhc-forecast-points', filter: ['==', ['get', 'tau'], 0],
        layout: { 'text-field': ['coalesce', ['get', 'stormname'], 'Tropical Cyclone'], 'text-size': 22, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 1.35], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#05080d', 'text-halo-width': 2 } });
    }
    if (hasFeatures(tropical.watchWarning)) {
      map.addSource('nhc-watch-warning', { type: 'geojson', data: tropical.watchWarning });
      map.addLayer({ id: 'nhc-watch-warning-shadow', type: 'line', source: 'nhc-watch-warning', paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.95 } });
      map.addLayer({ id: 'nhc-watch-warning', type: 'line', source: 'nhc-watch-warning', paint: {
        'line-color': ['match', ['get', 'tcww'], 'HWR', '#ef1743', 'HWA', '#ff4fbe', 'TWR', '#ff9500', 'TWA', '#ffe13b', 'SSW', '#a98cff', 'SSA', '#70b5ff', warningColor],
        'line-width': 5 } });
    }
  };

  const map = new maplibregl.Map({
    container: 'map', style: data.style, bounds: data.bounds,
    fitBoundsOptions: { padding: { top: 260, right: 500, bottom: 130, left: 90 }, maxZoom: data.maxZoom },
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0
  });
  const overviewEl = document.getElementById('overview');
  const overview = overviewEl && data.overviewStyle ? new maplibregl.Map({
    container: 'overview', style: data.overviewStyle, center: warning.center, zoom: 2.9,
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0
  }) : null;

  let pending = overview ? 2 : 1;
  const done = () => { pending -= 1; if (pending <= 0) setTimeout(finish, 250); };

  map.on('load', () => {
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    const radar = warning.radar || {};
    const addRaster = (id, url, opacity) => {
      if (!url) return;
      map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256 });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, firstSymbol);
    };
    if (!warning.isForecast) {
      if (radar.mode !== 'velocity' || !radar.velocityTileUrl) addRaster('reflectivity', radar.reflectivityTileUrl, radar.mode === 'both' ? 0.5 : 0.8);
      if ((radar.mode === 'velocity' || radar.mode === 'both') && radar.velocityTileUrl) addRaster('velocity', radar.velocityTileUrl, 0.82);
    }
    addTropicalLayers(map);
    if (!warning.isForecast && data.geometry) {
      map.addSource('poly', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: data.geometry } });
      map.addLayer({ id: 'poly-fill', type: 'fill', source: 'poly', paint: { 'fill-color': warningColor, 'fill-opacity': 0.12 } }, firstSymbol);
      map.addLayer({ id: 'poly-shadow', type: 'line', source: 'poly', layout: { 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': warning.isWatch ? 7 : 13, 'line-opacity': 0.7, 'line-blur': 2 } });
      if (!warning.isWatch) map.addLayer({ id: 'poly-white', type: 'line', source: 'poly', layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
      map.addLayer({ id: 'poly-line', type: 'line', source: 'poly', layout: { 'line-join': 'round' }, paint: { 'line-color': warningColor, 'line-width': warning.isWatch ? 4 : 4.5 } });
    } else if (warning.isForecast) {
      map.addSource('pin', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: warning.center } } });
      map.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 12, 'circle-color': '#fff', 'circle-stroke-color': warningColor, 'circle-stroke-width': 6 } });
    }
    map.once('idle', done);
  });
  if (overview) {
    overview.on('load', () => {
      overview.addSource('dot', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: warning.center } } });
      overview.addLayer({ id: 'dot-halo', type: 'circle', source: 'dot', paint: { 'circle-radius': 18, 'circle-color': warningColor, 'circle-opacity': 0.3 } });
      overview.addLayer({ id: 'dot', type: 'circle', source: 'dot', paint: { 'circle-radius': 6, 'circle-color': warningColor, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      overview.once('idle', done);
    });
    overview.on('error', () => setTimeout(done, 400));
  }
  map.on('error', () => setTimeout(finish, 2500));
  setTimeout(finish, 14000);
})();
</script>
</body>
</html>`;
};
