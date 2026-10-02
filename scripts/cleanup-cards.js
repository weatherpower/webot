// One-time backlog cleanup. Keeps every card referenced by the current alert state and anything
// newer than the retention window. Usage: node scripts/cleanup-cards.js [--dry-run] [--hours 24]
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../src/paths.js';
import { cleanupUnusedCards } from '../src/cardCleanup.js';
import { pruneShorts } from '../src/shorts.js';

const dryRun = process.argv.includes('--dry-run');
const hoursIndex = process.argv.indexOf('--hours');
const retentionHours = hoursIndex > -1 ? Number(process.argv[hoursIndex + 1]) : undefined;

const state = JSON.parse(await fs.readFile(path.join(dataDir, 'rendered-alerts.json'), 'utf8').catch(() => '{"items":[]}'));
const result = await cleanupUnusedCards(state.items || [], { force: true, dryRun, retentionHours });
if (!dryRun) await pruneShorts();
console.log(`${dryRun ? 'Would remove' : 'Removed'} ${result.deleted} files (${(result.bytesDeleted / 1073741824).toFixed(2)} GB); kept ${result.kept} cards in use, ${result.skipped} newer or non-card files.`);
