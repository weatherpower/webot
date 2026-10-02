const qs = (selector) => document.querySelector(selector);

const state = {
  token: localStorage.getItem('warningControllerToken') || '',
  weWatchMap: null,
  weWatchMapReady: false,
  weWatchDraft: [],
  weWatchSelectedId: ''
};

const CONTROLLER_VIEWS = {
  ops: {
    title: 'Live Operations',
    description: 'Renderer health, real alerts, and posting activity.'
  },
  wewatch: {
    title: 'WeWatch Studio',
    description: 'Draw, classify, save, and render custom WeatherPower watch areas.'
  },
  studio: {
    title: 'Card Studio',
    description: 'Edit alert data, tune the card treatment, and inspect the final render.'
  },
  connections: {
    title: 'Connections',
    description: 'Controller access and outbound publishing authorization.'
  }
};

const PRESETS = {
  severe: {
    event: 'Severe Thunderstorm Warning',
    title: 'SEVERE THUNDERSTORM WARNING',
    primary: '#ffd400',
    accent: '#ffe45e',
    tag: '',
    radarMode: 'both',
    hazardLabel: 'Wind / Hail',
    hazardValue: '60 MPH',
    wind: '60 MPH',
    hail: '1.00 IN',
    whatToDo: 'Seek shelter inside a sturdy building. Stay away from windows and prepare for damaging wind or large hail.'
  },
  destructive: {
    event: 'Severe Thunderstorm Warning',
    title: 'DESTRUCTIVE SEVERE THUNDERSTORM WARNING',
    primary: '#ffd400',
    accent: '#fff176',
    tag: 'DESTRUCTIVE',
    radarMode: 'both',
    hazardLabel: 'Destructive',
    hazardValue: '80 MPH',
    wind: '80 MPH',
    hail: '2.75 IN',
    whatToDo: 'This is a destructive storm. Move inside now, stay away from windows, and prepare for destructive wind or very large hail.'
  },
  tornado: {
    event: 'Tornado Warning',
    title: 'TORNADO WARNING',
    primary: '#e40000',
    accent: '#ff1919',
    tag: '',
    radarMode: 'both',
    hazardLabel: 'Tornado',
    hazardValue: 'Radar Indicated',
    wind: '',
    hail: '1.00 IN',
    whatToDo: 'Take cover now. Move to a basement or interior room on the lowest floor and stay away from windows.'
  },
  'pds-tornado': {
    event: 'Tornado Warning',
    title: 'PDS TORNADO WARNING',
    primary: '#ff3fb6',
    accent: '#ff80d2',
    tag: 'PDS EMERGENCY',
    radarMode: 'both',
    hazardLabel: 'PDS Tornado',
    hazardValue: 'Observed',
    wind: '',
    hail: '2.00 IN',
    whatToDo: 'This is a particularly dangerous situation. Take cover now in a basement or interior room and protect your head.'
  },
  'tornado-emergency': {
    event: 'Tornado Warning',
    title: 'TORNADO EMERGENCY',
    primary: '#ff3fb6',
    accent: '#ff80d2',
    tag: 'EMERGENCY',
    radarMode: 'both',
    hazardLabel: 'Tornado',
    hazardValue: 'Observed',
    wind: '',
    hail: '2.00 IN',
    whatToDo: 'TORNADO EMERGENCY. Take cover now in a basement or interior room on the lowest floor. Protect your head.'
  },
  flood: {
    event: 'Flood Warning',
    title: 'FLOOD WARNING',
    primary: '#16a34a',
    accent: '#5cff88',
    tag: '',
    radarMode: 'reflectivity',
    hazardLabel: 'Flood',
    hazardValue: 'Warning',
    wind: '',
    hail: '',
    whatToDo: 'Move to higher ground. Do not walk or drive through flood water.'
  },
  'flood-emergency': {
    event: 'Flash Flood Warning',
    title: 'FLASH FLOOD EMERGENCY',
    primary: '#14a84a',
    accent: '#42e06f',
    tag: 'EMERGENCY',
    radarMode: 'reflectivity',
    hazardLabel: 'Flood Emergency',
    hazardValue: 'Emergency',
    wind: '',
    hail: '',
    whatToDo: 'FLOOD EMERGENCY. Move to higher ground now. Never drive through flooded roads.'
  },
  'tornado-watch': {
    event: 'Tornado Watch',
    title: 'TORNADO WATCH',
    primary: '#e40000',
    accent: '#ff1919',
    tag: 'WATCH',
    radarMode: 'reflectivity',
    hazardLabel: 'Tornado',
    hazardValue: 'Watch',
    wind: '',
    hail: '',
    whatToDo: 'Stay weather aware and be ready to act quickly if tornado warnings are issued.'
  },
  'severe-watch': {
    event: 'Severe Thunderstorm Watch',
    title: 'SEVERE THUNDERSTORM WATCH',
    primary: '#ffd400',
    accent: '#ffe45e',
    tag: 'WATCH',
    radarMode: 'reflectivity',
    hazardLabel: 'Severe Storm',
    hazardValue: 'Watch',
    wind: '',
    hail: '',
    whatToDo: 'Stay weather aware and be ready to seek shelter if severe thunderstorm warnings are issued.'
  }
};

