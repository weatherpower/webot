import assert from 'node:assert/strict';
import { readiness } from '../src/config.js';
import { warningCardHtml } from '../src/cardHtml.js';
import { sampleWarning } from '../src/sampleWarning.js';
import { analyzeTornadoId } from '../src/tornadoId.js';
import { classifyAlert } from '../src/themes.js';
import { hasPdsWatchTag } from '../src/spcWatch.js';
import { publicWarningCenterFeed } from '../src/publicFeed.js';
import { displayTimes, normalizeWarning } from '../src/warning.js';
import { fetchDailyForecastCards } from '../src/dailyForecasts.js';
import { forecastSearchQuery } from '../src/forecastSearch.js';
import { areaLineFor, headlineFor, statusTagFor, summaryFor } from '../src/broadcast.js';
import { indexLabelFor, indexValueFor, spcDay1Risk, talliesFor, trackTitle } from '../src/live.js';
import { modelTake } from '../src/models.js';
import { warningShortHtml } from '../src/shortHtml.js';
import { toV3Alert } from '../src/apiV3.js';
import { formatAlertTime } from '../src/warning.js';

const health = readiness();
assert.equal(health.ok, true);
assert.equal(health.maps.renderer, 'MapLibre GL JS');
assert.match(health.maps.styleUrl, /\/maps\/weatherpower\/style\.json/);
assert.equal(health.population.enabled, true);

const html = warningCardHtml({
  warning: sampleWarning,
  mapConfig: {
    styleUrl: health.maps.styleUrl
  }
});

assert.match(html, /TORNADO WARNING IN WISCONSIN/);
assert.match(html, /class="wp-brand">[^]*?WEATHERPOWER\.APP/);
assert.match(html, /maplibre-gl/);
assert.match(html, /WeatherPower Tornado ID/);
assert.match(html, /Rotation detection/);
assert.match(html, /fitTitle/);
assert.match(html, /class="sub"/);
assert.match(html, /Tornado AI/);

const warningWithoutPopulation = normalizeWarning({
  key: 'test:no-population',
  event: 'Severe Thunderstorm Warning',
  title: 'Severe Thunderstorm Warning in Oklahoma',
  state: 'OK',
  areaDesc: 'McCurtain County, Oklahoma',
  center: [-94.8263, 33.8957],
  geometry: {
    type: 'Polygon',
    coordinates: [[[-95, 33.7], [-94.6, 33.7], [-94.6, 34.1], [-95, 34.1], [-95, 33.7]]]
  },
  polygon: [[-95, 33.7], [-94.6, 33.7], [-94.6, 34.1], [-95, 34.1], [-95, 33.7]]
});
assert.equal(warningWithoutPopulation.impacts.people, null);
assert.equal(warningWithoutPopulation.impacts.homes, null);
const noPopulationHtml = warningCardHtml({
  warning: warningWithoutPopulation,
  mapConfig: { styleUrl: health.maps.styleUrl }
});
assert.doesNotMatch(noPopulationHtml, /85,078 PEOPLE/);

const censusWarning = {
  ...warningWithoutPopulation,
  impacts: {
    people: 63439,
    homes: 27377,
    sourceLabel: '2020 CENSUS ESTIMATE'
  }
};
const censusHtml = warningCardHtml({
  warning: censusWarning,
  mapConfig: { styleUrl: health.maps.styleUrl }
});
assert.match(censusHtml, /<strong>63,439<\/strong>/);
assert.match(censusHtml, /27,377 homes/);
assert.match(censusHtml, /2020 CENSUS ESTIMATE/);

const censusWatchClassification = classifyAlert({ event: 'Tornado Watch' });
const censusWatchHtml = warningCardHtml({
  warning: {
    ...censusWarning,
    event: 'Tornado Watch',
    title: 'Tornado Watch in Oklahoma',
    classification: censusWatchClassification,
    theme: censusWatchClassification.theme
  },
  mapConfig: { styleUrl: health.maps.styleUrl }
});
assert.match(censusWatchHtml, /<strong>63,439<\/strong>/);
assert.match(censusWatchHtml, /2020 CENSUS ESTIMATE/);

