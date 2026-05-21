import chalk from 'chalk';
import { showBanner, showInfoBox } from '../ui/banner';
import {
  promptText,
  promptPassword,
  promptList,
  promptConfirm,
  printStep,
  printHint,
  printSuccess,
  printWarning,
  printError,
} from '../ui/prompts';
import { withSpinner } from '../ui/spinner';
import { TempoClient, getTempoBaseUrl } from '../api/tempo';
import { JiraClient } from '../api/jira';
import { DyceClient } from '../api/dyce';
import { refreshAccessToken } from '../api/msauth';
import { saveConfig, loadDraft, saveDraft, clearDraft, SetupDraft } from '../config/manager';
import { Config, DyceMapping } from '../config/schema';

/** Safely decode a URL-encoded string (e.g. "My%20Company" → "My Company"). */
function decodeInput(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const TOTAL_STEPS = 6;

export async function runSetup(): Promise<void> {
  showBanner();

  console.log(chalk.bold('Welcome to aion setup!'));
  console.log(chalk.dim('This wizard will configure your Tempo, Jira, and Dyce credentials.\n'));

  // ── Draft / resume ────────────────────────────────────────────────────────────
  let draft: SetupDraft = loadDraft() ?? { step: 0 };
  let resuming = false;

  // Clean up draft (which may contain live tokens) if the process is killed mid-setup
  const onAbort = () => {
    clearDraft();
    process.exit(1);
  };
  process.once('SIGINT', onAbort);
  process.once('SIGTERM', onAbort);

  if (draft.step > 0) {
    console.log(
      chalk.yellow(`  ⚠  Found an incomplete setup draft (${draft.step} of 5 steps completed).`)
    );
    const resume = await promptConfirm('Resume from where you left off?', true);
    if (resume) {
      resuming = true;
      console.log(chalk.dim('  Resuming…\n'));
    } else {
      draft = { step: 0 };
      clearDraft();
    }
  }

  // ── Step 1: Tempo ────────────────────────────────────────────────────────────
  printStep(1, TOTAL_STEPS, 'Tempo API');

  let tempoToken: string;
  let tempoBaseUrl: string;

  if (resuming && draft.step >= 1 && draft.tempo) {
    tempoToken = draft.tempo.token;
    tempoBaseUrl = draft.tempo.baseUrl;
    printSuccess('  Tempo credentials restored from draft');
  } else {
    printHint('Get your Tempo API token: Tempo app → Settings → API integration → New Token');
    printHint('Docs: https://apidocs.tempo.io');

    tempoToken = await promptPassword(
      'Tempo API token:',
      (v) => v.trim().length > 0 || 'Token cannot be empty'
    );

    const tempoRegion = await promptList('Tempo data region:', [
      { name: 'EU  (api.eu.tempo.io)', value: 'eu' as const },
      { name: 'US  (api.tempo.io)', value: 'us' as const },
    ]);

    tempoBaseUrl = getTempoBaseUrl(tempoRegion);

    draft = { ...draft, step: 1, tempo: { token: tempoToken, baseUrl: tempoBaseUrl, accountId: '' } };
    saveDraft(draft);
  }

  // ── Step 2: Jira ─────────────────────────────────────────────────────────────
  printStep(2, TOTAL_STEPS, 'Jira API');

  let jiraBaseUrl: string;
  let jiraEmail: string;
  let jiraToken: string;
  let accountId: string;

  if (resuming && draft.step >= 2 && draft.jira && draft.tempo?.accountId) {
    jiraBaseUrl = draft.jira.baseUrl;
    jiraEmail = draft.jira.email;
    jiraToken = draft.jira.token;
    accountId = draft.tempo.accountId;
    printSuccess('  Jira credentials restored from draft');
  } else {
    printHint('Get your Jira API token: https://id.atlassian.com/manage-profile/security/api-tokens');

    jiraBaseUrl = await promptText(
      'Jira base URL (e.g. https://yourcompany.atlassian.net):',
      undefined,
      (v) => {
        try {
          new URL(v);
          return true;
        } catch {
          return 'Enter a valid URL';
        }
      }
    );

    jiraEmail = await promptText('Jira email address:', undefined, (v) =>
      v.includes('@') ? true : 'Enter a valid email'
    );

    jiraToken = await promptPassword(
      'Jira API token:',
      (v) => v.trim().length > 0 || 'Token cannot be empty'
    );

    // Verify Jira and fetch accountId
    accountId = '';
    try {
      const jiraClient = new JiraClient(jiraBaseUrl, jiraEmail, jiraToken);
      const user = await withSpinner('Connecting to Jira…', () => jiraClient.testConnection());
      accountId = user.accountId;
      printSuccess(`Logged in as ${user.displayName} (accountId: ${accountId})`);
    } catch (err) {
      printError(`Jira connection failed: ${err instanceof Error ? err.message : String(err)}`);
      const proceed = await promptConfirm('Jira verification failed. Continue anyway?', false);
      if (!proceed) process.exit(1);

      accountId = await promptText(
        'Enter your Jira accountId manually (found in Jira profile URL):',
        undefined,
        (v) => v.trim().length > 0 || 'Cannot be empty'
      );
    }

    // Verify Tempo now that we have accountId
    try {
      const tempoClient = new TempoClient(tempoToken, tempoBaseUrl);
      const ok = await withSpinner('Connecting to Tempo…', () =>
        tempoClient.testConnection(accountId)
      );
      if (!ok) throw new Error('Unexpected empty response');
      printSuccess('Tempo connection successful');
    } catch (err) {
      printError(`Tempo connection failed: ${err instanceof Error ? err.message : String(err)}`);
      const proceed = await promptConfirm('Continue anyway?', false);
      if (!proceed) process.exit(1);
    }

    draft = {
      ...draft,
      step: 2,
      tempo: { ...draft.tempo!, accountId },
      jira: { baseUrl: jiraBaseUrl, email: jiraEmail, token: jiraToken },
    };
    saveDraft(draft);
  }

  // ── Step 3: Dyce ─────────────────────────────────────────────────────────────
  printStep(3, TOTAL_STEPS, 'Dyce API');

  let dyceClientId: string;
  let effectiveScope: string;
  let dyceAccessToken: string;
  let dyceRefreshToken: string;
  let dyceInstance: string;
  let dyceCompany: string;
  let dyceResourceNo!: string;
  let dyceResourceId: string | undefined;
  let dyceResourceName: string | undefined;

  if (resuming && draft.step >= 3 && draft.dyce) {
    ({
      clientId: dyceClientId,
      scope: effectiveScope,
      token: dyceAccessToken,
      refreshToken: dyceRefreshToken,
      instance: dyceInstance,
      company: dyceCompany,
      resourceNo: dyceResourceNo,
      resourceId: dyceResourceId,
      resourceName: dyceResourceName,
    } = draft.dyce);
    printSuccess('  Dyce credentials restored from draft');
  } else {
    showInfoBox('Finding your Dyce OAuth2 credentials from DevTools', [
      '1. Open the Dyce web app and log in normally in your browser.',
      '2. Open DevTools (F12) → Network tab → filter by "token".',
      '3. Find a POST to login.microsoftonline.com/.../oauth2/v2.0/token',
      '4. Click it → Payload tab and copy:',
      '   • client_id     → paste when prompted below',
      '   • scope         → paste when prompted below',
      '   • refresh_token → paste when prompted below',
      '',
      'x-instance / x-company: in DevTools Network tab,',
      'open any request to api.dyce.cloud → look at the',
      'Response of GET /api/settings for the exact values.',
    ]);

    dyceClientId = await promptText(
      'Dyce Azure AD client_id:',
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );

    const dyceScope = await promptText(
      'Dyce OAuth2 scope (from Payload tab):',
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );

    effectiveScope = dyceScope.includes('offline_access')
      ? dyceScope
      : `${dyceScope} offline_access`;

    const pastedRefreshToken = await promptPassword(
      'Dyce refresh_token (from Payload tab):',
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );

    // Exchange the pasted refresh token immediately to verify it works and get an access token
    let tokenData: { access_token: string; refresh_token: string };
    try {
      tokenData = await withSpinner(
        'Verifying Dyce credentials…',
        () => refreshAccessToken(dyceClientId, pastedRefreshToken, effectiveScope)
      );
      dyceAccessToken = tokenData.access_token;
      dyceRefreshToken = tokenData.refresh_token;
      printSuccess('Dyce credentials verified');
    } catch (err) {
      printError(`Dyce authentication failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    dyceInstance = decodeInput(await promptText(
      'Dyce x-instance value (from api.dyce.cloud request headers):',
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    ));

    dyceCompany = decodeInput(await promptText(
      'Dyce x-company value (from api.dyce.cloud request headers):',
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    ));

    const dyceClient3 = new DyceClient(dyceAccessToken, dyceInstance, dyceCompany);

    try {
      const recordings = await withSpinner('Connecting to Dyce & detecting your resource…', () =>
        dyceClient3.testConnection()
      );

      if (recordings.length > 0 && recordings[0].resource) {
        const res = recordings[0].resource;
        printSuccess(`Detected Dyce resource: ${res.name} (${res.no})`);

        const confirmed = await promptConfirm(`Use "${res.name} (${res.no})" as your Dyce resource?`);
        if (confirmed) {
          dyceResourceNo = res.no;
          dyceResourceId = res.id;
          dyceResourceName = res.name;
        } else {
          dyceResourceNo = await promptText(
            'Enter your Dyce Resource No:',
            undefined,
            (v) => v.trim().length > 0 || 'Cannot be empty'
          );
        }
      } else {
        printWarning(
          'No existing time recordings found. Please enter your Dyce Resource No manually.'
        );
        dyceResourceNo = await promptText(
          'Dyce Resource No (the code used in Dyce for your employee record):',
          undefined,
          (v) => v.trim().length > 0 || 'Cannot be empty'
        );

        const resolved = await dyceClient3.lookupResource(dyceResourceNo);
        if (resolved) {
          dyceResourceId = resolved.id;
          dyceResourceName = resolved.name;
          printSuccess(`Resolved resource: ${resolved.name} (${resolved.id})`);
        }
      }
    } catch (err) {
      printError(`Dyce connection failed: ${err instanceof Error ? err.message : String(err)}`);
      const proceed = await promptConfirm('Continue anyway?', false);
      if (!proceed) process.exit(1);

      dyceResourceNo = await promptText(
        'Dyce Resource No:',
        undefined,
        (v) => v.trim().length > 0 || 'Cannot be empty'
      );
    }

    draft = {
      ...draft,
      step: 3,
      dyce: {
        clientId: dyceClientId,
        scope: effectiveScope,
        token: dyceAccessToken,
        refreshToken: dyceRefreshToken,
        instance: dyceInstance,
        company: dyceCompany,
        resourceNo: dyceResourceNo,
        resourceId: dyceResourceId,
        resourceName: dyceResourceName,
      },
    };
    saveDraft(draft);
  }

  // dyceClient is available throughout step 4 (mapping resolution)
  const dyceClient = new DyceClient(dyceAccessToken, dyceInstance, dyceCompany);

  // ── Step 4: Project Mappings ──────────────────────────────────────────────────
  printStep(4, TOTAL_STEPS, 'Project Mappings');
  console.log(
    chalk.dim('  Map Jira project keys or exact issue keys to Dyce Customer / Job / Job Task codes.\n')
  );

  let mappings: DyceMapping[] = resuming && draft.step >= 4 && draft.mappings
    ? draft.mappings
    : [];

  if (resuming && draft.step >= 4 && draft.mappings) {
    printSuccess(`  ${mappings.length} mapping(s) restored from draft`);
  }

  let addMore = true;
  while (addMore) {
    const jiraProjectKey = await promptText(
      `Jira project key or issue key (e.g. PROJ or INP1-11755):`,
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );

    console.log(
      chalk.dim(`\n  Enter the Dyce codes for project ${chalk.bold(jiraProjectKey.toUpperCase())}:`)
    );

    // ── Customer ──────────────────────────────────────────────────────────────
    let dyceCustomerNo: string;
    let customerId: string | undefined;
    let customerName: string | undefined;

    const customers = await withSpinner('Fetching Dyce customers…', () => dyceClient.listCustomers());
    if (customers.length > 0) {
      const choices = customers.map((c) => ({
        name: `${c.no}${c.name ? ` — ${c.name}` : c.description ? ` — ${c.description}` : ''}`,
        value: c.no,
      }));
      dyceCustomerNo = await promptList('  Dyce Customer:', choices);
      const sel = customers.find((c) => c.no === dyceCustomerNo);
      customerId = sel?.id;
      customerName = sel?.name ?? sel?.description;
    } else {
      printWarning('Could not fetch customers — enter the No manually.');
      dyceCustomerNo = await promptText('  Dyce Customer No:');
    }

    // ── Job ───────────────────────────────────────────────────────────────────
    let dyceJobNo: string;
    let jobId: string | undefined;
    let jobDescription: string | undefined;

    const jobs = await withSpinner('Fetching Dyce projects…', () => dyceClient.listJobs(customerId));
    if (jobs.length > 0) {
      const choices = jobs.map((j) => ({
        name: `${j.no}${j.description ? ` — ${j.description}` : ''}`,
        value: j.no,
      }));
      dyceJobNo = await promptList('  Dyce Project:', choices);
      const sel = jobs.find((j) => j.no === dyceJobNo);
      jobId = sel?.id;
      jobDescription = sel?.description;
    } else {
      printWarning('Could not fetch projects — enter the No manually.');
      dyceJobNo = await promptText('  Dyce Project No:');
    }

    // ── Job Task ──────────────────────────────────────────────────────────────
    let dyceJobTaskNo: string;
    let jobTaskId: string | undefined;
    let jobTaskDescription: string | undefined;

    const jobTasks = await withSpinner('Fetching Dyce project tasks…', () => dyceClient.listJobTasks(jobId));
    if (jobTasks.length > 0) {
      const choices = jobTasks.map((t) => ({
        name: `${t.no}${t.description ? ` — ${t.description}` : ''}`,
        value: t.no,
      }));
      dyceJobTaskNo = await promptList('  Dyce Project Task:', choices);
      const sel = jobTasks.find((t) => t.no === dyceJobTaskNo);
      jobTaskId = sel?.id;
      jobTaskDescription = sel?.description;
    } else {
      printWarning('Could not fetch project tasks — enter the No manually.');
      printHint('Open DevTools → Network → /api/resourceJobAssignments/JobTasks response → copy the "no" value.');
      dyceJobTaskNo = await promptText('  Dyce Project Task No:');
    }

    // ── Job Planning Line ─────────────────────────────────────────────────────
    let jobPlanningLineId: string | undefined;
    let jobPlanningLineDescription: string | undefined;
    if (jobTaskId) {
      const planningLines = await withSpinner(
        'Fetching Dyce job planning lines…',
        () => dyceClient.listJobPlanningLines(jobTaskId!)
      );
      if (planningLines.length === 1) {
        jobPlanningLineId = planningLines[0].id;
        jobPlanningLineDescription = planningLines[0].description;
      } else if (planningLines.length > 1) {
        const choices = planningLines.map((l) => ({
          name: `${l.description ?? l.id}${l.serviceBillingType ? ` (${l.serviceBillingType})` : ''}`,
          value: l.id,
        }));
        jobPlanningLineId = await promptList('  Dyce Job Planning Line:', choices);
        const sel = planningLines.find((l) => l.id === jobPlanningLineId);
        jobPlanningLineDescription = sel?.description;
      }
    }

    const label = await promptText(`  Label for this mapping (optional, e.g. "Backend Dev"):`, '');

    const mapping: DyceMapping = {
      jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
      label: label || undefined,
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
    mappings.push(mapping);

    addMore = await promptConfirm('Add another project mapping?', false);
  }

  draft = { ...draft, step: 4, mappings };
  saveDraft(draft);

  // ── Step 5: Special Leave / Holiday Detection ───────────────────────────────
  printStep(5, TOTAL_STEPS, 'Special Leave / Holiday Detection');

  let vacationPrefixes: string[];
  let publicHolidayDescription: string;

  if (resuming && draft.step >= 5 && draft.vacationPrefixes) {
    vacationPrefixes = draft.vacationPrefixes;
    publicHolidayDescription = draft.publicHolidayDescription ?? 'Government approved official holiday';
    printSuccess(`  Vacation prefixes restored: ${vacationPrefixes.join(', ') || '(none)'}`);
  } else {
    printHint('Worklogs matching these Jira values will be treated as vacation, sick leave, or public holiday.');
    printHint('During sync you will choose the type for each matching entry.');
    printHint('Only vacation/sick leave entries require a Paser request ID.');
    printHint('You can enter full ticket numbers (e.g. INP1-11755) or project prefixes (e.g. INP1).');
    printHint('Use comma-separated values if needed.');

    const vacationRaw = await promptText(
      'Special leave/holiday ticket numbers or project prefixes (comma-separated, e.g. INP1-11755,INP1):',
      ''
    );

    vacationPrefixes = vacationRaw
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter((v) => v.length > 0);

    publicHolidayDescription = await promptText(
      'Description to use for government-approved official holidays in Dyce:',
      'Government approved official holiday',
      (v) => v.trim().length > 0 || 'Description cannot be empty'
    );

    if (vacationPrefixes.length > 0) {
      printSuccess(`Special leave/holiday values: ${vacationPrefixes.join(', ')}`);
    }
    printSuccess(`Public holiday description: ${publicHolidayDescription}`);

    draft = { ...draft, step: 5, vacationPrefixes, publicHolidayDescription };
    saveDraft(draft);
  }

  // ── Step 6: Save ──────────────────────────────────────────────────────────────
  printStep(6, TOTAL_STEPS, 'Saving Configuration');

  const config: Config = {
    tempo: {
      token: tempoToken,
      baseUrl: tempoBaseUrl,
      accountId,
    },
    jira: {
      baseUrl: jiraBaseUrl,
      email: jiraEmail,
      token: jiraToken,
    },
    dyce: {
      clientId: dyceClientId,
      scope: effectiveScope,
      token: dyceAccessToken,
      refreshToken: dyceRefreshToken,
      instance: dyceInstance,
      company: dyceCompany,
      resourceNo: dyceResourceNo,
      resourceId: dyceResourceId,
      resourceName: dyceResourceName,
    },
    mappings,
    vacationPrefixes,
    publicHolidayDescription,
  };

  saveConfig(config);
  clearDraft();
  // Setup completed — remove abort handlers so they don't fire on normal exit
  process.off('SIGINT', onAbort);
  process.off('SIGTERM', onAbort);

  console.log();
  console.log(chalk.green.bold('✔  Setup complete! Config saved to ~/.aion/config.json'));
  console.log();
  console.log(
    chalk.dim('Run ') +
    chalk.cyan('aion preview') +
    chalk.dim(' to see your worklogs before syncing.')
  );
  console.log(
    chalk.dim('Run ') +
    chalk.cyan('aion sync') +
    chalk.dim(" to sync this month's worklogs to Dyce.")
  );
  console.log();
}
