// WeatherPower broadcast warning card (1600x900). Shares its look with the warning shorts.
// Every module is data-driven: if the live alert has no value for it, the module is not rendered at all.
import { boundsForPolygon, compactNumber, normalizeWarning } from './warning.js';
import {
  REFLECTIVITY_LEGEND, SATELLITE_STYLE, VELOCITY_LEGEND,
  areaLineFor, embeddedFontCss, escapeHtml, hasNhcData, hazardChipsFor, headlineFor, iconKeyFor, iconSvg,
  identityFor, inkFor, isDuplicateText, peopleFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';

export const CARD_SIZE = { width: 1600, height: 900 };

const present = (value) => value !== '' && value !== null && value !== undefined;

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

const row = (label, value, extra = '') => (present(value)
  ? `<div class="mod row ${extra}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  : '');

const isConus = ([lon, lat] = []) => lon > -126 && lon < -65 && lat > 23 && lat < 50;

const modulesFor = ({ warning, layout, times, people, headline }) => {
  const modules = [];
  const add = (html) => { if (html) modules.push(html); };
  const homes = Number(warning.impacts?.homes);
  const whatToDo = String(warning.whatToDo || '').trim();

  if (layout === 'forecast') {
    const f = warning.forecast || {};
    const temp = (value) => (present(value) ? `${value}°` : '');
    add(present(f.shortForecast) && !isDuplicateText(f.shortForecast, headline.full)
      ? `<div class="mod hero-mod"><strong>${escapeHtml(f.shortForecast)}</strong></div>` : '');
    const temps = [['High', temp(f.high)], ['Low', temp(f.low)]].filter(([, value]) => value);
    add(temps.length ? `<div class="mod temps">${temps.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : '');
    add(present(f.precipitation) ? row('Rain chance', `${f.precipitation}%`) : '');
    add(row('Wind', f.wind));
    add(present(f.detailedForecast) ? `<div class="mod action"><span>Details</span><p>${escapeHtml(f.detailedForecast)}</p></div>` : '');
    return modules;
  }

  add(times.expires
    ? `<div class="mod expires"><span>${layout === 'warning' ? 'Expires' : 'Valid until'}</span><strong>${escapeHtml(times.expires)}</strong><small>${escapeHtml(times.expiresDay)}</small></div>`
    : '');

  if (layout === 'tropical') {
    const t = warning.tropical;
    const name = [t.classificationLabel, t.name].filter(Boolean).join(' ');
    add(name ? `<div class="mod storm"><span>NHC${t.advisoryNumber ? ` advisory ${escapeHtml(t.advisoryNumber)}` : ''}</span><strong>${escapeHtml(name)}</strong></div>` : '');
    for (const stat of (warning.hazardStats || []).slice(0, 3)) add(row(stat.label, stat.value, 'hazard'));
    add(row('Movement', t.movement));
    add(Number(t.modelCount) > 0 ? row('Guidance', `${t.modelCount} model tracks`) : '');
  } else {
    add(people
      ? `<div class="mod impact"><strong>${escapeHtml(people)}</strong><span>people in the warned area${Number.isFinite(homes) && homes > 0 ? ` · ${escapeHtml(compactNumber(homes))} homes` : ''}</span>${warning.impacts?.sourceLabel ? `<small>${escapeHtml(warning.impacts.sourceLabel)}</small>` : ''}</div>`
      : '');
    if (layout === 'discussion') {
      for (const stat of (warning.hazardStats || []).slice(0, 2)) add(row(stat.label, stat.value, 'hazard'));
    } else if (layout !== 'outlook') {
      for (const chip of hazardChipsFor(warning)) add(row(chip.label, chip.value, 'hazard'));
    }
    const tornadoId = warning.tornadoId?.experimental ? warning.tornadoId : null;
    add(tornadoId
      ? `<div class="mod tid" style="--tid:${escapeHtml(tornadoId.color || '#70d7ff')}">
          <span>WeatherPower Tornado ID · experimental</span>
          <div class="tid-grid">
            <div><b>Rotation detection</b><strong>${escapeHtml(tornadoId.rotation)}<small>/100</small></strong><i>${escapeHtml(tornadoId.rotationLabel)}</i></div>
            <div><b>Tornado AI</b><strong>${escapeHtml(tornadoId.tornadoSignal)}<small>%</small></strong><i>${escapeHtml(tornadoId.tornadoSignalLabel)}</i></div>
          </div>
        </div>`
      : '');
    const groups = (warning.watchDetails?.probabilities || []).reduce((acc, item) => {
      (acc[item.group] ||= []).push(item);
      return acc;
    }, {});
    for (const [group, items] of Object.entries(groups).slice(0, 2)) {
      add(`<div class="mod probs"><span>${escapeHtml(group)}</span><div>${items.slice(0, 4).map((item) => `<b>${escapeHtml(item.value)}</b><i>${escapeHtml(item.label)}</i>`).join('')}</div></div>`);
    }
    const concern = (warning.mdDetails?.concerning || []).filter(Boolean).slice(0, 3);
    add(concern.length ? `<div class="mod action"><span>Concerning</span><p>${concern.map(escapeHtml).join('<br>')}</p></div>` : '');
  }

  add(whatToDo && !isDuplicateText(whatToDo, headline.full)
    ? `<div class="mod action"><span>What to do</span><p>${escapeHtml(whatToDo)}</p></div>` : '');
  if (layout === 'tropical' && warning.tropical?.cone?.features?.length) {
    add('<p class="mod note">The cone shows the likely path of the center, not the size of the storm. Dangerous impacts can occur outside the cone.</p>');
  }
  return modules;
};

