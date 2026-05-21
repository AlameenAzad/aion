import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from './manager';

const SYNC_LOG_FILE = () => path.join(getConfigDir(), 'synced.json');

export function loadSyncedIds(): Set<number> {
  const file = SYNC_LOG_FILE();
  if (!fs.existsSync(file)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((x) => typeof x === 'number') as number[]);
  } catch {
    return new Set();
  }
}

export function markSynced(tempoWorklogIds: number[]): void {
  const existing = loadSyncedIds();
  for (const id of tempoWorklogIds) existing.add(id);
  const file = SYNC_LOG_FILE();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Array.from(existing), null, 2), 'utf-8');
}

export function isSynced(tempoWorklogId: number): boolean {
  return loadSyncedIds().has(tempoWorklogId);
}
