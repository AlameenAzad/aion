import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig, saveConfig, configExists, migrateRawConfig } from '../config/manager';
import { FileConfigSchema } from '../config/schema';
import { promptConfirm, printSuccess, printWarning } from '../ui/prompts';

const SENSITIVE_NOTICE =
  'WARNING: This file contains API tokens and credentials in plaintext. ' +
  'Keep it secure and delete it when no longer needed.';

function stripSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    ...obj,
    tempo: { ...(obj.tempo as Record<string, unknown>), token: undefined },
    jira: { ...(obj.jira as Record<string, unknown>), token: undefined },
    dyce: {
      ...(obj.dyce as Record<string, unknown>),
      token: undefined,
      refreshToken: undefined,
    },
    paser: obj.paser
      ? { ...(obj.paser as Record<string, unknown>), password: undefined }
      : undefined,
  };
}

export async function runConfigExport(opts: {
  file?: string;
  includeSecrets?: boolean;
}): Promise<void> {
  const config = loadConfig();

  const outPath = path.resolve(opts.file ?? 'aion-export.json');
  const includeSecrets = opts.includeSecrets === true;

  // Represent as a plain object for export (keep schemaVersion)
  const full = config as unknown as Record<string, unknown>;
  const exportData = includeSecrets ? full : stripSecrets(full);

  if (includeSecrets) {
    console.error(chalk.red(`\n  ⚠  ${SENSITIVE_NOTICE}\n`));
    const confirmed = await promptConfirm(
      'Export config WITH sensitive tokens/passwords? This is a security risk.'
    );
    if (!confirmed) {
      console.log(chalk.dim('\n  Export cancelled.\n'));
      return;
    }
  }

  // Remove undefined fields before serialising
  const cleaned = JSON.parse(JSON.stringify(exportData)) as Record<string, unknown>;

  fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  printSuccess(`Config exported to ${outPath}`);
  if (includeSecrets) {
    printWarning(`${SENSITIVE_NOTICE}`);
  } else {
    console.log(
      chalk.dim('  Sensitive tokens were excluded. Re-run with --include-secrets to include them.')
    );
  }
  console.log();
}

export async function runConfigImport(filePath: string): Promise<void> {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.error(chalk.red(`\n  File not found: ${absPath}\n`));
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  } catch {
    console.error(chalk.red(`\n  Could not parse ${absPath} as JSON.\n`));
    process.exit(1);
  }

  // Run migration pass so older exports without schemaVersion are accepted
  const migrated = migrateRawConfig(raw);

  // Validate through the file schema (secrets are optional — they may be absent from export)
  const fileResult = FileConfigSchema.safeParse(migrated);
  if (!fileResult.success) {
    const issues = fileResult.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(chalk.red(`\n  Invalid export file:\n${issues}\n`));
    process.exit(1);
  }

  const incoming = fileResult.data;

  // Show summary of what will change
  console.log();
  console.log(chalk.bold('Import summary:'));
  console.log(`  Tempo region : ${incoming.tempo?.baseUrl ?? '(unchanged)'}`);
  console.log(`  Jira URL     : ${incoming.jira?.baseUrl ?? '(unchanged)'}`);
  console.log(`  Dyce instance: ${incoming.dyce?.instance ?? '(unchanged)'}`);
  console.log(`  Mappings     : ${incoming.mappings?.length ?? 0} project mapping(s)`);
  console.log(`  Vacation pfx : ${(incoming.vacationPrefixes ?? []).join(', ') || '(none)'}`);
  console.log();

  const hasSecrets =
    !!incoming.tempo?.token ||
    !!incoming.jira?.token ||
    !!incoming.dyce?.refreshToken ||
    !!incoming.paser?.password;

  if (!hasSecrets) {
    printWarning(
      'No credentials found in this export file. You will need to re-run `aion setup` or update tokens manually after import.'
    );
  }

  const overwriting = configExists();
  const confirmed = await promptConfirm(
    overwriting ? 'This will overwrite your current config. Continue?' : 'Import this config?'
  );
  if (!confirmed) {
    console.log(chalk.dim('\n  Import cancelled.\n'));
    return;
  }

  // If the current config has secrets that the import is missing, merge them in
  if (overwriting && !hasSecrets) {
    try {
      const current = loadConfig();
      const merged = {
        ...incoming,
        tempo: { ...incoming.tempo, token: incoming.tempo?.token ?? current.tempo.token },
        jira: { ...incoming.jira, token: incoming.jira?.token ?? current.jira.token },
        dyce: {
          ...incoming.dyce,
          token: incoming.dyce?.token ?? current.dyce.token,
          refreshToken: incoming.dyce?.refreshToken ?? current.dyce.refreshToken,
        },
        paser:
          incoming.paser && !incoming.paser.password && current.paser
            ? { ...incoming.paser, password: current.paser.password }
            : incoming.paser,
      };
      // Re-validate merged result as full Config
      saveConfig(merged as Parameters<typeof saveConfig>[0]);
    } catch {
      // If merge fails, save what we have (may be incomplete)
      saveConfig(incoming as Parameters<typeof saveConfig>[0]);
    }
  } else {
    saveConfig(incoming as Parameters<typeof saveConfig>[0]);
  }

  printSuccess('Config imported successfully.');
  if (!hasSecrets) {
    console.log(chalk.dim('  Run `aion status` to verify all services are reachable.'));
  }
  console.log();
}