const IDABEL_CENTER = [-94.8263, 33.8957];
const WEWATCH_COLORS = {
  'Severe Thunderstorm Watch': '#ffd400',
  'Tornado Watch': '#e40000',
  'Flood Watch': '#16a34a',
  'Winter Storm Watch': '#15a2ff',
  'WeatherPower Watch': '#22d3ee'
};

const WEWATCH_LEVEL_TAGS = {
  Standard: 'WEWATCH',
  Elevated: 'ELEVATED',
  Significant: 'SIGNIFICANT',
  PDS: 'PDS WATCH'
};

const hexToRgb = (hex) => {
  const clean = String(hex || '#8896b8').replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((part) => part + part).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
};

const darkenHex = (hex) => {
  const clean = String(hex || '#8896b8').replace('#', '').padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(clean, 16);
  const r = Math.max(0, Math.round(((value >> 16) & 255) * 0.48));
  const g = Math.max(0, Math.round(((value >> 8) & 255) * 0.48));
  const b = Math.max(0, Math.round((value & 255) * 0.48));
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
};

const toDatetimeLocal = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const formatVisualTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
};

const setValue = (id, value) => {
  qs(`#${id}`).value = value ?? '';
};

const getValue = (id) => qs(`#${id}`).value.trim();

const setText = (id, value) => {
  qs(`#${id}`).textContent = value || '';
};

const getText = (id) => qs(`#${id}`).textContent.trim();

const authHeaders = () => state.token ? { 'x-controller-token': state.token } : {};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders()
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
};

const setControllerView = (view) => {
  const next = CONTROLLER_VIEWS[view] ? view : 'ops';
  document.body.dataset.controllerView = next;
  document.querySelectorAll('[data-controller-view]').forEach((button) => {
    if (!button.classList.contains('control-nav-item')) return;
    button.classList.toggle('active', button.dataset.controllerView === next);
  });
  qs('#controller-view-name').textContent = CONTROLLER_VIEWS[next].title;
  qs('#controller-view-description').textContent = CONTROLLER_VIEWS[next].description;
  if (next === 'wewatch') {
    window.setTimeout(() => {
      state.weWatchMap?.resize();
      updateWeWatchMap();
    }, 80);
  }
};

const setWeWatchStatus = (message) => {
  qs('#wewatch-map-status').textContent = message;
};

const watchColor = (event, level) => {
  if (level === 'PDS') return '#ff56c7';
  return WEWATCH_COLORS[event] || WEWATCH_COLORS['WeatherPower Watch'];
};

const createBoxAround = ([lon, lat], radiusMiles = 24) => {
  const milesPerDegreeLat = 69;
  const latDelta = radiusMiles / milesPerDegreeLat;
  const lonDelta = radiusMiles / (milesPerDegreeLat * Math.max(0.25, Math.cos((lat * Math.PI) / 180)));
  return [
    [lon - lonDelta, lat - latDelta],
    [lon + lonDelta, lat - latDelta],
    [lon + lonDelta, lat + latDelta],
    [lon - lonDelta, lat + latDelta]
  ];
};

const closeRing = (points) => {
  const clean = points
    .filter((point) => Array.isArray(point) && point.length === 2)
    .map(([lon, lat]) => [Number(lon), Number(lat)])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (!clean.length) return [];
  const first = clean[0];
  const last = clean.at(-1);
  const closed = first[0] === last[0] && first[1] === last[1] ? clean : [...clean, first];
  return closed;
};

const openRing = (ring = []) => {
  if (!Array.isArray(ring)) return [];
  const points = ring
    .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point.lon ?? point.lng), Number(point.lat)])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
};

const centerForPoints = (points = []) => {
  const clean = points.filter((point) => Array.isArray(point) && point.length === 2);
  if (!clean.length) return IDABEL_CENTER;
  const sum = clean.reduce((acc, [lon, lat]) => [acc[0] + Number(lon), acc[1] + Number(lat)], [0, 0]);
  return [sum[0] / clean.length, sum[1] / clean.length];
};

