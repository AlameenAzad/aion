import axios from 'axios';
import { TempoClient, getTempoBaseUrl } from '../../src/api/tempo';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

// axios.create returns an instance; we mock the instance methods
const mockGet = jest.fn();
const mockPost = jest.fn();
mockedAxios.create.mockReturnValue({
  get: mockGet,
  post: mockPost,
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
} as unknown as ReturnType<typeof axios.create>);

const client = new TempoClient('test-token', 'https://api.eu.tempo.io');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getTempoBaseUrl ───────────────────────────────────────────────────────────

describe('getTempoBaseUrl', () => {
  it('returns the EU base URL', () => {
    expect(getTempoBaseUrl('eu')).toBe('https://api.eu.tempo.io');
  });

  it('returns the US base URL', () => {
    expect(getTempoBaseUrl('us')).toBe('https://api.tempo.io');
  });

  it('returns the global URL as default', () => {
    expect(getTempoBaseUrl('global')).toBe('https://api.tempo.io');
  });
});

// ── TempoClient.getWorklogs ───────────────────────────────────────────────────

describe('TempoClient.getWorklogs', () => {
  const singlePageResponse = {
    data: {
      results: [
        {
          tempoWorklogId: 1001,
          issue: { id: 10, key: 'PROJ-1' },
          timeSpentSeconds: 3600,
          startDate: '2026-05-01',
          startTime: '09:00:00',
          description: 'Some work',
          author: { accountId: 'acc1' },
        },
      ],
      metadata: { count: 1, offset: 0, limit: 50 },
    },
  };

  it('returns worklogs from a single-page response', async () => {
    mockGet.mockResolvedValueOnce(singlePageResponse);

    const worklogs = await client.getWorklogs({
      from: '2026-05-01',
      to: '2026-05-31',
      accountId: 'acc1',
    });

    expect(worklogs).toHaveLength(1);
    expect(worklogs[0].tempoWorklogId).toBe(1001);
    expect(mockGet).toHaveBeenCalledWith(
      '/4/worklogs',
      expect.objectContaining({
        params: expect.objectContaining({ from: '2026-05-01', accountId: 'acc1' }),
      })
    );
  });

  it('paginates and concatenates results when metadata.next is set', async () => {
    const page1 = {
      data: {
        results: Array.from({ length: 50 }, (_, i) => ({
          tempoWorklogId: i + 1,
          issue: { id: i + 1 },
          timeSpentSeconds: 3600,
          startDate: '2026-05-01',
          author: { accountId: 'acc1' },
        })),
        metadata: { count: 60, offset: 0, limit: 50, next: 'yes' },
      },
    };
    const page2 = {
      data: {
        results: Array.from({ length: 10 }, (_, i) => ({
          tempoWorklogId: 51 + i,
          issue: { id: 51 + i },
          timeSpentSeconds: 3600,
          startDate: '2026-05-02',
          author: { accountId: 'acc1' },
        })),
        metadata: { count: 60, offset: 50, limit: 50 },
      },
    };

    mockGet.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const worklogs = await client.getWorklogs({
      from: '2026-05-01',
      to: '2026-05-31',
      accountId: 'acc1',
    });

    expect(worklogs).toHaveLength(60);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when there are no worklogs', async () => {
    mockGet.mockResolvedValueOnce({
      data: { results: [], metadata: { count: 0, offset: 0, limit: 50 } },
    });

    const worklogs = await client.getWorklogs({
      from: '2026-05-01',
      to: '2026-05-31',
      accountId: 'acc1',
    });

    expect(worklogs).toHaveLength(0);
  });

  it('propagates API errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    await expect(
      client.getWorklogs({ from: '2026-05-01', to: '2026-05-31', accountId: 'acc1' })
    ).rejects.toThrow('Network error');
  });
});

// ── TempoClient.testConnection ────────────────────────────────────────────────

describe('TempoClient.testConnection', () => {
  it('returns true on a successful response', async () => {
    mockGet.mockResolvedValueOnce({
      data: { results: [], metadata: { count: 0, offset: 0, limit: 1 } },
    });
    expect(await client.testConnection('acc1')).toBe(true);
  });

  it('returns false when the request throws', async () => {
    mockGet.mockRejectedValueOnce(new Error('Unauthorized'));
    expect(await client.testConnection('acc1')).toBe(false);
  });
});
