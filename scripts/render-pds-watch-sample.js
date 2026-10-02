import { renderWarningCard } from '../src/renderCard.js';
import { classifyAlert } from '../src/themes.js';

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 6 * 60 * 60 * 1000);
const description = 'THIS IS A PARTICULARLY DANGEROUS SITUATION. Numerous tornadoes are expected with a few intense tornadoes likely.';
const classification = classifyAlert({
  event: 'Tornado Watch',
  description
});

const warning = {
  key: 'sample-pds-tornado-watch-189',
  event: 'Tornado Watch',
  title: 'PDS Tornado Watch in Oklahoma and Texas',
  headline: 'SPC PDS Tornado Watch 189',
  description,
  state: 'OK AND TX',
  areaDesc: 'Western Oklahoma; Northwest Texas',
  office: 'Storm Prediction Center',
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  timezone: 'America/Chicago',
  classification,
  theme: classification.theme,
  hazards: {
    label: 'Tornado',
    value: 'PDS WATCH',
    subtext: 'Numerous tornadoes possible',
    hail: '3"',
    wind: '80 MPH'
  },
  hazardStats: [
    { label: 'Max Hail', value: '3"' },
    { label: 'Max Wind', value: '80 MPH' }
  ],
  watchDetails: {
    number: '189',
    pds: true,
    pdsText: 'Particularly Dangerous Situation',
    probabilities: [
      { group: 'Tornado', label: '2+ tornadoes', value: '90%' },
      { group: 'Tornado', label: '1+ EF2+', value: '70%' },
      { group: 'Hail', label: '10+ severe', value: '80%' },
      { group: 'Wind', label: '10+ severe', value: '80%' }
    ]
  },
  impactLine: 'PDS · SEVERE · IMMEDIATE · LIKELY',
  sourceText: 'SPC PDS WATCH 189 · PARTICULARLY DANGEROUS SITUATION',
  whatToDo: 'This is a particularly dangerous situation. Be ready to take shelter immediately if a warning is issued. Review your safe place now.',
  polygon: [
    [-101.2, 32.9],
    [-99.1, 33.2],
    [-97.2, 35.1],
    [-98.2, 37.0],
    [-100.7, 36.8],
    [-102.0, 35.0],
    [-101.2, 32.9]
  ],
  center: [-99.7, 35.0],
  locations: ['Western Oklahoma', 'Northwest Texas'],
  radar: { mode: 'reflectivity' }
};

const render = await renderWarningCard(warning);
console.log(JSON.stringify({
  title: render.warning.title,
  alertTag: render.warning.classification?.alertTag,
  isPdsWatch: render.warning.classification?.isPdsWatch,
  theme: render.warning.theme?.type,
  filePath: render.filePath,
  publicPath: render.publicPath
}, null, 2));
