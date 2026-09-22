import { printHint } from '../ui/prompts';
import { Config } from '../config/schema';
import { loadConfig, saveConfig } from '../config/manager';
import { configureDyceSilentReauth } from './dyceSilentReauthSetup';

/**
 * One-time, non-blocking notice for existing users: Dyce can now silently
 * re-authenticate itself via browser SSO instead of needing a manual
 * `re-auth-dyce` DevTools paste roughly every 24h. Shown once
 * (dyceAutoReauthNoticeShown), never repeated, and never forces anything —
 * declining just marks it seen and leaves config.dyce exactly as it was.
 */
export async function ensureDyceAutoReauthNotice(config: Config): Promise<Config> {
  const alreadyConfigured = config.dyce.browser ?? config.peopleforce?.browser;
  if (alreadyConfigured || config.dyceAutoReauthNoticeShown) {
    return config;
  }

  console.log();
  printHint(
    "Dyce's refresh token expires after ~24h — aion can now silently re-authenticate itself " +
      "using your browser's Microsoft SSO session instead of you re-pasting a token from DevTools."
  );

  await configureDyceSilentReauth(config.dyce.clientId, config.dyce.scope);

  const updated: Config = { ...loadConfig(), dyceAutoReauthNoticeShown: true };
  saveConfig(updated);
  return updated;
}
