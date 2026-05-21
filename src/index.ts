import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/banner';
import { runSetup } from './commands/setup';
import { runSync } from './commands/sync';
import { runPreview } from './commands/preview';
import {
  runConfigList,
  runConfigAddMapping,
  runConfigSetVacation,
  runConfigEditTempo,
  runConfigEditJira,
  runConfigEditPaser,
  runConfigReAuthDyce,
} from './commands/config';
import { configExists } from './config/manager';

const program = new Command();

program.name('aion').description('Sync Tempo worklogs → Dyce time recordings').version('1.0.0');

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
  .option('--week', "Sync this week's worklogs")
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts: { today?: boolean; week?: boolean; from?: string; to?: string }) => {
    if (!configExists()) {
      console.error(
        chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
      );
      process.exit(1);
    }
    showBanner();
    try {
      await runSync(opts);
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// ── aion preview ────────────────────────────────────────────────────────────
program
  .command('preview')
  .description('Dry run — show what would be synced without making changes')
  .option('--today', "Preview today's worklogs only")
  .option('--week', "Preview this week's worklogs")
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts: { today?: boolean; week?: boolean; from?: string; to?: string }) => {
    if (!configExists()) {
      console.error(
        chalk.red('\n  No config found. Run ') + chalk.cyan('aion setup') + chalk.red(' first.\n')
      );
      process.exit(1);
    }
    showBanner();
    try {
      await runPreview(opts);
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

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
  .description('Re-authenticate with Dyce via Microsoft OAuth2 device code flow')
  .action(async () => {
    try {
      await runConfigReAuthDyce();
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }
  });

// Default: show banner + help if no args
if (process.argv.length <= 2) {
  showBanner();
}

program.parse(process.argv);
