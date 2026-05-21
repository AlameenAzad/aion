import chalk from 'chalk';
import {
  promptText,
  promptList,
  promptConfirm,
  printSuccess,
  printWarning,
} from '../ui/prompts';
import { withSpinner } from '../ui/spinner';
import { DyceClient } from '../api/dyce';
import { DyceLeaveMapping } from '../config/schema';

export interface LeaveTypeMappings {
  vacation?: DyceLeaveMapping;
  sickLeave?: DyceLeaveMapping;
  publicHoliday?: DyceLeaveMapping;
}

const LEAVE_TYPES: Array<{
  key: keyof LeaveTypeMappings;
  label: string;
  hint: string;
}> = [
    {
      key: 'vacation',
      label: 'Vacation',
      hint: 'Where are annual leave / vacation days logged in Dyce?',
    },
    {
      key: 'sickLeave',
      label: 'Sick Leave',
      hint: 'Where are sick days logged in Dyce?',
    },
    {
      key: 'publicHoliday',
      label: 'Public / Bank Holiday',
      hint: 'Where are government-approved public holidays logged in Dyce?',
    },
  ];

/**
 * Interactive wizard that asks the user to configure a Dyce customer/job/task
 * for each leave type (Vacation, Sick Leave, Public Holiday).
 *
 * Returns the updated mappings object. Existing mappings are passed as
 * `current` so that the user can skip a type and keep the previous value.
 */
export async function configureLeaveTypeMappings(
  dyceClient: DyceClient,
  current: LeaveTypeMappings = {}
): Promise<LeaveTypeMappings> {
  const result: LeaveTypeMappings = { ...current };

  for (const leaveType of LEAVE_TYPES) {
    const existing = current[leaveType.key];

    console.log(chalk.cyan(`\n  ── ${leaveType.label} ──────────────────────────────────────`));
    console.log(chalk.dim(`  ${leaveType.hint}`));

    if (existing) {
      console.log(
        chalk.dim(
          `  Current: ${existing.dyce.customerNo} / ${existing.dyce.jobNo} / ${existing.dyce.jobTaskNo}`
        )
      );
    }

    const configure = await promptConfirm(
      existing
        ? `  Update Dyce mapping for ${leaveType.label}?`
        : `  Configure Dyce mapping for ${leaveType.label}?`,
      !existing // default YES only when not yet configured
    );

    if (!configure) {
      if (!existing) {
        printWarning(
          `  Skipped — ${leaveType.label} entries will use the regular Jira project mapping as fallback.`
        );
      }
      continue;
    }

    // ── Customer ────────────────────────────────────────────────────────────
    let dyceCustomerNo: string;
    let customerId: string | undefined;
    let customerName: string | undefined;

    const customers = await withSpinner('Fetching Dyce customers…', () =>
      dyceClient.listCustomers()
    );
    if (customers.length > 0) {
      const choices = customers.map((c) => ({
        name: `${c.no}${c.name ? ` — ${c.name}` : c.description ? ` — ${c.description}` : ''}`,
        value: c.no,
      }));
      dyceCustomerNo = await promptList(`  Dyce Customer for ${leaveType.label}:`, choices);
      const sel = customers.find((c) => c.no === dyceCustomerNo);
      customerId = sel?.id;
      customerName = sel?.name ?? sel?.description;
    } else {
      printWarning('Could not fetch customers — enter the No manually.');
      dyceCustomerNo = await promptText(`  Dyce Customer No for ${leaveType.label}:`);
    }

    // ── Job ─────────────────────────────────────────────────────────────────
    let dyceJobNo: string;
    let jobId: string | undefined;
    let jobDescription: string | undefined;

    const jobs = await withSpinner('Fetching Dyce projects…', () =>
      dyceClient.listJobs(customerId)
    );
    if (jobs.length > 0) {
      const choices = jobs.map((j) => ({
        name: `${j.no}${j.description ? ` — ${j.description}` : ''}`,
        value: j.no,
      }));
      dyceJobNo = await promptList(`  Dyce Project for ${leaveType.label}:`, choices);
      const sel = jobs.find((j) => j.no === dyceJobNo);
      jobId = sel?.id;
      jobDescription = sel?.description;
    } else {
      printWarning('Could not fetch projects — enter the No manually.');
      dyceJobNo = await promptText(`  Dyce Project No for ${leaveType.label}:`);
    }

    // ── Job Task ─────────────────────────────────────────────────────────────
    let dyceJobTaskNo: string;
    let jobTaskId: string | undefined;
    let jobTaskDescription: string | undefined;

    const jobTasks = await withSpinner('Fetching Dyce project tasks…', () =>
      dyceClient.listJobTasks(jobId)
    );
    if (jobTasks.length > 0) {
      const choices = jobTasks.map((t) => ({
        name: `${t.no}${t.description ? ` — ${t.description}` : ''}`,
        value: t.no,
      }));
      dyceJobTaskNo = await promptList(`  Dyce Project Task for ${leaveType.label}:`, choices);
      const sel = jobTasks.find((t) => t.no === dyceJobTaskNo);
      jobTaskId = sel?.id;
      jobTaskDescription = sel?.description;
    } else {
      printWarning('Could not fetch project tasks — enter the No manually.');
      dyceJobTaskNo = await promptText(`  Dyce Project Task No for ${leaveType.label}:`);
    }

    // ── Job Planning Line ────────────────────────────────────────────────────
    let jobPlanningLineId: string | undefined;
    let jobPlanningLineDescription: string | undefined;
    if (jobTaskId) {
      const planningLines = await withSpinner('Fetching Dyce job planning lines…', () =>
        dyceClient.listJobPlanningLines(jobTaskId!)
      );
      if (planningLines.length === 1) {
        jobPlanningLineId = planningLines[0].id;
        jobPlanningLineDescription = planningLines[0].description;
      } else if (planningLines.length > 1) {
        const choices = planningLines.map((l) => ({
          name: `${l.description ?? l.id}${l.serviceBillingType ? ` (${l.serviceBillingType})` : ''}`,
          value: l.id,
        }));
        jobPlanningLineId = await promptList(
          `  Dyce Job Planning Line for ${leaveType.label}:`,
          choices
        );
        const sel = planningLines.find((l) => l.id === jobPlanningLineId);
        jobPlanningLineDescription = sel?.description;
      }
    }

    result[leaveType.key] = {
      label: leaveType.label,
      dyce: {
        customerNo: dyceCustomerNo.trim(),
        customerId,
        customerName,
        jobNo: dyceJobNo.trim(),
        jobId,
        jobDescription,
        jobTaskNo: dyceJobTaskNo.trim(),
        jobTaskId,
        jobTaskDescription,
        jobPlanningLineId,
        jobPlanningLineDescription,
      },
    };

    printSuccess(
      `  ${leaveType.label} → ${dyceCustomerNo} / ${dyceJobNo} / ${dyceJobTaskNo}`
    );
  }

  return result;
}
