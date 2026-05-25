import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  Config,
  ConfigSchema,
  FileConfig,
  FileConfigSchema,
  DyceMapping,
  DyceLeaveMapping,
} from './schema';
import { keychainAvailable, getSecret, setSecret, SECRET_ACCOUNTS } from './keychain';

const CONFIG_DIR = path.join(os.homedir(), '.aion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Private keychain helpers ──────────────────────────────────────────────────

/**
 * Build the on-disk representation of the config.
 * Secrets are stripped from the file only when the caller confirms the
 * keychain write succeeded (`stripSecrets = true`), preventing silent data
 * loss when the credential store tool is unavailable (e.g. secret-tool not
 * installed on Linux).
 */
function buildFileConfig(config: Config, stripSecrets: boolean): FileConfig {
  const strip = stripSecrets;
  return {
    ...config,
    tempo: { ...config.tempo, token: strip ? undefined : config.tempo.token },
    jira: { ...config.jira, token: strip ? undefined : config.jira.token },
    dyce: {
      ...config.dyce,
      token: strip ? undefined : config.dyce.token,
      refreshToken: strip ? undefined : config.dyce.refreshToken,
    },
    paser: config.paser
      ? { ...config.paser, password: strip ? undefined : config.paser.password }
      : undefined,
  };
}

/**
 * Write all secret fields to the OS credential store.
 * Returns true when every write succeeded, false if any failed (so the caller
 * knows to keep secrets in the config file as a fallback).
 */
function persistSecretsToKeychain(config: Config): boolean {
  if (!keychainAvailable) return false;
  try {
    setSecret(SECRET_ACCOUNTS.tempoToken, config.tempo.token);
    setSecret(SECRET_ACCOUNTS.jiraToken, config.jira.token);
    setSecret(SECRET_ACCOUNTS.dyceRefreshToken, config.dyce.refreshToken);
    if (config.dyce.token) setSecret(SECRET_ACCOUNTS.dyceAccessToken, config.dyce.token);
    if (config.paser?.password) setSecret(SECRET_ACCOUNTS.paserPassword, config.paser.password);
    return true;
  } catch {
    return false;
  }
}

/**
 * Overlay keychain secrets onto a FileConfig, then validate the merged result
 * against the full ConfigSchema (which requires all secrets to be present).
 * Throws a user-friendly error if the merged config is still incomplete.
 */
function resolveSecretsIntoConfig(fileConfig: FileConfig): Config {
  const merged: Record<string, unknown> = { ...fileConfig };

  if (keychainAvailable) {
    const tempoToken = getSecret(SECRET_ACCOUNTS.tempoToken);
    const jiraToken = getSecret(SECRET_ACCOUNTS.jiraToken);
    const dyceRefreshToken = getSecret(SECRET_ACCOUNTS.dyceRefreshToken);
    const dyceAccessToken = getSecret(SECRET_ACCOUNTS.dyceAccessToken);
    const paserPassword = getSecret(SECRET_ACCOUNTS.paserPassword);

    if (tempoToken) merged.tempo = { ...fileConfig.tempo, token: tempoToken };
    if (jiraToken) merged.jira = { ...fileConfig.jira, token: jiraToken };
    if (dyceRefreshToken || dyceAccessToken) {
      merged.dyce = {
        ...fileConfig.dyce,
        ...(dyceRefreshToken ? { refreshToken: dyceRefreshToken } : {}),
        ...(dyceAccessToken ? { token: dyceAccessToken } : {}),
      };
    }
    if (paserPassword && fileConfig.paser) {
      merged.paser = { ...fileConfig.paser, password: paserPassword };
    }
  }

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config is incomplete:\n${issues}\n\nRun \`aion setup\` to reconfigure.`);
  }
  return result.data;
}

/**
 * One-time migration: if the file still contains plaintext secrets and keychain
 * is available, migrate them to keychain and rewrite the file without them.
 * This runs transparently on the first load after upgrading.
 */
function migrateSecretsIfNeeded(fileConfig: FileConfig, config: Config): void {
  const hasSecretsInFile =
    !!fileConfig.tempo?.token ||
    !!fileConfig.jira?.token ||
    !!fileConfig.dyce?.refreshToken ||
    !!fileConfig.paser?.password;

  if (!hasSecretsInFile) return;

  const keychainWritten = persistSecretsToKeychain(config);
  if (!keychainWritten) return; // keep secrets in file until keychain write succeeds
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(buildFileConfig(config, true), null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // Non-fatal: migration will retry on the next load.
  }
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Stamp schemaVersion: 1 on raw config objects that pre-date schema versioning.
 * Extend this function with additional migration steps as the schema evolves.
 */
export function migrateRawConfig(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (!('schemaVersion' in obj)) {
    return { ...obj, schemaVersion: 1 };
  }
  return raw;
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`No config found at ${CONFIG_FILE}. Run \`aion setup\` first.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    throw new Error(
      `Config file at ${CONFIG_FILE} is not valid JSON. Run \`aion setup\` to reconfigure.`
    );
  }

  // First validate the on-disk format, where secrets may be absent (stored in keychain).
  const fileResult = FileConfigSchema.safeParse(migrateRawConfig(raw));
  if (!fileResult.success) {
    const issues = fileResult.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config file is invalid:\n${issues}\n\nRun \`aion setup\` to reconfigure.`);
  }

  // Overlay keychain secrets (if available) and validate the fully merged config.
  const config = resolveSecretsIntoConfig(fileResult.data);

  // One-time migration: if secrets are still in the file, move them to keychain.
  if (keychainAvailable) {
    migrateSecretsIfNeeded(fileResult.data, config);
  }

  return config;
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  // Persist secrets to keychain; only strip them from the file if it succeeded.
  const keychainWritten = persistSecretsToKeychain(config);

  // lgtm[js/http-to-file-access] - config is Zod-validated user credentials written
  // to the user's own home directory (~/.aion/config.json) with mode 0o600.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(buildFileConfig(config, keychainWritten), null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function updateConfig(partial: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  saveConfig(updated);
  return updated;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '***';
  return token.slice(0, 4) + '••••••••' + token.slice(-4);
}

// ── Setup draft ───────────────────────────────────────────────────────────────

const SETUP_DRAFT_FILE = path.join(CONFIG_DIR, 'setup-draft.json');

export interface SetupDraft {
  /** Last fully completed step number (1–6) */
  step: number;
  tempo?: { token: string; baseUrl: string; accountId: string };
  jira?: { baseUrl: string; email: string; token: string };
  dyce?: {
    clientId: string;
    scope: string;
    token: string;
    refreshToken: string;
    instance: string;
    company: string;
    resourceNo: string;
    resourceId?: string;
    resourceName?: string;
  };
  paser?: {
    baseUrl: string;
    email: string;
    password: string;
    accountId: number;
  };
  mappings?: DyceMapping[];
  vacationPrefixes?: string[];
  publicHolidayDescription?: string;
  leaveTypeMappings?: {
    vacation?: DyceLeaveMapping;
    sickLeave?: DyceLeaveMapping;
    publicHoliday?: DyceLeaveMapping;
  };
}

export function loadDraft(): SetupDraft | null {
  if (!fs.existsSync(SETUP_DRAFT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SETUP_DRAFT_FILE, 'utf-8')) as SetupDraft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: SetupDraft): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(SETUP_DRAFT_FILE, JSON.stringify(draft, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function clearDraft(): void {
  if (fs.existsSync(SETUP_DRAFT_FILE)) {
    fs.unlinkSync(SETUP_DRAFT_FILE);
  }
}
