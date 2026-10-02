// Removes card images no longer referenced by any active alert, plus leftover state temp files.
// Only files older than CARD_RETENTION_HOURS are removed, and only inside cards/ and data/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cardsDir, dataDir } from './paths.js';
import { config } from './config.js';

const CARD_FILE_RE = /\.(?:png|gif|jpe?g)$/i;
const STATE_TEMP_RE = /^rendered-alerts\.json\.\d+\.\d+\.tmp$|^shorts\.json\.\d+\.tmp$/;
const STATE_CORRUPT_RE = /^rendered-alerts\.corrupt-\d+\.json$/;
const KEEP_CORRUPT_BACKUPS = 3;
const MIN_INTERVAL_MS = 15 * 60 * 1000;

let lastRunAt = 0;
let running = null;

const publicPathToFilename = (publicPath = '') => path.basename(String(publicPath || ''));

const removeFile = async (filePath, result, { dryRun, size }) => {
  if (!dryRun) await fs.rm(filePath, { force: true });
  result.deleted += 1;
  result.bytesDeleted += size;
};

const cleanupStateFiles = async (result, { dryRun }) => {
  const files = await fs.readdir(dataDir).catch(() => []);
  const now = Date.now();
  const corrupt = [];
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    if (STATE_TEMP_RE.test(file)) {
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs > 60 * 60 * 1000) await removeFile(filePath, result, { dryRun, size: stat.size });
    } else if (STATE_CORRUPT_RE.test(file)) {
      corrupt.push(file);
    }
  }
  corrupt.sort().reverse();
  for (const file of corrupt.slice(KEEP_CORRUPT_BACKUPS)) {
    const filePath = path.join(dataDir, file);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat) await removeFile(filePath, result, { dryRun, size: stat.size });
  }
};

export const cleanupUnusedCards = async (items = [], { force = false, dryRun = false, retentionHours } = {}) => {
  if (!config.cardCleanup.enabled && !force) {
    return { scanned: 0, kept: 0, deleted: 0, skipped: 0, bytesDeleted: 0, disabled: true };
  }
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { throttled: true };
  if (running) return running;

  running = (async () => {
    lastRunAt = Date.now();
    const retentionMs = (retentionHours ?? config.cardCleanup.retentionHours) * 60 * 60 * 1000;
    const keep = new Set(items.map((item) => publicPathToFilename(item.card?.path)).filter(Boolean));
    const now = Date.now();
    const files = await fs.readdir(cardsDir, { withFileTypes: true }).catch(() => []);
    const result = { scanned: files.length, kept: 0, deleted: 0, skipped: 0, bytesDeleted: 0, dryRun };

    for (const entry of files) {
      if (!entry.isFile() || !CARD_FILE_RE.test(entry.name)) {
        result.skipped += 1;
        continue;
      }
      if (keep.has(entry.name)) {
        result.kept += 1;
        continue;
      }
      const filePath = path.join(cardsDir, entry.name);
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs < retentionMs) {
          result.skipped += 1;
          continue;
        }
        await removeFile(filePath, result, { dryRun, size: stat.size });
      } catch {
        result.skipped += 1;
      }
    }
    await cleanupStateFiles(result, { dryRun });
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
};
