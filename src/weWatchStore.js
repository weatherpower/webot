import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, ensureRuntimeDirs } from './paths.js';

const weWatchPath = path.join(dataDir, 'wewatches.json');

const readStore = async () => {
  await ensureRuntimeDirs();
  try {
    const body = JSON.parse(await fs.readFile(weWatchPath, 'utf8'));
    return Array.isArray(body.items) ? body.items : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const writeStore = async (items) => {
  await ensureRuntimeDirs();
  const tempPath = `${weWatchPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, weWatchPath);
};

const activeFilter = (item, { includeExpired = false, now = Date.now() } = {}) => {
  if (includeExpired) return true;
  if (item.active === false) return false;
  const expires = Date.parse(item.expiresAt || item.expires || '');
  return !Number.isFinite(expires) || expires > now;
};

const cleanId = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

export const listWeWatches = async (options = {}) => {
  const items = await readStore();
  return items.filter((item) => activeFilter(item, options));
};

export const saveWeWatch = async (input = {}) => {
  const items = await readStore();
  const now = new Date().toISOString();
  const id = cleanId(input.id) || `wewatch-${crypto.randomUUID()}`;
  const existing = items.find((item) => item.id === id);
  const next = {
    ...existing,
    ...input,
    id,
    source: 'WeatherPower WeWatch Builder',
    active: input.active !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const withoutExisting = items.filter((item) => item.id !== id);
  const nextItems = [next, ...withoutExisting]
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  await writeStore(nextItems);
  return next;
};

export const deleteWeWatch = async (id) => {
  const clean = cleanId(id);
  const items = await readStore();
  const nextItems = items.filter((item) => item.id !== clean);
  await writeStore(nextItems);
  return { deleted: items.length !== nextItems.length, id: clean };
};
