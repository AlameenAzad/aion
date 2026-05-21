import axios, { AxiosInstance } from 'axios';

function withCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

export interface DyceResource {
  id: string;
  no: string;
  name: string;
  [key: string]: unknown;
}

export interface DyceEntityRef {
  id?: string;
  no: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface DyceTimeRecording {
  id?: string;
  resource: DyceResource | null;
  customer?: DyceEntityRef | null;
  job?: DyceEntityRef | null;
  jobTask?: DyceEntityRef | null;
  jobPlanningLine?: DyceJobPlanningLine | null;
  /** ISO datetime, e.g. "2024-01-15T09:00:00Z" */
  start: string;
  /** ISO datetime */
  end: string;
  /** Date only, YYYY-MM-DD */
  date: string;
  /** Duration in minutes (Int32) */
  duration: number;
  /** Billable duration in minutes — must equal duration when nonBillableReason is None */
  durationBillable?: number;
  break?: number;
  nonBillableReason?: string;
  description?: string;
  complete?: boolean;
  workType?: string;
  [key: string]: unknown;
}

export interface DyceJobPlanningLine {
  id: string;
  description?: string;
  serviceBillingType?: string;
  [key: string]: unknown;
}

export interface DyceODataResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

export class DyceClient {
  private client: AxiosInstance;

  constructor(token: string, instance: string, company: string) {
    this.client = axios.create({
      baseURL: 'https://api.dyce.cloud',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-instance': instance,
        'x-company': company,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  async createTimeRecording(recording: DyceTimeRecording): Promise<DyceTimeRecording> {
    try {
      const res = await this.client.post<DyceTimeRecording>('/api/timeRecordings', recording);
      return res.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        const body = err.response.data as Record<string, unknown>;
        process.stderr.write(
          `\n[dyce debug] HTTP ${err.response.status} on createTimeRecording\n` +
          `  Request: ${JSON.stringify(recording, null, 2)}\n` +
          `  Response: ${JSON.stringify(body, null, 2)}\n\n`
        );
        const message =
          (body?.message as string | undefined) ??
          (body?.error as string | undefined) ??
          (body?.title as string | undefined) ??
          JSON.stringify(body);
        throw withCause(`HTTP ${err.response.status}: ${message}`, err);
      }
      throw err;
    }
  }

  async getRecentTimeRecordings(top = 5): Promise<DyceTimeRecording[]> {
    const res = await this.client.get<DyceODataResponse<DyceTimeRecording>>('/api/timeRecordings', {
      params: {
        $top: top,
        $orderby: 'date desc',
        $expand: 'resource',
      },
    });
    return res.data.value ?? [];
  }

  async lookupResource(resourceNo: string): Promise<DyceResource | null> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceResource>>('/api/resources', {
        params: { $filter: `no eq '${resourceNo}'`, $top: 1 },
      });
      return res.data.value?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async lookupCustomer(customerNo: string): Promise<DyceEntityRef | null> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>('/api/customers', {
        params: { $filter: `no eq '${customerNo}'`, $top: 1 },
      });
      return res.data.value?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async lookupJob(jobNo: string): Promise<DyceEntityRef | null> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>('/api/jobs', {
        params: { $filter: `no eq '${jobNo}'`, $top: 1 },
      });
      return res.data.value?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async lookupJobTask(jobTaskNo: string): Promise<DyceEntityRef | null> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>('/api/jobTasks', {
        params: { $filter: `no eq '${jobTaskNo}'`, $top: 1 },
      });
      return res.data.value?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async listCustomers(): Promise<DyceEntityRef[]> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>(
        '/api/resourceJobAssignments/Customers',
        { params: { $orderby: 'name asc, id asc', $top: 100 } }
      );
      return res.data.value ?? [];
    } catch {
      return [];
    }
  }

  async listJobs(customerId?: string): Promise<DyceEntityRef[]> {
    try {
      const filter = customerId
        ? `customer/id eq ${customerId} and not(status eq 'Completed')`
        : `not(status eq 'Completed')`;
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>(
        '/api/resourceJobAssignments/Jobs',
        { params: { $filter: filter, $orderby: 'no asc, id asc', $top: 100 } }
      );
      return res.data.value ?? [];
    } catch {
      return [];
    }
  }

  async listJobTasks(jobId?: string): Promise<DyceEntityRef[]> {
    try {
      const params: Record<string, string | number> = {
        $orderby: 'description asc, id asc',
        $top: 100,
      };
      if (jobId) params['$filter'] = `job/id eq ${jobId} and status eq 'Open'`;
      const res = await this.client.get<DyceODataResponse<DyceEntityRef>>(
        '/api/resourceJobAssignments/JobTasks',
        { params }
      );
      return res.data.value ?? [];
    } catch {
      return [];
    }
  }

  async listJobPlanningLines(jobTaskId: string): Promise<DyceJobPlanningLine[]> {
    try {
      const res = await this.client.get<DyceODataResponse<DyceJobPlanningLine>>(
        '/api/resourceJobAssignments/JobPlanningLines',
        {
          params: {
            $filter: `jobTask/id eq ${jobTaskId} and status eq 'Open'`,
            $orderby: 'description asc',
            $top: 100,
          },
        }
      );
      return res.data.value ?? [];
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<DyceTimeRecording[]> {
    const res = await this.client.get<DyceODataResponse<DyceTimeRecording>>('/api/timeRecordings', {
      params: { $top: 1, $expand: 'resource' },
    });
    return res.data.value ?? [];
  }
}
