import { loadConfig } from '../config/manager';
import { resolveDyceToken, isTokenExpired } from '../api/msauth';

function cronLog(message: string): void {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${message}\n`);
}

/**
 * Refreshes the Dyce access token (and persists the new token pair).
 * Logs a timestamped line on every run so `aion cron status` always has
 * output to display, even when no refresh was needed.
 */
export async function runTokenRefresh(): Promise<void> {
  const config = loadConfig();

  const needsRefresh = !config.dyce.token || isTokenExpired(config.dyce.token);
  if (!needsRefresh) {
    cronLog('token still valid — no refresh needed');
    return;
  }

  cronLog('access token expired — refreshing…');
  await resolveDyceToken(config);
  cronLog('token refreshed successfully');
}
