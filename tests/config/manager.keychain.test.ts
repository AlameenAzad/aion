/**
 * Tests for manager.ts with keychainAvailable = true.
 * Covers all code paths that are skipped in manager.test.ts (where keychain is
 * disabled), including: secret stripping, keychain injection, migration, and
 * the setSecret failure fallback.
 */

import * as fs from 'fs';
import { loadConfig, saveConfig } from '../../src/config/manager';
import { Config } from '../../src/config/schema';

jest.mock('fs');

jest.mock('../../src/config/keychain', () => ({
  keychainAvailable: true,
  getSecret: jest.fn(),
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

import { getSecret, setSecret } from '../../src/config/keychain';

const mockGetSecret = getSecret as jest.Mock;
const mockSetSecret = setSecret as jest.Mock;
const mockedFs = fs as jest.Mocked<typeof fs>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validConfig: Config = {
  tempo: { token: 'tempo-abc', baseUrl: 'https://api.eu.tempo.io', accountId: 'acc123' },
  jira: { baseUrl: 'https://myco.atlassian.net', email: 'user@myco.com', token: 'jira-xyz' },
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

// File config where secrets have been stripped (as saved when keychain is on).
const fileConfigWithoutSecrets = {
  tempo: { baseUrl: 'https://api.eu.tempo.io', accountId: 'acc123' },
  jira: { baseUrl: 'https://myco.atlassian.net', email: 'user@myco.com' },
  dyce: {
    clientId: 'azure-client-id',
    scope: 'api://dyce/.default offline_access',
    instance: 'inst1',
    company: 'co1',
    resourceNo: 'EMP01',
  },
  paser: { baseUrl: 'https://app.paser.io', email: 'user@myco.com', accountId: 90 },
  mappings: [],
  vacationPrefixes: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── saveConfig — keychain enabled ─────────────────────────────────────────────

describe('saveConfig (keychain enabled)', () => {
  it('strips secrets from the file when keychain write succeeds', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockSetSecret.mockReturnValue(undefined); // success

    saveConfig(validConfig);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);

    // Secrets must not appear in the saved file.
    expect(parsed.tempo.token).toBeUndefined();
    expect(parsed.jira.token).toBeUndefined();
    expect(parsed.dyce.refreshToken).toBeUndefined();
    expect(parsed.paser.password).toBeUndefined();

    // Non-secret fields must still be present.
    expect(parsed.tempo.baseUrl).toBe('https://api.eu.tempo.io');
    expect(parsed.jira.email).toBe('user@myco.com');
  });

  it('keeps secrets in the file when keychain write fails (safe fallback)', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockSetSecret.mockImplementation(() => {
      throw new Error('credential store unavailable');
    });

    saveConfig(validConfig);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);

    // Secrets must still be in the file so they are not lost.
    expect(parsed.tempo.token).toBe('tempo-abc');
    expect(parsed.jira.token).toBe('jira-xyz');
    expect(parsed.dyce.refreshToken).toBe('eyRefreshDyce');
    expect(parsed.paser.password).toBe('secret123');
  });

  it('calls setSecret for every secret field', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockSetSecret.mockReturnValue(undefined);

    saveConfig(validConfig);

    expect(mockSetSecret).toHaveBeenCalledWith('tempo-token', 'tempo-abc');
    expect(mockSetSecret).toHaveBeenCalledWith('jira-token', 'jira-xyz');
    expect(mockSetSecret).toHaveBeenCalledWith('dyce-refresh-token', 'eyRefreshDyce');
    expect(mockSetSecret).toHaveBeenCalledWith('dyce-access-token', 'eyDyce');
    expect(mockSetSecret).toHaveBeenCalledWith('paser-password', 'secret123');
  });

  it('does not call setSecret for optional secrets that are absent', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockSetSecret.mockReturnValue(undefined);

    const configNoPaser: Config = { ...validConfig, paser: undefined };
    const configNoDyceToken: Config = {
      ...validConfig,
      dyce: { ...validConfig.dyce, token: undefined },
    };

    saveConfig(configNoPaser);
    expect(mockSetSecret).not.toHaveBeenCalledWith('paser-password', expect.anything());

    jest.clearAllMocks();
    saveConfig(configNoDyceToken);
    expect(mockSetSecret).not.toHaveBeenCalledWith('dyce-access-token', expect.anything());
  });
});

// ── loadConfig — keychain injection ──────────────────────────────────────────

