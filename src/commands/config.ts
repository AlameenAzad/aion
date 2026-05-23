import chalk from 'chalk';
import { loadConfig, saveConfig, maskToken } from '../config/manager';
import {
  promptText,
  promptPassword,
  promptList,
  promptConfirm,
  printStep,
  printSuccess,
  printHint,
  printWarning,
  printError,
} from '../ui/prompts';
import { DyceMapping } from '../config/schema';
import { DyceClient } from '../api/dyce';
import { resolveDyceToken, refreshAccessToken } from '../api/msauth';
import { withSpinner } from '../ui/spinner';
import { showInfoBox } from '../ui/banner';
import { TempoClient, getTempoBaseUrl } from '../api/tempo';
import { JiraClient } from '../api/jira';
import { PaserClient } from '../api/paser';
import { configureLeaveTypeMappings } from '../utils/leaveSetup';

export function runConfigList(): void {
  const config = loadConfig();

  console.log();
  console.log(chalk.bold.cyan('Current Configuration'));
  console.log(chalk.dim('─'.repeat(50)));

  console.log(chalk.bold('\nTempo:'));
  console.log(`  Region/Base URL : ${config.tempo.baseUrl}`);
  console.log(`  Account ID      : ${config.tempo.accountId}`);
  console.log(`  Token           : ${maskToken(config.tempo.token)}`);

  console.log(chalk.bold('\nJira:'));
  console.log(`  Base URL        : ${config.jira.baseUrl}`);
  console.log(`  Email           : ${config.jira.email}`);
  console.log(`  Token           : ${maskToken(config.jira.token)}`);

  console.log(chalk.bold('\nDyce:'));
  console.log(`  Instance        : ${config.dyce.instance}`);
  console.log(`  Company         : ${config.dyce.company}`);
  console.log(`  Resource No     : ${config.dyce.resourceNo}`);
  if (config.dyce.resourceName) {
    console.log(`  Resource Name   : ${config.dyce.resourceName}`);
  }
  console.log(
    `  Token           : ${config.dyce.token ? maskToken(config.dyce.token) : '(will refresh on next use)'}`
  );

  console.log(chalk.bold('\nPaser:'));
  if (config.paser) {
    console.log(`  Base URL        : ${config.paser.baseUrl}`);
    console.log(`  Email           : ${config.paser.email}`);
    console.log('  Password        : (configured)');
    console.log(`  Account ID      : ${config.paser.accountId}`);
  } else {
    console.log(chalk.dim('  (not configured)'));
  }

  console.log(chalk.bold('\nProject Mappings:'));
  if (config.mappings.length === 0) {
    console.log(chalk.dim('  (none configured)'));
  } else {
    for (const m of config.mappings) {
      const label = m.label ? ` — ${m.label}` : '';
      console.log(`  ${chalk.cyan(m.jiraProjectKey)}${chalk.dim(label)}`);
      console.log(
        `    Customer : ${m.dyce.customerNo}${m.dyce.customerName ? ` (${m.dyce.customerName})` : ''}`
      );
      console.log(
        `    Job      : ${m.dyce.jobNo}${m.dyce.jobDescription ? ` (${m.dyce.jobDescription})` : ''}`
      );
      console.log(
        `    Job Task : ${m.dyce.jobTaskNo}${m.dyce.jobTaskDescription ? ` (${m.dyce.jobTaskDescription})` : ''}`
      );
    }
  }

  console.log(chalk.bold('\nVacation Prefixes:'));
  if (config.vacationPrefixes.length === 0) {
    console.log(chalk.dim('  (none configured)'));
  } else {
    console.log(`  ${config.vacationPrefixes.join(', ')}`);
  }

  console.log(chalk.bold('\nPublic Holiday Description:'));
  console.log(`  ${config.publicHolidayDescription || '(not set)'}`);

  console.log();
}