const weWatchFeatureCollection = () => {
  const points = state.weWatchDraft;
  const features = points.map((point, index) => ({
    type: 'Feature',
    properties: { index },
    geometry: { type: 'Point', coordinates: point }
  }));

  if (points.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { type: 'outline' },
      geometry: {
        type: 'LineString',
        coordinates: points.length >= 3 ? closeRing(points) : points
      }
    });
  }

  if (points.length >= 3) {
    features.push({
      type: 'Feature',
      properties: { type: 'area' },
      geometry: { type: 'Polygon', coordinates: [closeRing(points)] }
    });
  }

  return { type: 'FeatureCollection', features };
};

const updateWeWatchMap = ({ fit = false } = {}) => {
  const map = state.weWatchMap;
  if (!map || !state.weWatchMapReady || !map.getSource('wewatch-draft')) return;
  const color = getValue('wewatch-color') || watchColor(getValue('wewatch-event'), getValue('wewatch-level'));
  map.setPaintProperty('wewatch-draft-fill', 'fill-color', color);
  map.setPaintProperty('wewatch-draft-outline', 'line-color', color);
  map.setPaintProperty('wewatch-draft-points', 'circle-color', color);
  map.getSource('wewatch-draft').setData(weWatchFeatureCollection());
  const count = state.weWatchDraft.length;
  setWeWatchStatus(count >= 3
    ? `${count} points selected. Save to render this highlighted WeWatch area.`
    : (count === 0
      ? 'Click the map to draw a WeWatch area, or use the Idabel box button when you want a starter area.'
      : `${count} point${count === 1 ? '' : 's'} selected. Add ${Math.max(0, 3 - count)} more to make an area.`));

  if (fit && state.weWatchDraft.length) {
    const bounds = state.weWatchDraft.reduce((nextBounds, point) => nextBounds.extend(point), new window.maplibregl.LngLatBounds(state.weWatchDraft[0], state.weWatchDraft[0]));
    map.fitBounds(bounds, { padding: 70, maxZoom: 8.5, duration: 300 });
  }
};

const ensureWeWatchMap = async () => {
  if (state.weWatchMap) return state.weWatchMap;
  if (!window.maplibregl) {
    setWeWatchStatus('MapLibre GL did not load. You can still use the Idabel box and save.');
    return null;
  }
  const config = await request('/api/maps/config');
  if (!config.styleUrl) {
    setWeWatchStatus('The WeatherPower map style is missing. Deploy shared map assets first.');
    return null;
  }

  const map = new window.maplibregl.Map({
    container: 'wewatch-map',
    style: config.styleUrl,
    center: IDABEL_CENTER,
    zoom: 7.2,
    attributionControl: false
  });
  map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.on('load', () => {
    state.weWatchMapReady = true;
    map.addSource('wewatch-draft', {
      type: 'geojson',
      data: weWatchFeatureCollection()
    });
    map.addLayer({
      id: 'wewatch-draft-fill',
      type: 'fill',
      source: 'wewatch-draft',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': getValue('wewatch-color') || '#ffd400',
        'fill-opacity': 0.26
      }
    });
    map.addLayer({
      id: 'wewatch-draft-outline',
      type: 'line',
      source: 'wewatch-draft',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'LineString']],
      paint: {
        'line-color': getValue('wewatch-color') || '#ffd400',
        'line-width': 4,
        'line-opacity': 1
      }
    });
    map.addLayer({
      id: 'wewatch-draft-points',
      type: 'circle',
      source: 'wewatch-draft',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': getValue('wewatch-color') || '#ffd400',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });
    updateWeWatchMap({ fit: true });
  });
  map.on('click', (event) => {
    state.weWatchDraft.push([Number(event.lngLat.lng.toFixed(4)), Number(event.lngLat.lat.toFixed(4))]);
    updateWeWatchMap();
  });
  state.weWatchMap = map;
  return map;
};

const setDefaultWeWatchExpires = () => {
  if (!getValue('wewatch-expires')) {
    setValue('wewatch-expires', toDatetimeLocal(new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()));
  }
};

const applyWeWatchStyleDefaults = () => {
  setValue('wewatch-color', watchColor(getValue('wewatch-event'), getValue('wewatch-level')));
  updateWeWatchMap();
};

const useIdabelWeWatchBox = () => {
  state.weWatchDraft = createBoxAround(IDABEL_CENTER, 24);
  if (!getValue('wewatch-area')) setValue('wewatch-area', 'Idabel, Oklahoma');
  if (!getValue('wewatch-state')) setValue('wewatch-state', 'OK');
  updateWeWatchMap({ fit: true });
};

const weWatchTitle = () => {
  const event = getValue('wewatch-event') || 'WeatherPower Watch';
  const stateName = getValue('wewatch-state') || 'OK';
  return (getValue('wewatch-title') || `${event} in ${stateName}`).toUpperCase();
};

