import chalk from 'chalk';
import { loadConfig } from '../config/manager';
import { loadSyncedIds, markSynced } from '../config/synclog';
import { TempoClient } from '../api/tempo';
import { JiraClient } from '../api/jira';
import { DyceClient, DyceTimeRecording } from '../api/dyce';
import { resolveDyceToken } from '../api/msauth';
import { getDateRange, DateFlags, buildIsoDatetime, secondsToMinutes, timeToSeconds } from '../utils/date';
import { findMappings, isVacationEntry } from '../utils/mapping';
import { printWorklogTable, printSyncSummary, TableRow } from '../ui/table';
import { startSpinner } from '../ui/spinner';
import { promptText, promptConfirm, promptList, printWarning } from '../ui/prompts';
import { DyceMapping } from '../config/schema';

interface SyncOptions extends DateFlags {
  dryRun?: boolean;
}

export async function runSync(opts: SyncOptions): Promise<void> {
  const config = loadConfig();
  const { from, to } = getDateRange(opts);
  const isDryRun = opts.dryRun === true;

  console.log();
  console.log(
    chalk.bold(`${isDryRun ? 'Preview' : 'Syncing'} worklogs from `) +
    chalk.cyan(from) +
    chalk.bold(' to ') +
    chalk.cyan(to)
  );

  const syncedIds = loadSyncedIds();

  // ── Fetch Tempo worklogs ────────────────────────────────────────────────────
  const tempoSpinner = startSpinner('Fetching worklogs from Tempo…');
  let worklogs;
  try {
    const tempo = new TempoClient(config.tempo.token, config.tempo.baseUrl);
    worklogs = await tempo.getWorklogs({
      from,
      to,
      accountId: config.tempo.accountId,
    });
    tempoSpinner.succeed(chalk.green(`Fetched ${worklogs.length} worklog(s) from Tempo`));
  } catch (err) {
    tempoSpinner.fail(
      chalk.red(`Failed to fetch from Tempo: ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }

  if (worklogs.length === 0) {
    console.log(chalk.dim('\n  No worklogs found for the selected date range.\n'));
    return;
  }

  // ── Enrich with Jira issue info ─────────────────────────────────────────────
  const jiraSpinner = startSpinner(`Fetching issue titles from Jira (${worklogs.length} entries)…`);
  const issueKeyMap = new Map<number, string>(); // issueId → issueKey
  const issueSummaryMap = new Map<string, string>(); // issueKey → summary

  try {
    const jira = new JiraClient(config.jira.baseUrl, config.jira.email, config.jira.token);

    // Worklogs carry issue.id (number) but we need the key. Try to use issue.key if present.
    const idsNeedingLookup: number[] = [];
    for (const wl of worklogs) {
      if (wl.issue.key) {
        issueKeyMap.set(wl.issue.id, wl.issue.key);
      } else {
        idsNeedingLookup.push(wl.issue.id);
      }
    }

    // Collect all keys we have so far (direct and from worklogs with key)
    const knownKeys = Array.from(issueKeyMap.values());

    // For issues without a key, we try fetching by numeric ID
    for (const issueId of idsNeedingLookup) {
      try {
        const issue = await jira.getIssue(String(issueId));
        issueKeyMap.set(issueId, issue.key);
        knownKeys.push(issue.key);
      } catch {
        // Skip — will show numeric id as fallback
      }
    }

    // Batch-fetch summaries for all known keys
    const allKeys = [...new Set([...knownKeys, ...Array.from(issueKeyMap.values())])];
    const issueMap = await jira.getIssuesBatch(allKeys);
    for (const [key, issue] of issueMap) {
      issueSummaryMap.set(key, issue.fields.summary);
    }

    jiraSpinner.succeed(chalk.green(`Fetched ${issueSummaryMap.size} issue title(s) from Jira`));
  } catch (err) {
    jiraSpinner.warn(
      chalk.yellow(
        `Jira enrichment failed: ${err instanceof Error ? err.message : String(err)}. Titles will be blank.`
      )
    );
  }

  // ── Build table rows ─────────────────────────────────────────────────────────
  const rows: TableRow[] = [];
  const toSync: Array<{
    worklog: (typeof worklogs)[0];
    issueKey: string;
    mappingCandidates: DyceMapping[];
    selectedMapping?: DyceMapping;
    specialEntryType?: 'vacation' | 'publicHoliday';
  }> = [];

  for (const wl of worklogs) {
    const issueKey = issueKeyMap.get(wl.issue.id) ?? `ISSUE-${wl.issue.id}`;
    const summary = issueSummaryMap.get(issueKey) ?? wl.description ?? '';
    const mappingCandidates = findMappings(issueKey, config.mappings);
    const vacation = isVacationEntry(issueKey, config.vacationPrefixes);

    if (syncedIds.has(wl.tempoWorklogId)) {
      rows.push({
        date: wl.startDate,
        issueKey,
        summary,
        duration: wl.timeSpentSeconds,
        dyceJob:
          mappingCandidates.length > 0
            ? `${mappingCandidates[0].dyce.jobNo}/${mappingCandidates[0].dyce.jobTaskNo}`
            : '—',
        status: 'skipped',
        note: 'Already synced',
      });
      continue;
    }

    if (mappingCandidates.length === 0) {
      rows.push({
        date: wl.startDate,
        issueKey,
        summary,
        duration: wl.timeSpentSeconds,
        dyceJob: '—',
        status: 'skipped',
        note: 'No mapping configured for this project',
      });
      continue;
    }

    rows.push({
      date: wl.startDate,
      issueKey,
      summary,
      duration: wl.timeSpentSeconds,
      dyceJob:
        vacation && mappingCandidates.length > 1
          ? `${mappingCandidates.length} options (will ask)`
          : `${mappingCandidates[0].dyce.jobNo}/${mappingCandidates[0].dyce.jobTaskNo}`,
      status: vacation ? 'vacation' : 'pending',
    });

    toSync.push({ worklog: wl, issueKey, mappingCandidates });
  }

  // Show preview table
  printWorklogTable(rows);

  if (toSync.length === 0) {
    console.log(chalk.dim('  Nothing new to sync.\n'));
    return;
  }

  // ── Handle special leave/holiday entries ─────────────────────────────────────
  const paserMap = new Map<number, string>(); // tempoWorklogId → paserRequestId

  for (const item of toSync) {
    if (isVacationEntry(item.issueKey, config.vacationPrefixes)) {
      console.log();
      printWarning(`Special leave/holiday entry detected: ${item.issueKey} on ${item.worklog.startDate}`);

      const specialEntryType = await promptList('  What type of entry is this?', [
        { name: 'Vacation / sick leave (requires Paser ID)', value: 'vacation' as const },
        { name: 'Public holiday (no Paser ID)', value: 'publicHoliday' as const },
      ]);
      item.specialEntryType = specialEntryType;

      if (item.mappingCandidates.length > 1) {
        const choices = item.mappingCandidates.map((m, idx) => ({
          name:
            `${m.label ?? `Option ${idx + 1}`}: ` +
            `${m.dyce.customerNo} / ${m.dyce.jobNo} / ${m.dyce.jobTaskNo}`,
          value: String(idx),
        }));
        const selected = await promptList('  Select Dyce mapping for this vacation entry:', choices);
        item.selectedMapping = item.mappingCandidates[Number(selected)]!;
      } else {
        item.selectedMapping = item.mappingCandidates[0];
      }

      if (specialEntryType === 'vacation') {
        const paserId = await promptText(
          `  Enter Paser.io request ID for this entry (e.g. #23234):`,
          '',
          (v) => v.trim().length > 0 || 'Paser request ID is required for vacation/sick leave entries'
        );
        paserMap.set(item.worklog.tempoWorklogId, paserId.trim());
      }
    }
  }

  if (isDryRun) {
    console.log(chalk.bold.cyan('\n  Dry run complete. No changes were made.\n'));
    return;
  }

  // ── Confirm sync ─────────────────────────────────────────────────────────────
  const pendingCount = toSync.length;
  const confirmed = await promptConfirm(`Sync ${pendingCount} worklog(s) to Dyce?`);
  if (!confirmed) {
    console.log(chalk.dim('\n  Aborted.\n'));
    return;
  }

  // ── Sync to Dyce ─────────────────────────────────────────────────────────────
  const dyceToken = await resolveDyceToken(config);
  const dyce = new DyceClient(dyceToken, config.dyce.instance, config.dyce.company);

  const syncSpinner = startSpinner(`Syncing to Dyce (0/${pendingCount})…`);
  let done = 0;
  const newlySyncedIds: number[] = [];

  for (const item of toSync) {
    const { worklog, issueKey } = item;
    const mapping = item.selectedMapping ?? item.mappingCandidates[0]!;
    const summary = issueSummaryMap.get(issueKey) ?? worklog.description ?? '';
    const isSpecialEntry = isVacationEntry(issueKey, config.vacationPrefixes);
    const isVacation = item.specialEntryType === 'vacation';
    const paserId = paserMap.get(worklog.tempoWorklogId);

    // Build description
    let description = `${issueKey}: ${summary}`;
    if (isVacation && paserId) {
      // For vacation entries the Dyce description should be only the Paser request id.
      description = paserId;
    } else if (item.specialEntryType === 'publicHoliday') {
      description = config.publicHolidayDescription?.trim() || 'Government approved official holiday';
    }

    const startIso = buildIsoDatetime(worklog.startDate, worklog.startTime);
    const durationMinutes = secondsToMinutes(worklog.timeSpentSeconds);
    const endIso = buildIsoDatetime(
      worklog.startDate,
      timeToSeconds(worklog.startTime) + worklog.timeSpentSeconds
    );

    const recording: DyceTimeRecording = {
      resource: {
        id: config.dyce.resourceId ?? '',
        no: config.dyce.resourceNo,
        name: config.dyce.resourceName ?? config.dyce.resourceNo,
      },
      customer: {
        no: mapping.dyce.customerNo,
        id: mapping.dyce.customerId,
      },
      job: {
        no: mapping.dyce.jobNo,
        id: mapping.dyce.jobId,
      },
      jobTask: {
        no: mapping.dyce.jobTaskNo,
        id: mapping.dyce.jobTaskId,
      },
      jobPlanningLine: mapping.dyce.jobPlanningLineId
        ? { id: mapping.dyce.jobPlanningLineId, description: mapping.dyce.jobPlanningLineDescription }
        : null,
      start: startIso,
      end: endIso,
      date: `${worklog.startDate}T00:00:00Z`,
      duration: durationMinutes,
      durationBillable: durationMinutes,
      break: 0,
      nonBillableReason: 'None',
      description,
      complete: false,
    };

    try {
      await dyce.createTimeRecording(recording);
      newlySyncedIds.push(worklog.tempoWorklogId);
      done++;

      // Update row status in the table array
      const row = rows.find(
        (r) =>
          r.date === worklog.startDate &&
          r.issueKey === issueKey &&
          r.duration === worklog.timeSpentSeconds
      );
      if (row) row.status = isSpecialEntry ? 'vacation' : 'synced';

      syncSpinner.text = chalk.cyan(`Syncing to Dyce (${done}/${pendingCount})…`);
    } catch (err) {
      const row = rows.find(
        (r) =>
          r.date === worklog.startDate &&
          r.issueKey === issueKey &&
          r.duration === worklog.timeSpentSeconds
      );
      if (row) {
        row.status = 'error';
        row.note = err instanceof Error ? err.message : String(err);
      }
    }
  }

  syncSpinner.succeed(
    chalk.green(`Synced ${newlySyncedIds.length}/${pendingCount} worklog(s) to Dyce`)
  );

  if (newlySyncedIds.length > 0) {
    markSynced(newlySyncedIds);
  }

  // Show final table + summary
  printWorklogTable(rows);
  printSyncSummary(rows);
}
