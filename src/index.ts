import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/banner';
import { runSetup } from './commands/setup';
import { runSync } from './commands/sync';
import { runPreview } from './commands/preview';
import { runStatus } from './commands/status';
import {
  runConfigList,
  runConfigAddMapping,
  runConfigSetVacation,
  runConfigEditTempo,
  runConfigEditJira,
  runConfigEditPaser,
  runConfigReAuthDyce,
} from './commands/config';
import { runConfigExport, runConfigImport } from './commands/configExport';
import { runTokenRefresh } from './commands/tokenRefresh';
import { runCronInstall, runCronUninstall, runCronStatus } from './commands/cron';
import { configExists } from './config/manager';
import { setVerbose } from './utils/verbose';

const program = new Command();

program
  .name('aion')
  .description('Sync Tempo worklogs → Dyce time recordings')
  .version(require('../package.json').version as string)
  .option('--verbose', 'Enable verbose debug output to stderr')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ verbose?: boolean }>();
    if (opts.verbose) setVerbose(true);
  });

// ── aion status ──────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Check connectivity to all configured services (Tempo, Jira, Dyce, Paser)')
  .action(async () => {
    if (!configExists()) {
      console.error(
        chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
      );
      process.exit(1);
    }
    try {
      await runStatus();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// ── aion setup ───────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Interactive setup wizard — configure Tempo, Jira, and Dyce credentials')
  .action(async () => {
    try {
      await runSetup();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// ── aion sync ────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Sync Tempo worklogs to Dyce (default: current month)')
  .option('--today', "Sync today's worklogs only")
  .option('--yesterday', "Sync yesterday's worklogs only")
  .option('--week', "Sync this week's worklogs")
  .option('--last-week', "Sync last week's worklogs")
  .option('--last-month', "Sync last month's worklogs")
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(
    async (opts: {
      today?: boolean;
      yesterday?: boolean;
      week?: boolean;
      lastWeek?: boolean;
      lastMonth?: boolean;
      from?: string;
      to?: string;
    }) => {
      if (!configExists()) {
        console.error(
          chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
        );
        process.exit(1);
      }
      await showBanner();
      try {
        await runSync(opts);
      } catch (err) {
        console.error(
          chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`)
        );
        process.exit(1);
      }
    }
  );

// ── aion preview ────────────────────────────────────────────────────────────
program
  .command('preview')
  .description('Dry run — show what would be synced without making changes')
  .option('--today', "Preview today's worklogs only")
  .option('--yesterday', "Preview yesterday's worklogs only")
  .option('--week', "Preview this week's worklogs")
  .option('--last-week', "Preview last week's worklogs")
  .option('--last-month', "Preview last month's worklogs")
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(
    async (opts: {
      today?: boolean;
      yesterday?: boolean;
      week?: boolean;
      lastWeek?: boolean;
      lastMonth?: boolean;
      from?: string;
      to?: string;
    }) => {
      if (!configExists()) {
        console.error(
          chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
        );
        process.exit(1);
      }
      await showBanner();
      try {
        await runPreview(opts);
      } catch (err) {
        console.error(
          chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`)
        );
        process.exit(1);
      }
    }
  );

// ── aion config ─────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage aion configuration');

configCmd
  .command('list')
  .description('Show current configuration (tokens are masked)')
  .action(() => {
    try {
      runConfigList();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('add-mapping')
  .description('Add or update a Jira → Dyce project mapping')
  .action(async () => {
    try {
      await runConfigAddMapping();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('set-vacation')
  .description('Update the Jira project key prefixes that indicate vacation/leave')
  .action(async () => {
    try {
      await runConfigSetVacation();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('edit-tempo')
  .description('Update Tempo API token and region')
  .action(async () => {
    try {
      await runConfigEditTempo();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('edit-jira')
  .description('Update Jira base URL, email, and API token')
  .action(async () => {
    try {
      await runConfigEditJira();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('edit-paser')
  .description('Update Paser base URL, email, password, and account')
  .action(async () => {
    try {
      await runConfigEditPaser();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('re-auth-dyce')
  .description('Re-authenticate Dyce by updating OAuth refresh token from DevTools')
  .action(async () => {
    try {
      await runConfigReAuthDyce();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('export')
  .description('Export current configuration to a JSON file')
  .option('--file <path>', 'Output file path (default: ./aion-config-export.json)')
  .option('--include-secrets', 'Include plaintext secrets in the export (handle with care)')
  .action(async (opts: { file?: string; includeSecrets?: boolean }) => {
    try {
      await runConfigExport(opts);
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

configCmd
  .command('import <file>')
  .description('Import configuration from a JSON file exported by `aion config export`')
  .action(async (file: string) => {
    try {
      await runConfigImport(file);
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// ── aion token-refresh ───────────────────────────────────────────────────────
program
  .command('token-refresh')
  .description('Silently refresh the Dyce access token (safe to run as a scheduled job)')
  .action(async () => {
    if (!configExists()) {
      console.error(
        chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
      );
      process.exit(1);
    }
    try {
      await runTokenRefresh();
    } catch (err) {
      const ts = new Date().toISOString();
      process.stdout.write(
        `[${ts}] token-refresh failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }
  });

// ── aion cron ────────────────────────────────────────────────────────────────
const cronCmd = program.command('cron').description('Manage the background Dyce token-refresh job');

cronCmd
  .command('install')
  .description('Install a system job to refresh the Dyce token every hour')
  .action(async () => {
    if (!configExists()) {
      console.error(
        chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
      );
      process.exit(1);
    }
    try {
      await runCronInstall();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

cronCmd
  .command('uninstall')
  .description('Remove the background token-refresh job')
  .action(async () => {
    try {
      await runCronUninstall();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

cronCmd
  .command('status')
  .description('Show whether the background job is installed and its last run result')
  .action(async () => {
    try {
      await runCronStatus();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Default: show banner + help if no args
if (process.argv.length <= 2) {
  void showBanner();
}

program.parse(process.argv);
