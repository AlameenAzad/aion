import axios from 'axios';
import { DyceClient } from '../../src/api/dyce';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
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

// ── lookupCustomer ────────────────────────────────────────────────────────────

describe('DyceClient.lookupCustomer', () => {
  it('returns the matched customer', async () => {
    const customer = { id: 'cust-id', no: 'C001', name: 'Acme Corp' };
    mockGet.mockResolvedValueOnce({ data: { value: [customer] } });

    const result = await client.lookupCustomer('C001');
    expect(result?.id).toBe('cust-id');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/customers',
      expect.objectContaining({
        params: expect.objectContaining({ $filter: "no eq 'C001'" }),
      })
    );
  });

  it('returns null when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.lookupCustomer('C001')).toBeNull();
  });

  it('returns null when no match is found', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [] } });
    expect(await client.lookupCustomer('NOPE')).toBeNull();
  });

  it('returns null on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.lookupCustomer('C001')).toBeNull();
  });
});

// ── lookupJob ─────────────────────────────────────────────────────────────────

describe('DyceClient.lookupJob', () => {
  it('returns the matched job', async () => {
    const job = { id: 'job-id', no: 'J001', description: 'Backend' };
    mockGet.mockResolvedValueOnce({ data: { value: [job] } });

    const result = await client.lookupJob('J001');
    expect(result?.id).toBe('job-id');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/jobs',
      expect.objectContaining({
        params: expect.objectContaining({ $filter: "no eq 'J001'" }),
      })
    );
  });

  it('returns null when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.lookupJob('J001')).toBeNull();
  });

  it('returns null when no match is found', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [] } });
    expect(await client.lookupJob('NOPE')).toBeNull();
  });

  it('returns null on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.lookupJob('J001')).toBeNull();
  });
});

// ── lookupJobTask ─────────────────────────────────────────────────────────

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

// ── listCustomers ─────────────────────────────────────────────────────────────

describe('DyceClient.listCustomers', () => {
  it('returns the list from the OData value array', async () => {
    const customers = [
      { id: 'c1', no: 'C001', name: 'Acme' },
      { id: 'c2', no: 'C002', name: 'Globex' },
    ];
    mockGet.mockResolvedValueOnce({ data: { value: customers } });

    const result = await client.listCustomers();
    expect(result).toHaveLength(2);
    expect(result[0].no).toBe('C001');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/Customers',
      expect.objectContaining({ params: expect.objectContaining({ $top: 100 }) })
    );
  });

  it('returns an empty array when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.listCustomers()).toEqual([]);
  });

  it('returns an empty array on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.listCustomers()).toEqual([]);
  });
});

// ── listJobs ──────────────────────────────────────────────────────────────────

describe('DyceClient.listJobs', () => {
  it('fetches all non-completed jobs when no customerId is given', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [{ id: 'j1', no: 'J001' }] } });

    const result = await client.listJobs();
    expect(result).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/Jobs',
      expect.objectContaining({
        params: expect.objectContaining({ $filter: "not(status eq 'Completed')" }),
      })
    );
  });

  it('filters by customerId when provided', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [] } });

    await client.listJobs('cust-uuid');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/Jobs',
      expect.objectContaining({
        params: expect.objectContaining({
          $filter: "customer/id eq cust-uuid and not(status eq 'Completed')",
        }),
      })
    );
  });

  it('returns an empty array when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.listJobs()).toEqual([]);
  });

  it('returns an empty array on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.listJobs()).toEqual([]);
  });
});

// ── listJobTasks ──────────────────────────────────────────────────────────────

describe('DyceClient.listJobTasks', () => {
  it('fetches all open job tasks when no jobId is given', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [{ id: 't1', no: 'T001' }] } });

    const result = await client.listJobTasks();
    expect(result).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/JobTasks',
      expect.objectContaining({
        params: expect.not.objectContaining({ $filter: expect.anything() }),
      })
    );
  });

  it('filters by jobId when provided', async () => {
    mockGet.mockResolvedValueOnce({ data: { value: [] } });

    await client.listJobTasks('job-uuid');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/JobTasks',
      expect.objectContaining({
        params: expect.objectContaining({
          $filter: "job/id eq job-uuid and status eq 'Open'",
        }),
      })
    );
  });

  it('returns an empty array when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.listJobTasks()).toEqual([]);
  });

  it('returns an empty array on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.listJobTasks()).toEqual([]);
  });
});

// ── listJobPlanningLines ──────────────────────────────────────────────────────

describe('DyceClient.listJobPlanningLines', () => {
  it('returns planning lines for the given job task', async () => {
    const lines = [
      { id: 'pl-1', description: 'Dev work', serviceBillingType: 'Billable' },
      { id: 'pl-2', description: 'Support' },
    ];
    mockGet.mockResolvedValueOnce({ data: { value: lines } });

    const result = await client.listJobPlanningLines('task-uuid');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pl-1');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/resourceJobAssignments/JobPlanningLines',
      expect.objectContaining({
        params: expect.objectContaining({
          $filter: "jobTask/id eq task-uuid and status eq 'Open'",
        }),
      })
    );
  });

  it('returns an empty array when value key is absent from response', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await client.listJobPlanningLines('task-uuid')).toEqual([]);
  });

  it('returns an empty array on API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('500'));
    expect(await client.listJobPlanningLines('task-uuid')).toEqual([]);
  });
});

// ── createTimeRecording (HTTP error body) ─────────────────────────────────────

describe('DyceClient.createTimeRecording (HTTP error handling)', () => {
  it('extracts message field from error response body', async () => {
    const axiosError = Object.assign(new Error('HTTP 422'), {
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: 'Duration must be positive' },
      },
    });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockPost.mockRejectedValueOnce(axiosError);

    await expect(client.createTimeRecording(mockRecording)).rejects.toThrow(
      'HTTP 422: Duration must be positive'
    );
  });

  it('falls back to error field when message is absent', async () => {
    const axiosError = Object.assign(new Error('HTTP 400'), {
      isAxiosError: true,
      response: { status: 400, data: { error: 'Bad request body' } },
    });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockPost.mockRejectedValueOnce(axiosError);

    await expect(client.createTimeRecording(mockRecording)).rejects.toThrow(
      'HTTP 400: Bad request body'
    );
  });

  it('falls back to title field when message and error are absent', async () => {
    const axiosError = Object.assign(new Error('HTTP 409'), {
      isAxiosError: true,
      response: { status: 409, data: { title: 'Conflict on resource' } },
    });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockPost.mockRejectedValueOnce(axiosError);

    await expect(client.createTimeRecording(mockRecording)).rejects.toThrow(
      'HTTP 409: Conflict on resource'
    );
  });

  it('falls back to stringified body when no named error fields are present', async () => {
    const axiosError = Object.assign(new Error('HTTP 500'), {
      isAxiosError: true,
      response: { status: 500, data: { code: 'INTERNAL_ERROR' } },
    });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockPost.mockRejectedValueOnce(axiosError);

    await expect(client.createTimeRecording(mockRecording)).rejects.toThrow('HTTP 500:');
  });
});
