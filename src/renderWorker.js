import { closeRenderer, renderWarningCardsDirect } from './renderCard.js';

let input = '';
let shuttingDown = false;

const shutdown = async (exitCode) => {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeRenderer().catch(() => {});
  process.exit(exitCode);
};

process.once('SIGTERM', () => void shutdown(143));
process.once('SIGINT', () => void shutdown(130));

process.stdin.setEncoding('utf8');

try {
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const warnings = JSON.parse(input || '[]');
  const renders = await renderWarningCardsDirect(Array.isArray(warnings) ? warnings : [warnings]);
  process.stdout.write(JSON.stringify(renders));
} catch (error) {
  process.stderr.write(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  await closeRenderer().catch(() => {});
}