const fontHtml = warningCardHtml({
  warning: sampleWarning,
  mapConfig: { styleUrl: health.maps.styleUrl },
  fontDataUrls: {
    oswald: 'data:font/woff2;base64,dGVzdA==',
    inter: 'data:font/woff2;base64,dGVzdA=='
  }
});
assert.match(fontHtml, /font-family: "WP Display"/);
assert.match(fontHtml, /data:font\/woff2;base64,dGVzdA==/);

const publicFeed = publicWarningCenterFeed({
  status: 'idle',
  count: 1,
  items: [{
    key: 'test',
    event: 'Tornado Watch',
    geometry: {
      type: 'Polygon',
      coordinates: [Array.from({ length: 200 }, (_, index) => [-100 + index / 100, 35 + index / 100])]
    },
    impacts: censusWarning.impacts,
    whatToDo: 'large private detail'
  }]
});
assert.equal(publicFeed.items.length, 1);
assert.equal(publicFeed.items[0].whatToDo, undefined);
assert.ok(publicFeed.items[0].geometry.coordinates[0].length <= 49);
assert.deepEqual(publicFeed.items[0].impacts, censusWarning.impacts);

const forecastWarning = normalizeWarning({
  key: 'daily-forecast:test',
  event: 'Daily Forecast',
  cardLayout: 'forecast',
  title: 'Idabel, OK Forecast - Friday',
  state: 'OK',
  areaDesc: 'Idabel, OK',
  issuedAt: '2026-08-08T12:00:00.000Z',
  expiresAt: '2026-08-09T00:00:00.000Z',
  center: [-94.8263, 33.8957],
  polygon: [[-95, 33.7], [-94.6, 33.7], [-94.6, 34.1], [-95, 34.1], [-95, 33.7]],
  forecast: { location: 'Idabel, OK', dayLabel: 'Friday, Aug 8', isDaytime: true, high: 91, low: 72, temperatureUnit: 'F', precipitation: 30, wind: 'S 10 mph', shortForecast: 'Partly Sunny', detailedForecast: 'Partly sunny with a chance of showers.' }
});
assert.equal(forecastWarning.classification.isForecast, true);
const forecastHtml = warningCardHtml({ warning: forecastWarning, mapConfig: { styleUrl: health.maps.styleUrl } });
assert.match(forecastHtml, /data-layout="forecast"/);
assert.match(forecastHtml, /Partly Sunny/);
assert.match(forecastHtml, /Rain chance/);
const forecastFeed = publicWarningCenterFeed({ items: [forecastWarning] });
assert.equal(forecastFeed.items[0].cardLayout, 'forecast');
assert.equal(forecastFeed.items[0].classification.isForecast, true);
assert.equal(forecastSearchQuery('  Denver, CO  '), 'Denver, CO');
assert.equal(forecastSearchQuery('Dallas;<script>'), 'Dallas script');
assert.equal(publicWarningCenterFeed({ items: [{ ...forecastWarning, searchResult: true }] }).items[0].searchResult, true);

if (process.env.SMOKE_LIVE_FORECAST === '1') {
  const liveForecast = await fetchDailyForecastCards({ force: true });
  assert.ok(liveForecast.warnings.length > 0);
  assert.ok(liveForecast.warnings.length <= 7);
  assert.ok(liveForecast.warnings.every((item) => item.cardLayout === 'forecast'));
}

const coloradoWarning = normalizeWarning({
  ...sampleWarning,
  state: 'CO',
  timezone: undefined,
  center: [-105.27, 40.02],
  polygon: [[-105.4, 39.9], [-105.1, 39.9], [-105.1, 40.1], [-105.4, 40.1], [-105.4, 39.9]],
  issuedAt: '2026-07-29T01:00:00.000Z',
  expiresAt: '2026-07-29T02:00:00.000Z'
});
assert.equal(coloradoWarning.timezone, 'America/Denver');
assert.match(displayTimes(coloradoWarning).expiresTime, /8:00 PM MDT/);

const arizonaWarning = normalizeWarning({
  ...sampleWarning,
  state: 'AZ',
  timezone: undefined,
  center: [-112.07, 33.45],
  polygon: [[-112.2, 33.3], [-111.9, 33.3], [-111.9, 33.6], [-112.2, 33.6], [-112.2, 33.3]],
  expiresAt: '2026-07-29T02:00:00.000Z'
});
assert.equal(arizonaWarning.timezone, 'America/Phoenix');
assert.match(displayTimes(arizonaWarning).expiresTime, /7:00 PM MST/);

