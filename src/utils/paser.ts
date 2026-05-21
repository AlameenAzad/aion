import dayjs from 'dayjs';
import { PaserCase } from '../api/paser';

export type LeaveType = 'vacation' | 'sickLeave' | 'unknown';

export interface ParsedPaserCase {
  id: number;
  title: string;
  leaveType: LeaveType;
  from: string;
  to: string;
  state?: string;
  stage?: string;
  updatedAt?: string;
}

const DATE_RANGE_REGEX = /\((\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\)/;

export function parsePaserCase(raw: PaserCase): ParsedPaserCase | null {
  const range = parseDateRangeFromTitle(raw.title);
  if (!range) return null;

  return {
    id: raw.id,
    title: raw.title,
    leaveType: classifyLeaveType(raw.title),
    from: range.from,
    to: range.to,
    state: raw.state,
    stage: raw.stage,
    updatedAt: raw.updatedAt,
  };
}

export function classifyLeaveType(title: string): LeaveType {
  const normalized = title.trim().toLowerCase();

  if (normalized.includes('vacation')) return 'vacation';
  if (normalized.includes('sick')) return 'sickLeave';

  return 'unknown';
}

export function parseDateRangeFromTitle(title: string): { from: string; to: string } | null {
  const match = DATE_RANGE_REGEX.exec(title);
  if (!match) return null;

  const from = dottedDateToIso(match[1]);
  const to = dottedDateToIso(match[2]);
  if (!from || !to) return null;

  return { from, to };
}

function dottedDateToIso(value: string): string | null {
  const [day, month, year] = value.split('.').map(Number);
  if (!day || !month || !year) return null;

  const parsed = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  if (!parsed.isValid()) return null;

  return parsed.format('YYYY-MM-DD');
}

export function findCasesMatchingDate(cases: ParsedPaserCase[], date: string): ParsedPaserCase[] {
  const target = dayjs(date);
  if (!target.isValid()) return [];

  return cases.filter((item) => {
    const from = dayjs(item.from);
    const to = dayjs(item.to);
    if (!from.isValid() || !to.isValid()) return false;

    return !target.isBefore(from, 'day') && !target.isAfter(to, 'day');
  });
}

export function isSupportedLeaveType(leaveType: LeaveType): boolean {
  return leaveType === 'vacation' || leaveType === 'sickLeave';
}
