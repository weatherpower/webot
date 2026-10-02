// Vertical/square "warning short" scene. The page never animates on its own:
// the renderer calls window.__seek(seconds) for every frame so output is deterministic.
// All text comes from the live alert; modules without data are not rendered.
import {
  REFLECTIVITY_LEGEND, RAINFALL_LEGEND, SATELLITE_STYLE, VELOCITY_LEGEND,
  areaLineFor, embeddedFontCss, escapeHtml, hazardChipsFor, headlineFor, iconKeyFor, iconSvg,
  identityFor, inkFor, isDuplicateText, peopleFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';

export const SHORT_FORMATS = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};

export const END_CARD_SECONDS = 1.6;

const geometryFor = (warning) => warning.geometry || { type: 'Polygon', coordinates: [warning.polygon || []] };

const shortStyle = (scale) => {
  const style = JSON.parse(JSON.stringify(SATELLITE_STYLE));
  style.transition = { duration: 0, delay: 0 };
  // Dim the imagery so radar echoes carry the frame.
  style.layers.find((layer) => layer.id === 'usgs-imagery').paint['raster-brightness-max'] = 0.5;
  style.layers.find((layer) => layer.id === 'blue-marble').paint = { 'raster-brightness-max': 0.6 };
  const places = style.layers.find((layer) => layer.id === 'places');
  places.layout['text-size'] = ['interpolate', ['linear'], ['zoom'],
    6, ['match', ['get', 'class'], 'city', 34 * scale, 26 * scale],
    10, ['match', ['get', 'class'], 'city', 52 * scale, 40 * scale]];
  places.paint['text-halo-width'] = 3.2;
  return style;
};

const STORM_FAMILIES = new Set(['tornado', 'severe', 'hurricane', 'tropical-storm', 'tropical-cyclone', 'extreme-wind']);

