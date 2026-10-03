/* Stream House map: the map you work on and the stream map draw exactly the same layers the same way.
   WPMap.create(container, { interactive }) → controller. Needs maplibre-gl loaded first. */
(() => {
  const REPORT_COLORS = { Tornado: '#ff2a2a', 'Funnel Cloud': '#ff7a7a', Waterspout: '#ff7a7a', Hail: '#3fa9ff', Wind: '#ffd400', Damage: '#ffd400', 'Marine Wind': '#ffe680', Flood: '#2ee06f', Rain: '#36c3a4', Snow: '#e6f0ff' };
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const HOLD = 4;          // the newest radar frame stays up a little longer
  const STEP_MS = 520;
  const getJson = async (u) => {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error(u + ' → ' + r.status);
    return r.json();
  };
  const css = document.createElement('style');
  css.textContent = '.wp-site{display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none}'
    + '.wp-site i{width:12px;height:12px;border-radius:50%;background:#3fb7ff;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.5)}'
    + '.wp-site span{font:700 11px "WP Mono",monospace;color:#cfe6ff;text-shadow:0 1px 2px #000,0 0 4px #000;letter-spacing:.08em}';
  document.head.appendChild(css);

  const eachCoord = (g, fn) => {
    if (!g) return;
    const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.forEach(walk));
    if (g.type === 'GeometryCollection') g.geometries.forEach((x) => eachCoord(x, fn)); else walk(g.coordinates);
  };
  const bboxOf = (g) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    eachCoord(g, ([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); });
    return Number.isFinite(b[0]) ? [[b[0], b[1]], [b[2], b[3]]] : null;
  };
  const siteLabel = (s) => (['AK', 'HI', 'GU'].includes(s.state) ? 'P' : s.state === 'PR' ? 'T' : 'K') + s.id;

  const create = async (container, opts = {}) => {
    const style = (await getJson('/api/map/style').catch(() => ({}))).styleUrl || 'https://tiles.openfreemap.org/styles/dark';
    const v = opts.view || { center: [-96, 38.6], zoom: 4.3 };
    const map = new maplibregl.Map({
      container, style, center: v.center, zoom: v.zoom, bearing: v.bearing || 0, pitch: v.pitch || 0,
      interactive: Boolean(opts.interactive), attributionControl: false, fadeDuration: 0, maxPitch: 60,
      dragRotate: Boolean(opts.interactive), pitchWithRotate: false, touchPitch: false
    });
    const M = {
      map, ready: false, shapes: EMPTY, reports: [], cfg: null, sites: [],
      national: null, local: null, localKey: '', siteMarker: null, step: 0, playing: true, sel: '', hover: '',
      onFrame: null, onReady: null
    };
    const before = () => (map.getStyle().layers || []).find((l) => l.type === 'symbol')?.id;
    const has = (id) => Boolean(map.getLayer(id));
    const vis = (id, on) => { if (has(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    const reportFC = () => ({
      type: 'FeatureCollection',
      features: M.reports.filter((r) => Number.isFinite(r.lon) && Number.isFinite(r.lat)).map((r, i) => ({
        type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { i, color: REPORT_COLORS[r.type] || '#ffffff' }
      }))
    });

    /* ---------- radar ---------- */
    const addFrames = (prefix, frames, maxzoom, beforeId) => frames.forEach((f, i) => {
      map.addSource(prefix + i, { type: 'raster', tiles: [f.tiles], tileSize: 256, maxzoom });
      map.addLayer({ id: prefix + i, type: 'raster', source: prefix + i, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, beforeId);
    });
    const dropFrames = (prefix, n) => { for (let i = 0; i < n; i++) if (has(prefix + i)) { map.removeLayer(prefix + i); map.removeSource(prefix + i); } };
    const loadNational = async () => {
      let body;
      try { body = await getJson('/api/map/radar'); } catch { return; }
      const frames = body?.reflectivity || [];
      if (!frames.length || !M.ready) return;
      const same = M.national && M.national.length === frames.length && M.national.at(-1).tiles === frames.at(-1).tiles;
      if (same) return;
      dropFrames('rf', M.national?.length || 0);
      addFrames('rf', frames, 10, has('lr0') ? 'lr0' : has('vel') ? 'vel' : 'a-fill');
      M.national = frames;
      paintRadar();
    };
    const clearLocal = () => {
      dropFrames('lr', M.local?.reflectivity.length || 0);
      if (has('vel')) { map.removeLayer('vel'); map.removeSource('vel'); }
      M.local = null;
      M.localKey = '';
      M.siteMarker?.remove();
      M.siteMarker = null;
    };
    const loadLocal = async (id) => {
      if (!M.ready) return;
      if (!id) { if (M.localKey) clearLocal(); return; }
      if (M.localKey === id) return;
      clearLocal();
      M.localKey = id;
      let body;
      try { body = await getJson('/api/map/radar/site?site=' + encodeURIComponent(id)); } catch { body = null; }
      if (M.localKey !== id) return;
      if (!body?.reflectivity?.length) { M.onSiteError?.(id); return; }
      addFrames('lr', body.reflectivity, 11, 'a-fill');
      if (body.velocity) {
        map.addSource('vel', { type: 'raster', tiles: [body.velocity.tiles], tileSize: 256, maxzoom: 11 });
        map.addLayer({ id: 'vel', type: 'raster', source: 'vel', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } }, 'a-fill');
      }
      const site = M.sites.find((s) => s.id === id);
      M.local = { ...body, site };
      if (site) {
        const el = document.createElement('div');
        el.className = 'wp-site';
        el.innerHTML = '<i></i><span>' + siteLabel(site) + '</span>';
        M.siteMarker = new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([site.lon, site.lat]).addTo(map);
      }
      paintRadar();
    };
    const frameAt = (n) => (n ? Math.min(n - 1, M.step % (n + HOLD)) : 0);
    const paintRadar = () => {
      if (!M.ready || !M.cfg) return;
      const on = M.cfg.layers.radar;
      const op = Math.max(0.1, Math.min(1, Number(M.cfg.opacity) || 0.85));
      const velOn = on && M.cfg.layers.velocity && M.local?.velocity;
      vis('vel', velOn);
      const nN = M.national?.length || 0, nL = M.local?.reflectivity.length || 0;
      const fN = M.playing ? frameAt(nN) : nN - 1, fL = M.playing ? frameAt(nL) : nL - 1;
      for (let i = 0; i < nN; i++) if (has('rf' + i)) map.setPaintProperty('rf' + i, 'raster-opacity', on && i === fN ? op : 0);
      for (let i = 0; i < nL; i++) if (has('lr' + i)) map.setPaintProperty('lr' + i, 'raster-opacity', on && !velOn && i === fL ? op : 0);
      const t = nL ? M.local.reflectivity[fL]?.time : nN ? M.national[fN]?.time : null;
      M.onFrame?.({ time: t, latest: nL ? fL === nL - 1 : fN === nN - 1, site: M.local?.site || null });
    };
    setInterval(() => { if (M.playing) { M.step += 1; paintRadar(); } }, STEP_MS);
    setInterval(loadNational, 120000);
    M.setPlaying = (on) => { M.playing = on; paintRadar(); };

    /* ---------- warnings, watches, reports, the picked warning ---------- */
    const install = () => {
      const b = before();
      map.addSource('alerts', { type: 'geojson', data: M.shapes });
      map.addLayer({ id: 'a-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'group'], 'watches'], 0.07, 0.14] } }, b);
      map.addLayer({ id: 'a-case', type: 'line', source: 'alerts', paint: { 'line-color': '#000', 'line-opacity': 0.5, 'line-width': 4.5 } });
      map.addLayer({ id: 'a-line', type: 'line', source: 'alerts', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['<=', ['get', 'rank'], 3], 3, 2] } });
      map.addLayer({ id: 'w-line', type: 'line', source: 'alerts', filter: ['==', ['get', 'group'], 'watches'], paint: { 'line-color': ['get', 'color'], 'line-width': 2.2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'hover-line', type: 'line', source: 'alerts', filter: ['==', ['get', 'key'], ''], paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'sel-case', type: 'line', source: 'alerts', filter: ['==', ['get', 'key'], ''], paint: { 'line-color': '#000', 'line-opacity': 0.75, 'line-width': 10 } });
      map.addLayer({ id: 'sel-line', type: 'line', source: 'alerts', filter: ['==', ['get', 'key'], ''], paint: { 'line-color': '#ffffff', 'line-width': 4.5 } });
      map.addSource('reports', { type: 'geojson', data: reportFC() });
      map.addLayer({ id: 'reports', type: 'circle', source: 'reports', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4.5, 9, 7.5], 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#000' } });
      M.ready = true;
      applyLayers();
      loadNational().then(() => loadLocal(wantSite()));
      M.onReady?.();
    };
    map.once('style.load', install);
    // A style reload (rare) wipes our layers: put them back.
    map.on('styledata', () => { if (M.ready && !has('a-fill')) { M.ready = false; M.national = null; M.local = null; M.localKey = ''; install(); } });

    const wantSite = () => (M.cfg && M.cfg.radar !== 'national' && M.cfg.site) || '';
    const applyLayers = () => {
      if (!M.ready || !M.cfg) return;
      const L = M.cfg.layers;
      const live = ['in', ['get', 'group'], ['literal', ['warnings', 'statements', 'discussions']]];
      const fill = ['any', L.warnings ? live : ['==', 1, 0], L.watches ? ['==', ['get', 'group'], 'watches'] : ['==', 1, 0]];
      map.setFilter('a-fill', fill);
      map.setFilter('a-case', L.warnings ? live : ['==', 1, 0]);
      map.setFilter('a-line', L.warnings ? live : ['==', 1, 0]);
      vis('w-line', L.watches);
      vis('reports', L.reports);
      const sel = opts.interactive || M.cfg.showSelected ? M.sel : '';
      map.setFilter('sel-case', ['==', ['get', 'key'], sel]);
      map.setFilter('sel-line', ['==', ['get', 'key'], sel]);
      paintRadar();
    };
    setInterval(() => { if (M.ready && M.sel) map.setPaintProperty('sel-line', 'line-opacity', 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 420))); }, 90);

    M.setConfig = (cfg) => { M.cfg = cfg; M.sel = cfg.selected || ''; applyLayers(); loadLocal(wantSite()); };
    M.setShapes = (fc) => { M.shapes = fc || EMPTY; map.getSource('alerts')?.setData(M.shapes); };
    M.setReports = (list) => { M.reports = list || []; map.getSource('reports')?.setData(reportFC()); };
    M.setHover = (key) => { M.hover = key || ''; if (M.ready) map.setFilter('hover-line', ['==', ['get', 'key'], M.hover]); };
    M.shapeOf = (key) => M.shapes.features.find((f) => f.properties.key === key)?.geometry || null;
    M.boundsOf = (key) => bboxOf(M.shapeOf(key));
    M.bboxOf = bboxOf;
    M.loadSites = async () => { try { M.sites = (await getJson('/api/map/sites')).sites || []; } catch { M.sites = []; } return M.sites; };
    M.nearestSite = (pt, maxKm = 420) => {
      let best = null, bestD = Infinity;
      const cos = Math.cos((pt[1] * Math.PI) / 180);
      for (const s of M.sites) {
        const dx = (s.lon - pt[0]) * cos, dy = s.lat - pt[1], d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = s; }
      }
      return best && Math.sqrt(bestD) * 111 < maxKm ? best : null;
    };
    M.siteLabel = siteLabel;
    M.setView = (view, how = 'fly') => {
      const target = { center: view.center, zoom: view.zoom, bearing: view.bearing || 0, pitch: view.pitch || 0 };
      map.stop();
      if (how === 'jump') map.jumpTo(target);
      else if (how === 'ease') map.easeTo({ ...target, duration: 180, easing: (t) => t });
      else map.flyTo({ ...target, speed: 1.15, curve: 1.42, maxDuration: 4500, essential: true });
    };
    M.reportAt = (i) => M.reports[i];
    await M.loadSites();
    return M;
  };
  window.WPMap = { create, REPORT_COLORS };
})();
