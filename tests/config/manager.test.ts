import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfig,
  saveConfig,
  configExists,
  maskToken,
  loadDraft,
  saveDraft,
  clearDraft,
  SetupDraft,
} from '../../src/config/manager';
import { Config } from '../../src/config/schema';

jest.mock('fs');

// Disable keychain in all manager tests — secrets live in the JSON file here.
jest.mock('../../src/config/keychain', () => ({
  keychainAvailable: false,
  getSecret: jest.fn().mockReturnValue(null),
  setSecret: jest.fn(),
  deleteSecret: jest.fn(),
  deleteAllSecrets: jest.fn(),
  SECRET_ACCOUNTS: {
    tempoToken: 'tempo-token',
    jiraToken: 'jira-token',
    dyceRefreshToken: 'dyce-refresh-token',
    dyceAccessToken: 'dyce-access-token',
    paserPassword: 'paser-password',
  },
}));

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockReadFileSync = mockedFs.readFileSync as jest.Mock;

const CONFIG_DIR = path.join(os.homedir(), '.aion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SETUP_DRAFT_FILE = path.join(CONFIG_DIR, 'setup-draft.json');

const validConfig: Config = {
  tempo: {
    token: 'tempo-abc',
    baseUrl: 'https://api.eu.tempo.io',
    accountId: 'acc123',
  },
  jira: {
    baseUrl: 'https://myco.atlassian.net',
    email: 'user@myco.com',
    token: 'jira-xyz',
  },
  dyce: {
    clientId: 'azure-client-id',
    scope: 'api://dyce/.default offline_access',
    token: 'eyDyce',
    refreshToken: 'eyRefreshDyce',
    instance: 'inst1',
    company: 'co1',
    resourceNo: 'EMP01',
  },
  paser: {
    baseUrl: 'https://app.paser.io',
    email: 'user@myco.com',
    password: 'secret123',
    accountId: 90,
  },
  mappings: [],
  vacationPrefixes: [],
  schemaVersion: 1,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// ── configExists ──────────────────────────────────────────────────────────────

describe('configExists', () => {
  it('returns true when the config file exists', () => {
    mockedFs.existsSync.mockReturnValue(true);
    expect(configExists()).toBe(true);
    expect(mockedFs.existsSync).toHaveBeenCalledWith(CONFIG_FILE);
  });

  it('returns false when the config file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(configExists()).toBe(false);
  });
});

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('parses and returns a valid config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validConfig));

    const config = loadConfig();
    expect(config.tempo.token).toBe('tempo-abc');
    expect(config.jira.email).toBe('user@myco.com');
    expect(config.paser?.accountId).toBe(90);
  });

  it('throws when the config file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(() => loadConfig()).toThrow(/aion setup/);
  });

  it('throws when the config file contains invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ bad json');
    expect(() => loadConfig()).toThrow(/not valid JSON/);
  });

  it('throws a descriptive error when required fields are missing', () => {
    mockedFs.existsSync.mockReturnValue(true);
    const incomplete = { tempo: { token: 'x' } }; // missing most fields
    mockReadFileSync.mockReturnValue(JSON.stringify(incomplete));
    expect(() => loadConfig()).toThrow(/Config file is invalid/);
  });
});

// ── saveConfig ────────────────────────────────────────────────────────────────

describe('saveConfig', () => {
  it('creates the config directory if it does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    saveConfig(validConfig);

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 });
  });

  it('writes valid JSON to the config file', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    saveConfig(validConfig);

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      CONFIG_FILE,
      expect.stringContaining('"tempo-abc"'),
      { encoding: 'utf-8', mode: 0o600 }
    );
  });

  it('writes pretty-printed JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    saveConfig(validConfig);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    expect(() => JSON.parse(written)).not.toThrow();
    // pretty-printed has newlines
    expect(written).toContain('\n');
  });
});

// ── maskToken ─────────────────────────────────────────────────────────────────

describe('maskToken', () => {
  it('shows first 4 and last 4 characters for a long token', () => {
    const masked = maskToken('abcd1234efgh5678');
    expect(masked).toMatch(/^abcd/);
    expect(masked).toMatch(/5678$/);
    expect(masked).toContain('••••');
  });

  it('returns *** for tokens 8 characters or fewer', () => {
    expect(maskToken('short')).toBe('***');
    expect(maskToken('12345678')).toBe('***');
  });

  it('masks a 9-character token', () => {
    const masked = maskToken('123456789');
    expect(masked).toMatch(/^1234/);
    expect(masked).toMatch(/6789$/);
  });
});

// ── loadDraft ─────────────────────────────────────────────────────────────────

describe('loadDraft', () => {
  it('returns null when the draft file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(loadDraft()).toBeNull();
  });

  it('parses and returns the draft when the file exists', () => {
    const draft: SetupDraft = {
      step: 2,
      tempo: { token: 't', baseUrl: 'https://x.io', accountId: 'a' },
    };
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(draft));
    expect(loadDraft()).toEqual(draft);
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(SETUP_DRAFT_FILE, 'utf-8');
  });

  it('returns null when the draft file contains invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ bad json');
    expect(loadDraft()).toBeNull();
  });
});

// ── saveDraft ─────────────────────────────────────────────────────────────────

describe('saveDraft', () => {
  it('creates the config directory if it does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    saveDraft({ step: 1 });

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 });
  });

  it('writes the draft as pretty-printed JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    saveDraft({ step: 3 });

    const [filePath, content] = mockedFs.writeFileSync.mock.calls[0] as [string, string, string];
    expect(filePath).toBe(SETUP_DRAFT_FILE);
    expect(JSON.parse(content)).toEqual({ step: 3 });
    expect(content).toContain('\n');
  });
});

// ── clearDraft ────────────────────────────────────────────────────────────────

describe('clearDraft', () => {
  it('deletes the draft file when it exists', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.unlinkSync.mockReturnValue(undefined);

    clearDraft();

    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(SETUP_DRAFT_FILE);
  });

  it('does nothing when the draft file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);

    clearDraft();

    expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
  });
});