export async function runConfigAddMapping(prefillKey?: string): Promise<void> {
  const config = loadConfig();

  printStep(1, 1, 'Add Project Mapping');
  printHint('Map a Jira project key or exact issue key to a Dyce Customer / Job / Job Task.');

  let jiraProjectKey: string;
  if (prefillKey) {
    jiraProjectKey = prefillKey.trim().toUpperCase();
    console.log(chalk.dim(`  Jira key: ${jiraProjectKey}`));
  } else {
    jiraProjectKey = await promptText(
      'Jira project key or issue key (e.g. PROJ or INP1-11755):',
      undefined,
      (v) => v.trim().length > 0 || 'Cannot be empty'
    );
  }

  const existingCount = config.mappings.filter(
    (m) => m.jiraProjectKey.toUpperCase() === jiraProjectKey.trim().toUpperCase()
  ).length;
  if (existingCount > 0) {
    printHint(
      `${existingCount} mapping(s) already exist for ${jiraProjectKey.toUpperCase()}. ` +
      'This new mapping will be added as an additional option.'
    );
  }

  const dyceToken = await resolveDyceToken(config);
  const dyceClient = new DyceClient(dyceToken, config.dyce.instance, config.dyce.company);

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
    dyceCustomerNo = await promptList('Dyce Customer:', choices);
    const sel = customers.find((c) => c.no === dyceCustomerNo);
    customerId = sel?.id;
    customerName = sel?.name ?? sel?.description;
  } else {
    printWarning('Could not fetch customers — enter the No manually.');
    dyceCustomerNo = await promptText('Dyce Customer No:');
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
    dyceJobNo = await promptList('Dyce Project:', choices);
    const sel = jobs.find((j) => j.no === dyceJobNo);
    jobId = sel?.id;
    jobDescription = sel?.description;
  } else {
    printWarning('Could not fetch projects — enter the No manually.');
    dyceJobNo = await promptText('Dyce Project No:');
  }

  // ── Job Task ──────────────────────────────────────────────────────────────
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
    dyceJobTaskNo = await promptList('Dyce Project Task:', choices);
    const sel = jobTasks.find((t) => t.no === dyceJobTaskNo);
    jobTaskId = sel?.id;
    jobTaskDescription = sel?.description;
  } else {
    printWarning('Could not fetch project tasks — enter the No manually.');
    printHint(
      'Open DevTools → Network → /api/resourceJobAssignments/JobTasks response → copy the "no" value.'
    );
    dyceJobTaskNo = await promptText('Dyce Job Task No:');
  }

  // ── Job Planning Line ─────────────────────────────────────────────────────
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
      jobPlanningLineId = await promptList('Dyce Job Planning Line:', choices);
      const sel = planningLines.find((l) => l.id === jobPlanningLineId);
      jobPlanningLineDescription = sel?.description;
    }
  }

  const label = await promptText('Label (optional):', '');

  const newMapping: DyceMapping = {
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

  const updatedMappings = [...config.mappings, newMapping];

  saveConfig({ ...config, mappings: updatedMappings });
  printSuccess(`Mapping for ${jiraProjectKey.toUpperCase()} saved.`);
}

export async function runConfigSetVacation(): Promise<void> {
  const config = loadConfig();

  console.log();
  console.log(chalk.bold('Current special leave/holiday values:'));
  console.log(
    config.vacationPrefixes.length > 0
      ? `  ${config.vacationPrefixes.join(', ')}`
      : chalk.dim('  (none)')
  );

  if (config.leaveTypeMappings) {
    console.log();
    console.log(chalk.bold('Current Dyce leave-type mappings:'));
    for (const [key, m] of Object.entries(config.leaveTypeMappings)) {
      if (m) {
        console.log(`  ${key}: ${m.dyce.customerNo} / ${m.dyce.jobNo} / ${m.dyce.jobTaskNo}`);
      }
    }
  }
  console.log();

  printHint('These Jira values identify leave/holiday worklogs during sync.');
  printHint('After updating the prefixes you will configure the Dyce target for each leave type.');

  const raw = await promptText(
    'Special leave/holiday ticket numbers or project prefixes (comma-separated, e.g. INP1-11755,VAC):',
    config.vacationPrefixes.join(', ')
  );

  const prefixes = raw
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter((v) => v.length > 0);

  const publicHolidayDescription = await promptText(
    'Description to use for public holidays in Dyce:',
    config.publicHolidayDescription || 'Government approved official holiday',
    (v) => v.trim().length > 0 || 'Description cannot be empty'
  );

  // ── Dyce leave-type mappings ─────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('  Configure Dyce targets for each leave type:'));
  console.log(
    chalk.dim('  Each leave type is logged to its own Dyce customer / project / task.\n')
  );

  const dyceToken = await resolveDyceToken(config);
  const dyceClient = new DyceClient(dyceToken, config.dyce.instance, config.dyce.company);

  const leaveTypeMappings = await configureLeaveTypeMappings(
    dyceClient,
    config.leaveTypeMappings ?? {}
  );

  saveConfig({
    ...config,
    vacationPrefixes: prefixes,
    publicHolidayDescription,
    leaveTypeMappings: Object.keys(leaveTypeMappings).length > 0 ? leaveTypeMappings : undefined,
  });

  printSuccess(`Special leave/holiday values updated: ${prefixes.join(', ') || '(none)'}`);
  printSuccess(`Public holiday description: "${publicHolidayDescription}"`);
}

