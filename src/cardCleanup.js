import fs from 'node:fs/promises';
import path from 'node:path';
import { cardsDir } from './paths.js';
import { config } from './config.js';

const CARD_FILE_RE = /\.(?:png|gif)$/i;

const publicPathToFilename = (publicPath = '') => path.basename(String(publicPath || ''));

export const cleanupUnusedCards = async (items = []) => {
  if (!config.cardCleanup.enabled) {
    return { scanned: 0, kept: 0, deleted: 0, skipped: 0, bytesDeleted: 0, disabled: true };
  }

  const retentionMs = config.cardCleanup.retentionHours * 60 * 60 * 1000;
  const keep = new Set(
    items
      .map((item) => publicPathToFilename(item.card?.path))
      .filter(Boolean)
  );
  const now = Date.now();
  const files = await fs.readdir(cardsDir).catch(() => []);
  const result = {
    scanned: files.length,
    kept: 0,
    deleted: 0,
    skipped: 0,
    bytesDeleted: 0
  };

  for (const file of files) {
    if (!CARD_FILE_RE.test(file)) {
      result.skipped += 1;
      continue;
    }
    if (keep.has(file)) {
      result.kept += 1;
      continue;
    }

    const filePath = path.join(cardsDir, file);
    try {
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs < retentionMs) {
        result.skipped += 1;
        continue;
      }
      await fs.rm(filePath, { force: true });
      result.deleted += 1;
      result.bytesDeleted += stat.size;
    } catch {
      result.skipped += 1;
    }
  }

  return result;
};
