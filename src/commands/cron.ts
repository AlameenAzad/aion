import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { printSuccess, printError, printWarning, printHint } from '../ui/prompts';

// ── Constants ──────────────────────────────────────────────────────────────────

const LAUNCH_AGENT_LABEL = 'io.aion.token-refresh';
const LAUNCH_AGENT_PLIST = path.join(
  os.homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCH_AGENT_LABEL}.plist`
);
const CRON_LOG = '/tmp/aion-token-refresh.log';
const CRON_BEGIN = '# BEGIN aion-token-refresh';
const CRON_END = '# END aion-token-refresh';
const WINDOWS_TASK_NAME = 'aion-token-refresh';

// ── Platform detection ─────────────────────────────────────────────────────────

type Platform = 'macos' | 'linux' | 'windows' | 'unsupported';

function getPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unsupported';
  }
}

/**
 * Returns the absolute paths needed to run aion as an OS-level scheduled job.
 *
 * We separate the Node.js runtime (`nodePath`) from the script (`scriptPath`)
 * so that launchd / crontab / Task Scheduler can invoke the *signed* node
 * binary directly, with our script as an argument. This avoids two macOS issues:
 *   1. "index.js" appearing as the process name (it now shows "node").
 *   2. "Item from unidentified developer" — the node binary is signed by the
 *      Node.js Foundation (TeamIdentifier HX7739G8FX), so Gatekeeper accepts it.
 *
 * `process.execPath` is always the exact node binary that launched this process,
 * so it's correct regardless of nvm version, Homebrew, or system node.
 */
function resolveAionPaths(): { nodePath: string; scriptPath: string } {
  return {
    nodePath: process.execPath,
    scriptPath: path.resolve(process.argv[1]),
  };
}

// ── macOS launchd ─────────────────────────────────────────────────────────────

function buildPlist(nodePath: string, scriptPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>token-refresh</string>
  </array>
  <key>StartInterval</key>
  <integer>43200</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CRON_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${CRON_LOG}</string>
</dict>
</plist>
`;
}

async function installMacos(nodePath: string, scriptPath: string): Promise<void> {
  // Ensure the LaunchAgents directory exists (mkdirSync with recursive is idempotent)
  const launchAgentsDir = path.dirname(LAUNCH_AGENT_PLIST);
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  // Always attempt unload — execFileNoThrow swallows the error when the plist
  // isn't loaded yet. This also avoids a TOCTOU race between existsSync and
  // the subsequent write (flagged by CodeQL as a file-system race condition).
  await execFileNoThrow('launchctl', ['unload', LAUNCH_AGENT_PLIST]);

  fs.writeFileSync(LAUNCH_AGENT_PLIST, buildPlist(nodePath, scriptPath), { mode: 0o644 });

  const result = await execFileNoThrow('launchctl', ['load', LAUNCH_AGENT_PLIST]);
  if (result.exitCode !== 0 && result.stderr) {
    throw new Error(`launchctl load failed: ${result.stderr.trim()}`);
  }
}

async function uninstallMacos(): Promise<void> {
  if (!fs.existsSync(LAUNCH_AGENT_PLIST)) {
    printWarning('No launchd job found — nothing to uninstall.');
    return;
  }
  await execFileNoThrow('launchctl', ['unload', LAUNCH_AGENT_PLIST]);
  fs.unlinkSync(LAUNCH_AGENT_PLIST);
}

async function statusMacos(): Promise<void> {
  const installed = fs.existsSync(LAUNCH_AGENT_PLIST);
  if (installed) {
    printSuccess(`Job installed: ${LAUNCH_AGENT_LABEL} (launchd)`);
    console.log(chalk.dim(`  Plist: ${LAUNCH_AGENT_PLIST}`));
  } else {
    console.log(chalk.yellow(`  ○  Job not installed.`));
    printHint('Run `aion cron install` to set it up.');
  }
  printLastLog();
}

// ── Linux crontab ─────────────────────────────────────────────────────────────

