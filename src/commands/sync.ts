import chalk from 'chalk';
import { loadConfig } from '../config/manager';
import { loadSyncedIds, markSynced } from '../config/synclog';
import { TempoClient } from '../api/tempo';
import { JiraClient } from '../api/jira';
import { PaserClient } from '../api/paser';
import { DyceClient, DyceTimeRecording } from '../api/dyce';
import { resolveDyceToken } from '../api/msauth';
import { getDateRange, DateFlags, buildIsoDatetime, secondsToMinutes, timeToSeconds } from '../utils/date';
import { findMappings, isVacationEntry } from '../utils/mapping';
import {
  ParsedPaserCase,
  findCasesMatchingDate,
  isSupportedLeaveType,
  parsePaserCase,
} from '../utils/paser';
import { printWorklogTable, printSyncSummary, TableRow } from '../ui/table';
import { startSpinner } from '../ui/spinner';
import { promptText, promptConfirm, promptList, printWarning } from '../ui/prompts';
import { DyceMapping, DyceLeaveMapping } from '../config/schema';

interface SyncOptions extends DateFlags {
  dryRun?: boolean;
}

function isApprovedOrCompleted(item: ParsedPaserCase): boolean {
  const state = (item.state ?? '').toLowerCase();
  const stage = (item.stage ?? '').toLowerCase();
  const approved = state === 'approved' || stage === 'approved';
  const completed = state === 'completed' || stage === 'completed';
  return approved || completed;
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

  // ── Fetch matching leave requests from Paser (optional) ─────────────────────
  const paserMatchesByWorklogId = new Map<number, ParsedPaserCase[]>();
  if (config.paser) {
    const paserSpinner = startSpinner('Fetching leave requests from Paser…');
    try {
      const paser = new PaserClient(config.paser.baseUrl);
      const auth = await paser.authenticate(config.paser.email, config.paser.password);

      let sessionCookie = auth.sessionCookie;
      if (!sessionCookie) {
        sessionCookie = await paser.fetchSessionCookieFromPermissions(config.paser.accountId);
      }
      if (sessionCookie) {
        paser.setSessionCookie(sessionCookie);
      }

      const rawCases = await paser.getCases({
        accountId: config.paser.accountId,
        from,
        to,
      });

      const parsed = rawCases
        .map((item) => parsePaserCase(item))
        .filter((item): item is ParsedPaserCase => item !== null)
        .filter((item) => isSupportedLeaveType(item.leaveType));

      for (const wl of worklogs) {
        const issueKey = issueKeyMap.get(wl.issue.id) ?? `ISSUE-${wl.issue.id}`;
        if (!isVacationEntry(issueKey, config.vacationPrefixes)) continue;
        const matches = findCasesMatchingDate(parsed, wl.startDate);
        if (matches.length > 0) {
          paserMatchesByWorklogId.set(wl.tempoWorklogId, matches);
        }
      }

      paserSpinner.succeed(
        chalk.green(
          `Fetched ${rawCases.length} Paser request(s), matched ${paserMatchesByWorklogId.size} vacation/sick worklog(s)`
        )
      );
    } catch (err) {
      paserSpinner.warn(
        chalk.yellow(
          `Paser lookup failed: ${err instanceof Error ? err.message : String(err)}. Falling back to manual Paser ID entry.`
        )
      );
    }
  }

  // ── Build table rows ─────────────────────────────────────────────────────────
  const rows: TableRow[] = [];
  const toSync: Array<{
    worklog: (typeof worklogs)[0];
    issueKey: string;
    mappingCandidates: DyceMapping[];
    selectedMapping?: DyceMapping;
    leaveMapping?: DyceLeaveMapping;
    specialEntryType?: 'vacation' | 'sickLeave' | 'publicHoliday';
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

    if (mappingCandidates.length === 0 && !vacation) {
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

    // For vacation entries, show the dedicated leave mapping if configured; otherwise show
    // the regular mapping (or a placeholder if none exists yet).
    let dyceJobPreview: string;
    if (vacation) {
      const hasLeaveMapping =
        config.leaveTypeMappings?.vacation ||
        config.leaveTypeMappings?.sickLeave ||
        config.leaveTypeMappings?.publicHoliday;
      if (hasLeaveMapping) {
        dyceJobPreview = 'leave mapping (will ask type)';
      } else if (mappingCandidates.length > 1) {
        dyceJobPreview = `${mappingCandidates.length} options (will ask)`;
      } else if (mappingCandidates.length === 1) {
        dyceJobPreview = `${mappingCandidates[0].dyce.jobNo}/${mappingCandidates[0].dyce.jobTaskNo} ⚠ fallback`;
      } else {
        dyceJobPreview = '⚠ no mapping — run aion setup';
      }
    } else {
      dyceJobPreview = `${mappingCandidates[0].dyce.jobNo}/${mappingCandidates[0].dyce.jobTaskNo}`;
    }

    rows.push({
      date: wl.startDate,
      issueKey,
      summary,
      duration: wl.timeSpentSeconds,
      dyceJob: dyceJobPreview,
      status: vacation ? 'vacation' : 'pending',
    });

    if (vacation && mappingCandidates.length === 0 && !config.leaveTypeMappings) {
      // No mapping at all — skip
      const lastRow = rows[rows.length - 1]!;
      lastRow.status = 'skipped';
      lastRow.note = 'No leave mapping configured — run aion setup';
      continue;
    }

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
        { name: 'Vacation (annual leave — requires Paser ID)', value: 'vacation' as const },
        { name: 'Sick Leave (requires Paser ID)', value: 'sickLeave' as const },
        { name: 'Public / Bank Holiday (no Paser ID)', value: 'publicHoliday' as const },
      ]);
      item.specialEntryType = specialEntryType;

      // Resolve Dyce target: prefer the dedicated leave-type mapping, then fall back to
      // regular Jira project mappings (with a prompt if multiple candidates exist).
      const dedicatedLeaveMapping = config.leaveTypeMappings?.[specialEntryType];
      if (dedicatedLeaveMapping) {
        item.leaveMapping = dedicatedLeaveMapping;
        console.log(
          chalk.dim(
            `  Using ${specialEntryType} mapping → ` +
            `${dedicatedLeaveMapping.dyce.customerNo} / ${dedicatedLeaveMapping.dyce.jobNo} / ${dedicatedLeaveMapping.dyce.jobTaskNo}`
          )
        );
      } else if (item.mappingCandidates.length > 1) {
        const choices = item.mappingCandidates.map((m, idx) => ({
          name:
            `${m.label ?? `Option ${idx + 1}`}: ` +
            `${m.dyce.customerNo} / ${m.dyce.jobNo} / ${m.dyce.jobTaskNo}`,
          value: String(idx),
        }));
        const selected = await promptList('  Select Dyce mapping for this leave entry:', choices);
        item.selectedMapping = item.mappingCandidates[Number(selected)]!;
      } else {
        item.selectedMapping = item.mappingCandidates[0];
        if (!dedicatedLeaveMapping) {
          printWarning(
            `  No dedicated ${specialEntryType} mapping configured — falling back to regular project mapping.\n` +
            `  Run \`aion setup\` and reconfigure Step 6 to set a dedicated ${specialEntryType} Dyce target.`
          );
        }
      }

      if (specialEntryType === 'vacation' || specialEntryType === 'sickLeave') {
        const matchedCases = paserMatchesByWorklogId.get(item.worklog.tempoWorklogId) ?? [];

        if (matchedCases.length === 1) {
          const selected = matchedCases[0];
          if (!isApprovedOrCompleted(selected)) {
            printWarning(
              `Matched request #${selected.id} is not approved/completed (state: ${selected.state || 'n/a'}, stage: ${selected.stage || 'n/a'})`
            );
          }
          console.log(chalk.dim(`  Auto-matched Paser request #${selected.id} (${selected.title})`));
          paserMap.set(item.worklog.tempoWorklogId, `#${selected.id}`);
        } else if (matchedCases.length > 1) {
          printWarning(
            `Multiple Paser requests match ${item.worklog.startDate}. Please choose the correct one.`
          );

          const selected = await promptList(
            '  Select matching Paser request:',
            matchedCases.map((candidate) => {
              const status = `${candidate.state || 'n/a'} / ${candidate.stage || 'n/a'}`;
              return {
                name: `#${candidate.id} — ${candidate.title} [${candidate.from} to ${candidate.to}] (${status})`,
                value: String(candidate.id),
              };
            })
          );

          const selectedCase = matchedCases.find((c) => String(c.id) === selected);
          if (selectedCase && !isApprovedOrCompleted(selectedCase)) {
            printWarning(
              `Selected request #${selectedCase.id} is not approved/completed (state: ${selectedCase.state || 'n/a'}, stage: ${selectedCase.stage || 'n/a'})`
            );
          }

          paserMap.set(item.worklog.tempoWorklogId, `#${selected}`);
        } else {
          const paserId = await promptText(
            `  Enter Paser.io request ID for this entry (e.g. #23234):`,
            '',
            (v) => v.trim().length > 0 || 'Paser request ID is required for vacation/sick leave entries'
          );
          paserMap.set(item.worklog.tempoWorklogId, paserId.trim());
        }
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
    // Prefer the dedicated leave-type mapping, then the user-selected regular mapping, then the first candidate
    const leaveMapping = item.leaveMapping;
    const mapping = item.selectedMapping ?? item.mappingCandidates[0]!;
    const summary = issueSummaryMap.get(issueKey) ?? worklog.description ?? '';
    const isSpecialEntry = isVacationEntry(issueKey, config.vacationPrefixes);
    const needsPaserId = item.specialEntryType === 'vacation' || item.specialEntryType === 'sickLeave';
    const paserId = paserMap.get(worklog.tempoWorklogId);

    // Build description
    let description = `${issueKey}: ${summary}`;
    if (needsPaserId && paserId) {
      // For vacation/sick-leave entries the Dyce description should be only the Paser request id.
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

    // Resolve the Dyce customer/job/task — leave-type mapping takes precedence
    const dyceTarget = leaveMapping?.dyce ?? mapping.dyce;

    const recording: DyceTimeRecording = {
      resource: {
        id: config.dyce.resourceId ?? '',
        no: config.dyce.resourceNo,
        name: config.dyce.resourceName ?? config.dyce.resourceNo,
      },
      customer: {
        no: dyceTarget.customerNo,
        id: dyceTarget.customerId,
      },
      job: {
        no: dyceTarget.jobNo,
        id: dyceTarget.jobId,
      },
      jobTask: {
        no: dyceTarget.jobTaskNo,
        id: dyceTarget.jobTaskId,
      },
      jobPlanningLine: dyceTarget.jobPlanningLineId
        ? { id: dyceTarget.jobPlanningLineId, description: dyceTarget.jobPlanningLineDescription }
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
