import axios, { AxiosInstance } from 'axios';
import { applyRetryInterceptor } from '../utils/retry';
import { verboseLog } from '../utils/verbose';

export interface PaserAccount {
  accountId: number;
  accountName: string;
  userInAccountId: number;
  status?: string;
}

export interface PaserUser {
  id: number;
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  accounts: PaserAccount[];
}

export interface PaserCase {
  id: number;
  title: string;
  state?: string;
  stage?: string;
  stageId?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface PaserCasesResponse {
  results?: PaserCase[];
}

export class PaserClient {
  private client: AxiosInstance;

  constructor(baseUrl: string, sessionCookie?: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
    this.client.interceptors.request.use((cfg) => {
      verboseLog(`[Paser] ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });
    this.client.interceptors.response.use(
      (res) => { verboseLog(`[Paser] ${res.status} ${res.config.url}`); return res; },
      (err) => { verboseLog(`[Paser] ERROR ${err?.response?.status ?? 'network'} ${err?.config?.url}`); return Promise.reject(err); }
    );
    applyRetryInterceptor(this.client, 'Paser');

    if (sessionCookie) {
      this.setSessionCookie(sessionCookie);
    }
  }

  setSessionCookie(cookie: string): void {
    this.client.defaults.headers.common.Cookie = cookie;
  }

  async authenticate(
    email: string,
    password: string
  ): Promise<{ user: PaserUser; sessionCookie?: string }> {
    const res = await this.client.post<PaserUser>('/api/user/authenticate/', { email, password });
    const sessionCookie = this.extractSessionCookie(res.headers['set-cookie']);

    return {
      user: res.data,
      sessionCookie,
    };
  }

  async fetchSessionCookieFromPermissions(accountId: number): Promise<string | undefined> {
    const res = await this.client.get(`/api/${accountId}/userpermissions/`, {
      params: { ps: 1 },
    });
    return this.extractSessionCookie(res.headers['set-cookie']);
  }

  async getCases(params: {
    accountId: number;
    from: string;
    to: string;
    folderId?: string;
    pageSize?: number;
    maxPages?: number;
  }): Promise<PaserCase[]> {
    const results: PaserCase[] = [];
    const pageSize = params.pageSize ?? 100;
    const maxPages = params.maxPages ?? 20;
    const folderId = params.folderId ?? 'sent';

    for (let page = 1; page <= maxPages; page++) {
      const res = await this.client.get<PaserCase[] | PaserCasesResponse>(
        `/api/${params.accountId}/cases/`,
        {
          params: {
            folderId,
            sb: 'CreatedAt',
            sd: 'desc',
            pg: page,
            ps: pageSize,
            from: params.from,
            to: params.to,
          },
        }
      );

      const pageItems = this.normalizeCasesResponse(res.data);
      results.push(...pageItems);

      if (pageItems.length < pageSize) break;
    }

    return results;
  }

  async testConnection(
    email: string,
    password: string
  ): Promise<{ user: PaserUser; sessionCookie?: string }> {
    const auth = await this.authenticate(email, password);
    const fallbackAccount = auth.user.accounts?.[0]?.accountId;

    if (!auth.sessionCookie && fallbackAccount) {
      const cookieFromFollowUp = await this.fetchSessionCookieFromPermissions(fallbackAccount);
      if (cookieFromFollowUp) {
        auth.sessionCookie = cookieFromFollowUp;
      }
    }

    return auth;
  }

  private normalizeCasesResponse(data: PaserCase[] | PaserCasesResponse): PaserCase[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    return [];
  }

  private extractSessionCookie(setCookieHeader: unknown): string | undefined {
    if (!setCookieHeader) return undefined;

    if (Array.isArray(setCookieHeader)) {
      return setCookieHeader[0];
    }

    if (typeof setCookieHeader === 'string') {
      return setCookieHeader;
    }

    return undefined;
  }
}
