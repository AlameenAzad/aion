import axios from 'axios';
import { JiraClient } from '../../src/api/jira';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockGet = jest.fn();
mockedAxios.create.mockReturnValue({
  get: mockGet,
} as unknown as ReturnType<typeof axios.create>);

const client = new JiraClient('https://myco.atlassian.net', 'user@myco.com', 'jira-token');

beforeEach(() => {
  jest.clearAllMocks();
});

const mockUser = {
  accountId: 'acc-xyz',
  displayName: 'Alice Dev',
  emailAddress: 'alice@myco.com',
};

const mockIssue = (key: string) => ({
  id: '10001',
  key,
  fields: {
    summary: `Summary of ${key}`,
    issuetype: { name: 'Story' },
    status: { name: 'In Progress' },
    project: { key: key.split('-')[0], name: 'My Project' },
  },
});

// ── getCurrentUser ────────────────────────────────────────────────────────────

describe('JiraClient.getCurrentUser', () => {
  it('returns the current user', async () => {
    mockGet.mockResolvedValueOnce({ data: mockUser });
    const user = await client.getCurrentUser();
    expect(user.accountId).toBe('acc-xyz');
    expect(mockGet).toHaveBeenCalledWith('/rest/api/3/myself');
  });

  it('propagates API errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(client.getCurrentUser()).rejects.toThrow('401 Unauthorized');
  });
});

// ── getIssue ──────────────────────────────────────────────────────────────────

describe('JiraClient.getIssue', () => {
  it('fetches an issue by key', async () => {
    mockGet.mockResolvedValueOnce({ data: mockIssue('PROJ-42') });
    const issue = await client.getIssue('PROJ-42');
    expect(issue.key).toBe('PROJ-42');
    expect(issue.fields.summary).toContain('PROJ-42');
  });

  it('also fetches by numeric ID (string)', async () => {
    mockGet.mockResolvedValueOnce({ data: mockIssue('PROJ-10') });
    const issue = await client.getIssue('10001');
    expect(issue.key).toBe('PROJ-10');
  });
});

// ── getIssuesBatch ────────────────────────────────────────────────────────────

describe('JiraClient.getIssuesBatch', () => {
  it('returns a map of issue key → issue', async () => {
    const issues = ['PROJ-1', 'PROJ-2', 'API-5'].map(mockIssue);
    mockGet.mockResolvedValueOnce({ data: { issues } });

    const map = await client.getIssuesBatch(['PROJ-1', 'PROJ-2', 'API-5']);

    expect(map.get('PROJ-1')?.fields.summary).toContain('PROJ-1');
    expect(map.get('API-5')?.fields.summary).toContain('API-5');
    expect(map.size).toBe(3);
  });

  it('deduplicates issue keys before fetching', async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [mockIssue('PROJ-1')] } });
    await client.getIssuesBatch(['PROJ-1', 'PROJ-1', 'PROJ-1']);
    // Only one GET call, JQL has deduplicated keys
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map for an empty input array', async () => {
    const map = await client.getIssuesBatch([]);
    expect(map.size).toBe(0);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to individual fetches when batch request fails', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('JQL error')) // batch fails
      .mockResolvedValueOnce({ data: mockIssue('PROJ-1') }) // individual fetch #1
      .mockResolvedValueOnce({ data: mockIssue('PROJ-2') }); // individual fetch #2

    const map = await client.getIssuesBatch(['PROJ-1', 'PROJ-2']);
    expect(map.size).toBe(2);
    expect(mockGet).toHaveBeenCalledTimes(3); // 1 failed batch + 2 individual
  });
});
