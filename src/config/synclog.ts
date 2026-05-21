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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(file, JSON.stringify(Array.from(existing), null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  // Ensure permissions stay strict even when the file already existed.
  try {
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(file, 0o600);
  } catch {
    // Ignore chmod failures and keep sync-log behavior non-fatal.
  }
}

export function isSynced(tempoWorklogId: number): boolean {
  return loadSyncedIds().has(tempoWorklogId);
}