const timezoneFeed = publicWarningCenterFeed({ items: [coloradoWarning] });
assert.equal(timezoneFeed.items[0].timezone, 'America/Denver');

[
  { state: 'NY', center: [-74.0, 40.7], timezone: 'America/New_York' },
  { state: 'CA', center: [-118.24, 34.05], timezone: 'America/Los_Angeles' },
  { state: 'AK', center: [-149.9, 61.22], timezone: 'America/Anchorage' },
  { state: 'HI', center: [-157.86, 21.31], timezone: 'Pacific/Honolulu' },
  { state: 'PR', center: [-66.1, 18.4], timezone: 'America/Puerto_Rico' }
].forEach((example) => {
  const warning = normalizeWarning({
    ...sampleWarning,
    state: example.state,
    timezone: undefined,
    center: example.center,
    polygon: [
      [example.center[0] - 0.1, example.center[1] - 0.1],
      [example.center[0] + 0.1, example.center[1] - 0.1],
      [example.center[0] + 0.1, example.center[1] + 0.1],
      [example.center[0] - 0.1, example.center[1] + 0.1],
      [example.center[0] - 0.1, example.center[1] - 0.1]
    ]
  });
  assert.equal(warning.timezone, example.timezone);
});

const geometrylessColorado = normalizeWarning({
  event: 'Flood Watch',
  state: 'CO',
  timezone: undefined,
  center: null,
  polygon: []
});
assert.equal(geometrylessColorado.timezone, 'America/Denver');

const tornadoId = analyzeTornadoId({
  event: 'Tornado Warning',
  description: 'RADAR CONFIRMED TORNADO DEBRIS SIGNATURE. TIGHT ROTATION.',
  parameters: { tornadoDetection: ['RADAR INDICATED'] },
  certainty: 'Observed'
});
assert.equal(tornadoId.rotation, 100);
assert.equal(tornadoId.tornadoSignal, 100);

const tornadoPossible = analyzeTornadoId({
  event: 'Severe Thunderstorm Warning',
  parameters: { tornadoTag: ['POSSIBLE'] }
});
assert.equal(tornadoPossible.rotation, 76);
assert.equal(tornadoPossible.tornadoSignal, 28);

const tropicalClassification = classifyAlert({ event: 'Hurricane Watch' });
assert.equal(tropicalClassification.family, 'hurricane');
assert.equal(tropicalClassification.isTropical, true);
assert.equal(tropicalClassification.alertTag, 'WATCH');
assert.equal(tropicalClassification.theme.type, 'hurricane-watch');

const tropicalHtml = warningCardHtml({
  warning: {
    ...sampleWarning,
    event: 'Hurricane Warning',
    title: 'Hurricane Warning in Louisiana',
    classification: classifyAlert({ event: 'Hurricane Warning' }),
    hazards: {
      label: 'Hurricane',
      value: 'WARNING',
      subtext: 'Hurricane Bertha',
      hail: ''
    },
    hazardStats: [
      { label: 'Current Wind', value: '85 MPH' },
      { label: 'Pressure', value: '980 MB' },
      { label: 'Movement', value: 'NW 9 MPH' }
    ],
    tropical: {
      name: 'Bertha',
      classificationLabel: 'Hurricane',
      advisoryNumber: '015',
      modelCount: 2,
      modelNames: ['AVNI', 'HFAI'],
      cone: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[[-91, 28], [-89, 29], [-87, 32], [-90, 31], [-91, 28]]]
          }
        }]
      },
      forecastTrack: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[-91, 28], [-89, 29], [-87, 31]] }
        }]
      },
      forecastPoints: { type: 'FeatureCollection', features: [] },
      watchWarning: { type: 'FeatureCollection', features: [] },
      modelTracks: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { model: 'AVNI', color: '#00e5ff', kind: 'model' },
          geometry: { type: 'LineString', coordinates: [[-91, 28], [-88.8, 29.5], [-86.8, 31.5]] }
        }]
      }
    }
  },
  mapConfig: {
    styleUrl: health.maps.styleUrl
  }
});
assert.match(tropicalHtml, /NHC (advisory|latest advisory)/);
assert.match(tropicalHtml, /Hurricane Bertha/);
assert.match(tropicalHtml, /nhc-cone/);
assert.match(tropicalHtml, /nhc-model-tracks/);
assert.match(tropicalHtml, /Dangerous impacts can occur outside the cone/);
assert.match(tropicalHtml, /data-layout="tropical"/);

