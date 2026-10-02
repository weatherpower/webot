import { renderWarningShortDirect } from './shortVideo.js';

let input = '';
process.stdin.setEncoding('utf8');

try {
  for await (const chunk of process.stdin) input += chunk;
  const { warning, options } = JSON.parse(input || '{}');
  const result = await renderWarningShortDirect(warning, options || {});
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
