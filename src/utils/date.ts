import dayjs from 'dayjs';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface DateFlags {
  today?: boolean;
  week?: boolean;
  from?: string;
  to?: string;
}

export function getDateRange(flags: DateFlags): DateRange {
  const now = dayjs();

  if (flags.today) {
    const today = now.format('YYYY-MM-DD');
    return { from: today, to: today };
  }

  if (flags.week) {
    return {
      from: now.startOf('week').format('YYYY-MM-DD'),
      to: now.endOf('week').format('YYYY-MM-DD'),
    };
  }

  if (flags.from && flags.to) {
    return { from: flags.from, to: flags.to };
  }

  if (flags.from && !flags.to) {
    return { from: flags.from, to: now.format('YYYY-MM-DD') };
  }

  // Default: current month
  return {
    from: now.startOf('month').format('YYYY-MM-DD'),
    to: now.endOf('month').format('YYYY-MM-DD'),
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/** Returns the local timezone offset as ±HH:MM, e.g. "+03:00" or "-05:00" */
export function getLocalOffset(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = Math.floor(abs / 60).toString().padStart(2, '0');
  const mm = (abs % 60).toString().padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** Converts a startTime value (HH:MM:SS string or seconds-from-midnight number) to total seconds. */
export function timeToSeconds(startTime?: string | number): number {
  if (typeof startTime === 'number') return startTime;
  if (typeof startTime === 'string' && startTime.length >= 5) {
    const parts = startTime.split(':').map(Number);
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return 0;
}

/**
 * Build an ISO datetime from a date string (YYYY-MM-DD) and optional time string.
 * startTime can be:
 *   - a string like "09:00:00" or "09:00"
 *   - a number (seconds from midnight, may exceed 86400 for end-of-entry overflow)
 *   - undefined (defaults to midnight)
 */
export function buildIsoDatetime(date: string, startTime?: string | number): string {
  const totalSeconds = timeToSeconds(startTime);
  const daysOverflow = Math.floor(totalSeconds / 86400);
  const secondsInDay = totalSeconds % 86400;

  let resolvedDate = date;
  if (daysOverflow > 0) {
    const [y, mo, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d + daysOverflow));
    resolvedDate = dt.toISOString().slice(0, 10);
  }

  let timeStr: string;
  if (typeof startTime === 'string' && startTime.length >= 5 && daysOverflow === 0) {
    // Preserve string format as-is (already validated), just normalise HH:MM → HH:MM:SS
    timeStr = startTime.length === 5 ? `${startTime}:00` : startTime;
  } else {
    const h = Math.floor(secondsInDay / 3600);
    const m = Math.floor((secondsInDay % 3600) / 60);
    const s = secondsInDay % 60;
    timeStr = [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  return `${resolvedDate}T${timeStr}${getLocalOffset()}`;
}
