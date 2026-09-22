import axios from 'axios';
import * as crypto from 'crypto';
import { Config } from '../config/schema';
import { updateConfig } from '../config/manager';
import { keychainAvailable, setSecret, SECRET_ACCOUNTS } from '../config/keychain';
import { getSessionCookieForDomain, SupportedBrowser } from '../utils/browserCookies';

const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0';

/**
 * Dyce's SPA app registration only allows this origin as a redirect URI —
 * verified live: an /authorize call with prompt=none and a valid AAD SSO
 * cookie 302s back here with ?code=... in the query (response_mode=query).
 */
const DYCE_REDIRECT_URI = 'https://app.dyce.cloud';

function withCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export interface MsTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function getDeviceCode(clientId: string, scope: string): Promise<DeviceCodeInfo> {
  const res = await axios.post<DeviceCodeInfo>(
    `${AUTHORITY}/devicecode`,
    new URLSearchParams({ client_id: clientId, scope }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  timeoutMs = 300_000
): Promise<MsTokenResponse> {
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let pollInterval = interval;

  while (Date.now() < deadline) {
    await sleep(pollInterval * 1000);
    try {
      const res = await axios.post<MsTokenResponse>(
        `${AUTHORITY}/token`,

        new URLSearchParams({
          client_id: clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return res.data;
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) throw err;
      const error = err.response?.data?.error as string | undefined;
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        pollInterval += 5;
        continue;
      }
      throw withCause(
        (err.response?.data?.error_description as string | undefined) ?? err.message,
        err
      );
    }
  }
  throw new Error('Device code flow timed out. Run `aion setup` again to re-authenticate.');
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  scope: string
): Promise<MsTokenResponse> {
  try {
    const res = await axios.post<MsTokenResponse>(
      `${AUTHORITY}/token`,
      new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Required for SPA-registered Azure AD apps (AADSTS9002327):
          // refresh tokens issued to SPAs may only be redeemed via cross-origin requests.
          Origin: 'https://app.dyce.cloud',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Dest': 'empty',
        },
      }
    );
    return res.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const body = err.response.data as Record<string, unknown>;
      const description =
        (body?.error_description as string | undefined) ?? (body?.error as string | undefined);
      throw withCause(description ?? err.message, err);
    }
    throw err;
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Silently re-authenticates against Azure AD using the browser's own AAD SSO
 * session cookie (`login.microsoftonline.com`) — no user interaction. Mirrors
 * exactly what Dyce's own MSAL client does in the browser when its cached
 * refresh token has expired: an `/authorize` call with `prompt=none` succeeds
 * (redirects with a fresh `code`) as long as the AAD session itself is still
 * alive, which lasts far longer than the 24h absolute lifetime of the SPA's
 * refresh tokens. Verified live against a real session on 2026-09-22.
 *
 * Returns null (never throws for "not silently authenticatable") when AAD
 * doesn't redirect with a code — e.g. the SSO session itself has also expired
 * and a real interactive login is required.
 */
export async function silentlyReauthenticateDyce(
  clientId: string,
  scope: string,
  browser: SupportedBrowser
): Promise<MsTokenResponse | null> {
  const cookie = await getSessionCookieForDomain(browser, 'login.microsoftonline.com');
  if (!cookie) return null;

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  const authorizeUrl =
    `${AUTHORITY}/authorize?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: DYCE_REDIRECT_URI,
      scope,
      response_mode: 'query',
      prompt: 'none',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();

  const authRes = await axios.get<string>(authorizeUrl, {
    headers: { Cookie: cookie },
    maxRedirects: 0,
    validateStatus: () => true,
  });

  const location = authRes.headers['location'];
  if (authRes.status !== 302 || !location) return null;

  const code = new URL(location, DYCE_REDIRECT_URI).searchParams.get('code');
  if (!code) return null;

  const tokenRes = await axios.post<MsTokenResponse>(
    `${AUTHORITY}/token`,
    new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DYCE_REDIRECT_URI,
      code_verifier: codeVerifier,
      scope,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://app.dyce.cloud',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Dest': 'empty',
      },
    }
  );
  return tokenRes.data;
}

/**
 * Returns true if the JWT access token is expired or expires within `bufferSeconds`.
 *
 * Default buffer is 2 hours (7200s): the cron runs hourly and SPA access tokens
 * last ~1 hour, so we must refresh proactively to avoid any gap in coverage.
 */
export function isTokenExpired(token: string, bufferSeconds = 7200): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      exp?: number;
    };
    return !payload.exp || Date.now() / 1000 > payload.exp - bufferSeconds;
  } catch {
    return true;
  }
}

/**
 * Returns a valid Dyce access token, refreshing via the stored refresh token if needed.
 * Persists the updated tokens back to config on refresh.
 */
export async function resolveDyceToken(config: Config): Promise<string> {
  if (config.dyce.token && !isTokenExpired(config.dyce.token)) {
    return config.dyce.token;
  }

  let tokenData: MsTokenResponse | null = null;
  let refreshErr: unknown;
  try {
    tokenData = await refreshAccessToken(
      config.dyce.clientId,
      config.dyce.refreshToken,
      config.dyce.scope
    );
  } catch (err) {
    refreshErr = err;
  }

  // The refresh token itself has a 24h absolute lifetime on Dyce's SPA app
  // registration — once it's dead, fall back to silently re-authenticating
  // off the browser's still-alive AAD SSO session, same as the browser does.
  const browser = config.dyce.browser ?? config.peopleforce?.browser;
  let silentErr: unknown;
  if (!tokenData && browser && !config.dyce.silentReauthDisabled) {
    try {
      tokenData = await silentlyReauthenticateDyce(
        config.dyce.clientId,
        config.dyce.scope,
        browser
      );
    } catch (err) {
      // Never let this escape raw — this runs unattended in the hourly cron,
      // where a bare CookieAccessDeniedError/axios error would kill the job
      // with a message that hides both the original refresh failure and the
      // `re-auth-dyce` hint below (and cron often can't read the browser's
      // cookie DB at all — no Full Disk Access grant on a launchd identity).
      silentErr = err;
    }
  }

  if (!tokenData) {
    const silentErrMsg = silentErr instanceof Error ? silentErr.message : String(silentErr);
    const hint = browser
      ? `Silent re-auth via ${browser} also failed${silentErr ? ` (${silentErrMsg})` : ' (your Microsoft SSO session may have expired too)'}. ` +
        'Run `aion config re-auth-dyce` to re-authenticate manually.'
      : 'Run `aion config re-auth-dyce` to re-authenticate — it can now also set up automatic ' +
        'silent re-auth via your browser so this stops happening.';
    throw withCause(
      `Dyce token refresh failed: ${
        refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
      }. ${hint}`,
      refreshErr
    );
  }

  // Write new tokens directly to keychain first, before calling updateConfig.
  // updateConfig calls loadConfig() internally, which overlays keychain values
  // over the in-memory config — if the keychain still holds the old refresh token
  // at that point, it would overwrite the new one. Writing here ensures the
  // keychain is already up-to-date before that read-back happens.
  if (keychainAvailable) {
    try {
      setSecret(SECRET_ACCOUNTS.dyceAccessToken, tokenData.access_token);
      setSecret(SECRET_ACCOUNTS.dyceRefreshToken, tokenData.refresh_token);
    } catch {
      // Non-fatal: updateConfig/saveConfig will persist to the JSON file as fallback.
    }
  }

  updateConfig({
    dyce: {
      ...config.dyce,
      token: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    },
  });

  return tokenData.access_token;
}
