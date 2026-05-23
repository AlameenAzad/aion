import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { verboseLog } from './verbose';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

type RetryConfig = InternalAxiosRequestConfig & { _retryCount?: number };

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network error
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function applyRetryInterceptor(client: AxiosInstance, label: string): void {
  client.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
      if (!axios.isAxiosError(err)) throw err;

      const config = err.config as RetryConfig | undefined;
      if (!config) throw err;

      config._retryCount = (config._retryCount ?? 0) + 1;

      const status = err.response?.status;

      if (!isRetryableStatus(status) || config._retryCount >= MAX_ATTEMPTS) {
        throw err;
      }

      let delayMs = BASE_DELAY_MS * Math.pow(2, config._retryCount - 1);

      // Respect Retry-After header on 429 responses
      if (status === 429) {
        const retryAfter = err.response?.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(String(retryAfter), 10);
          if (!isNaN(parsed)) {
            delayMs = parsed * 1000;
          }
        }
      }

      verboseLog(
        `[${label}] Retrying (attempt ${config._retryCount}/${MAX_ATTEMPTS}) after ${delayMs}ms — status: ${status ?? 'network error'}`
      );

      await sleep(delayMs);
      return client.request(config);
    }
  );
}