const buildWeWatchPayload = () => {
  if (state.weWatchDraft.length < 3) {
    throw new Error('Draw at least 3 map points before saving the WeWatch.');
  }
  const points = state.weWatchDraft;
  const ring = closeRing(points);

  const event = getValue('wewatch-event') || 'WeatherPower Watch';
  const level = getValue('wewatch-level') || 'Standard';
  const wind = getValue('wewatch-wind');
  const hail = getValue('wewatch-hail');
  const tornado = getValue('wewatch-tornado');
  const color = getValue('wewatch-color') || watchColor(event, level);
  const areaDesc = getValue('wewatch-area') || getValue('wewatch-state') || 'WeatherPower Area';
  const title = weWatchTitle();
  const alertTag = WEWATCH_LEVEL_TAGS[level] || 'WEWATCH';
  const expiresAt = fromDatetimeLocal(getValue('wewatch-expires')) || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const sourceText = getValue('wewatch-source') || `WeatherPower ${level} WeWatch for ${areaDesc}.`;
  const whatToDo = getValue('wewatch-action') || 'Stay weather aware and be ready to act quickly if warnings are issued.';
  const center = centerForPoints(points);

  const probabilities = [
    tornado ? { group: 'Tornado', value: tornado, label: 'tornado' } : null,
    wind ? { group: 'Wind', value: wind, label: 'max wind' } : null,
    hail ? { group: 'Hail', value: hail, label: 'max hail' } : null
  ].filter(Boolean);

  return {
    id: state.weWatchSelectedId || undefined,
    active: true,
    event,
    title,
    state: getValue('wewatch-state') || 'OK',
    areaDesc,
    office: 'WeatherPower Builder',
    issuedAt: new Date().toISOString(),
    expiresAt,
    timezone: 'America/Chicago',
    level,
    severity: level,
    hazardLabel: 'WeWatch',
    hazardValue: level,
    hazardSubtext: [wind ? `Wind ${wind}` : '', hail ? `Hail ${hail}` : ''].filter(Boolean).join(' · '),
    wind,
    hail,
    sourceText,
    description: sourceText,
    whatToDo,
    polygon: ring,
    geometry: {
      type: 'Polygon',
      coordinates: [ring]
    },
    center,
    locations: areaDesc.split(/[;,]/).map((item) => item.trim()).filter(Boolean),
    theme: {
      name: `WeatherPower ${level} WeWatch`,
      primary: color,
      primaryDark: darkenHex(color),
      accent: color,
      polygon: color,
      rgb: hexToRgb(color),
      type: 'wewatch'
    },
    hazards: {
      label: 'WeWatch',
      value: level,
      subtext: [wind ? `Wind ${wind}` : '', hail ? `Hail ${hail}` : ''].filter(Boolean).join(' · '),
      wind,
      hail
    },
    hazardStats: [
      { label: 'Level', value: level },
      wind ? { label: 'Wind', value: wind } : null,
      hail ? { label: 'Hail', value: hail } : null
    ].filter(Boolean),
    watchDetails: {
      maxWind: wind,
      maxHail: hail,
      probabilities
    },
    classification: {
      isCustom: true,
      customSource: 'wewatch',
      isWatch: true,
      isPds: level === 'PDS',
      alertTag
    },
    radar: {
      mode: 'reflectivity'
    },
    postText: `${title}. ${whatToDo}`.slice(0, 260)
  };
};

const setWeWatchForm = (item = {}) => {
  state.weWatchSelectedId = item.id || '';
  setValue('wewatch-title', item.title || '');
  setValue('wewatch-event', item.event || 'Severe Thunderstorm Watch');
  setValue('wewatch-level', item.level || item.severity || 'Standard');
  setValue('wewatch-state', item.state || 'OK');
  setValue('wewatch-area', item.areaDesc || '');
  setValue('wewatch-expires', toDatetimeLocal(item.expiresAt || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()));
  setValue('wewatch-wind', item.wind || item.watchDetails?.maxWind || '');
  setValue('wewatch-hail', item.hail || item.watchDetails?.maxHail || '');
  setValue('wewatch-tornado', item.watchDetails?.probabilities?.find((entry) => entry.group === 'Tornado')?.value || '');
  setValue('wewatch-color', item.theme?.accent || watchColor(item.event || 'Severe Thunderstorm Watch', item.level || 'Standard'));
  setValue('wewatch-source', item.sourceText || item.description || '');
  setValue('wewatch-action', item.whatToDo || '');
  const geometryRing = item.geometry?.type === 'Polygon' ? item.geometry.coordinates?.[0] : item.polygon;
  state.weWatchDraft = openRing(geometryRing);
  updateWeWatchMap({ fit: true });
};

const setPayloadFromWeWatch = (item) => {
  qs('#payload').value = JSON.stringify(item, null, 2);
  syncEditorFromPayload();
};

