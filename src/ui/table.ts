import chalk from 'chalk';
import { formatDuration } from '../utils/date';

export interface TableRow {
  date: string;
  issueKey: string;
  summary: string;
  duration: number; // seconds
  dyceJob: string;
  status: 'pending' | 'skipped' | 'synced' | 'error' | 'vacation';
  note?: string;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function pad(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}

function statusLabel(status: TableRow['status']): string {
  switch (status) {
    case 'pending':
      return chalk.yellow('  PENDING');
    case 'synced':
      return chalk.green('   SYNCED');
    case 'skipped':
      return chalk.dim('  SKIPPED');
    case 'error':
      return chalk.red('    ERROR');
    case 'vacation':
      return chalk.magenta(' VACATION');
  }
}

export function printWorklogTable(rows: TableRow[]): void {
  const COL = {
    date: 12,
    issue: 12,
    summary: 30,
    duration: 8,
    job: 20,
    status: 10,
  };

  const header = [
    chalk.bold.cyan(pad('DATE', COL.date)),
    chalk.bold.cyan(pad('ISSUE', COL.issue)),
    chalk.bold.cyan(pad('SUMMARY', COL.summary)),
    chalk.bold.cyan(pad('TIME', COL.duration)),
    chalk.bold.cyan(pad('DYCE JOB', COL.job)),
    chalk.bold.cyan('STATUS'),
  ].join('  ');

  const divider = chalk.dim(
    '─'.repeat(COL.date + COL.issue + COL.summary + COL.duration + COL.job + COL.status + 12)
  );

  console.log();
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    const line = [
      chalk.dim(pad(row.date, COL.date)),
      chalk.blue(pad(truncate(row.issueKey, COL.issue), COL.issue)),
      pad(truncate(row.summary, COL.summary), COL.summary),
      chalk.yellow(pad(formatDuration(row.duration), COL.duration)),
      chalk.dim(pad(truncate(row.dyceJob, COL.job), COL.job)),
      statusLabel(row.status),
    ].join('  ');

    console.log(line);

    if (row.note) {
      console.log(chalk.dim(`   └─ ${row.note}`));
    }
  }

  console.log(divider);
}

export function printSyncSummary(rows: TableRow[]): void {
  const synced = rows.filter((r) => r.status === 'synced').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const errors = rows.filter((r) => r.status === 'error').length;
  const vacation = rows.filter((r) => r.status === 'vacation').length;

  console.log();
  console.log(chalk.bold('Sync Summary:'));
  if (synced > 0) console.log(chalk.green(`  ✔  ${synced} worklog(s) synced`));
  if (vacation > 0) console.log(chalk.cyan(`  ✈  ${vacation} vacation/leave entry synced`));
  if (skipped > 0) console.log(chalk.dim(`  ─  ${skipped} worklog(s) already synced (skipped)`));
  if (errors > 0) console.log(chalk.red(`  ✖  ${errors} worklog(s) failed`));
  console.log();
}