async function installLinux(nodePath: string, scriptPath: string): Promise<void> {
  const cronLine = `0 */12 * * * ${nodePath} ${scriptPath} token-refresh >> ${CRON_LOG} 2>&1`;

  // Read existing crontab (may be empty / non-existent)
  const listResult = await execFileNoThrow('crontab', ['-l']);
  let existing = listResult.exitCode === 0 ? listResult.stdout : '';

  // Remove any pre-existing aion block
  existing = removeCronBlock(existing);

  const block = `${CRON_BEGIN}\n${cronLine}\n${CRON_END}\n`;
  const updated = existing.trimEnd() + (existing.trim() ? '\n' : '') + block;

  // Write to a uniquely-named temp file then pipe to crontab.
  // mkdtempSync creates a directory with a random suffix, avoiding the
  // predictable-path symlink attack flagged by CodeQL (insecure temp file).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-'));
  const tmpFile = path.join(tmpDir, 'crontab');
  try {
    fs.writeFileSync(tmpFile, updated, { mode: 0o600, flag: 'wx' });
    const result = await execFileNoThrow('crontab', [tmpFile]);
    if (result.exitCode !== 0) {
      throw new Error(`crontab write failed: ${result.stderr.trim()}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function uninstallLinux(): Promise<void> {
  const listResult = await execFileNoThrow('crontab', ['-l']);
  if (listResult.exitCode !== 0) {
    printWarning('No crontab found — nothing to uninstall.');
    return;
  }

  const cleaned = removeCronBlock(listResult.stdout);
  if (cleaned === listResult.stdout) {
    printWarning('aion cron block not found in crontab — nothing to remove.');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-'));
  const tmpFile = path.join(tmpDir, 'crontab');
  try {
    fs.writeFileSync(tmpFile, cleaned, { mode: 0o600, flag: 'wx' });
    await execFileNoThrow('crontab', [tmpFile]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function statusLinux(): Promise<void> {
  const listResult = await execFileNoThrow('crontab', ['-l']);
  const installed = listResult.exitCode === 0 && listResult.stdout.includes(CRON_BEGIN);

  if (installed) {
    printSuccess('Job installed (user crontab, every 12 hours)');
  } else {
    console.log(chalk.yellow('  ○  Job not installed.'));
    printHint('Run `aion cron install` to set it up.');
  }
  printLastLog();
}

function removeCronBlock(crontab: string): string {
  const lines = crontab.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trimEnd() === CRON_BEGIN) {
      inside = true;
      continue;
    }
    if (line.trimEnd() === CRON_END) {
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  return out.join('\n');
}

// ── Windows Task Scheduler ────────────────────────────────────────────────────

async function installWindows(nodePath: string, scriptPath: string): Promise<void> {
  const result = await execFileNoThrow('schtasks', [
    '/Create',
    '/TN',
    WINDOWS_TASK_NAME,
    '/TR',
    `"${nodePath}" "${scriptPath}" token-refresh`,
    '/SC',
    'HOURLY',
    '/MO',
    '12',
    '/F', // overwrite if exists
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`schtasks create failed: ${result.stderr.trim()}`);
  }
}

async function uninstallWindows(): Promise<void> {
  const result = await execFileNoThrow('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
  if (result.exitCode !== 0) {
    printWarning(`Could not remove task: ${result.stderr.trim()}`);
  }
}

async function statusWindows(): Promise<void> {
  const result = await execFileNoThrow('schtasks', [
    '/Query',
    '/TN',
    WINDOWS_TASK_NAME,
    '/FO',
    'LIST',
  ]);
  if (result.exitCode === 0) {
    printSuccess(`Job installed: ${WINDOWS_TASK_NAME} (Task Scheduler)`);
  } else {
    console.log(chalk.yellow('  ○  Job not installed.'));
    printHint('Run `aion cron install` to set it up.');
  }
}

// ── Log helper ────────────────────────────────────────────────────────────────

function printLastLog(): void {
  if (!fs.existsSync(CRON_LOG)) {
    console.log(chalk.dim(`  Log: ${CRON_LOG} (not yet created — job hasn't run)`));
    return;
  }
  const content = fs.readFileSync(CRON_LOG, 'utf-8').trim();
  const lines = content.split('\n').filter(Boolean);
  const last = lines[lines.length - 1] ?? '(empty)';
  console.log(chalk.dim(`  Log (last line): ${last}`));
  console.log(chalk.dim(`  Full log: ${CRON_LOG}`));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runCronInstall(): Promise<void> {
  const platform = getPlatform();
  const { nodePath, scriptPath } = resolveAionPaths();

  console.log(chalk.dim(`  Installing background token-refresh job…`));
  console.log(chalk.dim(`  Node:   ${nodePath}`));
  console.log(chalk.dim(`  Script: ${scriptPath}`));

  try {
    switch (platform) {
      case 'macos':
        await installMacos(nodePath, scriptPath);
        break;
      case 'linux':
        await installLinux(nodePath, scriptPath);
        break;
      case 'windows':
        await installWindows(nodePath, scriptPath);
        break;
      default:
        printError(
          `Unsupported platform: ${process.platform}. ` +
            `Add a cron job manually to run: ${nodePath} ${scriptPath} token-refresh`
        );
        return;
    }
  } catch (err) {
    printError(`Failed to install job: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  console.log();
  printSuccess('Background token-refresh job installed (runs every 12 hours).');
  console.log(chalk.dim(`  Log: ${CRON_LOG}`));
  console.log(chalk.dim('  Run `aion cron status` to check the last run.'));
  console.log(chalk.dim('  Run `aion cron uninstall` to remove it.'));
}

export async function runCronUninstall(): Promise<void> {
  const platform = getPlatform();

  try {
    switch (platform) {
      case 'macos':
        await uninstallMacos();
        break;
      case 'linux':
        await uninstallLinux();
        break;
      case 'windows':
        await uninstallWindows();
        break;
      default:
        printError(`Unsupported platform: ${process.platform}.`);
        return;
    }
  } catch (err) {
    printError(`Failed to uninstall job: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  printSuccess('Background token-refresh job removed.');
}

export async function runCronStatus(): Promise<void> {
  const platform = getPlatform();

  switch (platform) {
    case 'macos':
      await statusMacos();
      break;
    case 'linux':
      await statusLinux();
      break;
    case 'windows':
      await statusWindows();
      break;
    default:
      printWarning(`Unsupported platform: ${process.platform}.`);
  }
}