// ── aion config edit-tempo ────────────────────────────────────────────────────

export async function runConfigEditTempo(): Promise<void> {
  const config = loadConfig();

  printStep(1, 1, 'Update Tempo credentials');
  printHint('Get your Tempo API token: Tempo app → Settings → API integration → New Token');

  const tempoToken = await promptPassword(
    'New Tempo API token:',
    (v) => v.trim().length > 0 || 'Token cannot be empty'
  );

  const tempoRegion = await promptList('Tempo data region:', [
    { name: 'EU  (api.eu.tempo.io)', value: 'eu' as const },
    { name: 'US  (api.tempo.io)', value: 'us' as const },
  ]);

  const tempoBaseUrl = getTempoBaseUrl(tempoRegion);

  try {
    const client = new TempoClient(tempoToken, tempoBaseUrl);
    await withSpinner('Testing Tempo connection…', () =>
      client.testConnection(config.tempo.accountId)
    );
    printSuccess('Tempo connection successful');
  } catch (err) {
    printError(`Tempo connection failed: ${err instanceof Error ? err.message : String(err)}`);
    const proceed = await promptConfirm('Save anyway?', false);
    if (!proceed) return;
  }

  saveConfig({ ...config, tempo: { ...config.tempo, token: tempoToken, baseUrl: tempoBaseUrl } });
  printSuccess('Tempo credentials updated');
}

// ── aion config edit-jira ─────────────────────────────────────────────────────

export async function runConfigEditJira(): Promise<void> {
  const config = loadConfig();

  printStep(1, 1, 'Update Jira credentials');
  printHint('Get your Jira API token: https://id.atlassian.com/manage-profile/security/api-tokens');

  const jiraBaseUrl = await promptText('Jira base URL:', config.jira.baseUrl, (v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return 'Enter a valid URL';
    }
  });

  const jiraEmail = await promptText('Jira email address:', config.jira.email, (v) =>
    v.includes('@') ? true : 'Enter a valid email'
  );

  const jiraToken = await promptPassword(
    'Jira API token:',
    (v) => v.trim().length > 0 || 'Token cannot be empty'
  );

  try {
    const client = new JiraClient(jiraBaseUrl, jiraEmail, jiraToken);
    const user = await withSpinner('Testing Jira connection…', () => client.testConnection());
    printSuccess(`Logged in as ${user.displayName}`);
    saveConfig({
      ...config,
      jira: { baseUrl: jiraBaseUrl, email: jiraEmail, token: jiraToken },
      tempo: { ...config.tempo, accountId: user.accountId },
    });
  } catch (err) {
    printError(`Jira connection failed: ${err instanceof Error ? err.message : String(err)}`);
    const proceed = await promptConfirm('Save anyway?', false);
    if (!proceed) return;
    saveConfig({ ...config, jira: { baseUrl: jiraBaseUrl, email: jiraEmail, token: jiraToken } });
  }

  printSuccess('Jira credentials updated');
}

// ── aion config edit-paser ────────────────────────────────────────────────────