describe('loadConfig — secrets from keychain', () => {
  it('merges keychain secrets into a file that has no tokens', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfigWithoutSecrets));

    // getSecret is called in order: tempo, jira, dyceRefresh, dyceAccess, paser
    mockGetSecret
      .mockReturnValueOnce('tempo-abc') // tempo-token
      .mockReturnValueOnce('jira-xyz') // jira-token
      .mockReturnValueOnce('eyRefreshDyce') // dyce-refresh-token
      .mockReturnValueOnce('eyDyce') // dyce-access-token
      .mockReturnValueOnce('secret123'); // paser-password

    // No migration write (file already has no secrets)
    const config = loadConfig();

    expect(config.tempo.token).toBe('tempo-abc');
    expect(config.jira.token).toBe('jira-xyz');
    expect(config.dyce.refreshToken).toBe('eyRefreshDyce');
    expect(config.dyce.token).toBe('eyDyce');
    expect(config.paser?.password).toBe('secret123');
  });

  it('throws a descriptive error when a required secret is missing from both file and keychain', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfigWithoutSecrets));

    // All getSecret calls return null → tokens missing
    mockGetSecret.mockReturnValue(null);

    expect(() => loadConfig()).toThrow(/Config is incomplete/);
  });

  it('resolves paser password from keychain when paser section is in the file', () => {
    const fileConfigPaserNoPassword = {
      ...fileConfigWithoutSecrets,
      paser: { baseUrl: 'https://app.paser.io', email: 'user@myco.com', accountId: 90 },
    };
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfigPaserNoPassword));

    mockGetSecret
      .mockReturnValueOnce('tempo-abc')
      .mockReturnValueOnce('jira-xyz')
      .mockReturnValueOnce('eyRefreshDyce')
      .mockReturnValueOnce(null) // no cached access token
      .mockReturnValueOnce('secret123'); // paser-password

    const config = loadConfig();
    expect(config.paser?.password).toBe('secret123');
  });

  it('resolves only dyceAccessToken from keychain when file has no dyce.token', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfigWithoutSecrets));

    mockGetSecret
      .mockReturnValueOnce('tempo-abc')
      .mockReturnValueOnce('jira-xyz')
      .mockReturnValueOnce('eyRefreshDyce')
      .mockReturnValueOnce('eyDyceCached') // dyceAccessToken from keychain
      .mockReturnValueOnce('secret123'); // paser-password (paser is in the file)

    const config = loadConfig();
    expect(config.dyce.token).toBe('eyDyceCached');
    expect(config.dyce.refreshToken).toBe('eyRefreshDyce');
  });
});

// ── loadConfig — migration ────────────────────────────────────────────────────

describe('loadConfig — migration from file to keychain', () => {
  it('migrates plaintext secrets to keychain and rewrites the file without them', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(validConfig));
    mockGetSecret.mockReturnValue(null); // no keychain entries yet
    mockSetSecret.mockReturnValue(undefined); // write succeeds
    mockedFs.writeFileSync.mockReturnValue(undefined);

    loadConfig();

    // setSecret should have been called for all secrets (migration).
    expect(mockSetSecret).toHaveBeenCalledWith('tempo-token', 'tempo-abc');
    expect(mockSetSecret).toHaveBeenCalledWith('jira-token', 'jira-xyz');
    expect(mockSetSecret).toHaveBeenCalledWith('dyce-refresh-token', 'eyRefreshDyce');

    // File should have been rewritten without tokens.
    const lastWrite = mockedFs.writeFileSync.mock.calls.at(-1)!;
    const rewritten = JSON.parse(lastWrite[1] as string);
    expect(rewritten.tempo.token).toBeUndefined();
    expect(rewritten.jira.token).toBeUndefined();
    expect(rewritten.dyce.refreshToken).toBeUndefined();
  });

  it('does NOT rewrite the file if keychain write fails during migration', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(validConfig));
    mockGetSecret.mockReturnValue(null);
    mockSetSecret.mockImplementation(() => {
      throw new Error('keychain write failed');
    });
    mockedFs.writeFileSync.mockReturnValue(undefined);

    // loadConfig itself should still succeed (secrets come from the file).
    const config = loadConfig();
    expect(config.tempo.token).toBe('tempo-abc');

    // writeFileSync should NOT have been called for migration rewrite.
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('skips migration when the file has no plaintext secrets', () => {
    mockedFs.existsSync.mockReturnValue(true);
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfigWithoutSecrets));
    mockGetSecret
      .mockReturnValueOnce('tempo-abc')
      .mockReturnValueOnce('jira-xyz')
      .mockReturnValueOnce('eyRefreshDyce')
      .mockReturnValueOnce(null) // no cached dyce access token
      .mockReturnValueOnce('secret123'); // paser-password (paser is in the file)
    mockedFs.writeFileSync.mockReturnValue(undefined);

    loadConfig();

    // setSecret should NOT be called (no migration needed).
    expect(mockSetSecret).not.toHaveBeenCalled();
    // File should NOT be rewritten.
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});
