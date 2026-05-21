import chalk from 'chalk';
import { runSync } from './sync';
import { DateFlags } from '../utils/date';

export async function runPreview(flags: DateFlags): Promise<void> {
  // Preview is just a dry-run of sync
  console.log();
  console.log(chalk.bold.cyan('aion preview') + chalk.dim(' — dry run, no changes will be made'));

  await runSync({ ...flags, dryRun: true });
}
