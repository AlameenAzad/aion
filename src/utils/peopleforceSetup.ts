import chalk from 'chalk';
import {
  promptText,
  promptList,
  promptConfirm,
  promptPassword,
  printHint,
  printSuccess,
  printError,
} from '../ui/prompts';
import { showInfoBox } from '../ui/banner';
import { withSpinner } from '../ui/spinner';
import { PeopleForceClient } from '../api/peopleforce';
import {
  openPeopleForceLogin,
  getPeopleForceSessionCookie,
  CookieAccessDeniedError,
  SupportedBrowser,
  BROWSER_CHOICES,
} from './browserCookies';

export interface PeopleForceSetupResult {
  baseUrl: string;
  browser?: SupportedBrowser;
  manualCookie?: string;
}

async function verifyCookie(baseUrl: string, cookie: string): Promise<boolean> {
  try {
    await withSpinner('Verifying PeopleForce connection…', () =>
      new PeopleForceClient(baseUrl, cookie).testConnection()
    );
    printSuccess('PeopleForce connection successful');
    return true;
  } catch (err) {
    printError(
      `PeopleForce connection failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/**
 * Manual fallback — no OS permissions needed at all. Session cookie expires
 * and needs re-pasting periodically (there's no refresh token like Dyce has),
 * but this is the only option on machines where Full Disk Access is blocked
 * (common on MDM-managed company laptops).
 */
async function promptManualCookiePaste(baseUrl: string): Promise<string | null> {
  printHint(
    'In the browser tab you just logged into: open DevTools (F12) → Network tab → click any ' +
      'request to this PeopleForce domain → Headers → Request Headers → copy the whole "Cookie" value.'
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    const cookie = await promptPassword(
      'Paste the Cookie header value:',
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );

    if (await verifyCookie(baseUrl, cookie.trim())) {
      return cookie.trim();
    }

    const retry = await promptConfirm('Try pasting again?', true);
    if (!retry) return null;
  }

  return null;
}

/**
 * Interactive PeopleForce setup: open the login page (default OS browser,
 * not one Aion controls), wait for the user to complete Outlook SSO
 * themselves, then either auto-read the resulting session cookie from the
 * browser's local storage or fall back to a manual DevTools paste.
 *
 * Nothing beyond the pasted cookie itself (kept in the OS keychain, same as
 * Paser's password) is ever persisted — the auto-read path re-reads live
 * from the browser on every run instead of storing anything.
 */
export async function promptPeopleForceSetup(
  defaultBaseUrl?: string
): Promise<PeopleForceSetupResult | null> {
  printHint(
    'PeopleForce is per-company: your URL looks like https://<company>.peopleforce.io, not a shared domain.'
  );
  const baseUrl = await promptText(
    'PeopleForce base URL (e.g. https://yourcompany.peopleforce.io):',
    defaultBaseUrl,
    (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return 'Enter a valid URL';
      }
    }
  );

  printHint(
    'Opening PeopleForce login in your default browser — log in via Outlook SSO, then come back here.'
  );
  openPeopleForceLogin(baseUrl);
  await promptConfirm('Press Enter once you are logged in', true);

  showInfoBox('How should aion get your PeopleForce session?', [
    `${chalk.bold('Auto-detect (headless)')} — aion reads the session cookie straight out of`,
    "your browser's own encrypted cookie storage, the same way you're already",
    'logged in. Nothing to repeat: it re-reads live on every sync, so a normal',
    'browser login keeps working automatically. Tradeoff: on macOS this needs',
    '"Full Disk Access" granted to your terminal app (System Settings → Privacy',
    '& Security) — often blocked by MDM on managed company laptops. Linux/Windows',
    'support is best-effort and unverified.',
    '',
    `${chalk.bold('Manual paste')} — you copy the "Cookie" header once from DevTools and`,
    'aion stores it in your OS keychain. Needs zero special permissions and',
    "always works, but the session eventually expires and you'll need to paste",
    'a fresh one (no refresh token, unlike Dyce).',
    '',
    `You can switch modes anytime with: ${chalk.cyan('aion config edit-peopleforce')}`,
  ]);

  const mode = await promptList<'manual' | 'auto'>(
    'How should aion get your PeopleForce session?',
    [
      {
        name: 'Paste session cookie manually (no OS permissions needed, recommended)',
        value: 'manual',
      },
      {
        name: 'Auto-detect from browser (headless — needs OS permissions on macOS)',
        value: 'auto',
      },
    ]
  );

  if (mode === 'manual') {
    const manualCookie = await promptManualCookiePaste(baseUrl);
    return manualCookie ? { baseUrl, manualCookie } : null;
  }

  const browser = await promptList<SupportedBrowser>('Which browser is it in?', BROWSER_CHOICES);

  for (let attempt = 1; attempt <= 3; attempt++) {
    let cookie: string | null;
    try {
      cookie = await getPeopleForceSessionCookie(browser, baseUrl);
    } catch (err) {
      if (err instanceof CookieAccessDeniedError) {
        printError(err.message);
        printHint('Falling back to manual cookie paste instead — no permissions needed.');
        const manualCookie = await promptManualCookiePaste(baseUrl);
        return manualCookie ? { baseUrl, manualCookie } : null;
      }
      throw err;
    }

    if (!cookie) {
      printError(
        `Could not read a PeopleForce session cookie from ${browser}. Make sure you're logged in there.`
      );
      const retry = await promptConfirm('Try again?', true);
      if (!retry) return null;
      continue;
    }

    if (await verifyCookie(baseUrl, cookie)) {
      return { baseUrl, browser };
    }
    const retry = await promptConfirm('Try again?', true);
    if (!retry) return null;
  }

  printHint('Giving up on auto-detect — falling back to manual cookie paste.');
  const manualCookie = await promptManualCookiePaste(baseUrl);
  return manualCookie ? { baseUrl, manualCookie } : null;
}
