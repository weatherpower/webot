// Vertical/square "warning short" scene. The page never animates on its own:
// the renderer calls window.__seek(seconds) for every frame so output is deterministic.
import {
  REFLECTIVITY_LEGEND, RAINFALL_LEGEND, SATELLITE_STYLE, VELOCITY_LEGEND,
  areaLineFor, embeddedFontCss, escapeHtml, hazardChipsFor, headlineFor, iconKeyFor, iconSvg,
  inkFor, peopleFor, statusTagFor, threatTagFor, timeLabelsFor
} from './broadcast.js';

export const SHORT_FORMATS = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};

const geometryFor = (warning) => warning.geometry || { type: 'Polygon', coordinates: [warning.polygon || []] };

const shortStyle = (scale) => {
  const style = JSON.parse(JSON.stringify(SATELLITE_STYLE));
  style.transition = { duration: 0, delay: 0 };
  const places = style.layers.find((layer) => layer.id === 'places');
  places.layout['text-size'] = ['interpolate', ['linear'], ['zoom'],
    6, ['match', ['get', 'class'], 'city', 34 * scale, 26 * scale],
    10, ['match', ['get', 'class'], 'city', 52 * scale, 40 * scale]];
  places.paint['text-halo-width'] = 3.2;
  return style;
};

export const warningShortHtml = ({ warning, radarPlan, format = 'vertical', logoDataUrl = '', fontDataUrls = {}, duration = 15 }) => {
  const size = SHORT_FORMATS[format] || SHORT_FORMATS.vertical;
  const isVertical = size.height > size.width;
  const theme = warning.theme || {};
  const color = theme.primary || '#e40000';
  const accent = theme.polygon || theme.accent || color;
  const ink = inkFor(color);
  const headline = headlineFor(warning);
  const area = areaLineFor(warning, { maxNames: isVertical ? 3 : 2 });
  const times = timeLabelsFor(warning);
  const people = peopleFor(warning);
  const status = statusTagFor(warning);
  const threat = threatTagFor(warning);
  const chips = hazardChipsFor(warning);
  const icon = iconSvg(iconKeyFor(warning), { size: isVertical ? 64 : 52, stroke: 2.4 });
  const smallIcon = iconSvg(iconKeyFor(warning), { size: isVertical ? 44 : 36, stroke: 2.6 });
  const legends = {
    reflectivity: { gradient: REFLECTIVITY_LEGEND, labels: ['LIGHT', 'MODERATE', 'HEAVY', 'EXTREME'] },
    velocity: { gradient: VELOCITY_LEGEND, labels: ['TOWARD RADAR', '', 'AWAY'] },
    rainfall: { gradient: RAINFALL_LEGEND, labels: ['0.5"', '1"', '2"', '4"', '8"+'] }
  };
  const payload = JSON.stringify({
    duration,
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
  --u: ${isVertical ? 1 : 0.82};
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
  background: linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 72%, rgba(0,0,0,.6) 100%); }

/* ---------- headers ---------- */
.hdr { position: absolute; left: calc(40px * var(--u)); right: calc(40px * var(--u)); top: ${isVertical ? 120 : 34}px; will-change: transform, opacity; }
.intro .bar { display: flex; align-items: stretch; border-radius: 14px 14px 0 0; overflow: hidden;
  background: linear-gradient(100deg, var(--theme) 0%, var(--theme) 55%, var(--theme-dark) 130%); color: var(--ink);
  box-shadow: 0 18px 50px rgba(0,0,0,.45); position: relative; }
.intro .bar::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.28) 45%, transparent 60%);
  transform: translateX(var(--sheen, -120%)); }