assert.equal(hasPdsWatchTag('...THIS IS A PARTICULARLY DANGEROUS SITUATION...'), true);
assert.equal(hasPdsWatchTag('Storm Prediction Center PDS Tornado Watch 189'), true);
assert.equal(hasPdsWatchTag('Tornado Watch Number 190'), false);

const pdsWatchClassification = classifyAlert({
  event: 'Tornado Watch',
  description: 'THIS IS A PARTICULARLY DANGEROUS SITUATION'
});
assert.equal(pdsWatchClassification.isPds, true);
assert.equal(pdsWatchClassification.isPdsWatch, true);
assert.equal(pdsWatchClassification.isEmergency, false);
assert.equal(pdsWatchClassification.alertTag, 'PDS WATCH');
assert.equal(pdsWatchClassification.theme.type, 'pds-tornado-watch');

const pdsSevereWatchClassification = classifyAlert({
  event: 'Severe Thunderstorm Watch',
  description: 'THIS IS A PARTICULARLY DANGEROUS SITUATION'
});
assert.equal(pdsSevereWatchClassification.alertTag, 'PDS WATCH');
assert.equal(pdsSevereWatchClassification.theme.type, 'pds-severe-thunderstorm-watch');

const pdsWatchHtml = warningCardHtml({
  warning: {
    ...sampleWarning,
    event: 'Tornado Watch',
    title: 'PDS Tornado Watch in Oklahoma and Texas',
    state: 'OK AND TX',
    description: 'THIS IS A PARTICULARLY DANGEROUS SITUATION',
    classification: pdsWatchClassification,
    theme: pdsWatchClassification.theme,
    watchDetails: {
      number: '189',
      pds: true,
      pdsText: 'Particularly Dangerous Situation',
      probabilities: []
    },
    hazardStats: [
      { label: 'Max Hail', value: '3"' },
      { label: 'Max Wind', value: '80 MPH' }
    ]
  },
  mapConfig: {
    styleUrl: health.maps.styleUrl
  }
});
assert.match(pdsWatchHtml, /PDS TORNADO WATCH IN OKLAHOMA &amp; TEXAS/);
assert.match(pdsWatchHtml, /PARTICULARLY DANGEROUS SITUATION/);
assert.match(pdsWatchHtml, /is-pds/);
assert.doesNotMatch(pdsWatchHtml, /PDS EMERGENCY/);

// Broadcast text shared by cards and shorts.
const kansasFlood = normalizeWarning({
  event: 'Flash Flood Warning', areaDesc: 'Ford, KS', stateCodes: ['KS'], ugc: ['KSC057'], vtecAction: 'NEW',
  classification: classifyAlert({ event: 'Flash Flood Warning', description: 'FLASH FLOOD EMERGENCY' })
});
assert.equal(headlineFor(kansasFlood).full, 'FLASH FLOOD EMERGENCY IN KANSAS');
assert.equal(areaLineFor(kansasFlood), 'FORD COUNTY, KS');
assert.equal(areaLineFor({ areaDesc: 'Bosque, TX; Hill, TX', ugc: ['TXC035', 'TXC217'] }), 'BOSQUE & HILL COUNTIES, TX');
assert.equal(statusTagFor(kansasFlood), 'NEW');
assert.match(formatAlertTime('2026-10-03T02:45:00Z', 'Pacific/Guam'), /ChST$/);

