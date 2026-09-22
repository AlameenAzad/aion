import { parsePeopleForceCase } from '../../src/utils/peopleforce';

describe('parsePeopleForceCase', () => {
  it('parses a row with a two-digit year into an ISO date range', () => {
    const parsed = parsePeopleForceCase({
      requestId: 4782567,
      leaveType: 'Annual Vacation',
      startsOn: '14 Sep 26',
      endsOn: '18 Sep 26',
      amountDays: '5.0',
      status: 'Approved',
    });

    expect(parsed).toEqual({
      id: 4782567,
      provider: 'peopleforce',
      title: 'Annual Vacation (14 Sep 26 - 18 Sep 26)',
      leaveType: 'vacation',
      from: '2026-09-14',
      to: '2026-09-18',
      state: 'Approved',
    });
  });

  it('classifies sick leave rows', () => {
    const parsed = parsePeopleForceCase({
      requestId: 4683558,
      leaveType: 'Sick Leave',
      startsOn: '18 Aug 26',
      endsOn: '18 Aug 26',
      amountDays: '1.0',
      status: 'Approved',
    });

    expect(parsed?.leaveType).toBe('sickLeave');
  });

  it('returns null when the row has no request id', () => {
    expect(
      parsePeopleForceCase({
        leaveType: 'Annual Vacation',
        startsOn: '14 Sep 26',
        endsOn: '18 Sep 26',
        amountDays: '5.0',
        status: 'Approved',
      })
    ).toBeNull();
  });

  it('returns null when a date fails to parse', () => {
    expect(
      parsePeopleForceCase({
        requestId: 1,
        leaveType: 'Annual Vacation',
        startsOn: 'not a date',
        endsOn: '18 Sep 26',
        amountDays: '5.0',
        status: 'Approved',
      })
    ).toBeNull();
  });
});
