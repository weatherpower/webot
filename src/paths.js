import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, '..');
export const publicDir = path.join(projectRoot, 'public');
export const dataDir = path.join(projectRoot, 'data');
export const cardsDir = path.join(projectRoot, 'cards');
export const chromiumTmpDir = path.join(dataDir, 'chromium-tmp');
export const logPath = path.join(dataDir, 'post-log.jsonl');

export const ensureRuntimeDirs = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(cardsDir, { recursive: true });
  await fs.mkdir(chromiumTmpDir, { recursive: true });
};