const loadWeWatches = async () => {
  const { items } = await request('/api/wewatches?includeExpired=true');
  const list = qs('#wewatch-list');
  list.replaceChildren(new Option('New WeWatch', ''));
  items.forEach((item) => {
    const option = new Option(`${item.title || item.event || item.id} · ${item.areaDesc || item.state || ''}`, item.id);
    list.add(option);
  });
  if (state.weWatchSelectedId && [...list.options].some((option) => option.value === state.weWatchSelectedId)) {
    list.value = state.weWatchSelectedId;
  }
  state.weWatches = items;
};

const saveWeWatch = async ({ render = false } = {}) => {
  const payload = buildWeWatchPayload();
  const result = await request('/api/wewatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  state.weWatchSelectedId = result.item.id;
  await loadWeWatches();
  qs('#wewatch-list').value = result.item.id;
  setPayloadFromWeWatch(result.item);
  setWeWatchStatus(`Saved ${result.item.title || result.item.id}. The Warning Center will auto-render it.`);
  await loadLogs();
  if (render) await renderEditedCard();
};

const deleteSelectedWeWatch = async () => {
  const id = state.weWatchSelectedId || getValue('wewatch-list');
  if (!id) throw new Error('Choose a saved WeWatch to delete.');
  await request(`/api/wewatches/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.weWatchSelectedId = '';
  await loadWeWatches();
  setWeWatchForm({});
  setWeWatchStatus('Deleted the selected WeWatch.');
  await loadLogs();
};

const setOverallStatus = (health) => {
  const pill = qs('#overall-status');
  const hasPostTarget = health.x.readyToPost || health.discord?.readyToPost;
  const ready = Boolean(health.maps && health.maps.styleUrl) && hasPostTarget && health.pageEndpoint.configured;
  pill.className = `status-pill ${ready ? 'ok' : 'warn'}`;
  pill.textContent = ready ? 'Ready for live posts' : 'Needs config';
};

const statusLine = (label, value, ok = true) => {
  const div = document.createElement('div');
  div.className = 'status-line';
  div.innerHTML = `<span>${label}</span><strong class="${ok ? 'ok-text' : 'warn-text'}">${value}</strong>`;
  return div;
};

const loadHealth = async () => {
  const health = await request('/api/health');
  setOverallStatus(health);
  qs('#x-auth-note').textContent = health.x.readyToPost
    ? `Connected${health.x.savedScreenName ? ` as @${health.x.savedScreenName}` : ''} using ${health.x.authMethod}.`
    : `Add callback ${health.controller.xCallbackUrl}, then click Connect X.`;
  const list = qs('#health-list');
  list.replaceChildren(
    statusLine('MapLibre', health.maps && health.maps.styleUrl ? 'Configured' : 'Missing style', Boolean(health.maps && health.maps.styleUrl)),
    statusLine('Map style', health.maps && health.maps.styleUrl || 'Missing', Boolean(health.maps && health.maps.styleUrl)),
    statusLine('X app', health.x.appCredentialsPresent ? 'Key + secret present' : 'Missing key/secret', health.x.appCredentialsPresent),
    statusLine('X posting', health.x.readyToPost ? `${health.x.authMethod} ready` : 'Needs account authorization', health.x.readyToPost),
    statusLine('Discord posting', health.discord?.readyToPost ? 'Webhook ready' : 'Missing webhook', Boolean(health.discord?.readyToPost)),
    statusLine('Discord auto-post', health.discord?.autoPostEnabled ? `Enabled · max ${health.discord.autoPostMaxPerRefresh || 1}/refresh · ${health.discord.autoPostMinSeconds || 0}s cooldown` : 'Manual only', true),
    statusLine('Page endpoint', health.pageEndpoint.configured ? health.pageEndpoint.url : 'Missing', health.pageEndpoint.configured),
    statusLine('Controller auth', health.controller.tokenRequired ? 'Token required' : 'Open on LAN', !health.controller.tokenRequired),
    statusLine('WeWatch builder', 'Local editor ready', true),
    statusLine('Firebase WeWatches', health.customProducts?.firebaseWeWatchesConfigured ? 'Configured' : 'Optional', true)
  );
};

const loadSample = async () => {
  const warning = await request('/api/sample-warning');
  qs('#payload').value = JSON.stringify(warning, null, 2);
  syncEditorFromPayload();
};

const loadActiveWarnings = async () => {
  const params = new URLSearchParams();
  const area = qs('#nws-area').value.trim();
  const event = qs('#nws-event').value;
  if (area) params.set('area', area);
  if (event) params.set('event', event);
  params.set('limit', '0');
  params.set('warningOnly', 'false');
  const result = await request(`/api/warnings/active?${params.toString()}`);
  const list = qs('#warning-list');

  if (!result.warnings.length) {
    list.innerHTML = '<p class="hint">No active NWS warnings or watches matched that filter. Try the full U.S. view.</p>';
    return;
  }

  list.replaceChildren(...result.warnings.map((warning, index) => {
    const item = document.createElement('div');
    item.className = 'warning-item';
    const expires = warning.expiresAt ? new Date(warning.expiresAt).toLocaleString() : 'unknown expiration';
    item.innerHTML = `
      <div>
        <div class="warning-item-title">${warning.title}</div>
        <div class="warning-item-meta">${warning.areaDesc || warning.state} · expires ${expires}</div>
      </div>
      <button type="button">Use</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      qs('#payload').value = JSON.stringify(result.warnings[index], null, 2);
      syncEditorFromPayload();
    });
    return item;
  }));

  qs('#payload').value = JSON.stringify(result.warnings[0], null, 2);
  syncEditorFromPayload();
};

