import fs from 'node:fs/promises';
import { logPath, ensureRuntimeDirs } from './paths.js';

export const appendLog = async (entry) => {
  await ensureRuntimeDirs();
  const safeEntry = {
    id: entry.id || crypto.randomUUID(),
    time: new Date().toISOString(),
    ...entry
  };
  await fs.appendFile(logPath, `${JSON.stringify(safeEntry)}\n`, 'utf8');
  return safeEntry;
};

export const readLogs = async (limit = 100) => {
  await ensureRuntimeDirs();
  try {
    const content = await fs.readFile(logPath, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { time: null, level: 'error', message: 'Unreadable log entry' };
        }
      })
      .slice(-limit)
      .reverse();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};
