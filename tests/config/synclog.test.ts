import * as fs from 'fs';
import { loadSyncedIds, markSynced, isSynced } from '../../src/config/synclog';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockReadFileSync = mockedFs.readFileSync as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
});

// ── loadSyncedIds ─────────────────────────────────────────────────────────────

describe('loadSyncedIds', () => {
  it('returns an empty set when the sync file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(loadSyncedIds().size).toBe(0);
  });

  it('returns a Set of IDs from a valid sync file', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([1, 2, 3]));

    const ids = loadSyncedIds();
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('returns an empty set if the file contains invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not-json');
    expect(loadSyncedIds().size).toBe(0);
  });

  it('returns an empty set if the file contains a non-array', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ id: 1 }));
    expect(loadSyncedIds().size).toBe(0);
  });

  it('filters out non-numeric values', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify([1, 'two', null, 3]));
    const ids = loadSyncedIds();
    expect(ids.has(1)).toBe(true);
    expect(ids.has(3)).toBe(true);
    expect(ids.size).toBe(2);
  });
});

// ── markSynced ────────────────────────────────────────────────────────────────

describe('markSynced', () => {
  it('writes new IDs merged with existing ones', () => {
    // Existing: [1, 2]
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([1, 2]));
    mockedFs.writeFileSync.mockReturnValue(undefined);

    markSynced([3, 4]);

    const written = JSON.parse(mockedFs.writeFileSync.mock.calls[0][1] as string) as number[];
    expect(written).toContain(1);
    expect(written).toContain(2);
    expect(written).toContain(3);
    expect(written).toContain(4);
  });

  it('creates the directory if it does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    markSynced([10]);

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.aion'), {
      recursive: true,
      mode: 0o700,
    });
  });

  it('does not duplicate IDs already in the sync log', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([5, 6]));
    mockedFs.writeFileSync.mockReturnValue(undefined);

    markSynced([5, 7]); // 5 already exists

    const written = JSON.parse(mockedFs.writeFileSync.mock.calls[0][1] as string) as number[];
    expect(written.filter((x) => x === 5)).toHaveLength(1);
    expect(written).toContain(7);
  });

  it('handles marking an empty array (no-op write still happens)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([1]));
    mockedFs.writeFileSync.mockReturnValue(undefined);

    markSynced([]);

    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
  });
});

// ── isSynced ──────────────────────────────────────────────────────────────────

describe('isSynced', () => {
  it('returns true for an ID in the sync log', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([42, 99]));
    expect(isSynced(42)).toBe(true);
  });

  it('returns false for an ID not in the sync log', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify([1, 2]));
    expect(isSynced(999)).toBe(false);
  });

  it('returns false when the sync file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(isSynced(1)).toBe(false);
  });
});