export const warningShortHtml = ({ warning, radarPlan, format = 'vertical', logoDataUrl = '', fontDataUrls = {}, duration = 15 }) => {
  const size = SHORT_FORMATS[format] || SHORT_FORMATS.vertical;
  const isVertical = size.height > size.width;
  const theme = warning.theme || {};
  const color = theme.primary || '#e40000';
  const accent = theme.polygon || theme.accent || color;
  const ink = inkFor(color);
  const identity = identityFor(warning);
  const headline = headlineFor(warning);
  const areaLine = areaLineFor(warning, { maxNames: isVertical ? 3 : 2 });
  const area = isDuplicateText(areaLine, headline.full) ? '' : areaLine;
  const times = timeLabelsFor(warning);
  const people = peopleFor(warning);
  const status = statusTagFor(warning);
  const threat = threatTagFor(warning);
  const chips = hazardChipsFor(warning);
  const pathWords = STORM_FAMILIES.has(identity.family) ? `ARE IN THE PATH${isVertical ? '<br>' : ' '}OF THIS STORM` : `ARE IN THE${isVertical ? '<br>' : ' '}WARNED AREA`;
  const icon = iconSvg(iconKeyFor(warning), { size: isVertical ? 60 : 50, stroke: 2.4 });
  const smallIcon = iconSvg(iconKeyFor(warning), { size: isVertical ? 40 : 34, stroke: 2.6 });
  const legends = {
    reflectivity: { gradient: REFLECTIVITY_LEGEND, labels: ['LIGHT', 'MODERATE', 'HEAVY', 'EXTREME'] },
    velocity: { gradient: VELOCITY_LEGEND, labels: ['TOWARD RADAR', 'AWAY'] },
    rainfall: { gradient: RAINFALL_LEGEND, labels: ['0.5"', '1"', '2"', '4"', '8"+'] }
  };
  const payload = JSON.stringify({
    duration,
    endCard: END_CARD_SECONDS,
    size,
    isVertical,
    accent,
    geometry: geometryFor(warning),
    center: warning.center,
    style: shortStyle(isVertical ? 1 : 0.85),
    radar: radarPlan,
    legends,
    timezone: times.timezone
  }).replaceAll('</script', '<\\/script');

  const chipMarkup = chips.map((chip) => `<div class="chip"><span>${escapeHtml(chip.label)}</span><strong>${escapeHtml(chip.value)}</strong></div>`).join('');
  const titleHtml = headline.place
    ? `${escapeHtml(headline.event)} IN<br>${escapeHtml(headline.place)}`
    : escapeHtml(headline.event);
  const hasRow2 = Boolean(people || times.expires);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">
<style>
${embeddedFontCss(fontDataUrls)}
:root {
  --theme: ${color};
  --theme-dark: ${theme.primaryDark || '#300'};
  --accent: ${accent};
  --ink: ${ink};
  --pattern: ${identity.pattern};
  --u: ${isVertical ? 1 : 0.82};
  --panel: rgba(11,14,21,.92);
}
* { box-sizing: border-box; }
html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: #05070b; }
body { font-family: "WP Display", "Oswald", "Arial Narrow", sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
#stage { position: absolute; transform-origin: 50% 50%; }
#map, #shots, #shots img, #poly { position: absolute; inset: 0; width: 100%; height: 100%; }
#shots img { display: block; }
#poly { z-index: 3; overflow: visible; }
.maplibregl-ctrl-container { display: none; }
.vignette { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, rgba(0,0,0,.5) 100%); }

/* ---------- headers (family identity) ---------- */
.hdr { position: absolute; left: calc(36px * var(--u)); right: calc(36px * var(--u)); top: ${isVertical ? 120 : 30}px; }
.bar { position: relative; display: flex; align-items: stretch; overflow: hidden; color: var(--ink); background: var(--theme); box-shadow: 0 16px 44px rgba(0,0,0,.45); }
.bar::before { content: ""; position: absolute; inset: 0; background: var(--pattern); pointer-events: none; }
.bar > * { position: relative; }
.bar.style-watch { background: rgba(11,14,21,.95); color: var(--theme); box-shadow: inset 0 6px 0 var(--theme), 0 16px 44px rgba(0,0,0,.45); }
.bar.style-watch::before { opacity: 0; }
.bar.style-emergency { box-shadow: inset 0 0 0 6px #fff, 0 16px 44px rgba(0,0,0,.45); }
.kicker { display: block; font-family: "WP Mono", monospace; font-size: calc(19px * var(--u)); letter-spacing: .2em; font-weight: 600; opacity: .85; }
.intro .bar { border-radius: 14px 14px 0 0; }
.intro.solo .bar { border-radius: 14px; }
.intro .bar::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.26) 45%, transparent 60%); transform: translateX(var(--sheen, -120%)); }
.intro .lead { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px; padding: calc(20px * var(--u)) calc(22px * var(--u)); border-right: 2px solid color-mix(in srgb, currentColor 25%, transparent); }
.intro .lead b { font-size: calc(26px * var(--u)); letter-spacing: .1em; font-weight: 600; }
.intro .titlebox { flex: 1 1 auto; padding: calc(16px * var(--u)) calc(26px * var(--u)); align-self: center; min-width: 0; }
.intro h1 { margin: 4px 0 0; font-size: calc(74px * var(--u)); line-height: .98; font-weight: 700; text-transform: uppercase; }
.intro .sub { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: calc(16px * var(--u)) calc(24px * var(--u)); background: var(--panel); border-radius: 0 0 14px 14px; box-shadow: 0 16px 44px rgba(0,0,0,.45); }
.intro .sub .area { font-size: calc(36px * var(--u)); font-weight: 600; text-transform: uppercase; }
.intro .sub .until { font-family: "WP Mono", monospace; font-size: calc(24px * var(--u)); color: #c9cfdb; white-space: nowrap; }

.compact .bar { border-radius: 12px 12px 0 0; align-items: center; gap: calc(14px * var(--u)); padding: calc(14px * var(--u)) calc(22px * var(--u)); font-size: calc(46px * var(--u)); font-weight: 700; text-transform: uppercase; white-space: nowrap; }
.compact.solo .bar { border-radius: 12px; }
.compact .bar span { min-width: 0; overflow: hidden; }
.compact .where { padding: calc(12px * var(--u)) calc(22px * var(--u)); background: var(--panel); font-size: calc(32px * var(--u)); font-weight: 600; text-transform: uppercase; line-height: 1.08; border-top: 1px solid rgba(255,255,255,.08); }
.compact .row2 { display: flex; align-items: stretch; background: var(--panel); border-top: 1px solid rgba(255,255,255,.1); }
.compact > :last-child { border-radius: 0 0 12px 12px; }
.compact .people { flex: 1; display: flex; align-items: center; gap: 12px; padding: calc(14px * var(--u)) calc(22px * var(--u)); font-size: calc(28px * var(--u)); font-weight: 500; text-transform: uppercase; }
.compact .people em { font-style: normal; color: var(--accent); font-weight: 700; }
.compact .people svg { flex: none; opacity: .8; }
.compact .exp { display: flex; flex-direction: column; justify-content: center; align-items: flex-end; padding: calc(10px * var(--u)) calc(22px * var(--u)); white-space: nowrap; }
.compact .people + .exp { border-left: 1px solid rgba(255,255,255,.1); }
.compact .exp:only-child { flex: 1; align-items: flex-start; }
.compact .exp strong { font-size: calc(34px * var(--u)); font-weight: 700; }
.compact .exp small { font-family: "WP Mono", monospace; font-size: calc(16px * var(--u)); color: #aab2c2; letter-spacing: .06em; }
.threat { display: inline-block; padding: 4px 12px; border-radius: 8px; background: #000; color: #fff; font-size: .56em; letter-spacing: .08em; }
.style-watch .threat { background: var(--theme); color: var(--ink); }
.chips { display: flex; gap: 10px; margin-top: 12px; }
.chip { display: flex; flex-direction: column; padding: 8px 16px; background: var(--panel); border-left: 5px solid var(--accent); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.chip span { font-family: "WP Mono", monospace; font-size: calc(16px * var(--u)); color: #aab2c2; letter-spacing: .08em; }
.chip strong { font-size: calc(30px * var(--u)); font-weight: 700; }

/* ---------- radar HUD (no CTA over the radar) ---------- */
.bottom { position: absolute; left: calc(36px * var(--u)); right: calc(36px * var(--u)); bottom: ${isVertical ? 300 : 28}px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.hud { display: flex; align-items: center; gap: 14px; padding: 12px 20px 12px 12px; background: var(--panel); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.hud img { width: calc(44px * var(--u)); height: calc(44px * var(--u)); border-radius: 9px; }
.hud .t span { display: block; font-family: "WP Mono", monospace; font-size: calc(16px * var(--u)); letter-spacing: .12em; color: #aab2c2; }
.hud .t strong { display: block; font-size: calc(46px * var(--u)); line-height: 1; font-weight: 700; font-variant-numeric: tabular-nums; }
.hud .t .badge { display: inline-block; margin-left: 10px; padding: 2px 8px; border-radius: 6px; background: #ff2d55; color: #fff; font-size: calc(16px * var(--u)); letter-spacing: .1em; vertical-align: middle; opacity: 0; }
.ticks { display: flex; gap: 3px; margin-top: 8px; }
.ticks i { width: calc(14px * var(--u)); height: 6px; border-radius: 3px; background: rgba(255,255,255,.16); }
.ticks i.on { background: var(--accent); }
.ticks i.now { background: #fff; }
.legend { width: ${isVertical ? 420 : 380}px; padding: 12px 16px; background: var(--panel); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.legend .lhead { font-family: "WP Mono", monospace; font-size: calc(17px * var(--u)); letter-spacing: .08em; color: #c9cfdb; margin-bottom: 8px; text-transform: uppercase; white-space: nowrap; }
.legend .lbar { height: 14px; border-radius: 7px; }
.legend .llabels { display: flex; justify-content: space-between; margin-top: 6px; font-family: "WP Mono", monospace; font-size: calc(15px * var(--u)); color: #c3c9d4; }

/* ---------- end card ---------- */
.endcard { position: absolute; inset: 0; z-index: 20; opacity: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${isVertical ? 34 : 24}px;
  background: radial-gradient(120% 70% at 50% 45%, color-mix(in srgb, var(--theme) 22%, #0a0d14) 0%, #06080d 70%); }
.endcard::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 10px; background: var(--theme); }
.endcard img { width: ${isVertical ? 230 : 180}px; height: ${isVertical ? 230 : 180}px; border-radius: 44px; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
.endcard .url { font-size: ${isVertical ? 104 : 84}px; font-weight: 700; letter-spacing: .02em; line-height: 1; }
.endcard .tag { font-family: "WP Mono", monospace; font-size: ${isVertical ? 30 : 24}px; letter-spacing: .22em; color: #b9c0cd; }
</style>
</head>
<body>
<div id="stage">
  <div id="map"></div>
  <div id="shots"></div>
  <svg id="poly" preserveAspectRatio="none">
    <path id="poly-fill" stroke="none"/>
    <path id="poly-casing" fill="none" stroke="#05070b" stroke-opacity=".8" stroke-linejoin="round"/>
    <path id="poly-line" fill="none" stroke-linejoin="round"/>
  </svg>
</div>
<div class="vignette"></div>

<div class="hdr intro ${area || times.expires ? '' : 'solo'}" id="intro">
  <div class="bar style-${identity.style}">
    <div class="lead">${icon}<b>${escapeHtml(status)}</b></div>
    <div class="titlebox"><span class="kicker">${escapeHtml(identity.kicker)}</span><h1 id="intro-title">${titleHtml}</h1></div>
  </div>
  ${area || times.expires ? `<div class="sub">${area ? `<div class="area">${escapeHtml(area)}</div>` : '<div></div>'}${times.expires ? `<div class="until">UNTIL ${escapeHtml(times.expires)}</div>` : ''}</div>` : ''}
</div>

<div class="hdr compact ${area || hasRow2 ? '' : 'solo'}" id="compact">
  <div class="bar style-${identity.style}" id="compact-event">${smallIcon}<span>${escapeHtml(headline.event)}</span>${threat ? `<b class="threat">${escapeHtml(threat)}</b>` : ''}</div>
  ${area ? `<div class="where">${escapeHtml(area)}</div>` : ''}
  ${hasRow2 ? `<div class="row2">
    ${people ? `<div class="people"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.6" r="2.8"/><path d="M1.8 19c.4-3.6 3-5.6 6.2-5.6s5.8 2 6.2 5.6H1.8zM14.6 19c-.2-1.9-.9-3.4-2-4.5 1.2-.7 2.6-.9 3.9-.9 2.8 0 5 1.7 5.4 5.4h-7.3z"/></svg><span><em>${escapeHtml(people)} PEOPLE</em> ${pathWords}</span></div>` : ''}
    ${times.expires ? `<div class="exp"><strong>EXPIRES ${escapeHtml(times.expires)}</strong><small>${escapeHtml(times.expiresDay)}</small></div>` : ''}
  </div>` : ''}
  ${chipMarkup ? `<div class="chips" id="chips">${chipMarkup}</div>` : ''}
</div>

<div class="bottom" id="bottom">
  <div class="hud">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}
    <div class="t"><span id="hud-label">RADAR LOOP</span><strong><b id="hud-time">--</b><em class="badge" id="hud-badge">LATEST</em></strong><div class="ticks" id="ticks"></div></div>
  </div>
  <div class="legend">
    <div class="lhead" id="legend-title">RADAR</div>
    <div class="lbar" id="legend-bar"></div>
    <div class="llabels" id="legend-labels"></div>
  </div>
</div>

<div class="endcard" id="endcard">
  ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}
  <div class="url">WEATHERPOWER.APP</div>
  <div class="tag">LIVE WARNINGS · RADAR · ALERTS</div>
</div>

<script>window.__SHORT__ = ${payload};</script>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script>
(() => {
  const data = window.__SHORT__;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const fmtTime = (ms) => {
    try {
      return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone });
    } catch { return ''; }
  };

  const fitText = () => {
    const title = $('intro-title');
    let size = parseFloat(getComputedStyle(title).fontSize);
    while ((title.clientHeight > size * 2.1 || title.scrollWidth > title.clientWidth + 1) && size > 30) {
      size -= 2;
      title.style.fontSize = size + 'px';
    }
    const ev = $('compact-event');
    let evSize = parseFloat(getComputedStyle(ev).fontSize);
    while (ev.scrollWidth > ev.clientWidth + 1 && evSize > 24) { evSize -= 2; ev.style.fontSize = evSize + 'px'; }
  };

  const segments = data.radar.segments;
  const geometry = data.geometry;
  const pts = [];
  const walk = (c) => { if (!Array.isArray(c)) return; if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  walk(geometry.coordinates || []);
  const lons = pts.map((p) => p[0]); const lats = pts.map((p) => p[1]);
  const bounds = pts.length
    ? [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
    : [[data.center[0] - .5, data.center[1] - .5], [data.center[0] + .5, data.center[1] + .5]];

  // Map stills are captured once per radar frame on an oversized stage; the push-in is a CSS scale.
  const K = 1.4;
  const W = data.size.width, H = data.size.height;
  const SW = Math.round(W * K), SH = Math.round(H * K);
  const stage = $('stage');
  stage.style.width = SW + 'px';
  stage.style.height = SH + 'px';
  stage.style.left = ((W - SW) / 2) + 'px';
  stage.style.top = ((H - SH) / 2) + 'px';
  const mx = (SW - W) / 2, my = (SH - H) / 2;
  const pad = data.isVertical
    ? { top: 600 + my, bottom: 470 + my, left: 70 + mx, right: 70 + mx }
    : { top: 280 + my, bottom: 150 + my, left: 90 + mx, right: 90 + mx };

  const map = new maplibregl.Map({
    container: 'map', style: data.style, bounds, fitBoundsOptions: { padding: pad, maxZoom: 11.2 },
    interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0, pixelRatio: 1
  });
  const waitIdle = (ms = 4000) => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    map.once('idle', finish);
    setTimeout(finish, ms);
    map.triggerRepaint();
  });
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const drawPolygon = () => {
    const rings = geometry.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0]) : [geometry.coordinates[0]];
    const d = rings.filter(Boolean).map((ring) => 'M' + ring.map((c) => {
      const p = map.project(c);
      return p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join('L') + 'Z').join(' ');
    const svg = $('poly');
    svg.setAttribute('viewBox', '0 0 ' + SW + ' ' + SH);
    svg.querySelectorAll('path').forEach((path) => path.setAttribute('d', d));
  };

  map.on('load', async () => {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    for (const seg of segments) {
      for (const frame of seg.frames) {
        map.addSource(frame.id, { type: 'raster', tiles: [frame.url], tileSize: 256, maxzoom: seg.maxzoom || 12 });
        map.addLayer({ id: frame.id, type: 'raster', source: frame.id, paint: {
          'raster-opacity': 0.01, 'raster-fade-duration': 0, 'raster-resampling': 'linear',
          'raster-contrast': 0.18, 'raster-saturation': 0.25
        } }, firstSymbol);
      }
    }
    await waitIdle(30000);
    drawPolygon();
    const shots = $('shots');
    for (const seg of segments) {
      for (const frame of seg.frames) {
        for (const other of segments.flatMap((s) => s.frames)) {
          map.setPaintProperty(other.id, 'raster-opacity', other.id === frame.id ? seg.opacity : 0);
        }
        await waitIdle(8000);
        const img = new Image();
        img.src = map.getCanvas().toDataURL('image/jpeg', 0.9);
        await img.decode();
        img.id = 'shot-' + frame.id;
        img.style.opacity = '0';
        shots.appendChild(img);
      }
    }
    $('map').style.display = 'none';
    fitText();
    window.__SHORT_READY = true;
  });
  map.on('error', () => { window.__SHORT_ERRORS = (window.__SHORT_ERRORS || 0) + 1; });

  let lastSeg = null;
  const setHud = (seg, index) => {
    if (lastSeg !== seg) {
      lastSeg = seg;
      const legend = data.legends[seg.legend] || data.legends.reflectivity;
      $('legend-bar').style.background = legend.gradient;
      $('legend-labels').innerHTML = legend.labels.map((l) => '<span>' + l + '</span>').join('');
      $('legend-title').textContent = seg.title;
      $('hud-label').textContent = seg.frames.length > 1 ? 'RADAR LOOP · ' + Math.round((seg.frames.length - 1) * 5) + ' MIN' : seg.title;
      $('ticks').innerHTML = seg.frames.length > 1 ? seg.frames.map(() => '<i></i>').join('') : '';
    }
    const frame = seg.frames[index];
    $('hud-time').textContent = frame && frame.time ? fmtTime(frame.time) : '';
    const latest = index === seg.frames.length - 1;
    $('hud-badge').style.opacity = latest ? '1' : '0';
    [...$('ticks').children].forEach((tick, i) => { tick.className = i === index ? 'now' : i < index ? 'on' : ''; });
  };

  window.__seek = async (t) => {
    const T = data.duration;
    const endStart = T - data.endCard;
    const introIn = easeOut(span(t, 0, .5));
    const introOut = ease(span(t, 3.6, 4.1));
    const intro = $('intro');
    intro.style.opacity = String(introIn * (1 - introOut));
    intro.style.transform = 'translateY(' + ((1 - introIn) * -60 - introOut * 40) + 'px)';
    intro.style.setProperty('--sheen', (-120 + 260 * span(t, .4, 1.4)) + '%');
    const compactIn = easeOut(span(t, 3.9, 4.5));
    const compact = $('compact');
    compact.style.opacity = String(compactIn);
    compact.style.transform = 'translateY(' + ((1 - compactIn) * -50) + 'px)';
    const chips = $('chips');
    if (chips) {
      const c = easeOut(span(t, 4.5, 5.0));
      chips.style.opacity = String(c);
      chips.style.transform = 'translateX(' + ((1 - c) * -40) + 'px)';
    }
    const b = easeOut(span(t, .2, .8));
    $('bottom').style.opacity = String(b);
    $('bottom').style.transform = 'translateY(' + ((1 - b) * 40) + 'px)';

    // Camera push-in (scale 1/K -> 1) across the radar portion.
    const scale = (1 / K) + (1 - 1 / K) * ease(t / endStart);
    stage.style.transform = 'scale(' + scale.toFixed(5) + ')';

    // Polygon: brief white outline on arrival, then a thin alert-colored line with a dark casing.
    const settle = ease(span(t, .9, 1.8));
    const line = $('poly-line');
    line.setAttribute('stroke', settle < .5 ? '#ffffff' : data.accent);
    line.setAttribute('stroke-width', String(6.5 - 2 * settle));
    $('poly-casing').setAttribute('stroke-width', String(11 - 2.5 * settle));
    const fill = $('poly-fill');
    fill.setAttribute('fill', data.accent);
    fill.setAttribute('fill-opacity', String(.05 + .05 * settle));

    // Radar: step through stills; cross-fade between segments.
    let active = segments[0];
    for (const seg of segments) if (t >= seg.start) active = seg;
    const previous = segments[segments.indexOf(active) - 1] || null;
    const fadeIn = active.start > 0 ? easeOut(span(t, active.start, active.start + .45)) : 1;
    const frameIndex = (seg) => {
      if (seg.frames.length <= 1) return 0;
      const local = Math.max(0, t - seg.start);
      const cycle = seg.frames.length * seg.step + seg.hold;
      return Math.min(seg.frames.length - 1, Math.floor((local % cycle) / seg.step));
    };
    let activeIndex = 0;
    for (const seg of segments) {
      const index = frameIndex(seg);
      if (seg === active) activeIndex = index;
      seg.frames.forEach((frame, i) => {
        const img = $('shot-' + frame.id);
        if (!img) return;
        let opacity = 0;
        if (i === index && seg === active) opacity = fadeIn;
        else if (i === index && seg === previous && fadeIn < 1) opacity = 1;
        img.style.opacity = String(opacity);
        img.style.zIndex = seg === active ? '2' : '1';
      });
    }
    setHud(active, activeIndex);

    // Branded end card for the final seconds.
    $('endcard').style.opacity = String(easeOut(span(t, endStart, endStart + .35)));
    await nextFrame();
    return true;
  };
})();
</script>
</body>
</html>`;
};