const readPayload = () => {
  try {
    return JSON.parse(qs('#payload').value);
  } catch (error) {
    throw new Error(`Payload JSON is invalid: ${error.message}`);
  }
};

const showCard = (url) => {
  const image = qs('#preview-image');
  const open = qs('#open-card');
  const cacheBust = `${url}?t=${Date.now()}`;
  image.src = cacheBust;
  open.href = url;
};

const syncEditorFromPayload = () => {
  const warning = readPayload();
  setValue('edit-title', warning.title || '');
  setValue('edit-event', warning.event || '');
  setValue('edit-state', warning.state || '');
  setValue('edit-office', warning.office || '');
  setValue('edit-expires', toDatetimeLocal(warning.expiresAt));
  setValue('edit-issued', toDatetimeLocal(warning.issuedAt));
  setValue('edit-tag', warning.classification?.alertTag ?? 'auto');
  setValue('edit-radar-mode', warning.radar?.mode || 'reflectivity');
  setValue('edit-primary', warning.theme?.primary || '#8896b8');
  setValue('edit-accent', warning.theme?.accent || warning.theme?.primary || '#b8c0d8');
  setValue('edit-hazard-label', warning.hazards?.label || '');
  setValue('edit-hazard-value', warning.hazards?.value || warning.hazards?.hail || '');
  setValue('edit-wind', warning.hazardStats?.find((stat) => stat.label === 'Wind')?.value || warning.hazards?.wind || '');
  setValue('edit-hail', warning.hazardStats?.find((stat) => stat.label === 'Hail')?.value || warning.hazards?.hail || '');
  setValue('edit-motion', warning.hazardStats?.find((stat) => stat.label === 'Motion')?.value || '');
  setValue('edit-source', warning.sourceText || '');
  setValue('edit-what-to-do', warning.whatToDo || '');
  updateVisualPreview();
};

const updateVisualPreview = () => {
  const primary = getValue('edit-primary') || '#8896b8';
  const accent = getValue('edit-accent') || primary;
  const card = qs('#visual-card');
  card.style.setProperty('--vc-primary', primary);
  card.style.setProperty('--vc-dark', darkenHex(primary));
  card.style.setProperty('--vc-accent', accent);
  setText('visual-title', getValue('edit-event') || getValue('edit-title') || 'WEATHER ALERT');
  setText('visual-area', getValue('edit-title') || getValue('edit-state') || 'Affected area');
  const tag = getValue('edit-tag');
  setText('visual-tag', tag && tag !== 'auto' ? tag : '');
  qs('#visual-tag').classList.toggle('has-tag', Boolean(tag && tag !== 'auto'));
  setText('visual-expires', formatVisualTime(fromDatetimeLocal(getValue('edit-expires')) || getValue('edit-expires')));
  setText('visual-hazard-label', getValue('edit-hazard-label') || 'Hazard');
  setText('visual-hazard-value', getValue('edit-hazard-value') || 'Warning');
  setText('visual-wind', getValue('edit-wind') || '--');
  setText('visual-hail', getValue('edit-hail') || '--');
  setText('visual-motion', getValue('edit-motion') || '--');
  setText('visual-source', getValue('edit-source') || 'Live Alert');
  setText('visual-action-copy', getValue('edit-what-to-do') || 'Stay weather aware.');
};

const syncFieldsFromVisual = () => {
  setValue('edit-event', getText('visual-title'));
  setValue('edit-title', getText('visual-area'));
  const tag = getText('visual-tag');
  if ([...qs('#edit-tag').options].some((option) => option.value === tag)) {
    setValue('edit-tag', tag);
  }
  setValue('edit-hazard-label', getText('visual-hazard-label'));
  setValue('edit-hazard-value', getText('visual-hazard-value'));
  setValue('edit-wind', getText('visual-wind').replace(/^--$/, ''));
  setValue('edit-hail', getText('visual-hail').replace(/^--$/, ''));
  setValue('edit-motion', getText('visual-motion').replace(/^--$/, ''));
  setValue('edit-source', getText('visual-source'));
  setValue('edit-what-to-do', getText('visual-action-copy'));
  applyEditorToPayload();
};

