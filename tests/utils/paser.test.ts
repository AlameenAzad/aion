import { parseDateRangeFromTitle, parsePaserCase } from '../../src/utils/paser';

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
    expect(parsed?.provider).toBe('paser');
    expect(parsed?.from).toBe('2026-05-01');
    expect(parsed?.to).toBe('2026-05-03');
  });

  it('returns null for title without date range', () => {
    expect(parsePaserCase({ id: 1, title: 'Vacation' })).toBeNull();
  });
});