const shortHtml = warningShortHtml({
  warning: kansasFlood,
  radarPlan: { valid: Date.now(), segments: [{ kind: 'reflectivity', legend: 'reflectivity', title: 'RADAR', start: 0, frames: [{ id: 'f0', url: 'x/{z}/{x}/{y}.png', time: Date.now() }], step: 0.3, hold: 1, opacity: 0.8 }] }
});
assert.match(shortHtml, /window\.__seek/);
assert.match(shortHtml, /WEATHERPOWER\.APP/);
assert.match(shortHtml, /FLASH FLOOD EMERGENCY IN<br>KANSAS/);

const v3 = toV3Alert({ ...kansasFlood, key: 'k1', impacts: { people: 27604, homes: 11000 } });
assert.equal(v3.group, 'warnings');
assert.equal(v3.people, 27604);
assert.equal(v3.headline, 'FLASH FLOOD EMERGENCY IN KANSAS');
assert.equal(v3.whatToDo, undefined);

// Live stream: storm-location lead first, then IMPACTS / WHAT sections.
assert.match(summaryFor('At 312 PM CDT, a tornado was located near Dodge City, moving east at 25 mph.\n\nHAZARD...Tornado.'), /^At 312 PM CDT, a tornado/);
assert.equal(summaryFor('* WHAT...Flooding continues.\n\n* IMPACTS...Low water crossings will flood.'), 'Low water crossings will flood.');
assert.equal(summaryFor(''), '');

const liveAlert = (event, extra = {}) => ({ event, group: /watch/i.test(event) ? 'watches' : 'warnings', states: ['KS'], rank: 6, ...extra });
const quietDay = [...Array.from({ length: 70 }, () => liveAlert('Flood Warning')), ...Array.from({ length: 30 }, () => liveAlert('Gale Warning', { states: [] }))];
assert.equal(indexLabelFor(indexValueFor(quietDay)), 'QUIET');
assert.equal(indexLabelFor(indexValueFor([...quietDay, liveAlert('Tornado Warning', { rank: 2 })])), 'ACTIVE');
const outbreak = [...Array.from({ length: 15 }, () => liveAlert('Tornado Warning', { rank: 2 })), ...Array.from({ length: 30 }, () => liveAlert('Severe Thunderstorm Warning'))];
assert.equal(indexLabelFor(indexValueFor(outbreak)), 'SEVERE');
assert.equal(spcDay1Risk([{ group: 'outlooks', eventLabel: 'SPC DAY 1 OUTLOOK', hazards: [{ label: 'RISK', value: 'TSTM' }] }, { group: 'outlooks', eventLabel: 'SPC DAY 1 OUTLOOK', hazards: [{ label: 'RISK', value: 'ENH' }] }]), 'ENH');
const tallies = talliesFor([liveAlert('Tornado Warning'), liveAlert('Severe Thunderstorm Warning'), liveAlert('Flash Flood Warning'), liveAlert('Tornado Watch')]);
assert.deepEqual([tallies.tor, tallies.svr, tallies.ffw, tallies.torWatch], [1, 1, 1, 1]);

// WeBot's model take only uses returned numbers and calls out disagreement.
const agree = modelTake('qpf', 'Total precipitation', 'in', [{ model: 'ecmwf', name: 'ECMWF', value: 1.2 }, { model: 'gfs', name: 'GFS', value: 1.3 }], 'ecmwf', 'Idabel, Oklahoma', 120);
assert.match(agree, /next 5 days/);
assert.match(agree, /ECMWF brings a soaking/);
assert.match(agree, /GFS agrees/);
const split = modelTake('cape', 'CAPE', 'J/kg', [{ model: 'hrrr', name: 'HRRR', value: 3000 }, { model: 'gfs', name: 'GFS', value: 400 }], 'hrrr', 'Dodge City, Kansas', 18);
assert.match(split, /very unstable air/);
assert.match(split, /models disagree/);
assert.match(modelTake('refc', 'Simulated radar', 'dBZ', [{ model: 'hrrr', name: 'HRRR', value: null }], 'hrrr', 'Idabel', 18), /doesn't have/);

// Music file names become "Title — Artist" on stream.
assert.deepEqual(trackTitle('03 - Lofi Guy - Rainy Night.mp3'), { title: 'Rainy Night', artist: 'Lofi Guy' });
assert.deepEqual(trackTitle('storm_chaser_beat.ogg'), { title: 'storm chaser beat', artist: '' });

console.log('Smoke checks passed.');