export async function runConfigEditPaser(): Promise<void> {
  const config = loadConfig();

  printStep(1, 1, 'Update Paser credentials');

  const paserBaseUrl = await promptText(
    'Paser base URL:',
    config.paser?.baseUrl || 'https://app.paser.io',
    (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return 'Enter a valid URL';
      }
    }
  );

  const paserEmail = await promptText(
    'Paser email address:',
    config.paser?.email || config.jira.email,
    (v) => (v.includes('@') ? true : 'Enter a valid email')
  );

  const paserPassword = await promptPassword(
    'Paser password:',
    (v) => v.trim().length > 0 || 'Password cannot be empty'
  );

  let accounts: Array<{ accountId: number; accountName: string }> = [];
  try {
    const client = new PaserClient(paserBaseUrl);
    const auth = await withSpinner('Testing Paser connection…', () =>
      client.testConnection(paserEmail, paserPassword)
    );
    accounts = (auth.user.accounts ?? []).map((a) => ({
      accountId: a.accountId,
      accountName: a.accountName,
    }));

    if (accounts.length === 0) {
      throw new Error('No Paser accounts were returned for this user.');
    }
    printSuccess('Paser connection successful');
  } catch (err) {
    printError(`Paser connection failed: ${err instanceof Error ? err.message : String(err)}`);
    const proceed = await promptConfirm('Save anyway?', false);
    if (!proceed) return;
  }

  let accountId = config.paser?.accountId;
  if (accounts.length === 1) {
    accountId = accounts[0].accountId;
  } else if (accounts.length > 1) {
    const selected = await promptList(
      'Select Paser account:',
      accounts.map((a) => ({
        name: `${a.accountName} (${a.accountId})`,
        value: String(a.accountId),
      }))
    );
    accountId = Number(selected);
  } else if (accountId == null) {
    const rawAccountId = await promptText(
      'Paser accountId:',
      '',
      (v) => /^\d+$/.test(v.trim()) || 'Account ID must be a positive integer'
    );
    accountId = Number(rawAccountId.trim());
  }

  saveConfig({
    ...config,
    paser: {
      baseUrl: paserBaseUrl,
      email: paserEmail,
      password: paserPassword,
      accountId: accountId!,
    },
  });

  printSuccess('Paser credentials updated');
}

// ── aion config re-auth-dyce ──────────────────────────────────────────────────

export async function runConfigReAuthDyce(): Promise<void> {
  const config = loadConfig();

  printStep(1, 1, 'Re-authenticate Dyce');

  showInfoBox('Finding your Dyce OAuth2 credentials from DevTools', [
    'Open DevTools (F12) → Network tab → filter by "token".',
    'Find the POST to login.microsoftonline.com/.../oauth2/v2.0/token',
    'Copy "client_id", "scope", and "refresh_token" from the Payload tab.',
  ]);

  const dyceClientId = await promptText(
    'Dyce Azure AD client_id:',
    config.dyce.clientId,
    (v) => v.trim().length > 0 || 'Cannot be empty'
  );

  const dyceScope = await promptText(
    'Dyce OAuth2 scope:',
    config.dyce.scope,
    (v) => v.trim().length > 0 || 'Cannot be empty'
  );

  const effectiveScope = dyceScope.includes('offline_access')
    ? dyceScope
    : `${dyceScope} offline_access`;

  const pastedRefreshToken = await promptPassword(
    'Dyce refresh_token (from Payload tab):',
    (v) => v.trim().length > 0 || 'Cannot be empty'
  );

  let accessToken: string;
  let refreshToken: string;

  try {
    const tokenData = await withSpinner('Verifying Dyce credentials…', () =>
      refreshAccessToken(dyceClientId, pastedRefreshToken, effectiveScope)
    );

    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token;
    printSuccess('Dyce credentials verified');
  } catch (err) {
    printError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  saveConfig({
    ...config,
    dyce: {
      ...config.dyce,
      clientId: dyceClientId,
      scope: effectiveScope,
      token: accessToken,
      refreshToken,
    },
  });

  printSuccess('Dyce credentials updated');
}