const applyEditorToPayload = () => {
  const warning = readPayload();
  const primary = getValue('edit-primary') || '#8896b8';
  const accent = getValue('edit-accent') || primary;
  const event = getValue('edit-event');
  const title = getValue('edit-title');
  const tag = getValue('edit-tag');
  const wind = getValue('edit-wind');
  const hail = getValue('edit-hail');
  const motion = getValue('edit-motion');
  const hazardStats = [
    wind ? { label: 'Wind', value: wind } : null,
    hail ? { label: 'Hail', value: hail } : null,
    motion ? { label: 'Motion', value: motion } : null
  ].filter(Boolean);

  const next = {
    ...warning,
    title: title || warning.title,
    event: event || warning.event,
    state: getValue('edit-state') || warning.state,
    office: getValue('edit-office') || warning.office,
    expiresAt: fromDatetimeLocal(getValue('edit-expires')) || warning.expiresAt,
    issuedAt: fromDatetimeLocal(getValue('edit-issued')) || warning.issuedAt,
    sourceText: getValue('edit-source') || warning.sourceText,
    whatToDo: getValue('edit-what-to-do') || warning.whatToDo,
    hazards: {
      ...(warning.hazards || {}),
      label: getValue('edit-hazard-label') || warning.hazards?.label,
      value: getValue('edit-hazard-value') || warning.hazards?.value,
      subtext: warning.hazards?.subtext || warning.hazards?.hailSubtext || '',
      wind,
      hail
    },
    hazardStats,
    radar: {
      ...(warning.radar || {}),
      mode: getValue('edit-radar-mode') || warning.radar?.mode || 'reflectivity'
    },
    theme: {
      ...(warning.theme || {}),
      primary,
      primaryDark: darkenHex(primary),
      accent,
      polygon: accent,
      rgb: hexToRgb(primary)
    },
    classification: {
      ...(warning.classification || {})
    }
  };

  if (tag !== 'auto') {
    next.classification.alertTag = tag;
    next.classification.isWatch = tag === 'WATCH';
    next.classification.isDestructive = tag === 'DESTRUCTIVE';
    next.classification.isPds = tag === 'PDS EMERGENCY' || tag === 'PDS WATCH';
    next.classification.isPdsWatch = tag === 'PDS WATCH';
    next.classification.isEmergency = tag === 'EMERGENCY' || tag === 'PDS EMERGENCY';
    next.classification.renderAsGif = tag === 'EMERGENCY' && /tornado/i.test(event || next.event || '');
  }

  next.contentType = next.classification?.renderAsGif ? 'image/gif' : 'image/png';
  next.postText = `${next.title}. ${next.whatToDo || ''}`.slice(0, 260);
  qs('#payload').value = JSON.stringify(next, null, 2);
  updateVisualPreview();
  return next;
};

const applyPreset = () => {
  const preset = PRESETS[getValue('editor-preset')] || PRESETS.severe;
  const current = (() => {
    try {
      return readPayload();
    } catch {
      return {};
    }
  })();
  const stateSuffix = current.state ? ` IN ${String(current.state).toUpperCase()}` : '';
  setValue('edit-event', preset.event);
  setValue('edit-title', `${preset.title}${stateSuffix}`.trim());
  setValue('edit-primary', preset.primary);
  setValue('edit-accent', preset.accent);
  setValue('edit-tag', preset.tag);
  setValue('edit-radar-mode', preset.radarMode);
  setValue('edit-hazard-label', preset.hazardLabel);
  setValue('edit-hazard-value', preset.hazardValue);
  setValue('edit-wind', preset.wind);
  setValue('edit-hail', preset.hail);
  setValue('edit-motion', current.hazardStats?.find((stat) => stat.label === 'Motion')?.value || '');
  setValue('edit-what-to-do', preset.whatToDo);
  if (!getValue('edit-source')) setValue('edit-source', current.sourceText || 'Live Alert');
  applyEditorToPayload();
  updateVisualPreview();
};

