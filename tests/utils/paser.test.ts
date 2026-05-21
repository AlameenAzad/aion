import {
  classifyLeaveType,
  findCasesMatchingDate,
  isSupportedLeaveType,
  parseDateRangeFromTitle,
  parsePaserCase,
} from '../../src/utils/paser';

describe('classifyLeaveType', () => {
  it('detects vacation titles', () => {
    expect(classifyLeaveType('Vacation, User (01.05.2026 - 02.05.2026)')).toBe('vacation');
  });

  it('detects sick leave titles', () => {
    expect(classifyLeaveType('Sick leave, User (01.05.2026 - 01.05.2026)')).toBe('sickLeave');
  });

  it('returns unknown for other titles', () => {
    expect(classifyLeaveType('Business trip, User (01.05.2026 - 01.05.2026)')).toBe('unknown');
  });
});

describe('parseDateRangeFromTitle', () => {
  it('parses dd.mm.yyyy ranges', () => {
    expect(parseDateRangeFromTitle('Vacation, User (27.04.2026 - 28.04.2026)')).toEqual({
      from: '2026-04-27',
      to: '2026-04-28',
    });
  });

  it('returns null for unparseable title', () => {
    expect(parseDateRangeFromTitle('Vacation, User')).toBeNull();
  });

  it('returns null when day component is zero (invalid date part)', () => {
    // "00" parses to 0 which is falsy — triggers the !day guard
    expect(parseDateRangeFromTitle('X (00.01.2026 - 01.01.2026)')).toBeNull();
  });
});

describe('parsePaserCase', () => {
  it('returns parsed case when date range exists', () => {
    const parsed = parsePaserCase({
      id: 1,
      title: 'Vacation, User (01.05.2026 - 03.05.2026)',
      state: 'Completed',
      stage: 'Approved',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.from).toBe('2026-05-01');
    expect(parsed?.to).toBe('2026-05-03');
  });

  it('returns null for title without date range', () => {
    expect(parsePaserCase({ id: 1, title: 'Vacation' })).toBeNull();
  });
});

describe('findCasesMatchingDate', () => {
  it('matches inclusive boundaries', () => {
    const cases = [
      {
        id: 1,
        title: 'Vacation',
        leaveType: 'vacation' as const,
        from: '2026-05-01',
        to: '2026-05-03',
      },
    ];

    expect(findCasesMatchingDate(cases, '2026-05-01')).toHaveLength(1);
    expect(findCasesMatchingDate(cases, '2026-05-03')).toHaveLength(1);
    expect(findCasesMatchingDate(cases, '2026-05-04')).toHaveLength(0);
  });

  it('returns empty array for an invalid target date', () => {
    expect(findCasesMatchingDate([], 'not-a-date')).toEqual([]);
  });

  it('skips cases where from or to is not a valid date string', () => {
    const cases = [{ id: 1, title: 'X', leaveType: 'vacation' as const, from: 'bad', to: 'bad' }];
    expect(findCasesMatchingDate(cases, '2026-05-01')).toHaveLength(0);
  });
});

describe('isSupportedLeaveType', () => {
  it('supports vacation and sick leave', () => {
    expect(isSupportedLeaveType('vacation')).toBe(true);
    expect(isSupportedLeaveType('sickLeave')).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(isSupportedLeaveType('unknown')).toBe(false);
  });
});
