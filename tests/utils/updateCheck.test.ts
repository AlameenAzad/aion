import fs from 'fs';
import https from 'https';
import { EventEmitter } from 'events';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeResponse(statusCode: number): EventEmitter & { statusCode: number } {
  const emitter = new EventEmitter() as EventEmitter & { statusCode: number };
  emitter.statusCode = statusCode;
  return emitter;
}

function makeRequest(): EventEmitter & { destroy: jest.Mock } {
  const emitter = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
  emitter.destroy = jest.fn();
  return emitter;
}

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('fs');
jest.mock('https');

const mockedFs = jest.mocked(fs);
const mockedHttps = jest.mocked(https);

// ── import module under test ──────────────────────────────────────────────────

import {
  isNewerVersion,
  getLatestVersion,
  checkForUpdate,
} from '../../src/utils/updateCheck';

// ── isNewerVersion ────────────────────────────────────────────────────────────

describe('isNewerVersion', () => {
  it.each([
    ['1.0.0', '1.0.1', true],
    ['1.0.0', '1.1.0', true],
    ['1.0.0', '2.0.0', true],
    ['1.0.0', '1.0.0', false],
    ['1.1.0', '1.0.9', false],
    ['2.0.0', '1.9.9', false],
    ['1.0.0', 'v1.0.1', true], // handles leading 'v'
  ])('isNewerVersion(%s, %s) === %s', (current, latest, expected) => {
    expect(isNewerVersion(current, latest)).toBe(expected);
  });
});

// ── getLatestVersion / checkForUpdate ─────────────────────────────────────────

describe('getLatestVersion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached version without hitting npm when cache is fresh', async () => {
    const cache = { lastChecked: Date.now(), latestVersion: '2.0.0' };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await getLatestVersion();

    expect(result).toBe('2.0.0');
    expect(mockedHttps.get).not.toHaveBeenCalled();
  });

  it('fetches from npm and writes cache when cache is absent', async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    const req = makeRequest();
    const res = makeResponse(200);

    mockedHttps.get.mockImplementation((_url, _opts, cb) => {
      if (typeof cb === 'function') {
        cb(res as never);
        // emit in next tick so the listener is registered first
        setImmediate(() => {
          res.emit('data', Buffer.from('{"version":"1.5.0"}'));
          res.emit('end');
        });
      }
      return req as never;
    });

    const result = await getLatestVersion();

    expect(result).toBe('1.5.0');
    expect(mockedFs.writeFileSync).toHaveBeenCalled();
  });

  it('fetches from npm when cache is stale (older than 24h)', async () => {
    const staleCache = {
      lastChecked: Date.now() - 25 * 60 * 60 * 1000,
      latestVersion: '1.0.0',
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(staleCache));
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    const req = makeRequest();
    const res = makeResponse(200);

    mockedHttps.get.mockImplementation((_url, _opts, cb) => {
      if (typeof cb === 'function') {
        cb(res as never);
        setImmediate(() => {
          res.emit('data', Buffer.from('{"version":"2.0.0"}'));
          res.emit('end');
        });
      }
      return req as never;
    });

    const result = await getLatestVersion();

    expect(result).toBe('2.0.0');
  });

  it('returns null when npm registry returns non-200', async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const req = makeRequest();
    const res = makeResponse(503);

    mockedHttps.get.mockImplementation((_url, _opts, cb) => {
      if (typeof cb === 'function') {
        cb(res as never);
        setImmediate(() => res.emit('end'));
      }
      return req as never;
    });

    const result = await getLatestVersion();

    expect(result).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const req = makeRequest();
    const res = makeResponse(200);

    mockedHttps.get.mockImplementation((_url, _opts, cb) => {
      if (typeof cb === 'function') {
        cb(res as never);
        setImmediate(() => {
          res.emit('data', Buffer.from('not-json'));
          res.emit('end');
        });
      }
      return req as never;
    });

    const result = await getLatestVersion();

    expect(result).toBeNull();
  });

  it('returns null when the request emits an error', async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const req = makeRequest();

    mockedHttps.get.mockImplementation((_url, _opts, _cb) => {
      setImmediate(() => req.emit('error', new Error('network down')));
      return req as never;
    });

    const result = await getLatestVersion();

    expect(result).toBeNull();
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the latest version when an update is available', async () => {
    const cache = { lastChecked: Date.now(), latestVersion: '2.0.0' };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkForUpdate('1.0.0');

    expect(result).toBe('2.0.0');
  });

  it('returns null when already on the latest version', async () => {
    const cache = { lastChecked: Date.now(), latestVersion: '1.0.0' };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkForUpdate('1.0.0');

    expect(result).toBeNull();
  });

  it('returns null when the version check itself fails', async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const req = makeRequest();
    mockedHttps.get.mockImplementation((_url, _opts, _cb) => {
      setImmediate(() => req.emit('error', new Error('network error')));
      return req as never;
    });

    const result = await checkForUpdate('1.0.0');

    expect(result).toBeNull();
  });
});