const renderCard = async () => {
  const body = { warning: readPayload() };
  const result = await request('/api/warnings/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  showCard(result.render.url);
  await loadLogs();
};

const renderEditedCard = async () => {
  applyEditorToPayload();
  await renderCard();
};

const postCard = async (dryRun) => {
  const body = { warning: readPayload(), dryRun };
  const result = await request('/api/warnings/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  showCard(result.render.url);
  await loadLogs();
  await loadHealth();
};

const loadLogs = async () => {
  const { logs } = await request('/api/logs');
  const list = qs('#log-list');
  if (!logs.length) {
    list.innerHTML = '<p class="hint">No posts or renders logged yet.</p>';
    return;
  }
  list.replaceChildren(...logs.map((entry) => {
    const item = document.createElement('div');
    item.className = `log-item ${entry.level === 'error' ? 'error' : ''}`;
    const title = `${entry.action || 'event'} · ${entry.warningTitle || entry.message || 'warning service'}`;
    item.innerHTML = `
      <div class="log-item-title">
        <span>${title}</span>
        <time>${entry.time || ''}</time>
      </div>
      <pre>${JSON.stringify(entry, null, 2)}</pre>
    `;
    return item;
  }));
};

const withErrorAlert = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    alert(error.message);
  }
};

qs('#controller-token').value = state.token;
document.querySelectorAll('.control-nav-item[data-controller-view]').forEach((button) => {
  button.addEventListener('click', () => setControllerView(button.dataset.controllerView));
});
qs('#save-token').addEventListener('click', () => {
  state.token = qs('#controller-token').value.trim();
  localStorage.setItem('warningControllerToken', state.token);
  loadLogs().catch(() => {});
});
qs('#refresh-health').addEventListener('click', withErrorAlert(loadHealth));
qs('#refresh-logs').addEventListener('click', withErrorAlert(loadLogs));
qs('#sync-editor').addEventListener('click', withErrorAlert(syncEditorFromPayload));
qs('#apply-editor').addEventListener('click', withErrorAlert(applyEditorToPayload));
qs('#apply-preset').addEventListener('click', withErrorAlert(applyPreset));
qs('#render-edited').addEventListener('click', withErrorAlert(renderEditedCard));
qs('#wewatch-idabel').addEventListener('click', useIdabelWeWatchBox);
qs('#wewatch-undo').addEventListener('click', () => {
  state.weWatchDraft.pop();
  updateWeWatchMap();
});
qs('#wewatch-clear').addEventListener('click', () => {
  state.weWatchDraft = [];
  updateWeWatchMap();
});
qs('#wewatch-save').addEventListener('click', withErrorAlert(() => saveWeWatch({ render: false })));
qs('#wewatch-save-render').addEventListener('click', withErrorAlert(() => saveWeWatch({ render: true })));
qs('#wewatch-delete').addEventListener('click', withErrorAlert(deleteSelectedWeWatch));
qs('#wewatch-list').addEventListener('change', () => {
  const id = getValue('wewatch-list');
  const item = (state.weWatches || []).find((candidate) => candidate.id === id);
  if (item) {
    setWeWatchForm(item);
    setPayloadFromWeWatch(item);
    return;
  }
  state.weWatchSelectedId = '';
  setWeWatchForm({});
});
qs('#wewatch-event').addEventListener('change', applyWeWatchStyleDefaults);
qs('#wewatch-level').addEventListener('change', applyWeWatchStyleDefaults);
qs('#wewatch-color').addEventListener('input', () => updateWeWatchMap());
document.querySelectorAll('.editor-grid input, .editor-grid select, .editor-grid textarea').forEach((input) => {
  input.addEventListener('input', updateVisualPreview);
  input.addEventListener('change', updateVisualPreview);
});
document.querySelectorAll('.visual-card [contenteditable="true"]').forEach((node) => {
  node.addEventListener('blur', withErrorAlert(syncFieldsFromVisual));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && node.id !== 'visual-action-copy') {
      event.preventDefault();
      node.blur();
    }
  });
});
qs('#connect-x').addEventListener('click', () => {
  const params = new URLSearchParams();
  if (state.token) params.set('token', state.token);
  window.open(`/api/x/auth/start${params.size ? `?${params.toString()}` : ''}`, '_blank', 'noreferrer');
});
qs('#fetch-warnings').addEventListener('click', withErrorAlert(loadActiveWarnings));
qs('#load-sample').addEventListener('click', withErrorAlert(loadSample));
qs('#render-card').addEventListener('click', withErrorAlert(renderCard));
qs('#dry-post').addEventListener('click', withErrorAlert(() => postCard(true)));
qs('#live-post').addEventListener('click', withErrorAlert(() => postCard(false)));

setDefaultWeWatchExpires();
applyWeWatchStyleDefaults();
setControllerView('ops');
await loadSample();
syncEditorFromPayload();
await loadWeWatches();
ensureWeWatchMap().catch((error) => setWeWatchStatus(error.message));
await loadHealth();
await loadLogs();
await loadActiveWarnings().catch((error) => {
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `Live alert feed unavailable: ${error.message}`;
  qs('#warning-list').replaceChildren(note);
});
