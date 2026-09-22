import dayjs from 'dayjs';
import { PaserCase } from '../api/paser';
import { LeaveCase, classifyLeaveType } from './leave';

const DATE_RANGE_REGEX = /\((\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\)/;

export function parsePaserCase(raw: PaserCase): LeaveCase | null {
  const range = parseDateRangeFromTitle(raw.title);
  if (!range) return null;

  return {
    id: raw.id,
    provider: 'paser',
    title: raw.title,
    leaveType: classifyLeaveType(raw.title),
    from: range.from,
    to: range.to,
    state: raw.state,
    stage: raw.stage,
    updatedAt: raw.updatedAt,
  };
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
