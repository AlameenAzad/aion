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
      const res = await this.client.get<TempoWorklogsResponse>('/4/worklogs', {
        params: {
          from: params.from,
          to: params.to,
          // Some Tempo versions use 'worker', others use 'accountId'
          worker: params.accountId,
          accountId: params.accountId,
          limit,
          offset,
        },
      });

      const data = res.data;
      allWorklogs.push(...data.results);

      if (!data.metadata.next || data.results.length < limit) break;
      offset += limit;
    }

    // Hard client-side filter — guard against API ignoring the user param
    return allWorklogs.filter((w) => w.author.accountId === params.accountId);
  }

  async testConnection(accountId: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await this.client.get<TempoWorklogsResponse>('/4/worklogs', {
        params: { from: today, to: today, accountId, limit: 1 },
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
