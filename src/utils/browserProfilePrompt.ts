import { promptList } from '../ui/prompts';
import { SupportedBrowser, listBrowserProfiles } from './browserCookies';

const AUTO = '__auto__';

/**
 * Asks which browser profile to read cookies from. Returns the profile
 * directory name to store in config, or undefined for "auto" (most recently
 * used profile that has the cookie). Skips the prompt entirely when the browser
 * has fewer than two profiles, since there's nothing to choose between.
 */
export async function promptBrowserProfile(
  browser: SupportedBrowser,
  hint?: string
): Promise<string | undefined> {
  const profiles = listBrowserProfiles(browser);
  if (profiles.length < 2) return undefined;

  const choice = await promptList<string>(
    `Which ${browser} profile are you logged in with?${hint ? ` ${hint}` : ''}`,
    [
      { name: 'Auto — most recently used profile with a session', value: AUTO },
      ...profiles.map((p) => ({
        name: p.name === p.dir ? p.dir : `${p.name} (${p.dir})`,
        value: p.dir,
      })),
    ]
  );
  return choice === AUTO ? undefined : choice;
}
