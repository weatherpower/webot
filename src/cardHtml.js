import { boundsForPolygon, compactNumber, displayTimes, normalizeWarning } from './warning.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const hazardValueHtml = (value) => escapeHtml(value)
  .replace(/\s(in|mph)\b/gi, ' <small>$1</small>');

const statValueClass = (value) => {
  const compact = String(value ?? '').replace(/\s+/g, '');
  if (compact.length >= 11) return 'is-extra-long';
  if (compact.length >= 8) return 'is-long';
  return '';
};

export const warningCardHtml = ({ warning: rawWarning, mapConfig = {}, logoDataUrl = '', fontDataUrls = {}, staticMapDataUrl = '' }) => {
  const warning = normalizeWarning(rawWarning);
  const embeddedFontCss = [
    fontDataUrls.oswald ? `@font-face { font-family: "Avenir Next Condensed"; src: url("${fontDataUrls.oswald}") format("woff2"); font-style: normal; font-weight: 500 700; font-display: block; }` : '',
    fontDataUrls.inter ? `@font-face { font-family: "WeatherPower Sans"; src: url("${fontDataUrls.inter}") format("woff2"); font-style: normal; font-weight: 400 900; font-display: block; }` : '',
    fontDataUrls.ibmPlexMono500 ? `@font-face { font-family: "WeatherPower Mono"; src: url("${fontDataUrls.ibmPlexMono500}") format("woff2"); font-style: normal; font-weight: 500; font-display: block; }` : '',
    fontDataUrls.ibmPlexMono600 ? `@font-face { font-family: "WeatherPower Mono"; src: url("${fontDataUrls.ibmPlexMono600}") format("woff2"); font-style: normal; font-weight: 600; font-display: block; }` : '',
    fontDataUrls.ibmPlexMono700 ? `@font-face { font-family: "WeatherPower Mono"; src: url("${fontDataUrls.ibmPlexMono700}") format("woff2"); font-style: normal; font-weight: 700 950; font-display: block; }` : ''
  ].filter(Boolean).join('\n');
  const times = displayTimes(warning);
  const cardGeometry = warning.geometry || { type: 'Polygon', coordinates: [[...warning.polygon]] };
  const geometryPoints = (value) => {
    if (!value) return [];
    if (value.type === 'FeatureCollection') return (value.features || []).flatMap(geometryPoints);
    if (value.type === 'Feature') return geometryPoints(value.geometry);
    if (value.geometry) return geometryPoints(value.geometry);
    const collect = (coordinates) => {
      if (!Array.isArray(coordinates)) return [];
      if (
        coordinates.length >= 2 &&
        Number.isFinite(Number(coordinates[0])) &&
        Number.isFinite(Number(coordinates[1]))
      ) {
        return [[Number(coordinates[0]), Number(coordinates[1])]];
      }
      return coordinates.flatMap(collect);
    };
    return collect(value.coordinates);
  };
  const referenceLongitude = Number(warning.center?.[0]);
  const normalizeLongitude = (longitude) => {
    let value = Number(longitude);
    if (!Number.isFinite(referenceLongitude)) return value;
    while (value - referenceLongitude > 180) value -= 360;
    while (value - referenceLongitude < -180) value += 360;
    return value;
  };
  const tropicalGeometries = [
    warning.tropical?.cone,
    warning.tropical?.forecastTrack,
    warning.tropical?.forecastPoints,
    warning.tropical?.watchWarning
  ];
  const boundPoints = [cardGeometry, ...tropicalGeometries]
    .flatMap(geometryPoints)
    .map(([longitude, latitude]) => [normalizeLongitude(longitude), Number(latitude)])
    .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
  const bounds = boundPoints.length ? boundsForPolygon(boundPoints) : boundsForPolygon(warning.polygon);
  const theme = warning.theme;
  const classification = warning.classification || {};
  const isDiscussionLayout = Boolean(classification.isDiscussion || warning.mdDetails || warning.cardLayout === 'discussion');
  const isOutlookLayout = Boolean(classification.isOutlook || warning.outlookDetails || warning.cardLayout === 'outlook');
  const isForecastLayout = Boolean(classification.isForecast || warning.forecast || warning.cardLayout === 'forecast');
  const hasForecastStaticMap = Boolean(isForecastLayout && staticMapDataUrl);
  const isTropicalLayout = Boolean(classification.isTropical || warning.tropical);
  const isWatchLayout = Boolean(classification.isWatch && !isDiscussionLayout && !isOutlookLayout);
  const cardHeadline = isForecastLayout
    ? (warning.title || warning.event || 'Daily Forecast')
    : (warning.event || warning.title || 'Weather Alert');
  const cardArea = warning.areaDesc || warning.state || warning.forecast?.location || '';
  const isSpecialWeatherStatement = /special weather statement/i.test(`${warning.event || ''} ${warning.title || ''}`);
  const tornadoId = warning.tornadoId?.experimental ? warning.tornadoId : null;
  const tornadoIdIsPrimary = Boolean(tornadoId && classification.family === 'tornado');
  const cardClass = ['card', isWatchLayout ? 'is-watch' : '', classification.isPds ? 'is-pds' : '', isDiscussionLayout ? 'is-discussion' : '', isOutlookLayout ? 'is-outlook' : '', isForecastLayout ? 'is-forecast' : '', isTropicalLayout ? 'is-tropical' : '', tornadoId ? 'has-tornado-id' : '']
    .filter(Boolean)
    .join(' ');
  const hazardLabel = warning.hazards.label || 'Hail';
  const hazardValue = warning.hazards.value || warning.hazards.hail || 'Warning';
  const hazardSubtext = warning.hazards.subtext || warning.hazards.hailSubtext || '';
  const hasImpactNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const hasPopulation = hasImpactNumber(warning.impacts?.people) || hasImpactNumber(warning.impacts?.homes);
  const populationLine = hasPopulation
    ? `${compactNumber(warning.impacts?.people)} PEOPLE · ${compactNumber(warning.impacts?.homes)} HOMES`
    : '';
  const populationMarkup = populationLine
    ? `<div class="stat-line population-line"><span>${escapeHtml(populationLine)}</span>${warning.impacts?.sourceLabel ? `<small>${escapeHtml(warning.impacts.sourceLabel)}</small>` : ''}</div>`
    : '';
  const impactLine = warning.impactLine || '';
  const radarLabel = warning.radar?.mode === 'velocity'
    ? `${warning.radar.site || 'NEXRAD'} velocity`
    : warning.radar?.mode === 'both'
      ? `${warning.radar.site || 'NEXRAD'} velocity · reflectivity`
      : 'NEXRAD reflectivity';
  const logoMarkup = logoDataUrl
    ? `<img class="brand-logo" src="${logoDataUrl}" alt="WeatherPower">`
    : '<div class="brand-mark" aria-hidden="true"></div>';
  const rightLogoMarkup = logoDataUrl
    ? `<img class="corner-logo" src="${logoDataUrl}" alt="WeatherPower">`
    : '';
  const alertTag = classification.alertTag || '';
  const tropical = warning.tropical || {};
  const forecast = warning.forecast || {};
  const productBadges = isTropicalLayout
    ? [
        'NHC',
        tropical.advisoryNumber ? `ADV ${tropical.advisoryNumber}` : 'TROPICAL',
        tropical.modelCount ? `${tropical.modelCount} TRACKS` : 'OFFICIAL CONE'
      ]
    : isDiscussionLayout
    ? (warning.mdDetails?.badges || ['SPC', 'DISCUSSION'])
    : isOutlookLayout
      ? ['SPC', `DAY ${warning.outlookDetails?.day || ''}`.trim(), warning.outlookDetails?.label || 'OUTLOOK'].filter(Boolean)
      : isForecastLayout
        ? ['WEATHERPOWER', 'DAILY FORECAST']
      : isWatchLayout
        ? [classification.isPds ? 'PDS WATCH' : 'WATCH']
      : [];
  const badgeRow = productBadges.length
    ? `<div class="badge-row">${productBadges.map((badge) => `<span class="product-badge">${escapeHtml(badge)}</span>`).join('')}</div>`
    : '';
  const topAlertTag = isDiscussionLayout ? '' : alertTag;
  const emergencyBanner = classification.isEmergency
    ? `<div class="emergency-banner ${warning.emergencyFlashFrame ? 'is-flash' : ''}">${escapeHtml(topAlertTag || 'EMERGENCY')}</div>`
    : topAlertTag
      ? `<div class="alert-tag">${escapeHtml(topAlertTag)}</div>`
      : '';
  const statementJoke = isSpecialWeatherStatement
    ? `<div class="statement-note"><div class="statement-note-label">WeatherPower Translation</div><div class="statement-note-copy">Dollar Store Half-Off Temu Warning. Still take this seriously.</div></div>`
    : '';
  const tornadoIdPanel = tornadoId
    ? `<section class="tornado-id-panel" style="--tornado-id-color: ${escapeHtml(tornadoId.color || '#70d7ff')}">
          <div class="tornado-id-heading">
            <div><span class="tornado-id-kicker">WeatherPower Tornado ID</span><strong>Experimental signal</strong></div>
            <span class="tornado-id-status">${escapeHtml(tornadoId.detection || tornadoId.tornadoSignalLabel || 'ACTIVE')}</span>
          </div>
          <div class="tornado-id-scores">
            <div class="tornado-id-score"><span>Rotation detection</span><strong>${escapeHtml(tornadoId.rotationLabel)}</strong><b>${escapeHtml(tornadoId.rotation)}/100</b></div>
            <div class="tornado-id-score"><span>Tornado AI</span><strong>${escapeHtml(tornadoId.tornadoSignalLabel)}</strong><b>${escapeHtml(tornadoId.tornadoSignal)}%</b></div>
          </div>
          ${tornadoId.evidence?.length ? `<div class="tornado-id-evidence">${tornadoId.evidence.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
          <p>This automated WeatherPower signal uses official NWS warning metadata and wording. It is not an independent tornado confirmation.</p>
        </section>`
    : '';
  const statBoxes = (warning.hazardStats || [])
    .slice(0, 3)
    .map((stat) => {
      const valueClass = statValueClass(stat.value);
      return `<div class="mini-stat ${valueClass ? 'has-fitted-value' : ''}"><span>${escapeHtml(stat.label)}</span><strong class="${valueClass}">${hazardValueHtml(stat.value)}</strong></div>`;
    })
    .join('');
  const watchStatBoxes = (warning.hazardStats || [])
    .slice(0, 2)
    .map((stat) => `<div class="watch-stat"><span>${escapeHtml(stat.label)}</span><strong>${hazardValueHtml(stat.value)}</strong></div>`)
    .join('');
  const probabilitiesByGroup = (warning.watchDetails?.probabilities || []).reduce((groups, item) => {
    groups[item.group] ||= [];
    groups[item.group].push(item);
    return groups;
  }, {});
  const watchProbabilities = Object.entries(probabilitiesByGroup)
    .map(([group, items]) => `
      <div class="prob-group">
        <div class="prob-title">${escapeHtml(group)}</div>
        <div class="prob-chips">
          ${items.map((item) => `<span class="prob-chip"><strong>${escapeHtml(item.value)}</strong> ${escapeHtml(item.label)}</span>`).join('')}
        </div>
      </div>
    `)
    .join('');
  const metaLabel = isForecastLayout ? 'Forecast Date' : isWatchLayout || isDiscussionLayout || isOutlookLayout || isTropicalLayout ? 'Valid Until' : 'Expires';
  const discussionConcern = (warning.mdDetails?.concerning || [])
    .filter(Boolean)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');
  const discussionArea = warning.mdDetails?.area || warning.sourceText || '';
  const tropicalStormLabel = [tropical.classificationLabel, tropical.name].filter(Boolean).join(' ') || 'Tropical Cyclone';
  const tropicalStats = (warning.hazardStats || [])
    .slice(0, 3)
    .map((stat) => `<div class="tropical-stat"><span>${escapeHtml(stat.label)}</span><strong>${hazardValueHtml(stat.value)}</strong></div>`)
    .join('');
  const tropicalModelSummary = tropical.modelNames?.length
    ? `${tropical.modelNames.slice(0, 6).join(' · ')}${tropical.modelNames.length > 6 ? ` +${tropical.modelNames.length - 6}` : ''}`
    : 'Guidance tracks temporarily unavailable';
  const forecastTemperature = (value) => value === null || value === undefined || value === ''
    ? '--'
    : `${escapeHtml(value)}<small>&deg;${escapeHtml(forecast.temperatureUnit || 'F')}</small>`;
  const sidebarContent = isForecastLayout
    ? `
        <div class="sidebar-top forecast-sidebar">
          ${badgeRow}
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time forecast-date">${escapeHtml(forecast.dayLabel || forecast.periodName || times.expiresDate)}</div>
          <section class="forecast-condition">
            <span class="forecast-kicker">${escapeHtml(forecast.isDaytime ? 'Daytime forecast' : 'Nighttime forecast')}</span>
            <strong>${escapeHtml(forecast.shortForecast || warning.hazards.value || 'Forecast')}</strong>
          </section>
          <div class="forecast-temperature-grid">
            <div><span>High</span><strong>${forecastTemperature(forecast.high)}</strong></div>
            <div><span>Low</span><strong>${forecastTemperature(forecast.low)}</strong></div>
          </div>
          <div class="forecast-facts">
            <div><span>Rain chance</span><strong>${escapeHtml(forecast.precipitation === null || forecast.precipitation === undefined ? '--' : `${forecast.precipitation}%`)}</strong></div>
            <div><span>Wind</span><strong>${escapeHtml(forecast.wind || 'Light and variable')}</strong></div>
          </div>
          <div class="action forecast-action">
            <div class="action-title">Forecast Details</div>
            <div class="action-copy">${escapeHtml(forecast.detailedForecast || warning.whatToDo)}</div>
          </div>
          <div class="forecast-source">Official NWS point forecast for ${escapeHtml(forecast.location || warning.areaDesc)}</div>
        </div>`
    : isTropicalLayout
    ? `
        <div class="sidebar-top tropical-sidebar">
          ${badgeRow}
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time">${escapeHtml(times.expiresTime)}</div>
          <div class="tropical-identity">
            <span>Official NHC Storm</span>
            <strong>${escapeHtml(tropicalStormLabel)}</strong>
            <b>${tropical.advisoryNumber ? `ADVISORY ${escapeHtml(tropical.advisoryNumber)}` : 'LATEST ADVISORY'}</b>
          </div>
          ${tropicalStats ? `<div class="tropical-stat-grid">${tropicalStats}</div>` : ''}
          <div class="tropical-guidance">
            <span>Model Guidance</span>
            <strong>${escapeHtml(tropicalModelSummary)}</strong>
          </div>
          <div class="action tropical-action">
            <div class="action-title">What To Do</div>
            <div class="action-copy">${escapeHtml(warning.whatToDo)}</div>
          </div>
          <div class="cone-note">The cone shows the probable path of the storm center, not its size. Dangerous impacts can occur outside the cone.</div>
        </div>`
    : isDiscussionLayout
    ? `
        <div class="sidebar-top">
          ${badgeRow}
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time">${escapeHtml(times.expiresTime)}</div>
          ${statBoxes ? `<div class="mini-stat-grid discussion-stats">${statBoxes}</div>` : ''}
          <div class="action concern-panel">
            <div class="action-title">Concerning</div>
            <div class="action-copy">${discussionConcern ? `<ul class="concern-list">${discussionConcern}</ul>` : escapeHtml(warning.mdDetails?.summary || warning.sourceText)}</div>
          </div>
          ${discussionArea ? `<div class="report-line discussion-area">${escapeHtml(discussionArea)}</div>` : ''}
          <div class="action">
            <div class="action-title">What To Do</div>
            <div class="action-copy">${escapeHtml(warning.whatToDo)}</div>
          </div>
        </div>`
    : isOutlookLayout
      ? `
        <div class="sidebar-top outlook-sidebar">
          ${badgeRow}
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time">${escapeHtml(times.expiresTime)}</div>
          <div class="hazard-card outlook-risk">
            <div>
              <div class="hazard-label">SPC Outlook</div>
              <div class="hail">${hazardValueHtml(warning.hazards.value || warning.outlookDetails?.label || 'OUTLOOK')}</div>
              <div class="hail-sub">${escapeHtml(warning.outlookDetails?.labelText || warning.hazards.subtext || '')}</div>
            </div>
          </div>
          ${statBoxes ? `<div class="mini-stat-grid discussion-stats">${statBoxes}</div>` : ''}
          <div class="report-line">${escapeHtml(warning.sourceText)}</div>
          <div class="action">
            <div class="action-title">What To Do</div>
            <div class="action-copy">${escapeHtml(warning.whatToDo)}</div>
          </div>
        </div>`
    : isWatchLayout
      ? `
        <div class="sidebar-top watch-sidebar">
          ${badgeRow}
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time">${escapeHtml(times.expiresTime)}</div>
          ${classification.isPds ? '<div class="pds-watch-note">Particularly Dangerous Situation</div>' : ''}
          ${watchStatBoxes ? `<div class="watch-stat-grid">${watchStatBoxes}</div>` : ''}
          ${populationMarkup}
          ${watchProbabilities ? `<div class="action probabilities"><div class="action-title">Probabilities</div><div class="probability-copy">${watchProbabilities}</div></div>` : ''}
          <div class="action watch-action">
            <div class="action-title">What To Do</div>
            <div class="action-copy">${escapeHtml(warning.whatToDo)}</div>
          </div>
        </div>`
      : `
        <div class="sidebar-top">
          <div class="meta-row">
            <span>${metaLabel}</span>
            <span>${escapeHtml(times.expiresDate)}</span>
          </div>
          <div class="expires-time">${escapeHtml(times.expiresTime)}</div>
          ${tornadoIdIsPrimary ? '' : `<div class="hazard-card">
            <div>
              <div class="hazard-label">${escapeHtml(hazardLabel)}</div>
              <div class="hail">${hazardValueHtml(hazardValue)}</div>
              <div class="hail-sub">${escapeHtml(hazardSubtext)}</div>
            </div>
          </div>`}
          ${tornadoIdPanel}
          ${populationMarkup || (impactLine ? `<div class="stat-line">${escapeHtml(impactLine)}</div>` : '')}
          ${statBoxes ? `<div class="mini-stat-grid">${statBoxes}</div>` : ''}
          ${tornadoId ? '' : `<div class="report-line">${escapeHtml(warning.sourceText)}</div>`}
          ${statementJoke}
          <div class="action">
            <div class="action-title">What To Do</div>
            <div class="action-copy">${escapeHtml(warning.whatToDo)}</div>
          </div>
        </div>
        <div class="location-section">
          <div class="section-title">Location</div>
          <div class="overview-wrap">
            <div id="overview"></div>
            <div class="overview-label">${escapeHtml((warning.locations || []).join(' · '))}</div>
          </div>
        </div>`;
  const legendIsVelocity = warning.radar?.mode === 'velocity' || warning.radar?.mode === 'both';
  const legendLabels = legendIsVelocity
    ? ['←TOWARD', 'AWAY→']
    : ['LIGHT', 'MODERATE', 'HEAVY', 'EXTREME'];
  const footerCardType = isForecastLayout
    ? 'DAILY FORECAST CARD'
    : isTropicalLayout
    ? classification.isWatch ? 'TROPICAL WATCH CARD' : classification.isWarning ? 'TROPICAL WARNING CARD' : 'TROPICAL CARD'
    : isDiscussionLayout
    ? `MCD-${new Date(warning.issuedAt || Date.now()).getUTCFullYear()}-${warning.mdDetails?.number || ''}`
    : isOutlookLayout
      ? `SPC DAY ${warning.outlookDetails?.day || ''} OUTLOOK`
      : isWatchLayout
        ? 'WATCH CARD'
        : 'WARNING CARD';
  const mapCaption = isForecastLayout
    ? `<div class="map-caption forecast-caption">${escapeHtml(forecast.location || warning.areaDesc)} · NWS POINT FORECAST · ${escapeHtml(forecast.shortForecast || 'FORECAST')}</div>`
    : isTropicalLayout
    ? `<div class="map-caption tropical-caption">${escapeHtml(tropicalStormLabel)} · OFFICIAL NHC CONE · ${escapeHtml(String(tropical.modelCount || 0))} GUIDANCE TRACKS</div>`
    : isDiscussionLayout && discussionArea
    ? `<div class="map-caption">${escapeHtml(discussionArea)}</div>`
    : isOutlookLayout
      ? `<div class="map-caption">${escapeHtml(warning.outlookDetails?.labelText || warning.areaDesc || 'SPC Outlook')}</div>`
    : '';
  const payload = JSON.stringify({
    warning,
    geometry: cardGeometry,
    maps: {
      renderer: 'MapLibre GL JS',
      styleUrl: mapConfig.styleUrl || 'https://weatherpower.app/maps/weatherpower/style.json?v=20260809-v6-tribal-hard-gate',
      style: mapConfig.style || null
    },
    bounds
  }).replaceAll('</script', '<\\/script');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(warning.title)}</title>
  ${hasForecastStaticMap ? '' : '<link href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">'}
  <style>
    ${embeddedFontCss}

    :root {
      --primary: ${theme.primary};
      --primary-dark: ${theme.primaryDark};
      --accent: ${theme.accent};
      --theme-rgb: ${theme.rgb};
      --panel: #070d18;
      --panel-soft: #101926;
      --text: #f8fbff;
      --muted: #9aa8bb;
      --line: rgba(255, 255, 255, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 1280px;
      height: 960px;
      margin: 0;
      overflow: hidden;
      background: #050912;
      color: var(--text);
      font-family: "Avenir Next Condensed", "Arial Narrow", Impact, sans-serif;
    }

    .card {
      position: relative;
      width: 1280px;
      height: 960px;
      background: #050912;
      overflow: hidden;
    }

    .topbar {
      position: absolute;
      inset: 0 0 auto 0;
      height: 90px;
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 0 32px;
      background: var(--primary);
      border-bottom: 4px solid var(--primary-dark);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      z-index: 10;
    }

    .title-wrap {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
      flex: 1;
    }

    .title-copy {
      min-width: 0;
      flex: 1 1 auto;
      display: grid;
      align-content: center;
      gap: 5px;
    }

    .brand-logo {
      width: 56px;
      height: 56px;
      border-radius: 13px;
      object-fit: cover;
      flex: 0 0 auto;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    }

    .corner-logo {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      object-fit: cover;
      flex: 0 0 auto;
      margin-left: auto;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    }

    .brand-mark {
      width: 38px;
      height: 46px;
      position: relative;
      flex: 0 0 auto;
      filter: drop-shadow(0 2px 1px rgba(0, 0, 0, 0.4));
    }

    .brand-mark::before,
    .brand-mark::after {
      content: "";
      position: absolute;
      background: #fff;
      transform: skewX(-15deg);
    }

    .brand-mark::before {
      left: 5px;
      top: 0;
      width: 8px;
      height: 46px;
    }

    .brand-mark::after {
      right: 2px;
      top: 2px;
      width: 12px;
      height: 42px;
      clip-path: polygon(0 0, 100% 0, 52% 50%, 100% 100%, 0 100%, 46% 50%);
    }

    .title {
      min-width: 0;
      font-size: 43px;
      line-height: 1;
      letter-spacing: 2px;
      font-weight: 900;
      text-transform: uppercase;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.34);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
    }

    .title-subline {
      max-height: 28px;
      overflow: hidden;
      color: rgba(255, 255, 255, .9);
      font-family: "WeatherPower Sans", Inter, system-ui, sans-serif;
      font-size: 12px;
      line-height: 1.15;
      font-weight: 750;
      text-transform: uppercase;
    }

    .title-subline span {
      margin-right: 7px;
      color: rgba(255, 255, 255, .68);
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 1.4px;
    }

    .title.is-wrapped {
      max-height: 56px;
      line-height: 0.92;
      letter-spacing: 0;
      white-space: normal;
    }

    .card.is-discussion .title {
      font-size: 40px;
    }

    .alert-tag,
    .emergency-banner {
      flex: 0 0 auto;
      border: 2px solid rgba(255, 255, 255, 0.75);
      border-radius: 4px;
      padding: 7px 12px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 17px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #fff;
      background: rgba(0, 0, 0, 0.25);
      box-shadow: 0 0 18px rgba(255, 255, 255, 0.14);
    }

    .emergency-banner {
      background: #ffffff;
      color: var(--primary-dark);
      border-color: #ffffff;
      box-shadow: 0 0 28px rgba(255, 255, 255, 0.55);
    }

    .emergency-banner.is-flash {
      background: var(--primary-dark);
      color: #fff;
      border-color: #fff;
    }

    .card.is-pds .alert-tag {
      background: #ffffff;
      color: var(--primary-dark);
      border-color: #ffffff;
      box-shadow: 0 0 24px rgba(255, 255, 255, 0.42);
    }

    .layout {
      position: absolute;
      inset: 90px 0 42px 0;
      display: grid;
      grid-template-columns: 400px 1fr;
    }

    .sidebar {
      background: #060d17;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .sidebar-top {
      padding: 24px 22px 0;
    }

    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 14px;
    }

    .product-badge {
      min-width: 88px;
      border: 1px solid rgba(var(--theme-rgb), 0.72);
      background: rgba(var(--theme-rgb), 0.16);
      color: #fff;
      padding: 10px 12px;
      border-radius: 2px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: 1.4px;
      text-align: center;
      text-transform: uppercase;
    }

    .card.is-watch .sidebar-top,
    .card.is-discussion .sidebar-top,
    .card.is-tropical .sidebar-top {
      padding-top: 18px;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      color: var(--muted);
      letter-spacing: 2px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .expires-time {
      margin-top: 6px;
      font-size: 46px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 1px;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
    }

    .hazard-card {
      margin-top: 26px;
      border: 1px solid rgba(var(--theme-rgb), 0.62);
      background: linear-gradient(180deg, rgba(var(--theme-rgb), 0.25), rgba(28, 7, 17, 0.78));
      border-radius: 4px;
      min-height: 96px;
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 28px rgba(var(--theme-rgb), 0.12);
    }

    .tornado-id-panel {
      margin-top: 10px;
      border: 1px solid color-mix(in srgb, var(--tornado-id-color) 74%, transparent);
      border-radius: 5px;
      overflow: hidden;
      background: linear-gradient(135deg, color-mix(in srgb, var(--tornado-id-color) 18%, #07101d) 0%, #0a1321 58%, #070d18 100%);
      box-shadow: inset 3px 0 0 var(--tornado-id-color), inset 0 0 22px color-mix(in srgb, var(--tornado-id-color) 14%, transparent);
    }

    .tornado-id-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px 8px 15px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    }

    .tornado-id-heading > div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .tornado-id-kicker,
    .tornado-id-status,
    .tornado-id-score span,
    .tornado-id-evidence span {
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 1.15px;
      text-transform: uppercase;
    }

    .tornado-id-kicker {
      color: var(--tornado-id-color);
    }

    .tornado-id-heading strong {
      color: #f8fbff;
      font-size: 16px;
      line-height: 1;
      text-transform: uppercase;
    }

    .tornado-id-status {
      max-width: 116px;
      padding: 5px 6px;
      border: 1px solid color-mix(in srgb, var(--tornado-id-color) 70%, transparent);
      border-radius: 3px;
      color: #fff;
      background: color-mix(in srgb, var(--tornado-id-color) 18%, transparent);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tornado-id-scores {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      background: rgba(255, 255, 255, 0.08);
    }

    .tornado-id-score {
      min-width: 0;
      padding: 9px 10px;
      background: rgba(5, 12, 22, 0.72);
    }

    .tornado-id-score span {
      display: block;
      color: #9eb0c7;
    }

    .tornado-id-score strong {
      display: block;
      margin-top: 4px;
      color: #fff;
      font-size: 18px;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .tornado-id-score b {
      display: block;
      margin-top: 3px;
      color: var(--tornado-id-color);
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1;
    }

    .tornado-id-evidence {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 8px 10px 3px;
    }

    .tornado-id-evidence span {
      border-radius: 2px;
      padding: 4px 5px;
      color: #eaf2ff;
      background: rgba(255, 255, 255, 0.07);
    }

    .tornado-id-panel p {
      margin: 3px 10px 9px;
      color: #b8c6d7;
      font-family: "WeatherPower Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10px;
      line-height: 1.3;
      font-weight: 600;
    }

    .hazard-label {
      color: #9fb0c9;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 3px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      text-align: center;
    }

    .hail {
      margin-top: 2px;
      font-size: 32px;
      line-height: 1;
      font-weight: 900;
      text-align: center;
    }

    .hail small {
      font-size: 16px;
      opacity: 0.9;
      margin-left: 3px;
    }

    .hail-sub {
      margin-top: 7px;
      color: #9fb0c9;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      text-align: center;
    }

    .stat-line,
    .report-line {
      margin-top: 8px;
      border: 1px solid rgba(var(--theme-rgb), 0.42);
      background: #0a1420;
      border-radius: 3px;
      padding: 10px 13px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }

    .population-line small {
      display: block;
      margin-top: 4px;
      color: #9fb0c9;
      font-size: 9px;
      letter-spacing: 1.1px;
    }

    .statement-note {
      margin-top: 8px;
      border: 1px solid rgba(var(--theme-rgb), 0.58);
      border-radius: 4px;
      background:
        linear-gradient(90deg, rgba(var(--theme-rgb), 0.24), rgba(4, 10, 20, 0.82)),
        #0b1321;
      padding: 10px 12px 11px;
      box-shadow: inset 0 0 22px rgba(var(--theme-rgb), 0.11);
    }

    .statement-note-label {
      color: #d8deff;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: 1.6px;
      text-transform: uppercase;
    }

    .statement-note-copy {
      margin-top: 5px;
      color: #ffffff;
      font-size: 17px;
      line-height: 1.15;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .7px;
    }

    .mini-stat-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      margin-top: 8px;
    }

    .discussion-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 22px;
    }

    .discussion-stats .mini-stat:nth-child(3) {
      grid-column: 1 / -1;
    }

    .mini-stat {
      min-height: 58px;
      border: 1px solid rgba(var(--theme-rgb), 0.36);
      border-radius: 3px;
      background: rgba(4, 10, 20, 0.78);
      display: grid;
      place-items: center;
      padding: 8px 5px;
      text-align: center;
      min-width: 0;
      overflow: hidden;
    }

    .mini-stat span {
      color: #9fb0c9;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 1.7px;
      text-transform: uppercase;
    }

    .mini-stat strong {
      display: block;
      margin-top: 3px;
      color: #fff;
      font-size: 22px;
      line-height: 1;
      font-weight: 950;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: clip;
      white-space: nowrap;
    }

    .mini-stat strong.is-long {
      font-size: 18px;
      letter-spacing: -0.2px;
    }

    .mini-stat strong.is-extra-long {
      font-size: 14px;
      letter-spacing: -0.55px;
    }

    .mini-stat small {
      font-size: 12px;
      margin-left: 2px;
    }

    .action {
      margin-top: 8px;
      padding: 0;
      border-radius: 5px;
      background: #0c1622;
      border: 1px solid rgba(255, 255, 255, 0.07);
      overflow: hidden;
    }

    .action-title {
      border-left: 5px solid var(--accent);
      padding: 12px 14px;
      font-size: 17px;
      letter-spacing: 1.4px;
      font-weight: 900;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .action-copy {
      padding: 13px 14px 9px;
      font-family: "WeatherPower Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 18px;
      line-height: 1.35;
      font-weight: 700;
      color: #ecf3ff;
      max-height: 150px;
      overflow: hidden;
    }

    .watch-action {
      margin-top: 24px;
    }

    .card.is-watch .action-copy {
      font-size: 19px;
      line-height: 1.45;
      max-height: 210px;
    }

    .watch-stat-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 26px;
    }

    .pds-watch-note {
      margin-top: 16px;
      border: 2px solid #ffffff;
      border-radius: 4px;
      padding: 10px 12px;
      color: #ffffff;
      background: rgba(var(--theme-rgb), 0.32);
      box-shadow: inset 0 0 24px rgba(var(--theme-rgb), 0.18), 0 0 18px rgba(var(--theme-rgb), 0.2);
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.15;
      font-weight: 950;
      letter-spacing: 1.4px;
      text-align: center;
      text-transform: uppercase;
    }

    .card.is-pds .watch-stat-grid {
      margin-top: 10px;
    }

    .watch-stat {
      border: 1px solid rgba(var(--theme-rgb), 0.48);
      border-radius: 3px;
      background: rgba(var(--theme-rgb), 0.09);
      min-height: 64px;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 8px;
    }

    .watch-stat span,
    .prob-title {
      color: #9fb0c9;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .watch-stat strong {
      display: block;
      color: #fff;
      font-size: 30px;
      line-height: 1;
      font-weight: 950;
    }

    .tropical-identity {
      margin-top: 18px;
      border: 1px solid rgba(var(--theme-rgb), 0.64);
      border-left: 5px solid var(--accent);
      border-radius: 4px;
      padding: 13px 14px 12px;
      background:
        linear-gradient(135deg, rgba(var(--theme-rgb), 0.24), rgba(5, 12, 22, 0.88)),
        #091321;
      box-shadow: inset 0 0 26px rgba(var(--theme-rgb), 0.12);
    }

    .tropical-identity span,
    .tropical-identity b,
    .tropical-stat span,
    .tropical-guidance span {
      display: block;
      color: #a9b8cb;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10px;
      line-height: 1.15;
      font-weight: 900;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    .tropical-identity strong {
      display: block;
      margin-top: 5px;
      color: #fff;
      font-size: 28px;
      line-height: 1;
      font-weight: 950;
      text-transform: uppercase;
    }

    .tropical-identity b {
      margin-top: 7px;
      color: var(--accent);
    }

    .tropical-stat-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
    }

    .tropical-stat {
      min-width: 0;
      min-height: 66px;
      border: 1px solid rgba(var(--theme-rgb), 0.38);
      border-radius: 3px;
      display: grid;
      align-content: center;
      justify-items: center;
      padding: 7px 4px;
      overflow: hidden;
      text-align: center;
      background: rgba(5, 12, 22, 0.8);
    }

    .tropical-stat strong {
      display: block;
      max-width: 100%;
      margin-top: 5px;
      overflow: hidden;
      color: #fff;
      font-size: 18px;
      line-height: 1;
      font-weight: 950;
      white-space: nowrap;
    }

    .tropical-stat small {
      font-size: 10px;
    }

    .tropical-guidance {
      margin-top: 8px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 4px;
      padding: 10px 12px;
      background: #0d1725;
    }

    .tropical-guidance strong {
      display: block;
      margin-top: 5px;
      color: #eff6ff;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 850;
    }

    .tropical-action {
      margin-top: 8px;
    }

    .card.is-tropical .action-copy {
      max-height: 122px;
      font-size: 16px;
      line-height: 1.35;
    }

    .cone-note {
      margin-top: 8px;
      border-left: 3px solid var(--accent);
      padding: 7px 0 7px 10px;
      color: #b7c5d6;
      font-family: "WeatherPower Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 650;
    }

    .card.is-forecast .sidebar {
      background:
        linear-gradient(180deg, rgba(9, 30, 56, 0.98), rgba(5, 13, 25, 0.99)),
        #07101d;
    }

    .forecast-sidebar {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 18px;
    }

    .forecast-sidebar .badge-row {
      margin-bottom: 0;
    }

    .forecast-date {
      color: #ffffff;
      font-size: 35px;
      line-height: 1.04;
      text-transform: none;
    }

    .forecast-condition {
      border: 1px solid rgba(101, 210, 255, 0.54);
      border-radius: 4px;
      padding: 14px;
      background:
        linear-gradient(135deg, rgba(42, 154, 218, 0.28), rgba(7, 22, 49, 0.74)),
        #0b1d36;
      box-shadow: inset 0 0 28px rgba(82, 197, 255, 0.09);
    }

    .forecast-kicker,
    .forecast-temperature-grid span,
    .forecast-facts span,
    .forecast-source {
      display: block;
      color: #a7c4d9;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 1.2px;
      text-transform: uppercase;
    }

    .forecast-condition strong {
      display: block;
      margin-top: 7px;
      color: #f7fbff;
      font-family: "WeatherPower Sans", Inter, system-ui, sans-serif;
      font-size: 28px;
      line-height: 1.05;
      font-weight: 850;
    }

    .forecast-temperature-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }

    .forecast-temperature-grid > div,
    .forecast-facts > div {
      min-width: 0;
      border: 1px solid rgba(101, 210, 255, 0.2);
      border-radius: 4px;
      padding: 11px 10px;
      background: rgba(4, 13, 25, 0.54);
    }

    .forecast-temperature-grid strong {
      display: block;
      margin-top: 4px;
      color: #ffffff;
      font-size: 38px;
      line-height: .95;
      font-weight: 900;
    }

    .forecast-temperature-grid strong small {
      margin-left: 1px;
      color: var(--accent);
      font-size: 16px;
      vertical-align: top;
    }

    .forecast-facts {
      display: grid;
      grid-template-columns: 1fr;
      gap: 7px;
    }

    .forecast-facts strong {
      display: block;
      margin-top: 4px;
      color: #f6fbff;
      font-family: "WeatherPower Sans", Inter, system-ui, sans-serif;
      font-size: 18px;
      line-height: 1.18;
      font-weight: 780;
      overflow-wrap: anywhere;
    }

    .forecast-action {
      margin-top: 0;
    }

    .forecast-action .action-copy {
      max-height: 138px;
    }

    .forecast-source {
      margin-top: auto;
      border-top: 1px solid rgba(101, 210, 255, 0.2);
      padding-top: 10px;
      color: #80b4d2;
      line-height: 1.45;
    }

    .probabilities {
      margin-top: 8px;
    }

    .probability-copy {
      padding: 8px 0 10px;
    }

    .prob-group {
      padding: 0 0 9px;
    }

    .prob-title {
      padding: 0 0 5px;
    }

    .prob-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .prob-chip {
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.07);
      color: #b8c7dc;
      padding: 6px 8px;
      font-family: "WeatherPower Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      line-height: 1;
      font-weight: 700;
    }

    .prob-chip strong {
      color: var(--accent);
      font-size: 15px;
      margin-right: 3px;
    }

    .concern-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .concern-list li {
      margin: 0 0 12px;
    }

    .concern-list li::before {
      content: "• ";
      color: #fff;
    }

    .discussion-area {
      margin-top: 8px;
      font-size: 13px;
      line-height: 1.35;
    }

    .location-section {
      margin-top: auto;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .card.has-tornado-id .sidebar-top {
      padding-top: 16px;
    }

    .card.has-tornado-id .hazard-card {
      min-height: 72px;
      margin-top: 14px;
    }

    .card.has-tornado-id .hazard-label {
      margin-bottom: 3px;
    }

    .card.has-tornado-id .hail {
      font-size: 28px;
    }

    .card.has-tornado-id .hail-sub {
      margin-top: 3px;
    }

    .card.has-tornado-id .mini-stat-grid {
      margin-top: 8px;
    }

    .card.has-tornado-id .action-copy {
      max-height: 102px;
      font-size: 16px;
      line-height: 1.3;
    }

    .card.has-tornado-id .overview-wrap {
      height: 142px;
    }

    .section-title {
      border-left: 5px solid var(--accent);
      padding: 11px 12px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      background: rgba(3, 8, 15, 0.8);
    }

    .overview-wrap {
      height: 185px;
      position: relative;
      background:
        radial-gradient(circle at 50% 42%, rgba(var(--theme-rgb), 0.14), transparent 20%),
        linear-gradient(180deg, #091727, #050c16);
      overflow: hidden;
    }

    #overview {
      position: absolute;
      inset: 0;
      filter: saturate(0.78) brightness(0.82) contrast(1.08);
    }

    .overview-wrap::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(2, 6, 13, 0.08), rgba(2, 6, 13, 0.22)),
        radial-gradient(circle at 50% 48%, rgba(var(--theme-rgb), 0.16), transparent 20%);
      box-shadow: inset 0 0 0 1px rgba(95, 130, 170, 0.22);
      z-index: 2;
    }

    .overview-label {
      position: absolute;
      left: 22px;
      bottom: 16px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: rgba(190, 209, 230, 0.9);
      letter-spacing: 1px;
      z-index: 3;
    }

    .map-panel {
      position: relative;
      min-width: 0;
      background: #848891;
    }

    #map {
      position: absolute;
      inset: 0;
      background: #17202b;
    }

    .forecast-static-map {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .forecast-center-marker {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 18px;
      height: 18px;
      z-index: 3;
      border: 4px solid #ffffff;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.78), 0 0 20px rgba(var(--theme-rgb), 0.8);
      transform: translate(-50%, -50%);
    }

    .map-fallback {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(rgba(255,255,255,0.22) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px),
        radial-gradient(circle at 70% 22%, rgba(127, 0, 0, 0.58), transparent 18%),
        radial-gradient(circle at 25% 56%, rgba(20, 180, 60, 0.45), transparent 28%),
        #80858e;
      background-size: 155px 155px, 155px 155px, auto, auto, auto;
      color: rgba(255, 255, 255, 0.85);
      display: grid;
      place-items: center;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 1px;
      font-weight: 800;
    }

    .maplibregl-ctrl-bottom-left,
    .maplibregl-ctrl-bottom-right {
      display: none;
    }

    .radar-overlay {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      opacity: 0.06;
      mix-blend-mode: overlay;
      background:
        repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.2) 0 1px, transparent 1px 4px),
        radial-gradient(ellipse at 80% 18%, rgba(var(--theme-rgb), 0.5) 0 8%, transparent 28%);
      filter: blur(0.25px) saturate(1.15);
    }

    .legend {
      position: absolute;
      right: 16px;
      bottom: 16px;
      width: 320px;
      height: 88px;
      background: rgba(3, 5, 11, 0.95);
      border-radius: 4px;
      padding: 13px 18px 12px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
      z-index: 4;
    }

    .legend-bar {
      height: 21px;
      border-radius: 2px;
      background: linear-gradient(90deg, #00b6ff 0%, #00ffd5 18%, #11d948 34%, #e9f80a 52%, #ff9500 68%, #f11717 82%, #d50fff 100%);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }

    .legend-bar.velocity {
      background: linear-gradient(90deg, #f8009c 0%, #f100fe 10%, #00b6ff 20%, #00ff88 31%, #44d734 42%, #787878 50%, #d40a12 60%, #ff7046 73%, #fff7dc 86%, #ac1d11 100%);
    }

    .legend-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 9px;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 900;
      color: #e8edf5;
    }

    .legend-time {
      margin-top: 12px;
      text-align: center;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 1.5px;
      color: #c9cfda;
    }

    .forecast-map-legend {
      height: 76px;
      padding: 12px 16px;
    }

    .forecast-map-key {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: #f4f8ff;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .forecast-map-key span {
      width: 12px;
      height: 12px;
      border: 3px solid #ffffff;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 2px #02050a;
    }

    .forecast-map-legend .legend-time {
      margin-top: 10px;
      font-size: 11px;
    }

    .tropical-legend {
      width: 354px;
      height: 94px;
      padding: 12px 15px 10px;
    }

    .tropical-legend-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .tropical-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #eef5ff;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .tropical-swatch {
      width: 28px;
      height: 11px;
      border: 2px solid #fff;
      border-radius: 2px;
      background: rgba(var(--theme-rgb), 0.45);
      box-shadow: 0 0 0 2px #02050a;
    }

    .tropical-swatch.track {
      height: 4px;
      border: 0;
      border-radius: 0;
      background: #fff;
      box-shadow: 0 0 0 2px #02050a;
    }

    .tropical-swatch.models {
      height: 7px;
      border: 0;
      background: linear-gradient(90deg, #00e5ff, #ffdc2e, #ff5f57, #a78bfa, #22d3a6);
      box-shadow: none;
    }

    .tropical-legend .legend-time {
      margin-top: 18px;
      font-size: 12px;
    }

    .map-caption {
      position: absolute;
      top: 10px;
      left: 14px;
      right: 14px;
      z-index: 5;
      border-radius: 3px;
      padding: 10px 12px;
      background: rgba(6, 8, 13, 0.86);
      color: #f6f8fc;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.35;
      font-weight: 900;
      letter-spacing: 1.1px;
      text-transform: uppercase;
    }

    .footer {
      position: absolute;
      inset: auto 0 0 0;
      height: 42px;
      display: grid;
      grid-template-columns: 400px 1fr 300px;
      align-items: center;
      padding: 0 24px;
      background: #040a12;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      z-index: 10;
      font-family: "WeatherPower Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.5px;
      color: #9dabbd;
      font-weight: 800;
    }

    .footer-center {
      text-align: center;
      opacity: 0.7;
    }

    .footer-right {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      font-family: "WeatherPower Sans", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
      color: #cbd4e0;
    }

    .footer-right .corner-logo {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      margin-left: 0;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }

    .bolt {
      color: #ffc21c;
      font-size: 20px;
      line-height: 1;
      font-weight: 900;
    }

    .ready-probe {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="${cardClass}" id="card">
    <div class="topbar">
      <div class="title-wrap">
        ${logoMarkup}
        <div class="title-copy">
          <div class="title">${escapeHtml(cardHeadline)}</div>
          ${cardArea ? `<div class="title-subline"><span>Affected area</span>${escapeHtml(cardArea)}</div>` : ''}
        </div>
        ${emergencyBanner}
      </div>
      ${rightLogoMarkup}
    </div>
    <div class="layout">
      <aside class="sidebar">
        ${sidebarContent}
      </aside>
      <main class="map-panel">
        <div class="map-fallback" id="fallback">Loading WeatherPower warning map</div>
        <div id="map">${hasForecastStaticMap ? `<img class="forecast-static-map" src="${escapeHtml(staticMapDataUrl)}" alt=""><span class="forecast-center-marker" aria-hidden="true"></span>` : ''}</div>
        ${hasForecastStaticMap ? '' : '<div class="radar-overlay" aria-hidden="true"></div>'}
        ${mapCaption}
        ${isTropicalLayout
          ? `<div class="legend tropical-legend">
              <div class="tropical-legend-row">
                <div class="tropical-legend-item"><span class="tropical-swatch"></span><span>Cone</span></div>
                <div class="tropical-legend-item"><span class="tropical-swatch track"></span><span>NHC Track</span></div>
                <div class="tropical-legend-item"><span class="tropical-swatch models"></span><span>Models</span></div>
              </div>
              <div class="legend-time">ADV ${escapeHtml(tropical.advisoryNumber || 'CURRENT')} · ${escapeHtml(radarLabel)}</div>
            </div>`
          : hasForecastStaticMap
            ? `<div class="legend forecast-map-legend">
                <div class="forecast-map-key"><span></span>Forecast point</div>
                <div class="legend-time">${escapeHtml(times.issuedTime)} · WEATHERPOWER BASE MAP</div>
              </div>`
          : `<div class="legend">
              <div class="legend-bar ${legendIsVelocity ? 'velocity' : 'reflectivity'}"></div>
              <div class="legend-labels">
                ${legendLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}
              </div>
              <div class="legend-time">${escapeHtml(times.issuedTime)} · ${escapeHtml(radarLabel)}</div>
            </div>`}
      </main>
    </div>
    <footer class="footer">
      <div>weatherpower.app/warningcenter</div>
      <div class="footer-center">${escapeHtml(warning.office)} · ${escapeHtml(footerCardType)}</div>
      <div class="footer-right">${logoDataUrl ? `<img class="corner-logo" src="${logoDataUrl}" alt="WeatherPower">` : '<span class="bolt">↯</span>'}<span>See on <strong>weatherpower.app</strong></span></div>
    </footer>
    <div class="ready-probe" id="ready-probe"></div>
  </div>
  <script>window.__WARNING_CARD_DATA__ = ${payload};</script>
  ${hasForecastStaticMap ? '' : '<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>'}
  <script>
    const data = window.__WARNING_CARD_DATA__;
    const warning = data.warning;
    const mapConfig = data.maps || {};
    const overviewStyle = mapConfig.style || mapConfig.styleUrl;
    const theme = warning.theme || {};
    const warningColor = theme.polygon || theme.accent || '#ff0505';
    const tropical = warning.tropical || {};
    const warningGeometry = data.geometry || {
      type: 'Polygon',
      coordinates: [[...warning.polygon]]
    };

    const polygonGeoJson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          watch: Boolean(warning.classification?.isWatch)
        },
        geometry: warningGeometry
      }]
    };

    const centerPoint = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: warning.center }
      }]
    };

    const fitCardTitle = () => {
      const title = document.querySelector('.title');
      if (!title || title.clientWidth <= 0) return;

      title.classList.remove('is-wrapped');
      title.style.fontSize = '';
      title.style.letterSpacing = '';

      let fontSize = Number.parseFloat(window.getComputedStyle(title).fontSize) || 45;
      while (title.scrollWidth > title.clientWidth + 1 && fontSize > 26) {
        fontSize -= 1;
        title.style.fontSize = fontSize + 'px';
      }

      if (title.scrollWidth > title.clientWidth + 1) {
        title.classList.add('is-wrapped');
        fontSize = Math.min(fontSize, 27);
        title.style.fontSize = fontSize + 'px';
        title.style.letterSpacing = '0px';

        while (title.scrollHeight > 56 && fontSize > 14) {
          fontSize -= 1;
          title.style.fontSize = fontSize + 'px';
        }
      }

      title.dataset.fitMode = title.classList.contains('is-wrapped') ? 'wrapped' : 'single-line';
      title.dataset.fitFontSize = String(Math.round(fontSize));
    };

    fitCardTitle();
    if (document.fonts?.ready) {
      document.fonts.ready.then(fitCardTitle).catch(() => {});
    }

    const finish = () => {
      fitCardTitle();
      window.__CARD_READY = true;
      document.getElementById('ready-probe').dataset.ready = 'true';
    };

    const addRadarLayer = (map, id, tileUrl, opacity) => {
      if (!tileUrl || map.getSource(id)) return;
      map.addSource(id, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        scheme: 'xyz'
      });
      const firstSymbolLayer = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
      map.addLayer({
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': opacity,
          'raster-resampling': 'nearest'
        }
      }, firstSymbolLayer);
    };

    const addRadarLayers = (map) => {
      const radar = warning.radar || {};
      const mode = radar.mode || 'reflectivity';
      if (mode === 'reflectivity' || mode === 'both') {
        addRadarLayer(map, 'nexrad-reflectivity', radar.reflectivityTileUrl, Number(radar.reflectivityOpacity || 0.62));
      }
      if ((mode === 'velocity' || mode === 'both') && radar.velocityTileUrl) {
        addRadarLayer(map, 'nexrad-velocity', radar.velocityTileUrl, Number(radar.velocityOpacity || 0.68));
      }
    };

    const hasFeatures = (collection) => Boolean(collection?.features?.some((feature) => feature?.geometry));

    const addTropicalLayers = (map) => {
      if (hasFeatures(tropical.cone)) {
        map.addSource('nhc-cone', { type: 'geojson', data: tropical.cone });
        map.addLayer({
          id: 'nhc-cone-fill',
          type: 'fill',
          source: 'nhc-cone',
          paint: {
            'fill-color': warningColor,
            'fill-opacity': 0.24
          }
        });
        map.addLayer({
          id: 'nhc-cone-shadow',
          type: 'line',
          source: 'nhc-cone',
          paint: {
            'line-color': '#000000',
            'line-width': 9,
            'line-opacity': 0.9
          }
        });
        map.addLayer({
          id: 'nhc-cone-outline',
          type: 'line',
          source: 'nhc-cone',
          paint: {
            'line-color': '#ffffff',
            'line-width': 5,
            'line-opacity': 0.96
          }
        });
        map.addLayer({
          id: 'nhc-cone-accent',
          type: 'line',
          source: 'nhc-cone',
          paint: {
            'line-color': warningColor,
            'line-width': 2.2,
            'line-opacity': 1
          }
        });
      }

      if (hasFeatures(tropical.modelTracks)) {
        map.addSource('nhc-model-tracks', { type: 'geojson', data: tropical.modelTracks });
        map.addLayer({
          id: 'nhc-model-tracks',
          type: 'line',
          source: 'nhc-model-tracks',
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#00e5ff'],
            'line-width': ['match', ['get', 'kind'], 'ensemble', 1.2, 2],
            'line-opacity': ['match', ['get', 'kind'], 'ensemble', 0.48, 0.78]
          }
        });
      }

      if (hasFeatures(tropical.forecastTrack)) {
        map.addSource('nhc-forecast-track', { type: 'geojson', data: tropical.forecastTrack });
        map.addLayer({
          id: 'nhc-track-shadow',
          type: 'line',
          source: 'nhc-forecast-track',
          paint: {
            'line-color': '#000000',
            'line-width': 9,
            'line-opacity': 0.92
          }
        });
        map.addLayer({
          id: 'nhc-track',
          type: 'line',
          source: 'nhc-forecast-track',
          paint: {
            'line-color': '#ffffff',
            'line-width': 4.5,
            'line-opacity': 1
          }
        });
      }

      if (hasFeatures(tropical.forecastPoints)) {
        map.addSource('nhc-forecast-points', { type: 'geojson', data: tropical.forecastPoints });
        map.addLayer({
          id: 'nhc-forecast-points',
          type: 'circle',
          source: 'nhc-forecast-points',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'tau'], 0], 9, 5],
            'circle-color': [
              'match',
              ['get', 'stormtype'],
              'HU', '#ef1743',
              'MH', '#ef1743',
              'TY', '#ef1743',
              'TS', '#ff9500',
              'TD', '#27c7e7',
              '#ffffff'
            ],
            'circle-stroke-color': '#05080d',
            'circle-stroke-width': 2
          }
        });
        map.addLayer({
          id: 'nhc-current-storm-label',
          type: 'symbol',
          source: 'nhc-forecast-points',
          filter: ['==', ['get', 'tau'], 0],
          layout: {
            'text-field': ['coalesce', ['get', 'stormname'], 'Tropical Cyclone'],
            'text-size': 17,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.35],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#05080d',
            'text-halo-width': 2
          }
        });
      }

      if (hasFeatures(tropical.watchWarning)) {
        map.addSource('nhc-watch-warning', { type: 'geojson', data: tropical.watchWarning });
        map.addLayer({
          id: 'nhc-watch-warning-shadow',
          type: 'line',
          source: 'nhc-watch-warning',
          paint: {
            'line-color': '#000000',
            'line-width': 9,
            'line-opacity': 0.95
          }
        });
        map.addLayer({
          id: 'nhc-watch-warning',
          type: 'line',
          source: 'nhc-watch-warning',
          paint: {
            'line-color': [
              'match',
              ['get', 'tcww'],
              'HWR', '#ef1743',
              'HWA', '#ff4fbe',
              'TWR', '#ff9500',
              'TWA', '#ffe13b',
              'SSW', '#a98cff',
              'SSA', '#70b5ff',
              warningColor
            ],
            'line-width': 5,
            'line-opacity': 1
          }
        });
      }
    };

    const addWarningLayers = (map) => {
      if (map.getSource('warning-polygon')) return;
      if (warning.cardLayout === 'forecast' || warning.classification?.isForecast) {
        map.addSource('forecast-location', { type: 'geojson', data: centerPoint });
        map.addLayer({
          id: 'forecast-location-halo',
          type: 'circle',
          source: 'forecast-location',
          paint: {
            'circle-radius': 16,
            'circle-color': warningColor,
            'circle-opacity': 0.22
          }
        });
        map.addLayer({
          id: 'forecast-location-dot',
          type: 'circle',
          source: 'forecast-location',
          paint: {
            'circle-radius': 7,
            'circle-color': '#ffffff',
            'circle-stroke-color': warningColor,
            'circle-stroke-width': 4
          }
        });
        return;
      }
      map.addSource('warning-polygon', { type: 'geojson', data: polygonGeoJson });
      map.addLayer({
        id: 'warning-fill',
        type: 'fill',
        source: 'warning-polygon',
        paint: {
          'fill-color': warningColor,
          'fill-opacity': 0.16
        }
      });
      map.addLayer({
        id: 'warning-outline-shadow',
        type: 'line',
        source: 'warning-polygon',
        paint: {
          'line-color': '#000000',
          'line-width': ['case', ['==', ['get', 'watch'], true], 4, 12],
          'line-opacity': ['case', ['==', ['get', 'watch'], true], 0.72, 0.95]
        }
      });
      map.addLayer({
        id: 'warning-outline-white',
        type: 'line',
        source: 'warning-polygon',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['==', ['get', 'watch'], true], 0, 7],
          'line-opacity': 0.92
        }
      });
      map.addLayer({
        id: 'warning-outline-red',
        type: 'line',
        source: 'warning-polygon',
        paint: {
          'line-color': warningColor,
          'line-width': ['case', ['==', ['get', 'watch'], true], 2.8, 5],
          'line-opacity': 1
        }
      });
    };

    const addOverviewLayers = (map) => {
      if (map.getSource('warning-center')) return;
      map.addSource('warning-center', { type: 'geojson', data: centerPoint });
      map.addLayer({
        id: 'warning-glow',
        type: 'circle',
        source: 'warning-center',
        paint: {
          'circle-radius': 16,
          'circle-color': warningColor,
          'circle-opacity': 0.22,
          'circle-blur': 0.8
        }
      });
      map.addLayer({
        id: 'warning-dot',
        type: 'circle',
        source: 'warning-center',
        paint: {
          'circle-radius': 4,
          'circle-color': warningColor,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5
        }
      });
    };

    const initMap = () => {
      if (document.querySelector('.forecast-static-map')) {
        document.getElementById('fallback').style.display = 'none';
        setTimeout(finish, 80);
        return;
      }
      if (!overviewStyle || !window.maplibregl) {
        document.getElementById('fallback').textContent = 'WeatherPower map style unavailable';
        finish();
        return;
      }

      const map = new maplibregl.Map({
        container: 'map',
        style: overviewStyle,
        center: warning.center,
        zoom: warning.zoom || 8.5,
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true
      });
      window.__WP_WARNING_MAP__ = map;

      const overviewContainer = document.getElementById('overview');
      const overview = overviewContainer ? new maplibregl.Map({
        container: 'overview',
        style: overviewStyle,
        center: warning.center,
        zoom: warning.overviewZoom || 3.35,
        interactive: false,
        attributionControl: false,
        preserveDrawingBuffer: true
      }) : null;
      window.__WP_OVERVIEW_MAP__ = overview;

      let loaded = 0;
      const targetLoads = overview ? 2 : 1;
      const forecastFastPath = warning.cardLayout === 'forecast' || warning.classification?.isForecast;
      const markLoaded = () => {
        loaded += 1;
        if (loaded === targetLoads) {
          document.getElementById('fallback').style.display = 'none';
          setTimeout(finish, 650);
        }
      };

      map.on('load', () => {
        addRadarLayers(map);
        addTropicalLayers(map);
        addWarningLayers(map);
        map.fitBounds(data.bounds, {
          padding: { top: 70, right: 70, bottom: 110, left: 70 },
          maxZoom: warning.classification?.isTropical ? 6.6 : 10.2,
          duration: 0
        });
        if (forecastFastPath) {
          setTimeout(markLoaded, 900);
        } else {
          map.once('idle', markLoaded);
        }
      });

      if (overview) {
        overview.on('load', () => {
          addOverviewLayers(overview);
          overview.once('idle', markLoaded);
        });
      }

      map.on('error', () => setTimeout(finish, 1500));
      if (overview) overview.on('error', () => setTimeout(finish, 1500));
      setTimeout(finish, forecastFastPath ? 5500 : 10000);
    };

    initMap();
  </script>
</body>
</html>`;
};
