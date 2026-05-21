import ora, { Ora } from 'ora';
import chalk from 'chalk';

export function startSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start();
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = startSpinner(text);
  try {
    const result = await fn();
    spinner.succeed(chalk.green(text));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`${text} — ${msg}`));
    throw err;
  }
}

export async function withSpinnerCustom<T>(
  text: string,
  successText: string,
  fn: () => Promise<T>
): Promise<T> {
  const spinner = startSpinner(text);
  try {
    const result = await fn();
    spinner.succeed(chalk.green(successText));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`${text} — ${msg}`));
    throw err;
  }
}
