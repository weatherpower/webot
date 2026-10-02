// Render one card per product family from live feeds (local preview only; nothing is posted).
import { fetchActiveWarnings } from '../src/nws.js';
import { fetchActiveSpcOutlooks } from '../src/spcOutlooks.js';
import { fetchDailyForecastCards } from '../src/dailyForecasts.js';
import { closeRenderer, renderWarningCardsDirect } from '../src/renderCard.js';
import { sampleWarning } from '../src/sampleWarning.js';

const wanted = process.argv.slice(2);
const [active, outlooks, forecasts] = await Promise.all([
  fetchActiveWarnings({ warningOnly: false }),
  fetchActiveSpcOutlooks().catch(() => ({ warnings: [] })),
  fetchDailyForecastCards().catch(() => ({ warnings: [] }))
]);
const byFamily = new Map();
for (const warning of [...active.warnings, ...outlooks.warnings, ...forecasts.warnings.slice(0, 1)]) {
  const family = `${warning.classification?.family}${warning.classification?.isWatch ? '-watch' : ''}`;
  if (!byFamily.has(family)) byFamily.set(family, warning);
}
const ffw = active.warnings.find((warning) => /flash flood warning/i.test(warning.event));
if (ffw) {
  const { classification, theme, title, ...rest } = ffw;
  byFamily.set('tornado-test', {
    ...rest,
    event: 'Tornado Warning',
    hazardStats: [{ label: 'Tornado', value: 'Radar Indicated' }, { label: 'Hail', value: '1.75 IN' }, { label: 'Wind', value: '70 MPH' }],
    whatToDo: sampleWarning.whatToDo
  });
}
const picks = [...byFamily.entries()].filter(([family]) => !wanted.length || wanted.some((name) => family.includes(name)));
console.log(`Rendering: ${picks.map(([family]) => family).join(', ')}`);
try {
  for (const [family, warning] of picks) {
    const [render] = await renderWarningCardsDirect([warning]);
    console.log(`${family.padEnd(22)} ${render.publicPath}`);
  }
} finally {
  await closeRenderer();
}
