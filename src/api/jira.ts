import axios, { AxiosInstance } from 'axios';
import { applyRetryInterceptor } from '../utils/retry';
import { verboseLog } from '../utils/verbose';

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype?: {
      name: string;
    };
    status?: {
      name: string;
    };
    project?: {
      key: string;
      name: string;
    };
  };
}

export class JiraClient {
  private client: AxiosInstance;

  constructor(baseUrl: string, email: string, apiToken: string) {
    const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
    this.client.interceptors.request.use((cfg) => {
      verboseLog(`[Jira] ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });
    this.client.interceptors.response.use(
      (res) => { verboseLog(`[Jira] ${res.status} ${res.config.url}`); return res; },
      (err) => { verboseLog(`[Jira] ERROR ${err?.response?.status ?? 'network'} ${err?.config?.url}`); return Promise.reject(err); }
    );
    applyRetryInterceptor(this.client, 'Jira');
  }

  async getCurrentUser(): Promise<JiraUser> {
    const res = await this.client.get<JiraUser>('/rest/api/3/myself');
    return res.data;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get<JiraIssue>(`/rest/api/3/issue/${issueKey}`, {
      params: { fields: 'summary,issuetype,status,project' },
    });
    return res.data;
  }

  private async searchIssuesByJql(jql: string, maxResults: number): Promise<JiraIssue[]> {
    const res = await this.client.get<{ issues: JiraIssue[] }>('/rest/api/3/search/jql', {
      params: {
        jql,
        fields: 'summary,issuetype,status,project',
        maxResults,
      },
    });
    return res.data.issues;
  }

  async getIssuesBatch(issueKeys: string[]): Promise<Map<string, JiraIssue>> {
    const unique = Array.from(new Set(issueKeys));
    const results = new Map<string, JiraIssue>();

    // Jira's JQL search can batch up to ~100 issues at a time
    const BATCH = 50;
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const jql = `issueKey in (${batch.join(',')})`;
      try {
        const issues = await this.searchIssuesByJql(jql, BATCH);
        for (const issue of issues) {
          results.set(issue.key, issue);
        }
      } catch {
        // If batch fails, fall back to individual fetches
        for (const key of batch) {
          try {
            const issue = await this.getIssue(key);
            results.set(issue.key, issue);
          } catch {
            // Skip issues that can't be fetched
          }
        }
      }
    }

    return results;
  }

  async getIssuesByIdBatch(issueIds: number[]): Promise<Map<number, JiraIssue>> {
    const unique = Array.from(new Set(issueIds));
    const results = new Map<number, JiraIssue>();

    const BATCH = 50;
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const jql = `id in (${batch.join(',')})`;
      try {
        const issues = await this.searchIssuesByJql(jql, BATCH);
        for (const issue of issues) {
          const id = Number(issue.id);
          if (Number.isFinite(id)) {
            results.set(id, issue);
          }
        }
      } catch {
        // If batch fails, fall back to individual fetches by numeric ID.
        for (const id of batch) {
          try {
            const issue = await this.getIssue(String(id));
            const numericId = Number(issue.id);
            if (Number.isFinite(numericId)) {
              results.set(numericId, issue);
            }
          } catch {
            // Skip issues that can't be fetched
          }
        }
      }
    }

    return results;
  }

  async testConnection(): Promise<JiraUser> {
    return this.getCurrentUser();
  }
}
