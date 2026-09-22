import dayjs from 'dayjs';

export type LeaveType = 'vacation' | 'sickLeave' | 'unknown';
export type LeaveProvider = 'paser' | 'peopleforce';

/**
 * Normalized shape both Paser and PeopleForce leave/vacation cases map into,
 * so the rest of the sync pipeline (date matching, prompts, Dyce description)
 * doesn't need to branch on provider.
 */
export interface LeaveCase {
  id: number;
  provider: LeaveProvider;
  title: string;
  leaveType: LeaveType;
  from: string;
  to: string;
  state?: string;
  stage?: string;
  updatedAt?: string;
}

export function classifyLeaveType(text: string): LeaveType {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes('vacation')) return 'vacation';
  if (normalized.includes('sick')) return 'sickLeave';

  return 'unknown';
}

export function isSupportedLeaveType(leaveType: LeaveType): boolean {
  return leaveType === 'vacation' || leaveType === 'sickLeave';
}

export function findCasesMatchingDate(cases: LeaveCase[], date: string): LeaveCase[] {
  const target = dayjs(date);
  if (!target.isValid()) return [];

  return cases.filter((item) => {
    const from = dayjs(item.from);
    const to = dayjs(item.to);
    if (!from.isValid() || !to.isValid()) return false;

    return !target.isBefore(from, 'day') && !target.isAfter(to, 'day');
  });
}

export function isApprovedOrCompleted(item: LeaveCase): boolean {
  const state = (item.state ?? '').toLowerCase();
  const stage = (item.stage ?? '').toLowerCase();
  const approved = state === 'approved' || stage === 'approved';
  const completed = state === 'completed' || stage === 'completed';
  return approved || completed;
}
