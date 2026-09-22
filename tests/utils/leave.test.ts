import {
  classifyLeaveType,
  findCasesMatchingDate,
  isSupportedLeaveType,
  isApprovedOrCompleted,
  LeaveCase,
} from '../../src/utils/leave';

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

describe('findCasesMatchingDate', () => {
  it('matches inclusive boundaries', () => {
    const cases = [
      {
        id: 1,
        provider: 'paser' as const,
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
    const cases = [
      {
        id: 1,
        provider: 'paser' as const,
        title: 'X',
        leaveType: 'vacation' as const,
        from: 'bad',
        to: 'bad',
      },
    ];
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

describe('isApprovedOrCompleted', () => {
  const base: LeaveCase = {
    id: 1,
    provider: 'paser',
    title: 'X',
    leaveType: 'vacation',
    from: '2026-05-01',
    to: '2026-05-02',
  };

  it('treats an approved state as true', () => {
    expect(isApprovedOrCompleted({ ...base, state: 'Approved' })).toBe(true);
  });

  it('treats an approved stage as true', () => {
    expect(isApprovedOrCompleted({ ...base, stage: 'approved' })).toBe(true);
  });

  it('treats a completed state as true', () => {
    expect(isApprovedOrCompleted({ ...base, state: 'Completed' })).toBe(true);
  });

  it('treats a completed stage as true', () => {
    expect(isApprovedOrCompleted({ ...base, stage: 'Completed' })).toBe(true);
  });

  it('returns false when neither state nor stage is set', () => {
    expect(isApprovedOrCompleted(base)).toBe(false);
  });

  it('returns false for pending/rejected states', () => {
    expect(isApprovedOrCompleted({ ...base, state: 'Pending' })).toBe(false);
  });
});
