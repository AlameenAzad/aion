import axios from 'axios';
import { PaserClient } from '../../src/api/paser';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockGet = jest.fn();
const mockPost = jest.fn();

mockedAxios.create.mockReturnValue({
  get: mockGet,
  post: mockPost,
  defaults: { headers: { common: {} as Record<string, string> } },
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
});
