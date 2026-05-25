import { loadConfig } from '../config/manager';
import { resolveDyceToken } from '../api/msauth';

/**
 * Silently refreshes the Dyce access token (and persists the new token pair).
 * Exits without output on success — designed to be safe to run as a cron job.
 */
export async function runTokenRefresh(): Promise<void> {
  const config = loadConfig();
  await resolveDyceToken(config);
  // Silent on success — cron-friendly
}
