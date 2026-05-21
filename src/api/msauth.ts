import axios from 'axios';
import { Config } from '../config/schema';
import { updateConfig } from '../config/manager';

const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0';

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
      process.stderr.write(
        `\n[msauth debug] HTTP ${err.response.status} response body:\n${JSON.stringify(body, null, 2)}\n\n`
      );
      const description =
        (body?.error_description as string | undefined) ?? (body?.error as string | undefined);
      throw withCause(description ?? err.message, err);
    }
    throw err;
  }
}

/** Returns true if the JWT access token is expired or expires within `bufferSeconds`. */
export function isTokenExpired(token: string, bufferSeconds = 300): boolean {
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

  let tokenData: MsTokenResponse;
  try {
    tokenData = await refreshAccessToken(
      config.dyce.clientId,
      config.dyce.refreshToken,
      config.dyce.scope
    );
  } catch (err) {
    throw withCause(
      `Dyce token refresh failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Run `aion setup` to re-authenticate.',
      err
    );
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
