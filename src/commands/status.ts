import chalk from 'chalk';
import { loadConfig, configExists } from '../config/manager';
import { TempoClient } from '../api/tempo';
import { JiraClient } from '../api/jira';
import { DyceClient } from '../api/dyce';
import { PaserClient } from '../api/paser';
import { resolveDyceToken, isTokenExpired } from '../api/msauth';
import { startSpinner } from '../ui/spinner';

interface ServiceStatus {
  name: string;
  ok: boolean;
  detail: string;
}

function tokenExpiry(token: string | undefined): string {
  if (!token) return 'no cached token (will refresh)';
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
      exp?: number;
    };
    if (!payload.exp) return 'unknown expiry';
    const diffSeconds = Math.floor(payload.exp - Date.now() / 1000);
    if (diffSeconds <= 0) return chalk.red('expired');
    const h = Math.floor(diffSeconds / 3600);
    const m = Math.floor((diffSeconds % 3600) / 60);
    return chalk.green(`expires in ${h}h ${m}m`);
  } catch {
    return 'unknown expiry';
  }
}

function printStatus(results: ServiceStatus[]): void {
  const width = Math.max(...results.map((r) => r.name.length)) + 2;
  console.log();
  for (const r of results) {
    const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
    const label = r.name.padEnd(width);
    const detail = r.ok ? chalk.dim(r.detail) : chalk.red(r.detail);
    console.log(`  ${icon} ${chalk.bold(label)} ${detail}`);
  }
  console.log();
}

export async function runStatus(): Promise<void> {
  if (!configExists()) {
    console.error(
      chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
    );
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(
      chalk.red(`\n  Failed to load config: ${err instanceof Error ? err.message : String(err)}\n`)
    );
    process.exit(1);
  }

  const results: ServiceStatus[] = [];

  // ── Tempo ───────────────────────────────────────────────────────────────────
  const tempoSpinner = startSpinner('Checking Tempo…');
  try {
    const tempo = new TempoClient(config.tempo.token, config.tempo.baseUrl);
    const ok = await tempo.testConnection(config.tempo.accountId);
    if (ok) {
      tempoSpinner.succeed(chalk.green('Tempo — connected'));
      results.push({ name: 'Tempo', ok: true, detail: config.tempo.baseUrl });
    } else {
      tempoSpinner.fail(chalk.red('Tempo — connection failed'));
      results.push({ name: 'Tempo', ok: false, detail: 'connection test returned false' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tempoSpinner.fail(chalk.red(`Tempo — ${msg}`));
    results.push({ name: 'Tempo', ok: false, detail: msg });
  }

  // ── Jira ────────────────────────────────────────────────────────────────────
  const jiraSpinner = startSpinner('Checking Jira…');
  try {
    const jira = new JiraClient(config.jira.baseUrl, config.jira.email, config.jira.token);
    const user = await jira.testConnection();
    jiraSpinner.succeed(chalk.green(`Jira — connected as ${user.displayName}`));
    results.push({ name: 'Jira', ok: true, detail: `logged in as ${user.displayName}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    jiraSpinner.fail(chalk.red(`Jira — ${msg}`));
    results.push({ name: 'Jira', ok: false, detail: msg });
  }

  // ── Dyce ────────────────────────────────────────────────────────────────────
  const dyceSpinner = startSpinner('Checking Dyce…');
  try {
    const token = await resolveDyceToken(config);
    const dyce = new DyceClient(token, config.dyce.instance, config.dyce.company);
    await dyce.getRecentTimeRecordings(1);
    const expiry = tokenExpiry(token);
    dyceSpinner.succeed(chalk.green(`Dyce — connected (${expiry})`));
    results.push({
      name: 'Dyce',
      ok: true,
      detail: `resource ${config.dyce.resourceNo} — token ${expiry}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const expired = config.dyce.token ? isTokenExpired(config.dyce.token) : true;
    dyceSpinner.fail(chalk.red(`Dyce — ${msg}`));
    results.push({
      name: 'Dyce',
      ok: false,
      detail: `${msg}${expired ? ' (token expired — run `aion config re-auth-dyce`)' : ''}`,
    });
  }

  // ── Paser (optional) ────────────────────────────────────────────────────────
  if (config.paser) {
    const paserSpinner = startSpinner('Checking Paser…');
    try {
      const paser = new PaserClient(config.paser.baseUrl);
      await paser.authenticate(config.paser.email, config.paser.password);
      paserSpinner.succeed(chalk.green('Paser — connected'));
      results.push({ name: 'Paser', ok: true, detail: `account ${config.paser.accountId}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      paserSpinner.fail(chalk.red(`Paser — ${msg}`));
      results.push({ name: 'Paser', ok: false, detail: msg });
    }
  } else {
    results.push({ name: 'Paser', ok: true, detail: 'not configured (optional)' });
  }

  printStatus(results);

  const allOk = results.every((r) => r.ok);
  if (!allOk) {
    process.exit(1);
  }
}