.intro .lead { display: flex; align-items: center; gap: calc(18px * var(--u)); padding: calc(26px * var(--u)) calc(26px * var(--u)); border-right: 2px solid color-mix(in srgb, var(--ink) 25%, transparent); }
.intro .lead b { font-size: calc(34px * var(--u)); letter-spacing: .08em; font-weight: 600; opacity: .9; }
.intro h1 { margin: 0; padding: calc(20px * var(--u)) calc(28px * var(--u)); font-size: calc(78px * var(--u)); line-height: .98; font-weight: 700; text-transform: uppercase; letter-spacing: .01em; align-self: center; }
.intro .sub { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: calc(18px * var(--u)) calc(26px * var(--u));
  background: rgba(14,17,26,.94); border-radius: 0 0 14px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.intro .sub .area { font-size: calc(40px * var(--u)); font-weight: 600; text-transform: uppercase; }
.intro .sub .until { font-family: "WP Mono", monospace; font-size: calc(26px * var(--u)); color: #c9cfdb; white-space: nowrap; }

.compact .row1 { display: flex; border-radius: 14px 14px 0 0; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.compact .event { display: flex; align-items: center; gap: calc(16px * var(--u)); padding: calc(18px * var(--u)) calc(24px * var(--u)); background: var(--theme); color: var(--ink);
  font-size: calc(52px * var(--u)); font-weight: 700; text-transform: uppercase; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
.compact .event span { overflow: hidden; text-overflow: clip; }
.compact .where { flex: 1 1 auto; display: flex; align-items: center; padding: calc(14px * var(--u)) calc(24px * var(--u)); background: rgba(14,17,26,.94);
  font-size: calc(40px * var(--u)); font-weight: 600; text-transform: uppercase; line-height: 1.05; min-width: 0; }
.compact.stacked .row1 { flex-direction: column; }
.compact.stacked .where { border-top: 1px solid rgba(255,255,255,.08); }
.compact .row2 { display: flex; align-items: stretch; background: rgba(14,17,26,.94); border-top: 1px solid rgba(255,255,255,.1); border-radius: 0 0 14px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
.compact .people { flex: 1; display: flex; align-items: center; gap: 14px; padding: calc(16px * var(--u)) calc(24px * var(--u)); font-size: calc(32px * var(--u)); font-weight: 500; text-transform: uppercase; }
.compact .people em { font-style: normal; color: var(--accent); font-weight: 700; }
.compact .people svg { flex: none; opacity: .8; }
.compact .exp { display: flex; flex-direction: column; justify-content: center; align-items: flex-end; padding: calc(12px * var(--u)) calc(24px * var(--u)); border-left: 1px solid rgba(255,255,255,.1); white-space: nowrap; }
.compact .exp strong { font-size: calc(38px * var(--u)); font-weight: 700; }
.compact .exp small { font-family: "WP Mono", monospace; font-size: calc(17px * var(--u)); color: #aab2c2; letter-spacing: .06em; }
.threat { display: inline-block; margin-left: 6px; padding: 4px 12px; border-radius: 8px; background: #fff; color: #000; font-size: .62em; letter-spacing: .06em; }
.chips { display: flex; gap: 12px; margin-top: 14px; }
.chip { display: flex; flex-direction: column; padding: 10px 18px; background: rgba(14,17,26,.9); border-left: 6px solid var(--accent); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.chip span { font-family: "WP Mono", monospace; font-size: calc(17px * var(--u)); color: #aab2c2; letter-spacing: .08em; }
.chip strong { font-size: calc(34px * var(--u)); font-weight: 700; }

/* ---------- bottom ---------- */
.bottom { position: absolute; left: calc(40px * var(--u)); right: calc(40px * var(--u)); bottom: ${isVertical ? 330 : 30}px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.wp-brand { display: flex; align-items: center; gap: 16px; padding: 14px 26px 14px 14px; background: rgba(14,17,26,.92); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45);
  font-family: "WP Sans", sans-serif; font-size: calc(31px * var(--u)); font-weight: 600; letter-spacing: .01em; }
.wp-brand img { width: calc(66px * var(--u)); height: calc(66px * var(--u)); border-radius: 12px; }
.wp-brand strong { font-weight: 900; color: #fff; }
.wp-brand span { color: #d9dee8; }
.legend { width: ${isVertical ? 500 : 430}px; padding: 16px 20px 14px; background: rgba(14,17,26,.92); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.legend .lhead { display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; font-family: "WP Mono", monospace; font-size: calc(20px * var(--u)); letter-spacing: .06em; color: #c9cfdb; margin-bottom: 10px; text-transform: uppercase; }
.legend .lhead b { color: #fff; }
.legend .lbar { height: 18px; border-radius: 9px; }
.legend .llabels { display: flex; justify-content: space-between; margin-top: 8px; font-family: "WP Mono", monospace; font-size: calc(17px * var(--u)); color: #c3c9d4; letter-spacing: .05em; }
.loopbar { height: 4px; margin-top: 10px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
.loopbar i { display: block; height: 100%; width: 0; background: var(--accent); }
</style>
</head>
<body>
<div id="stage">
  <div id="map"></div>
  <div id="shots"></div>
  <svg id="poly" preserveAspectRatio="none">
    <path id="poly-fill" stroke="none"/>
    <path id="poly-glow" fill="none" stroke-width="34" stroke-linejoin="round" filter="url(#glow)"/>
    <path id="poly-shadow" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="20" stroke-linejoin="round"/>
    <path id="poly-line" fill="none" stroke-linejoin="round"/>
    <defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter></defs>
  </svg>
</div>
<div class="vignette"></div>

<div class="hdr intro" id="intro">
  <div class="bar">
    <div class="lead">${icon}<b>${escapeHtml(status)}</b></div>
    <h1 id="intro-title">${escapeHtml(headline.event)} IN<br>${escapeHtml(headline.place)}</h1>
  </div>
  <div class="sub">
    <div class="area">${escapeHtml(area)}</div>
    ${times.expires ? `<div class="until">UNTIL ${escapeHtml(times.expires)}</div>` : ''}
  </div>
</div>

<div class="hdr compact ${isVertical ? 'stacked' : ''}" id="compact">
  <div class="row1">
    <div class="event" id="compact-event">${smallIcon}<span>${escapeHtml(headline.event)}</span>${threat ? `<b class="threat">${escapeHtml(threat)}</b>` : ''}</div>
    <div class="where">${escapeHtml(area)}</div>
  </div>
  <div class="row2">
    <div class="people">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.6" r="2.8"/><path d="M1.8 19c.4-3.6 3-5.6 6.2-5.6s5.8 2 6.2 5.6H1.8zM14.6 19c-.2-1.9-.9-3.4-2-4.5 1.2-.7 2.6-.9 3.9-.9 2.8 0 5 1.7 5.4 5.4h-7.3z"/></svg>
      ${people ? `<span><em>${escapeHtml(people)} PEOPLE</em> ARE IN THE PATH${isVertical ? '<br>' : ' '}OF THIS STORM</span>` : `<span>${escapeHtml(warning.office || 'NWS')}</span>`}
    </div>
    ${times.expires ? `<div class="exp"><strong>EXPIRES ${escapeHtml(times.expires)}</strong><small>${escapeHtml(times.expiresDay)}</small></div>` : ''}
  </div>
  ${chipMarkup ? `<div class="chips" id="chips">${chipMarkup}</div>` : ''}
</div>

<div class="bottom" id="bottom">
  <div class="wp-brand">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : ''}
    <span>See on <strong>WEATHERPOWER.APP</strong></span>
  </div>
  <div class="legend">
    <div class="lhead"><span id="legend-title">RADAR</span><b id="legend-time"></b></div>
    <div class="lbar" id="legend-bar"></div>
    <div class="llabels" id="legend-labels"></div>
    <div class="loopbar"><i id="loop-progress"></i></div>
  </div>
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
      return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone, timeZoneName: 'short' });
    } catch { return ''; }
  };

  // Shrink headline text until it fits (two lines for the intro, one line for the compact chip).
  const fitIntro = () => {
    const title = $('intro-title');
    let size = parseFloat(getComputedStyle(title).fontSize);
    const cs = getComputedStyle(title);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    while ((title.scrollHeight - padY > size * 2.05 || title.scrollWidth > title.clientWidth + 1) && size > 30) {
      size -= 2;
      title.style.fontSize = size + 'px';
    }
    const ev = $('compact-event');
    let evSize = parseFloat(getComputedStyle(ev).fontSize);
    while (ev.scrollWidth > ev.clientWidth + 1 && evSize > 26) { evSize -= 2; ev.style.fontSize = evSize + 'px'; }
  };

  const segments = data.radar.segments; // [{ kind, start, frames:[{id,url,time}], legend, step, hold }]
  const geometry = data.geometry;
  const pts = [];
  const walk = (c) => { if (!Array.isArray(c)) return; if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  walk(geometry.coordinates || []);
  const lons = pts.map((p) => p[0]); const lats = pts.map((p) => p[1]);
  const bounds = pts.length
    ? [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
    : [[data.center[0] - .5, data.center[1] - .5], [data.center[0] + .5, data.center[1] + .5]];

  // The map is captured once per radar frame on an oversized "stage"; the camera push-in is
  // a CSS scale from 1/K (whole stage visible) to 1 (native pixels), so no per-frame WebGL work.
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
    ? { top: 640 + my, bottom: 560 + my, left: 90 + mx, right: 90 + mx }
    : { top: 300 + my, bottom: 170 + my, left: 110 + mx, right: 110 + mx };

  const map = new maplibregl.Map({
    container: 'map', style: data.style, bounds, fitBoundsOptions: { padding: pad, maxZoom: 10.4 },
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
        map.addLayer({ id: frame.id, type: 'raster', source: frame.id,
          paint: { 'raster-opacity': 0.01, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, firstSymbol);
      }
    }
    await waitIdle(30000);
    drawPolygon();
    // Capture one still per radar frame.
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
    fitIntro();
    window.__SHORT_READY = true;
  });
  map.on('error', () => { window.__SHORT_ERRORS = (window.__SHORT_ERRORS || 0) + 1; });

  let lastLegend = '';
  const setLegend = (seg, frame) => {
    const legend = data.legends[seg.legend] || data.legends.reflectivity;
    if (lastLegend !== seg.legend) {
      lastLegend = seg.legend;
      $('legend-bar').style.background = legend.gradient;
      $('legend-labels').innerHTML = legend.labels.map((l) => '<span>' + l + '</span>').join('');
      $('legend-title').textContent = seg.title;
    }
    $('legend-time').textContent = frame && frame.time ? fmtTime(frame.time) : '';
  };

  window.__seek = async (t) => {
    const T = data.duration;
    // Header choreography: intro card (0-4.2s) then the compact lower-info stack.
    const introIn = easeOut(span(t, 0, .55));
    const introOut = ease(span(t, 4.1, 4.6));
    const intro = $('intro');
    intro.style.opacity = String(introIn * (1 - introOut));
    intro.style.transform = 'translateY(' + ((1 - introIn) * -60 - introOut * 40) + 'px)';
    intro.style.setProperty('--sheen', (-120 + 260 * span(t, .5, 1.6)) + '%');
    const compactIn = easeOut(span(t, 4.4, 5.0));
    const compact = $('compact');
    compact.style.opacity = String(compactIn);
    compact.style.transform = 'translateY(' + ((1 - compactIn) * -50) + 'px)';
    const chips = $('chips');
    if (chips) {
      const c = easeOut(span(t, 5.0, 5.5));
      chips.style.opacity = String(c);
      chips.style.transform = 'translateX(' + ((1 - c) * -40) + 'px)';
    }
    const b = easeOut(span(t, .3, .9));
    $('bottom').style.opacity = String(b);
    $('bottom').style.transform = 'translateY(' + ((1 - b) * 40) + 'px)';

    // Camera: slow push-in across the whole clip (scale 1/K -> 1).
    const scale = (1 / K) + (1 - 1 / K) * ease(t / T);
    stage.style.transform = 'scale(' + scale.toFixed(5) + ')';

    // Polygon: white flash, then settle into the alert color with a gentle pulse.
    const settle = ease(span(t, 1.2, 2.4));
    const pulse = .5 + .5 * Math.sin(t * Math.PI * 1.1);
    const lineColor = settle < .5 ? '#ffffff' : data.accent;
    const line = $('poly-line'), glow = $('poly-glow'), fill = $('poly-fill');
    line.setAttribute('stroke', lineColor);
    line.setAttribute('stroke-width', String(13 - 4 * settle));
    glow.setAttribute('stroke', lineColor);
    glow.setAttribute('stroke-opacity', String((.9 - .45 * settle) * (settle < 1 ? 1 : .65 + .35 * pulse)));
    fill.setAttribute('fill', data.accent);
    fill.setAttribute('fill-opacity', String(.04 + .08 * settle * pulse));

    // Radar: loop stills within each segment; cross-fade between segments.
    let active = segments[0];
    for (const seg of segments) if (t >= seg.start) active = seg;
    let shownFrame = null;
    let previous = null;
    for (const seg of segments) {
      if (seg === active) break;
      previous = seg;
    }
    const fadeIn = active.start > 0 ? easeOut(span(t, active.start, active.start + .5)) : 1;
    const frameIndex = (seg) => {
      if (seg.frames.length <= 1) return 0;
      const local = Math.max(0, t - seg.start);
      const cycle = seg.frames.length * seg.step + seg.hold;
      return Math.min(seg.frames.length - 1, Math.floor((local % cycle) / seg.step));
    };
    for (const seg of segments) {
      const index = frameIndex(seg);
      const segOpacity = seg === active ? 1 : seg === previous && fadeIn < 1 ? 1 : 0;
      seg.frames.forEach((frame, i) => {
        const img = $('shot-' + frame.id);
        if (!img) return;
        img.style.opacity = i === index ? String(segOpacity) : '0';
        img.style.zIndex = seg === active ? '2' : '1';
        if (seg === active && i === index && seg.start > 0) img.style.opacity = String(fadeIn);
      });
      if (seg === active) {
        shownFrame = seg.frames[index];
        const local = Math.max(0, t - seg.start);
        const cycle = seg.frames.length * seg.step + seg.hold;
        $('loop-progress').style.width = seg.frames.length > 1
          ? (100 * Math.min(1, (local % cycle) / (seg.frames.length * seg.step))) + '%'
          : '100%';
      }
    }
    setLegend(active, shownFrame);
    await nextFrame();
    return true;
  };
})();
</script>
</body>
</html>`;
};
