import axios from 'axios';
import {
  getDeviceCode,
  pollForToken,
  refreshAccessToken,
  isTokenExpired,
  resolveDyceToken,
} from '../../src/api/msauth';
import { updateConfig } from '../../src/config/manager';
import { Config } from '../../src/config/schema';

jest.mock('axios');
jest.mock('../../src/config/manager', () => ({
  updateConfig: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedUpdateConfig = updateConfig as jest.Mock;

// Helper: build a minimal JWT with a given exp claim
function makeJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `header.${payload}.signature`;
}

const validConfig: Config = {
  tempo: { token: 't', baseUrl: 'https://api.eu.tempo.io', accountId: 'acc' },
  jira: { baseUrl: 'https://co.atlassian.net', email: 'a@b.com', token: 'j' },
  dyce: {
    clientId: 'client-id',
    scope: 'api://dyce/.default offline_access',
    token: makeJwt(Math.floor(Date.now() / 1000) + 3600), // expires in 1 hour
    refreshToken: 'refresh-token',
    instance: 'inst',
    company: 'co',
    resourceNo: 'EMP01',
  },
  mappings: [],
  vacationPrefixes: [],
  schemaVersion: 1,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// ── isTokenExpired ────────────────────────────────────────────────────────────

describe('isTokenExpired', () => {
  it('returns false for a token expiring in 1 hour', () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a token that already expired', () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) - 60);
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for a token expiring within the default buffer (5 min)', () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 60); // expires in 1 min
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false when expiry is just outside the buffer', () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 400); // > 300s buffer
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a malformed token', () => {
    expect(isTokenExpired('not.a.jwt')).toBe(true);
  });

  it('returns true for a token missing the exp claim', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url');
    expect(isTokenExpired(`h.${payload}.s`)).toBe(true);
  });
});

// ── getDeviceCode ─────────────────────────────────────────────────────────────

describe('getDeviceCode', () => {
  it('posts to the devicecode endpoint and returns the response', async () => {
    const mockResponse = {
      device_code: 'device-code-123',
      user_code: 'ABC123',
      verification_uri: 'https://microsoft.com/devicelogin',
      expires_in: 900,
      interval: 5,
      message: 'Go to https://microsoft.com/devicelogin and enter ABC123',
    };
    mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

    const result = await getDeviceCode('client-id', 'api://scope offline_access');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/devicecode'),
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
    expect(result.user_code).toBe('ABC123');
    expect(result.interval).toBe(5);
  });
});

// ── pollForToken ──────────────────────────────────────────────────────────────

describe('pollForToken', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns token data on success', async () => {
    const tokenResponse = {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expires_in: 3600,
      token_type: 'Bearer',
    };

    mockedAxios.post.mockResolvedValueOnce({ data: tokenResponse });

    const promise = pollForToken('client-id', 'device-code', 1);
    await jest.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result.access_token).toBe('access-123');
    expect(result.refresh_token).toBe('refresh-456');
  });

  it('retries on authorization_pending', async () => {
    const pendingError = Object.assign(new Error('pending'), {
      isAxiosError: true,
      response: { data: { error: 'authorization_pending' } },
    });
    const tokenResponse = {
      access_token: 'access-ok',
      refresh_token: 'refresh-ok',
      expires_in: 3600,
      token_type: 'Bearer',
    };

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post
      .mockRejectedValueOnce(pendingError)
      .mockResolvedValueOnce({ data: tokenResponse });

    const promise = pollForToken('client-id', 'device-code', 1);
    await jest.advanceTimersByTimeAsync(1100); // first sleep → authorization_pending
    await jest.advanceTimersByTimeAsync(1100); // second sleep → success
    const result = await promise;

    expect(result.access_token).toBe('access-ok');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('increases the poll interval on slow_down and then succeeds', async () => {
    const slowDownError = Object.assign(new Error('slow_down'), {
      isAxiosError: true,
      response: { data: { error: 'slow_down' } },
    });
    const tokenResponse = {
      access_token: 'access-ok',
      refresh_token: 'refresh-ok',
      expires_in: 3600,
      token_type: 'Bearer',
    };

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post
      .mockRejectedValueOnce(slowDownError)
      .mockResolvedValueOnce({ data: tokenResponse });

    const promise = pollForToken('client-id', 'device-code', 1);
    await jest.advanceTimersByTimeAsync(1100); // first sleep
    await jest.advanceTimersByTimeAsync(6100); // second sleep (interval bumped to 6s)
    const result = await promise;

    expect(result.access_token).toBe('access-ok');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('throws a timeout error when the deadline is exceeded', async () => {
    const pendingError = Object.assign(new Error('pending'), {
      isAxiosError: true,
      response: { data: { error: 'authorization_pending' } },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue(pendingError);

    // deadline = 500ms; sleep interval = 1s; after 1100ms fake time the sleep
    // resolves, post throws authorization_pending, loop re-checks deadline
    // (1100 > 500) and exits, throwing the "timed out" error.
    const promise = pollForToken('client-id', 'device-code', 1, 500);
    // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning.
    const assertion = expect(promise).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('throws on a non-pending error (with error_description)', async () => {
    const authError = Object.assign(new Error('access_denied'), {
      isAxiosError: true,
      response: { data: { error: 'access_denied', error_description: 'User denied access' } },
    });

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce(authError);

    const promise = pollForToken('client-id', 'device-code', 1);
    const assertion = expect(promise).rejects.toThrow('User denied access');
    await jest.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it('uses err.message as fallback when error_description is absent', async () => {
    const authError = Object.assign(new Error('invalid_request'), {
      isAxiosError: true,
      response: { data: { error: 'invalid_request' } },
    });

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce(authError);

    const promise = pollForToken('client-id', 'device-code', 1);
    const assertion = expect(promise).rejects.toThrow('invalid_request');
    await jest.advanceTimersByTimeAsync(1100);
    await assertion;
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('posts to the token endpoint with refresh_token grant and returns new tokens', async () => {
    const tokenResponse = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    };
    mockedAxios.post.mockResolvedValueOnce({ data: tokenResponse });

    const result = await refreshAccessToken(
      'client-id',
      'old-refresh-token',
      'api://scope offline_access'
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/token'),
      expect.any(URLSearchParams),
      expect.any(Object)
    );
    expect(result.access_token).toBe('new-access');
    expect(result.refresh_token).toBe('new-refresh');
  });
});

// ── refreshAccessToken (HTTP error body) ─────────────────────────────────────

describe('refreshAccessToken (HTTP error handling)', () => {
  it('extracts error_description from the response body', async () => {
    const axiosError = Object.assign(new Error('invalid_grant'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: 'invalid_grant',
          error_description: 'AADSTS70008: The provided refresh token has expired.',
        },
      },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce(axiosError);

    await expect(refreshAccessToken('client-id', 'bad-refresh', 'api://scope')).rejects.toThrow(
      'AADSTS70008: The provided refresh token has expired.'
    );
  });

  it('falls back to error field when error_description is absent', async () => {
    const axiosError = Object.assign(new Error('unauthorized_client'), {
      isAxiosError: true,
      response: { status: 401, data: { error: 'unauthorized_client' } },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValueOnce(axiosError);

    await expect(refreshAccessToken('client-id', 'bad-refresh', 'api://scope')).rejects.toThrow(
      'unauthorized_client'
    );
  });

  it('rethrows non-axios errors as-is', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValueOnce(new Error('Network failure'));

    await expect(refreshAccessToken('client-id', 'refresh', 'api://scope')).rejects.toThrow(
      'Network failure'
    );
  });
});

// ── resolveDyceToken ──────────────────────────────────────────────────────────

describe('resolveDyceToken', () => {
  it('returns the cached token without refreshing when it is still valid', async () => {
    const freshToken = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    const config = { ...validConfig, dyce: { ...validConfig.dyce, token: freshToken } };

    const result = await resolveDyceToken(config);

    expect(result).toBe(freshToken);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedUpdateConfig).not.toHaveBeenCalled();
  });

  it('refreshes and returns a new token when the cached token is expired', async () => {
    const expiredToken = makeJwt(Math.floor(Date.now() / 1000) - 60);
    const newToken = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    const config = { ...validConfig, dyce: { ...validConfig.dyce, token: expiredToken } };

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: newToken,
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });

    const result = await resolveDyceToken(config);

    expect(result).toBe(newToken);
    expect(mockedUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        dyce: expect.objectContaining({ token: newToken, refreshToken: 'new-refresh' }),
      })
    );
  });

  it('refreshes when no token is cached', async () => {
    const newToken = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    const { token: _, ...dyceWithout } = validConfig.dyce;
    const config = { ...validConfig, dyce: { ...dyceWithout } } as Config;

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: newToken,
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });

    const result = await resolveDyceToken(config);
    expect(result).toBe(newToken);
  });

  it('throws a helpful error when the refresh request fails', async () => {
    const expiredToken = makeJwt(Math.floor(Date.now() / 1000) - 60);
    const config = { ...validConfig, dyce: { ...validConfig.dyce, token: expiredToken } };

    mockedAxios.post.mockRejectedValueOnce(new Error('invalid_grant'));

    await expect(resolveDyceToken(config)).rejects.toThrow('aion setup');
  });
});
