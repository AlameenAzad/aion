import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { applyRetryInterceptor } from '../../src/utils/retry';
import { setVerbose } from '../../src/utils/verbose';

// Silence verbose output during tests
beforeAll(() => setVerbose(false));
afterAll(() => setVerbose(false));

function makeAxiosError(
  status: number | undefined,
  url = '/test',
  responseHeaders: Record<string, string> = {}
): AxiosError {
  const config = {
    url,
    method: 'get',
    headers: {},
  } as InternalAxiosRequestConfig;

  const err = new axios.AxiosError(
    `Request failed with status ${status ?? 'network'}`,
    status ? String(status) : 'ERR_NETWORK',
    config,
    {},
    status
      ? {
          status,
          statusText: String(status),
          data: {},
          headers: responseHeaders,
          config,
        }
      : undefined
  );
  return err;
}

/** Spy on `use` BEFORE calling applyRetryInterceptor so mock.calls is populated. */
function captureErrorHandler(
  client: ReturnType<typeof axios.create>
): (err: AxiosError) => Promise<unknown> {
  const spy = jest.spyOn(client.interceptors.response, 'use');
  applyRetryInterceptor(client, 'Test');
  const calls = spy.mock.calls as Array<[unknown, (err: AxiosError) => Promise<unknown>]>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][1]!;
}

describe('applyRetryInterceptor', () => {
  it('registers exactly one response interceptor', () => {
    const client = axios.create();
    const spy = jest.spyOn(client.interceptors.response, 'use');
    applyRetryInterceptor(client, 'Test');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 404', async () => {
    const client = axios.create();
    const requestSpy = jest.spyOn(client, 'request');
    const errorHandler = captureErrorHandler(client);

    const err = makeAxiosError(404);
    await expect(errorHandler(err)).rejects.toMatchObject({ response: { status: 404 } });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('retries on 500 and resolves when retry succeeds', async () => {
    jest.useFakeTimers();
    const client = axios.create();
    const errorHandler = captureErrorHandler(client);

    const successResponse = { data: 'ok', status: 200 };
    jest.spyOn(client, 'request').mockResolvedValueOnce(successResponse);

    const err = makeAxiosError(500);
    const promise = errorHandler(err);
    jest.runAllTimers();
    const result = await promise;

    expect(result).toEqual(successResponse);
    jest.useRealTimers();
  });

  it('retries on network error (no status)', async () => {
    jest.useFakeTimers();
    const client = axios.create();
    const errorHandler = captureErrorHandler(client);

    const successResponse = { data: 'ok', status: 200 };
    jest.spyOn(client, 'request').mockResolvedValueOnce(successResponse);

    const err = makeAxiosError(undefined);
    const promise = errorHandler(err);
    jest.runAllTimers();
    const result = await promise;

    expect(result).toEqual(successResponse);
    jest.useRealTimers();
  });

  it('respects Retry-After header on 429', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const client = axios.create();
    const errorHandler = captureErrorHandler(client);

    jest.spyOn(client, 'request').mockResolvedValueOnce({ data: 'ok', status: 200 });

    const err = makeAxiosError(429, '/test', { 'retry-after': '3' });
    const promise = errorHandler(err);

    // The retry delay for 429 + Retry-After: 3 should be 3000ms
    const retryCall = setTimeoutSpy.mock.calls.find((args) => (args[1] as number) === 3000);
    expect(retryCall).toBeDefined();

    jest.runAllTimers();
    await promise;
    jest.useRealTimers();
  });

  it('stops retrying after MAX_ATTEMPTS and throws', async () => {
    jest.useFakeTimers();
    const client = axios.create();
    const errorHandler = captureErrorHandler(client);

    // Pre-set retry count to MAX_ATTEMPTS so the next error is immediately rethrown
    const err = makeAxiosError(500);
    (err.config as InternalAxiosRequestConfig & { _retryCount?: number })._retryCount = 3;

    await expect(errorHandler(err)).rejects.toMatchObject({ response: { status: 500 } });
    jest.useRealTimers();
  });
});
