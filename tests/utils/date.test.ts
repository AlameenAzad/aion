import {
  getDateRange,
  formatDuration,
  secondsToMinutes,
  buildIsoDatetime,
  getLocalOffset,
  timeToSeconds,
} from '../../src/utils/date';

// Pin "today" so tests are deterministic
const MOCK_TODAY = '2026-05-21';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-21T10:00:00Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

// ── getDateRange ──────────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('returns today for --today flag', () => {
    const range = getDateRange({ today: true });
    expect(range).toEqual({ from: MOCK_TODAY, to: MOCK_TODAY });
  });

  it('returns the current week for --week flag', () => {
    const range = getDateRange({ week: true });
    // Week containing 2026-05-21 (Thursday): Mon 2026-05-18 → Sun 2026-05-24
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.from <= MOCK_TODAY).toBe(true);
    expect(range.to >= MOCK_TODAY).toBe(true);
  });

  it('returns the current month by default', () => {
    const range = getDateRange({});
    expect(range.from).toBe('2026-05-01');
    expect(range.to).toBe('2026-05-31');
  });

  it('uses explicit from/to when both are provided', () => {
    const range = getDateRange({ from: '2026-04-01', to: '2026-04-30' });
    expect(range).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('uses today as "to" when only from is provided', () => {
    const range = getDateRange({ from: '2026-05-01' });
    expect(range.from).toBe('2026-05-01');
    expect(range.to).toBe(MOCK_TODAY);
  });

  it('--today takes precedence over --week', () => {
    // today is checked first in the implementation
    const range = getDateRange({ today: true, week: true });
    expect(range).toEqual({ from: MOCK_TODAY, to: MOCK_TODAY });
  });
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats seconds only into minutes', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('formats 0 seconds as 0m', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats 7.5 hours', () => {
    expect(formatDuration(7.5 * 3600)).toBe('7h 30m');
  });
});

// ── secondsToMinutes ──────────────────────────────────────────────────────────

describe('secondsToMinutes', () => {
  it('converts whole hours', () => {
    expect(secondsToMinutes(3600)).toBe(60);
  });

  it('rounds fractional minutes', () => {
    expect(secondsToMinutes(3630)).toBe(61); // 60.5 → 61
  });

  it('handles zero', () => {
    expect(secondsToMinutes(0)).toBe(0);
  });

  it('handles 90 minutes', () => {
    expect(secondsToMinutes(5400)).toBe(90);
  });
});

// ── buildIsoDatetime ──────────────────────────────────────────────────────────

describe('buildIsoDatetime', () => {
  const TZ = /([+-]\d{2}:\d{2}|Z)$/;

  it('builds ISO datetime from date + HH:MM:SS string', () => {
    expect(buildIsoDatetime('2026-05-21', '09:30:00')).toMatch(/^2026-05-21T09:30:00/);
    expect(buildIsoDatetime('2026-05-21', '09:30:00')).toMatch(TZ);
  });

  it('pads HH:MM short time string to HH:MM:SS', () => {
    expect(buildIsoDatetime('2026-05-21', '09:30')).toMatch(/^2026-05-21T09:30:00/);
    expect(buildIsoDatetime('2026-05-21', '09:30')).toMatch(TZ);
  });

  it('converts numeric seconds-from-midnight to HH:MM:SS', () => {
    // 9 * 3600 = 32400 seconds → 09:00:00
    expect(buildIsoDatetime('2026-05-21', 32400)).toMatch(/^2026-05-21T09:00:00/);
    expect(buildIsoDatetime('2026-05-21', 32400)).toMatch(TZ);
  });

  it('converts numeric seconds-from-midnight with minutes', () => {
    // 9h 30m → 34200 seconds
    expect(buildIsoDatetime('2026-05-21', 34200)).toMatch(/^2026-05-21T09:30:00/);
    expect(buildIsoDatetime('2026-05-21', 34200)).toMatch(TZ);
  });

  it('defaults to midnight when startTime is undefined', () => {
    expect(buildIsoDatetime('2026-05-21')).toMatch(/^2026-05-21T00:00:00/);
    expect(buildIsoDatetime('2026-05-21')).toMatch(TZ);
  });

  it('handles midnight as 0 seconds', () => {
    expect(buildIsoDatetime('2026-05-21', 0)).toMatch(/^2026-05-21T00:00:00/);
    expect(buildIsoDatetime('2026-05-21', 0)).toMatch(TZ);
  });

  it('handles end-time overflow past midnight', () => {
    // 23h * 3600 + 3600 * 2 = 86400 + 3600 = next day 01:00:00
    expect(buildIsoDatetime('2026-05-21', 86400 + 3600)).toMatch(/^2026-05-22T01:00:00/);
  });
});

// ── getLocalOffset ────────────────────────────────────────────────────────────

describe('getLocalOffset', () => {
  it('returns a ±HH:MM formatted offset string', () => {
    expect(getLocalOffset()).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});

// ── timeToSeconds ─────────────────────────────────────────────────────────────

describe('timeToSeconds', () => {
  it('returns 0 for undefined', () => {
    expect(timeToSeconds(undefined)).toBe(0);
  });

  it('returns numeric value unchanged', () => {
    expect(timeToSeconds(32400)).toBe(32400);
  });

  it('parses HH:MM:SS string', () => {
    expect(timeToSeconds('09:30:00')).toBe(9 * 3600 + 30 * 60);
  });

  it('parses HH:MM string', () => {
    expect(timeToSeconds('09:30')).toBe(9 * 3600 + 30 * 60);
  });
});
