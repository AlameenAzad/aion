import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import chalk from 'chalk';

export function showBanner(): void {
  const title = figlet.textSync('AION', {
    font: 'Big',
    horizontalLayout: 'fitted',
  });

  const coloredTitle = gradient(['#00d4ff', '#9b59b6', '#e74c3c']).multiline(title);

  const subtitle = chalk.dim('  Tempo → Dyce worklog sync  |  αἰών');
  const version = chalk.dim('  v1.0.0');

  const content = `${coloredTitle}\n${subtitle}  ${version}`;

  console.log(
    boxen(content, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
    })
  );
}

export function showSuccessBanner(message: string): void {
  console.log(
    boxen(chalk.green(`✔  ${message}`), {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'green',
    })
  );
}

export function showErrorBanner(message: string): void {
  console.log(
    boxen(chalk.red(`✖  ${message}`), {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'red',
    })
  );
}

export function showInfoBox(title: string, lines: string[]): void {
  const content = [chalk.bold(title), '', ...lines].join('\n');
  console.log(
    boxen(content, {
      padding: 1,
      margin: { top: 0, bottom: 1, left: 0, right: 0 },
      borderStyle: 'single',
      borderColor: 'cyan',
    })
  );
}
