import axios from 'axios';
import { DyceClient } from '../../src/api/dyce';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockGet = jest.fn();
const mockPost = jest.fn();
mockedAxios.create.mockReturnValue({
  get: mockGet,
  post: mockPost,
} as unknown as ReturnType<typeof axios.create>);

const client = new DyceClient('ey-token', 'my-instance', 'my-company');

beforeEach(() => {
  jest.clearAllMocks();
});

const mockRecording = {
  id: 'rec-uuid-1',
  resource: { id: 'res-uuid', no: 'EMP01', name: 'Alice' },
  customer: { id: 'cust-uuid', no: 'C001' },
  job: { id: 'job-uuid', no: 'J001' },
  jobTask: { id: 'task-uuid', no: 'T001' },
  start: '2026-05-21T09:00:00',
  end: '2026-05-21T10:00:00',
  date: '2026-05-21',
  duration: 60,
  description: 'PROJ-1: Some work',
};

// ── createTimeRecording ───────────────────────────────────────────────────────

describe('DyceClient.createTimeRecording', () => {
  it('posts a time recording and returns the created record', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...mockRecording, id: 'new-uuid' } });

    const result = await client.createTimeRecording(mockRecording);

    expect(result.id).toBe('new-uuid');
    expect(mockPost).toHaveBeenCalledWith('/api/timeRecordings', mockRecording);
  });

  it('propagates API errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('422 Unprocessable Entity'));
    await expect(client.createTimeRecording(mockRecording)).rejects.toThrow(
      '422 Unprocessable Entity'
    );
  });
});

// ── getRecentTimeRecordings ───────────────────────────────────────────────────

describe('DyceClient.getRecentTimeRecordings', () => {
  it('returns the list of recordings from the OData value array', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [mockRecording] } });
    const recordings = await client.getRecentTimeRecordings(5);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].resource?.no).toBe('EMP01');
  });

  it('returns an empty array when value is absent', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    const recordings = await client.getRecentTimeRecordings();
    expect(recordings).toHaveLength(0);
  });
});

// ── testConnection ────────────────────────────────────────────────────────────

describe('DyceClient.testConnection', () => {
  it('returns the recordings list on success', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [mockRecording] } });
    const result = await client.testConnection();
    expect(result).toHaveLength(1);
  });

  it('propagates errors (so the caller can handle auth failures)', async () => {
    mockGet.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(client.testConnection()).rejects.toThrow('401 Unauthorized');
  });
});

// ── lookupResource ────────────────────────────────────────────────────────────

describe('DyceClient.lookupResource', () => {
  it('returns the matched resource', async () => {
    const resource = { id: 'res-id', no: 'EMP01', name: 'Alice' };
    mockGet.mockResolvedValueOnce({ data: { value: [resource] } });

    const result = await client.lookupResource('EMP01');
    expect(result?.id).toBe('res-id');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resources',
      expect.objectContaining({
        params: expect.objectContaining({ $filter: "no eq 'EMP01'" }),
      })
    );
  });

  it('returns null when no match is found', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [] } });
    expect(await client.lookupResource('NOPE')).toBeNull();
  });

  it('returns null on API error (graceful fallback)', async () => {
    mockGet.mockRejectedValueOnce(new Error('404 Not Found'));
    expect(await client.lookupResource('EMP01')).toBeNull();
  });
});

// ── lookupJobTask ─────────────────────────────────────────────────────────────

describe('DyceClient.lookupJobTask', () => {
  it('filters by jobTaskNo only', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [{ id: 't1', no: 'T01' }] } });
    await client.lookupJobTask('T01');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/jobTasks',
      expect.objectContaining({
        params: expect.objectContaining({
          $filter: "no eq 'T01'",
        }),
      })
    );
  });

  it('returns null on error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.lookupJobTask('T01')).toBeNull();
  });
});
