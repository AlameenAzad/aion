import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Config, ConfigSchema, DyceMapping, DyceLeaveMapping } from './schema';

const CONFIG_DIR = path.join(os.homedir(), '.aion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
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

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config file is invalid:\n${issues}\n\nRun \`aion setup\` to reconfigure.`);
  }

  return result.data;
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
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
