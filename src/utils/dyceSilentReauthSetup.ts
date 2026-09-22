import { promptList, promptConfirm, printSuccess, printWarning } from '../ui/prompts';
import { showInfoBox } from '../ui/banner';
import { withSpinner } from '../ui/spinner';
import { loadConfig, saveConfig } from '../config/manager';
import { silentlyReauthenticateDyce } from '../api/msauth';
import { SupportedBrowser, BROWSER_CHOICES } from './browserCookies';

/**
 * Dyce's refresh token dies after ~24h, so without this the hourly sync cron
 * will eventually need re-authentication run by hand again, every day. This
 * lets aion silently re-authenticate itself instead by reusing the browser's
 * own Microsoft SSO session cookie — the same one Dyce's web app uses to
 * renew itself silently. See resolveDyceToken in src/api/msauth.ts.
 *
 * Shared by `aion config re-auth-dyce` and the one-time notice shown to
 * existing users on their first sync after this feature shipped (see
 * ensureDyceAutoReauthNotice).
 */
export async function configureDyceSilentReauth(clientId: string, scope: string): Promise<void> {
  const config = loadConfig();
  const currentBrowser = config.dyce.browser ?? config.peopleforce?.browser;

  showInfoBox('Automatic re-auth (optional)', [
    "Dyce's refresh token expires after ~24h, so the hourly sync cron will",
    'eventually need this command run again by hand — unless aion silently',
    "re-authenticates itself using your browser's Microsoft SSO session",
    '(the same one you use to log into Dyce/PeopleForce).',
    '',
    "No extra login needed: this just reads your browser's existing SSO",
    'session cookie whenever the refresh token dies.',
  ]);

  const enabled = !!currentBrowser && !config.dyce.silentReauthDisabled;
  const enable = await promptConfirm(
    enabled
      ? `Keep automatic silent re-auth enabled (currently: ${currentBrowser})?`
      : 'Enable automatic silent re-auth via browser SSO?',
    enabled
  );

  if (!enable) {
    // An explicit flag, not just clearing dyce.browser — currentBrowser can
    // come from the peopleforce.browser fallback, which this must not touch.
    saveConfig({ ...config, dyce: { ...config.dyce, silentReauthDisabled: true } });
    printSuccess('Automatic re-auth disabled');
    return;
  }

  const browser = await promptList<SupportedBrowser>(
    'Which browser are you logged into Microsoft/Dyce with?',
    BROWSER_CHOICES
  );

  let verifiedTokens: { token?: string; refreshToken?: string } = {};
  try {
    const verified = await withSpinner('Verifying silent re-auth works…', () =>
      silentlyReauthenticateDyce(clientId, scope, browser)
    );
    if (verified) {
      printSuccess('Silent re-auth verified — it will kick in automatically when needed');
      // Verifying just minted a fresh, valid token pair — persist it instead
      // of discarding it and leaving the (possibly already-dead) old one in place.
      verifiedTokens = { token: verified.access_token, refreshToken: verified.refresh_token };
    } else {
      printWarning(
        `Could not silently re-authenticate via ${browser} right now (no active SSO session found). ` +
          "Saving the setting anyway — it'll be retried automatically the next time the refresh token expires."
      );
    }
  } catch (err) {
    printWarning(
      `Silent re-auth check failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Saving the setting anyway.'
    );
  }

  saveConfig({
    ...config,
    dyce: { ...config.dyce, ...verifiedTokens, browser, silentReauthDisabled: undefined },
  });
  printSuccess(`Automatic re-auth enabled (${browser})`);
}