export const warningCardHtml = ({ warning: rawWarning, mapConfig = {}, logoDataUrl = '', fontDataUrls = {}, staticMapDataUrl = '' }) => {
  const warning = normalizeWarning(rawWarning);
  const classification = warning.classification || {};
  const nhc = hasNhcData(warning);
  const layout = classification.isForecast || warning.forecast || warning.cardLayout === 'forecast' ? 'forecast'
    : nhc ? 'tropical'
      : classification.isDiscussion || warning.mdDetails || warning.cardLayout === 'discussion' ? 'discussion'
        : classification.isOutlook || warning.outlookDetails || warning.cardLayout === 'outlook' ? 'outlook'
          : classification.isWatch ? 'watch' : 'warning';
  const theme = warning.theme || {};
  const color = theme.primary || '#e40000';
  const accent = theme.polygon || theme.accent || color;
  const ink = inkFor(color);
  const identity = identityFor(warning);
  const headline = headlineFor(warning);
  const areaLine = layout === 'forecast' ? (warning.forecast?.location || warning.areaDesc || '') : areaLineFor(warning, { maxNames: 4 });
  const area = isDuplicateText(areaLine, headline.full) ? '' : areaLine;
  const office = layout === 'forecast' || /^spc$/i.test(warning.office || '') ? '' : `NWS ${warning.office || ''}`.trim();
  const times = timeLabelsFor(warning);
  const people = peopleFor(warning);
  const status = statusTagFor(warning);
  const threat = threatTagFor(warning);
  const icon = iconSvg(iconKeyFor(warning), { size: 40, stroke: 2.4 });
  const flash = Boolean(warning.emergencyFlashFrame);
  const geometry = warning.geometry || { type: 'Polygon', coordinates: [[...warning.polygon]] };
  const tropical = nhc ? warning.tropical : {};
  const referenceLongitude = Number(warning.center?.[0]);
  const normalizeLongitude = (longitude) => {
    let value = Number(longitude);
    if (!Number.isFinite(referenceLongitude)) return value;
    while (value - referenceLongitude > 180) value -= 360;
    while (value - referenceLongitude < -180) value += 360;
    return value;
  };
  const boundPoints = [geometry, tropical.cone, tropical.forecastTrack, tropical.forecastPoints, tropical.watchWarning]
    .flatMap(geometryPoints)
    .map(([lon, lat]) => [normalizeLongitude(lon), lat]);
  const bounds = boundPoints.length ? boundsForPolygon(boundPoints) : boundsForPolygon(warning.polygon);
  const radarMode = warning.radar?.mode || 'reflectivity';
  const isVelocity = (radarMode === 'velocity' || radarMode === 'both') && warning.radar?.velocityTileUrl;
  const showLocator = !staticMapDataUrl && ['warning', 'watch', 'discussion'].includes(layout) && isConus(warning.center);
  const modules = modulesFor({ warning, layout, times, people, headline });
  const legend = layout === 'forecast'
    ? ''
    : `<div class="legend">
        <div class="lhead"><span>${escapeHtml(isVelocity ? `${warning.radar.site || 'NEXRAD'} velocity` : 'Radar')}</span>${times.issued ? `<b>Issued ${escapeHtml(times.issued)}</b>` : ''}</div>
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
      isWatch: ['watch', 'outlook', 'discussion'].includes(layout)
    },
    geometry,
    accent,
    style,
    overviewStyle: showLocator ? (mapConfig.style || mapConfig.styleUrl || null) : null,
    bounds,
    maxZoom: layout === 'tropical' ? 6.6 : layout === 'outlook' ? 6 : 10.6
  }).replaceAll('</script', '<\\/script');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(headline.full)}</title>
${staticMapDataUrl ? '' : '<link href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">'}
<style>
${embeddedFontCss(fontDataUrls)}
:root { --theme: ${color}; --theme-dark: ${theme.primaryDark || '#300'}; --accent: ${accent}; --ink: ${ink}; --panel: rgba(11,14,21,.9); --pattern: ${identity.pattern}; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1600px; height: 900px; overflow: hidden; background: #05070b; }
body { font-family: "WP Display", "Arial Narrow", sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
#card { position: relative; width: 1600px; height: 900px; overflow: hidden; background: #0b1220; }
#map, .static-map { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.maplibregl-ctrl-container { display: none; }
.shade { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,0) 24%), linear-gradient(270deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,0) 26%); }
.forecast-pin { position: absolute; left: 800px; top: 450px; width: 26px; height: 26px; margin: -13px; border-radius: 50%; background: #fff; border: 6px solid var(--accent); box-shadow: 0 0 0 10px rgba(255,255,255,.16); }

/* ---- header: family identity ---- */
.header { position: absolute; left: 28px; top: 26px; max-width: 920px; }
.bar { position: relative; display: flex; align-items: stretch; border-radius: 12px; overflow: hidden; color: var(--ink); background: var(--theme); box-shadow: 0 12px 34px rgba(0,0,0,.42); }
.header.has-sub .bar { border-radius: 12px 12px 0 0; }
.bar::before { content: ""; position: absolute; inset: 0; background: var(--pattern); pointer-events: none; }
.bar > * { position: relative; }
.bar.style-watch { background: rgba(11,14,21,.94); color: #fff; box-shadow: inset 0 5px 0 var(--theme), 0 12px 34px rgba(0,0,0,.42); }
.bar.style-watch::before { opacity: .0; }
.bar.style-watch .lead { color: var(--theme); border-right-color: rgba(255,255,255,.12); }
.bar.style-watch h1 { color: var(--theme); }
.bar.style-emergency { box-shadow: inset 0 0 0 5px #fff, 0 12px 34px rgba(0,0,0,.42); }
.bar.flash { background: #fff; color: #000; }
.lead { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; min-width: 104px; padding: 12px 14px; border-right: 2px solid color-mix(in srgb, currentColor 22%, transparent); }
.lead b { font-size: 17px; letter-spacing: .1em; font-weight: 600; }
.title { min-width: 0; padding: 10px 22px 12px; display: flex; flex-direction: column; justify-content: center; }
.kicker { font-family: "WP Mono", monospace; font-size: 13px; letter-spacing: .2em; font-weight: 600; opacity: .85; }
.title h1 { margin: 2px 0 0; font-size: 50px; line-height: 1; font-weight: 700; text-transform: uppercase; }
.title .tag { align-self: flex-start; margin-top: 7px; padding: 3px 10px; border-radius: 6px; background: #000; color: #fff; font-size: 17px; letter-spacing: .1em; }
.bar.style-watch .title .tag { background: var(--theme); color: var(--ink); }
.sub { display: flex; justify-content: space-between; align-items: center; gap: 22px; padding: 10px 22px; background: var(--panel); border-radius: 0 0 12px 12px; box-shadow: 0 12px 34px rgba(0,0,0,.42); }
.sub .area { font-size: 26px; font-weight: 600; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub .office { font-family: "WP Mono", monospace; font-size: 14px; color: #b9c0cd; letter-spacing: .06em; white-space: nowrap; text-transform: uppercase; }

/* ---- side modules (only rendered when data exists) ---- */
.panel { position: absolute; top: 26px; right: 28px; width: 350px; display: flex; flex-direction: column; gap: 8px; }
.mod { background: var(--panel); border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,.4); }
.expires { padding: 12px 18px; border-top: 5px solid var(--accent); }
.expires span, .row span, .action span, .storm span, .temps span, .probs > span, .impact small {
  display: block; font-family: "WP Mono", monospace; font-size: 13px; letter-spacing: .1em; color: #a9b1c0; text-transform: uppercase; }
.expires strong { display: block; font-size: 44px; line-height: 1.05; font-weight: 700; }
.expires small { font-family: "WP Mono", monospace; font-size: 13px; color: #cfd5df; letter-spacing: .06em; }
.impact { padding: 11px 18px; }
.impact strong { font-size: 38px; font-weight: 700; color: var(--accent); line-height: 1; }
.impact span { display: block; font-family: "WP Sans", sans-serif; font-size: 15px; font-weight: 600; color: #e9edf3; margin-top: 3px; }
.impact small { margin-top: 4px; font-size: 11px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 18px; }
.row strong { font-size: 26px; font-weight: 700; text-align: right; text-transform: uppercase; }
.row.hazard { border-left: 5px solid var(--accent); }
.storm, .hero-mod { padding: 12px 18px; }
.storm strong, .hero-mod strong { display: block; font-size: 30px; line-height: 1.05; font-weight: 700; text-transform: uppercase; }
.temps { display: flex; gap: 28px; padding: 12px 18px; }
.temps strong { font-size: 52px; font-weight: 700; line-height: 1; }
.probs { padding: 10px 18px; }
.probs div { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin-top: 6px; font-family: "WP Sans", sans-serif; }
.probs b { font-size: 17px; color: var(--accent); }
.probs i { font-style: normal; font-size: 14px; color: #dfe4ec; align-self: center; }
.action { padding: 11px 18px; }
.action p { margin: 6px 0 0; font-family: "WP Sans", sans-serif; font-size: 16px; line-height: 1.38; font-weight: 600; color: #eef1f6; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.note { margin: 0; padding: 10px 18px; font-family: "WP Sans", sans-serif; font-size: 13px; line-height: 1.4; color: #b9c0cd; }
.tid { padding: 10px 18px; border-left: 5px solid var(--tid); }
.tid > span { display: block; font-family: "WP Mono", monospace; font-size: 12px; letter-spacing: .08em; color: #a9b1c0; text-transform: uppercase; }
.tid-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
.tid-grid b { display: block; font-family: "WP Sans", sans-serif; font-size: 12px; color: #cfd5df; font-weight: 600; }
.tid-grid strong { display: block; font-size: 30px; line-height: 1.05; color: var(--tid); }
.tid-grid strong small { font-size: 16px; color: #cfd5df; }
.tid-grid i { font-style: normal; font-family: "WP Mono", monospace; font-size: 12px; text-transform: uppercase; color: #fff; }
.locator { position: relative; height: 128px; overflow: hidden; }
#overview { position: absolute; inset: 0; }

/* ---- bottom: small brand + legend ---- */
.bottom { position: absolute; left: 28px; right: 28px; bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; pointer-events: none; }
.wp-brand { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; background: var(--panel); border-radius: 8px;
  font-family: "WP Sans", sans-serif; font-size: 15px; font-weight: 800; color: #fff; letter-spacing: .02em; }
.wp-brand img { width: 26px; height: 26px; border-radius: 6px; }
.legend { width: 300px; padding: 9px 14px; background: var(--panel); border-radius: 10px; }
.lhead { display: flex; justify-content: space-between; gap: 10px; font-family: "WP Mono", monospace; font-size: 12px; letter-spacing: .06em; color: #c9cfdb; text-transform: uppercase; margin-bottom: 6px; white-space: nowrap; }
.lhead b { color: #fff; font-weight: 600; }
.lbar { height: 10px; border-radius: 5px; }
.llabels { display: flex; justify-content: space-between; margin-top: 4px; font-family: "WP Mono", monospace; font-size: 11px; color: #b9c0cd; text-transform: uppercase; }
</style>
</head>
<body>
<div id="card" class="${classification.isPds ? 'is-pds' : ''} family-${escapeHtml(identity.family)}" data-layout="${layout}">
  ${staticMapDataUrl ? `<img class="static-map" src="${escapeHtml(staticMapDataUrl)}" alt=""><span class="forecast-pin"></span>` : '<div id="map"></div>'}
  <div class="shade"></div>
  <header class="header ${area || office ? 'has-sub' : ''}">
    <div class="bar style-${identity.style} ${flash ? 'flash' : ''}">
      <div class="lead">${icon}<b>${escapeHtml(status)}</b></div>
      <div class="title">
        <span class="kicker">${escapeHtml(identity.kicker)}</span>
        <h1 id="title">${escapeHtml(headline.full)}</h1>
        ${threat ? `<span class="tag">${escapeHtml(threat === 'PDS' ? 'PARTICULARLY DANGEROUS SITUATION' : threat)}</span>` : ''}
      </div>
    </div>
    ${area || office ? `<div class="sub">${area ? `<div class="area">${escapeHtml(area)}</div>` : ''}${office ? `<div class="office">${escapeHtml(office)}</div>` : ''}</div>` : ''}
  </header>
  ${modules.length || showLocator ? `<aside class="panel">${modules.join('')}${showLocator ? '<div class="mod locator"><div id="overview"></div></div>' : ''}</aside>` : ''}
  <div class="bottom">
    <div class="wp-brand">${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}<span>WEATHERPOWER.APP</span></div>
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
    while ((title.clientHeight > size * 2.1 || title.scrollWidth > title.clientWidth + 1) && size > 24) {
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
      map.addLayer({ id: 'nhc-cone-fill', type: 'fill', source: 'nhc-cone', paint: { 'fill-color': warningColor, 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'nhc-cone-casing', type: 'line', source: 'nhc-cone', paint: { 'line-color': '#000', 'line-width': 4, 'line-opacity': 0.5 } });
      map.addLayer({ id: 'nhc-cone-outline', type: 'line', source: 'nhc-cone', paint: { 'line-color': '#fff', 'line-width': 2 } });
    }
    if (hasFeatures(tropical.modelTracks)) {
      map.addSource('nhc-model-tracks', { type: 'geojson', data: tropical.modelTracks });
      map.addLayer({ id: 'nhc-model-tracks', type: 'line', source: 'nhc-model-tracks', paint: {
        'line-color': ['coalesce', ['get', 'color'], '#00e5ff'],
        'line-width': ['match', ['get', 'kind'], 'ensemble', 1, 1.6],
        'line-opacity': ['match', ['get', 'kind'], 'ensemble', 0.45, 0.75] } });
    }
    if (hasFeatures(tropical.forecastTrack)) {
      map.addSource('nhc-forecast-track', { type: 'geojson', data: tropical.forecastTrack });
      map.addLayer({ id: 'nhc-track-casing', type: 'line', source: 'nhc-forecast-track', paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'nhc-track', type: 'line', source: 'nhc-forecast-track', paint: { 'line-color': '#fff', 'line-width': 2.5 } });
    }
    if (hasFeatures(tropical.forecastPoints)) {
      map.addSource('nhc-forecast-points', { type: 'geojson', data: tropical.forecastPoints });
      map.addLayer({ id: 'nhc-forecast-points', type: 'circle', source: 'nhc-forecast-points', paint: {
        'circle-radius': ['case', ['==', ['get', 'tau'], 0], 8, 4.5],
        'circle-color': ['match', ['get', 'stormtype'], 'HU', '#ef1743', 'MH', '#ef1743', 'TY', '#ef1743', 'TS', '#ff9500', 'TD', '#27c7e7', '#ffffff'],
        'circle-stroke-color': '#05080d', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'nhc-current-storm-label', type: 'symbol', source: 'nhc-forecast-points', filter: ['==', ['get', 'tau'], 0],
        layout: { 'text-field': ['get', 'stormname'], 'text-size': 20, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 1.2], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#05080d', 'text-halo-width': 2 } });
    }
    if (hasFeatures(tropical.watchWarning)) {
      map.addSource('nhc-watch-warning', { type: 'geojson', data: tropical.watchWarning });
      map.addLayer({ id: 'nhc-watch-warning', type: 'line', source: 'nhc-watch-warning', paint: {
        'line-color': ['match', ['get', 'tcww'], 'HWR', '#ef1743', 'HWA', '#ff4fbe', 'TWR', '#ff9500', 'TWA', '#ffe13b', 'SSW', '#a98cff', 'SSA', '#70b5ff', warningColor],
        'line-width': 3.5 } });
    }
  };

  const map = new maplibregl.Map({
    container: 'map', style: data.style, bounds: data.bounds,
    fitBoundsOptions: { padding: { top: 200, right: 410, bottom: 80, left: 60 }, maxZoom: data.maxZoom },
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0
  });
  const overviewEl = document.getElementById('overview');
  const overview = overviewEl && data.overviewStyle ? new maplibregl.Map({
    container: 'overview', style: data.overviewStyle, center: warning.center, zoom: 2.7,
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0
  }) : null;
  if (overviewEl && !overview) overviewEl.closest('.locator')?.remove();

  let pending = overview ? 2 : 1;
  const done = () => { pending -= 1; if (pending <= 0) setTimeout(finish, 250); };

  map.on('load', () => {
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    const radar = warning.radar || {};
    const addRaster = (id, url, opacity) => {
      if (!url) return;
      map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256 });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear', 'raster-contrast': 0.12, 'raster-saturation': 0.15 } }, firstSymbol);
    };
    if (!warning.isForecast) {
      if (radar.mode !== 'velocity' || !radar.velocityTileUrl) addRaster('reflectivity', radar.reflectivityTileUrl, radar.mode === 'both' ? 0.55 : 0.88);
      if ((radar.mode === 'velocity' || radar.mode === 'both') && radar.velocityTileUrl) addRaster('velocity', radar.velocityTileUrl, 0.85);
    }
    addTropicalLayers(map);
    if (!warning.isForecast && data.geometry) {
      map.addSource('poly', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: data.geometry } });
      map.addLayer({ id: 'poly-fill', type: 'fill', source: 'poly', paint: { 'fill-color': warningColor, 'fill-opacity': warning.isWatch ? 0.06 : 0.09 } }, firstSymbol);
      map.addLayer({ id: 'poly-casing', type: 'line', source: 'poly', layout: { 'line-join': 'round' }, paint: { 'line-color': '#05070b', 'line-width': warning.isWatch ? 4.5 : 6, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'poly-line', type: 'line', source: 'poly', layout: { 'line-join': 'round' }, paint: {
        'line-color': warningColor, 'line-width': warning.isWatch ? 2.2 : 3,
        ...(warning.isWatch ? { 'line-dasharray': [3, 1.5] } : {}) } });
    } else if (warning.isForecast) {
      map.addSource('pin', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: warning.center } } });
      map.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 11, 'circle-color': '#fff', 'circle-stroke-color': warningColor, 'circle-stroke-width': 5 } });
    }
    map.once('idle', done);
  });
  if (overview) {
    overview.on('load', () => {
      for (const layer of overview.getStyle().layers) {
        if (layer.type === 'symbol') overview.setLayoutProperty(layer.id, 'visibility', 'none');
      }
      overview.addSource('dot', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: warning.center } } });
      overview.addLayer({ id: 'dot-halo', type: 'circle', source: 'dot', paint: { 'circle-radius': 14, 'circle-color': warningColor, 'circle-opacity': 0.3 } });
      overview.addLayer({ id: 'dot', type: 'circle', source: 'dot', paint: { 'circle-radius': 5, 'circle-color': warningColor, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
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
