import {
  extractProjectKey,
  findMapping,
  findMappings,
  isVacationEntry,
} from '../../src/utils/mapping';
import { DyceMapping } from '../../src/config/schema';

const makeMapping = (jiraProjectKey: string): DyceMapping => ({
  jiraProjectKey,
  dyce: {
    customerNo: 'C001',
    jobNo: 'J001',
    jobTaskNo: 'T001',
  },
});

// ── extractProjectKey ─────────────────────────────────────────────────────────

describe('extractProjectKey', () => {
  it('extracts prefix from a standard issue key', () => {
    expect(extractProjectKey('PROJ-123')).toBe('PROJ');
  });

  it('always returns uppercase', () => {
    expect(extractProjectKey('proj-1')).toBe('PROJ');
  });

  it('handles single-character prefix', () => {
    expect(extractProjectKey('X-99')).toBe('X');
  });

  it('handles long numeric suffix', () => {
    expect(extractProjectKey('BACKEND-10042')).toBe('BACKEND');
  });
});

// ── findMapping ───────────────────────────────────────────────────────────────

describe('findMapping', () => {
  const mappings: DyceMapping[] = [makeMapping('PROJ'), makeMapping('API'), makeMapping('INFRA')];

  it('finds the correct mapping for a matching project key', () => {
    const result = findMapping('PROJ-42', mappings);
    expect(result?.jiraProjectKey).toBe('PROJ');
  });

  it('returns undefined when no mapping exists', () => {
    expect(findMapping('UNKNOWN-1', mappings)).toBeUndefined();
  });

  it('is case-insensitive on both sides', () => {
    const lowerMappings: DyceMapping[] = [makeMapping('proj')];
    expect(findMapping('PROJ-1', lowerMappings)).toBeDefined();
    expect(findMapping('proj-1', [makeMapping('PROJ')])).toBeDefined();
  });

  it('returns the first match when duplicates exist', () => {
    const dup: DyceMapping[] = [makeMapping('PROJ'), makeMapping('PROJ')];
    expect(findMapping('PROJ-1', dup)).toBeDefined();
  });

  it('returns undefined for an empty mappings array', () => {
    expect(findMapping('PROJ-1', [])).toBeUndefined();
  });

  it('supports exact Jira issue key mappings', () => {
    const exactMappings: DyceMapping[] = [makeMapping('INP1-11755')];
    expect(findMapping('INP1-11755', exactMappings)?.jiraProjectKey).toBe('INP1-11755');
  });

  it('prefers exact issue mapping over project-prefix mapping', () => {
    const mixed: DyceMapping[] = [makeMapping('INP1'), makeMapping('INP1-11755')];
    expect(findMapping('INP1-11755', mixed)?.jiraProjectKey).toBe('INP1-11755');
  });

  it('falls back to project-prefix mapping when exact issue mapping does not exist', () => {
    const mixed: DyceMapping[] = [makeMapping('INP1'), makeMapping('INP1-11755')];
    expect(findMapping('INP1-11756', mixed)?.jiraProjectKey).toBe('INP1');
  });
});

describe('findMappings', () => {
  it('returns all exact issue-key mappings when present', () => {
    const mappings: DyceMapping[] = [
      makeMapping('INP1'),
      makeMapping('INP1-11755'),
      makeMapping('INP1-11755'),
    ];
    expect(findMappings('INP1-11755', mappings)).toHaveLength(2);
    expect(
      findMappings('INP1-11755', mappings).every((m) => m.jiraProjectKey === 'INP1-11755')
    ).toBe(true);
  });

  it('falls back to all project-prefix mappings when no exact mapping exists', () => {
    const mappings: DyceMapping[] = [makeMapping('INP1'), makeMapping('INP1'), makeMapping('API')];
    expect(findMappings('INP1-11755', mappings)).toHaveLength(2);
  });
});

// ── isVacationEntry ───────────────────────────────────────────────────────────

describe('isVacationEntry', () => {
  const prefixes = ['VAC', 'LEAVE', 'SICK'];

  it('detects a vacation entry by prefix', () => {
    expect(isVacationEntry('VAC-12', prefixes)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isVacationEntry('vac-5', prefixes)).toBe(true);
    expect(isVacationEntry('Sick-1', prefixes)).toBe(true);
  });

  it('returns false for a non-vacation project', () => {
    expect(isVacationEntry('PROJ-100', prefixes)).toBe(false);
  });

  it('returns false when vacation prefixes list is empty', () => {
    expect(isVacationEntry('VAC-1', [])).toBe(false);
  });

  it('handles whitespace in configured prefixes', () => {
    expect(isVacationEntry('VAC-1', [' VAC '])).toBe(true);
  });

  it('supports exact issue key entries', () => {
    expect(isVacationEntry('INP1-11755', ['INP1-11755'])).toBe(true);
  });

  it('returns false for empty string entries in the prefixes array', () => {
    expect(isVacationEntry('VAC-1', ['', 'PROJ'])).toBe(false);
  });
});
