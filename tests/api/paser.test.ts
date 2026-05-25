import axios from 'axios';
import { PaserClient } from '../../src/api/paser';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockGet = jest.fn();
const mockPost = jest.fn();

let capturedRequestCb: ((cfg: unknown) => unknown) | undefined;
let capturedResponseSuccessCb: ((res: unknown) => unknown) | undefined;
let capturedResponseErrorCb: ((err: unknown) => Promise<unknown>) | undefined;

const requestInterceptorUse = jest.fn((cb: (cfg: unknown) => unknown) => { capturedRequestCb = cb; });
const responseInterceptorUse = jest.fn((successCb: (res: unknown) => unknown, errorCb: (err: unknown) => Promise<unknown>) => {
  capturedResponseSuccessCb = successCb;
  capturedResponseErrorCb = errorCb;
});

mockedAxios.create.mockReturnValue({
  get: mockGet,
  post: mockPost,
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: {
    request: { use: requestInterceptorUse },
    response: { use: responseInterceptorUse },
  },
} as unknown as ReturnType<typeof axios.create>);

const client = new PaserClient('https://app.paser.io');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PaserClient.authenticate', () => {
  it('returns user and session cookie when set-cookie is present', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 1,
        email: 'user@company.com',
        accounts: [{ accountId: 90, accountName: 'Acme', userInAccountId: 10 }],
      },
      headers: {
        'set-cookie': ['SessionId=abc; Path=/; HttpOnly'],
      },
    });

    const auth = await client.authenticate('user@company.com', 'secret');
    expect(auth.user.email).toBe('user@company.com');
    expect(auth.sessionCookie).toContain('SessionId=abc');
  });

  it('handles missing set-cookie without failing', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 1,
        email: 'user@company.com',
        accounts: [{ accountId: 90, accountName: 'Acme', userInAccountId: 10 }],
      },
      headers: {},
    });

    const auth = await client.authenticate('user@company.com', 'secret');
    expect(auth.sessionCookie).toBeUndefined();
  });
});

describe('PaserClient.fetchSessionCookieFromPermissions', () => {
  it('returns cookie from follow-up endpoint', async () => {
    mockGet.mockResolvedValueOnce({
      headers: {
        'set-cookie': ['SessionId=from-permissions; Path=/; HttpOnly'],
      },
    });

    const cookie = await client.fetchSessionCookieFromPermissions(90);
    expect(cookie).toContain('SessionId=from-permissions');
    expect(mockGet).toHaveBeenCalledWith('/api/90/userpermissions/', { params: { ps: 1 } });
  });
});

describe('PaserClient.getCases', () => {
  it('supports array response format', async () => {
    mockGet.mockResolvedValueOnce({
      data: [{ id: 1, title: 'Vacation, User (01.05.2026 - 02.05.2026)' }],
    });

    const results = await client.getCases({ accountId: 90, from: '2026-05-01', to: '2026-05-31' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('supports object response format and paginates', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          results: Array.from({ length: 2 }, (_, idx) => ({
            id: idx + 1,
            title: `Vacation, User (0${idx + 1}.05.2026 - 0${idx + 1}.05.2026)`,
          })),
        },
      })
      .mockResolvedValueOnce({ data: { results: [] } });

    const results = await client.getCases({
      accountId: 90,
      from: '2026-05-01',
      to: '2026-05-31',
      pageSize: 2,
    });

    expect(results).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('handles a completely empty / unexpected response shape', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    const results = await client.getCases({ accountId: 90, from: '2026-05-01', to: '2026-05-31' });
    expect(results).toEqual([]);
  });
});

describe('PaserClient constructor with initial sessionCookie', () => {
  it('sets the cookie header immediately when passed to the constructor', () => {
    const mockDefaultsHeaders = { common: {} as Record<string, string> };
    mockedAxios.create.mockReturnValueOnce({
      get: mockGet,
      post: mockPost,
      defaults: { headers: mockDefaultsHeaders },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as ReturnType<typeof axios.create>);

    new PaserClient('https://app.paser.io', 'SessionId=initial; Path=/');
    expect(mockDefaultsHeaders.common.Cookie).toBe('SessionId=initial; Path=/');
  });
});

describe('PaserClient.testConnection', () => {
  it('returns auth result with session cookie when authenticate succeeds directly', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 1,
        email: 'user@company.com',
        accounts: [{ accountId: 90, accountName: 'Acme', userInAccountId: 10 }],
      },
      headers: { 'set-cookie': ['SessionId=direct; Path=/'] },
    });

    const result = await client.testConnection('user@company.com', 'secret');
    expect(result.sessionCookie).toContain('SessionId=direct');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to fetchSessionCookieFromPermissions when authenticate returns no cookie', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: 1,
        email: 'user@company.com',
        accounts: [{ accountId: 90, accountName: 'Acme', userInAccountId: 10 }],
      },
      headers: {},
    });
    mockGet.mockResolvedValueOnce({
      headers: { 'set-cookie': ['SessionId=from-follow-up; Path=/'] },
    });

    const result = await client.testConnection('user@company.com', 'secret');
    expect(result.sessionCookie).toContain('SessionId=from-follow-up');
    expect(mockGet).toHaveBeenCalledWith('/api/90/userpermissions/', { params: { ps: 1 } });
  });

  it('returns auth result with no cookie when all cookie attempts fail', async () => {
    mockPost.mockResolvedValueOnce({
      data: { id: 1, email: 'user@company.com', accounts: [] },
      headers: {},
    });

    const result = await client.testConnection('user@company.com', 'secret');
    expect(result.sessionCookie).toBeUndefined();
  });
});

describe('PaserClient.authenticate (string set-cookie)', () => {
  it('handles a plain string set-cookie header', async () => {
    mockPost.mockResolvedValueOnce({
      data: { id: 1, email: 'user@company.com', accounts: [] },
      headers: { 'set-cookie': 'SessionId=string-cookie; Path=/' },
    });

    const auth = await client.authenticate('user@company.com', 'secret');
    expect(auth.sessionCookie).toBe('SessionId=string-cookie; Path=/');
  });
});

// ── verbose interceptors ──────────────────────────────────────────────────────

describe('PaserClient verbose interceptors', () => {
  it('request interceptor callback passes config through', () => {
    const cfg = { method: 'post', url: '/api/user/authenticate/' };
    expect(capturedRequestCb!(cfg)).toBe(cfg);
  });

  it('response success interceptor callback returns the response', () => {
    const res = { status: 200, config: { url: '/api/user/authenticate/' } };
    expect(capturedResponseSuccessCb!(res)).toBe(res);
  });

  it('response error interceptor callback rejects with the error', async () => {
    const err = { response: { status: 403 }, config: { url: '/api/user/authenticate/' } };
    await expect(capturedResponseErrorCb!(err)).rejects.toBe(err);
  });

  it('response error interceptor handles network error (no response)', async () => {
    const err = { config: { url: '/api/user/authenticate/' } };
    await expect(capturedResponseErrorCb!(err)).rejects.toBe(err);
  });
});
