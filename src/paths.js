import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, '..');
export const publicDir = path.join(projectRoot, 'public');
// WARNING_DATA_DIR lets a second (test) server keep its own settings and state.
export const dataDir = process.env.WARNING_DATA_DIR ? path.resolve(process.env.WARNING_DATA_DIR) : path.join(projectRoot, 'data');
export const cardsDir = path.join(projectRoot, 'cards');
export const chromiumTmpDir = path.join(dataDir, 'chromium-tmp');
export const logPath = path.join(dataDir, 'post-log.jsonl');

export const ensureRuntimeDirs = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(cardsDir, { recursive: true });
  await fs.mkdir(chromiumTmpDir, { recursive: true });
};

// Atomic swap of a freshly written temp file into place. On Windows the rename fails with
// EPERM/EBUSY while another handle (a reader, antivirus, indexer) briefly holds the target.
export const replaceFile = async (tempPath, targetPath) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
};
