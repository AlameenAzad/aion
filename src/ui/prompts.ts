import inquirer from 'inquirer';
import chalk from 'chalk';

export async function promptText(
  message: string,
  defaultValue?: string,
  validate?: (val: string) => boolean | string
): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
      validate: validate
        ? (v: string) => {
            const result = validate(v);
            return result === true ? true : result || 'Invalid value';
          }
        : undefined,
    },
  ]);
  return value;
}

export async function promptPassword(
  message: string,
  validate?: (val: string) => boolean | string
): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: 'password',
      name: 'value',
      message,
      mask: '•',
      validate: validate
        ? (v: string) => {
            const result = validate(v);
            return result === true ? true : result || 'Invalid value';
          }
        : undefined,
    },
  ]);
  return value;
}

export async function promptList<T extends string>(
  message: string,
  choices: { name: string; value: T }[]
): Promise<T> {
  const { value } = await inquirer.prompt<{ value: T }>([
    {
      type: 'list',
      name: 'value',
      message,
      choices,
    },
  ]);
  return value;
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  const { value } = await inquirer.prompt<{ value: boolean }>([
    {
      type: 'confirm',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);
  return value;
}

export function printStep(step: number, total: number, label: string): void {
  console.log();
  console.log(chalk.bold.cyan(`[${step}/${total}] ${label}`));
  console.log(chalk.dim('─'.repeat(50)));
}

export function printHint(text: string): void {
  console.log(chalk.dim(`  ℹ  ${text}`));
}

export function printSuccess(text: string): void {
  console.log(chalk.green(`  ✔  ${text}`));
}

export function printWarning(text: string): void {
  console.log(chalk.yellow(`  ⚠  ${text}`));
}

export function printError(text: string): void {
  console.log(chalk.red(`  ✖  ${text}`));
}
