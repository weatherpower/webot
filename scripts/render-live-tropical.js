import { fetchActiveWarnings } from '../src/nws.js';
import { renderWarningCard } from '../src/renderCard.js';

const events = [
  'Hurricane Warning',
  'Hurricane Watch',
  'Tropical Storm Warning',
  'Tropical Storm Watch',
  'Storm Surge Warning',
  'Storm Surge Watch',
  'Extreme Wind Warning'
];

let warning;
for (const event of events) {
  const active = await fetchActiveWarnings({ event, limit: 1 });
  if (active.warnings?.length) {
    [warning] = active.warnings;
    break;
  }
}

if (!warning) {
  throw new Error('No active hurricane-related NWS watch or warning is available to render.');
}

const render = await renderWarningCard(warning);
console.log(JSON.stringify({
  event: render.warning.event,
  title: render.warning.title,
  storm: render.warning.tropical?.name,
  advisory: render.warning.tropical?.advisoryNumber,
  modelCount: render.warning.tropical?.modelCount,
  publicPath: render.publicPath,
  filePath: render.filePath
}, null, 2));
