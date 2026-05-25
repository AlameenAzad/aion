import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_FILE = path.join(os.homedir(), '.aion', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/aion-sync/latest';

interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
}

function readCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // silently ignore write failures
  }
}

function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(NPM_REGISTRY_URL, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`npm registry returned ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { version: string };
          resolve(json.version);
        } catch {
          reject(new Error('Failed to parse npm registry response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('npm registry request timed out'));
    });
  });
}

/**
 * Returns the latest published version of aion-sync from npm, using a 24-hour
 * local cache to avoid hitting the registry on every invocation.
 * Returns null if the check fails for any reason.
 */
export async function getLatestVersion(): Promise<string | null> {
  const cache = readCache();
  const now = Date.now();

  if (cache && now - cache.lastChecked < CHECK_INTERVAL_MS) {
    return cache.latestVersion;
  }

  try {
    const latestVersion = await fetchLatestVersion();
    writeCache({ lastChecked: now, latestVersion });
    return latestVersion;
  } catch {
    return null;
  }
}

/**
 * Compares two semver strings. Returns true if `latest` is strictly newer
 * than `current`. Handles standard "MAJOR.MINOR.PATCH" format.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);

  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Checks npm for a newer version of aion-sync. Returns an update message
 * string if an update is available, or null if up-to-date / check failed.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  const latest = await getLatestVersion();
  if (!latest) return null;
  if (!isNewerVersion(currentVersion, latest)) return null;
  return latest;
}
