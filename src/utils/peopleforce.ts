import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { PeopleForceLeaveRow } from '../api/peopleforce';
import { LeaveCase, classifyLeaveType } from './leave';

dayjs.extend(customParseFormat);

/** PeopleForce renders dates like "14 Sep 26" — parsed with the year taken as 20YY. */
function parsePeopleForceDate(value: string): string | null {
  const parsed = dayjs(value, 'D MMM YY');
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export function parsePeopleForceCase(row: PeopleForceLeaveRow): LeaveCase | null {
  if (row.requestId == null) return null;

  const from = parsePeopleForceDate(row.startsOn);
  const to = parsePeopleForceDate(row.endsOn);
  if (!from || !to) return null;

  return {
    id: row.requestId,
    provider: 'peopleforce',
    title: `${row.leaveType} (${row.startsOn} - ${row.endsOn})`,
    leaveType: classifyLeaveType(row.leaveType),
    from,
    to,
    state: row.status,
  };
}
