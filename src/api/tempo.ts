import axios, { AxiosInstance } from 'axios';
import { applyRetryInterceptor } from '../utils/retry';
import { verboseLog } from '../utils/verbose';

export interface TempoWorklog {
  tempoWorklogId: number;
  issue: {
    id: number;
    key?: string;
  };
  timeSpentSeconds: number;
  billableSeconds?: number;
  startDate: string; // YYYY-MM-DD
  startTime?: string | number; // "HH:MM:SS" or seconds-from-midnight
  description?: string;
  author: {
    accountId: string;
    displayName?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface TempoWorklogsResponse {
  results: TempoWorklog[];
  metadata: {
    count: number;
    offset: number;
    limit: number;
    next?: string;
  };
}

export class TempoClient {
  private client: AxiosInstance;

  constructor(token: string, baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    this.client.interceptors.request.use((cfg) => {
      verboseLog(`[Tempo] ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });
    this.client.interceptors.response.use(
      (res) => { verboseLog(`[Tempo] ${res.status} ${res.config.url}`); return res; },
      (err) => { verboseLog(`[Tempo] ERROR ${err?.response?.status ?? 'network'} ${err?.config?.url}`); return Promise.reject(err); }
    );
    applyRetryInterceptor(this.client, 'Tempo');
  }

  async getWorklogs(params: {
    from: string;
    to: string;
    accountId: string;
  }): Promise<TempoWorklog[]> {
    const allWorklogs: TempoWorklog[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const res = await this.client.get<TempoWorklogsResponse>(
        `/4/worklogs/user/${encodeURIComponent(params.accountId)}`,
        {
          params: {
            from: params.from,
            to: params.to,
            limit,
            offset,
          },
        }
      );

      const data = res.data;
      allWorklogs.push(...data.results);

      // Tempo v4 omits `metadata.next` when there are no more pages.
      // Do NOT break on results.length < limit — the API returns all users'
      // worklogs per page (ignoring the worker/accountId param on some tenants),
      // so full pages of 50 are returned even when only a few belong to this user.
      if (!data.metadata.next) break;
      offset += limit;
    }

    return allWorklogs;
  }

  async testConnection(accountId: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await this.client.get<TempoWorklogsResponse>(`/4/worklogs/user/${encodeURIComponent(accountId)}`, {
        params: { from: today, to: today, limit: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function getTempoBaseUrl(region: 'eu' | 'us' | 'global'): string {
  switch (region) {
    case 'eu':
      return 'https://api.eu.tempo.io';
    case 'us':
      return 'https://api.tempo.io';
    case 'global':
    default:
      return 'https://api.tempo.io';
  }
}
