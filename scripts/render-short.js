// Render a warning short from a live NWS alert.
// Usage: node scripts/render-short.js [--event "Flash Flood Warning"] [--format vertical|square] [--duration 15] [--sample]
import { fetchActiveWarnings } from '../src/nws.js';
import { renderWarningShortDirect } from '../src/shortVideo.js';
import { sampleWarning } from '../src/sampleWarning.js';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const PRIORITY = [/tornado warning/i, /severe thunderstorm warning/i, /flash flood warning/i, /warning/i];

const pickWarning = async () => {
  if (process.argv.includes('--sample')) return sampleWarning;
  const event = arg('event');
  const { warnings } = await fetchActiveWarnings({ warningOnly: true, event });
  const withPolygon = warnings.filter((warning) => warning.geometry?.type === 'Polygon');
  for (const pattern of PRIORITY) {
    const match = withPolygon.find((warning) => pattern.test(warning.event));
    if (match) return match;
  }
  if (!warnings.length) throw new Error('No active warnings matched; try --sample');
  return warnings[0];
};

let warning = await pickWarning();
// Preview another product's styling on a live polygon (test only; never posted).
if (arg('as')) {
  const { classification, theme, title, vtecAction, ...rest } = warning;
  warning = {
    ...rest,
    event: arg('as'),
    hazardStats: [{ label: 'Tornado', value: 'Radar Indicated' }, { label: 'Hail', value: '1.75 IN' }, { label: 'Wind', value: '70 MPH' }],
    parameters: { ...(warning.parameters || {}), tornadoDetection: ['RADAR INDICATED'] }
  };
}
console.log(`Rendering short for: ${warning.event} — ${warning.areaDesc}`);
const result = await renderWarningShortDirect(warning, {
  format: arg('format', 'vertical'),
  duration: Number(arg('duration', 15)),
  onProgress: ({ frame, totalFrames }) => process.stdout.write(`\r  frame ${frame}/${totalFrames}`)
});
console.log(`\n${JSON.stringify(result, null, 2)}`);
