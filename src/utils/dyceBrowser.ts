import { SupportedBrowser } from './browserCookies';

interface DyceBrowserSource {
  dyce: { browser?: SupportedBrowser; browserProfile?: string };
  peopleforce?: { browser?: SupportedBrowser; browserProfile?: string };
}

/**
 * Browser (+ optional Chromium profile) Dyce silent re-auth should read the
 * SSO cookie from: Dyce's own setting wins, else PeopleForce's. The profile
 * always travels with the browser it was chosen for — a Dyce browser with no
 * profile means "auto", never PeopleForce's profile from a different browser.
 */
export function resolveDyceBrowser(
  config: DyceBrowserSource
): { browser: SupportedBrowser; profile?: string } | undefined {
  if (config.dyce.browser) {
    return { browser: config.dyce.browser, profile: config.dyce.browserProfile };
  }
  if (config.peopleforce?.browser) {
    return { browser: config.peopleforce.browser, profile: config.peopleforce.browserProfile };
  }
  return undefined;
}
