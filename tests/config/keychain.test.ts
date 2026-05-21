import * as childProcess from 'child_process';
import {
  getSecret,
  setSecret,
  deleteSecret,
  deleteAllSecrets,
  SECRET_ACCOUNTS,
  keychainAvailable,
} from '../../src/config/keychain';

// Mock the entire child_process module so we never call real system tools.
jest.mock('child_process');

const mockExecFileSync = childProcess.execFileSync as jest.Mock;

afterEach(() => jest.clearAllMocks());

// ── SECRET_ACCOUNTS shape ─────────────────────────────────────────────────────

describe('SECRET_ACCOUNTS', () => {
  it('contains the expected account name constants', () => {
    expect(SECRET_ACCOUNTS.tempoToken).toBe('tempo-token');
    expect(SECRET_ACCOUNTS.jiraToken).toBe('jira-token');
    expect(SECRET_ACCOUNTS.dyceRefreshToken).toBe('dyce-refresh-token');
    expect(SECRET_ACCOUNTS.dyceAccessToken).toBe('dyce-access-token');
    expect(SECRET_ACCOUNTS.paserPassword).toBe('paser-password');
  });
});

// ── keychainAvailable ─────────────────────────────────────────────────────────

describe('keychainAvailable', () => {
  it('is false when AION_DISABLE_KEYCHAIN=1 is set', () => {
    // keychainAvailable is evaluated at module load time.
    // If the env var was set before this module loaded, it will be false.
    // We test the value directly; CI on Linux also covers the "none" path.
    if (process.env.AION_DISABLE_KEYCHAIN === '1') {
      expect(keychainAvailable).toBe(false);
    } else {
      // On a supported platform without the disable flag it should be true.
      const supported = ['darwin', 'linux', 'win32'].includes(process.platform);
      expect(keychainAvailable).toBe(supported);
    }
  });
});

// ── getSecret ─────────────────────────────────────────────────────────────────

describe('getSecret', () => {
  it('returns null and does not call execFileSync when keychain is unavailable', () => {
    if (keychainAvailable) return; // skip on supported platforms

    const result = getSecret(SECRET_ACCOUNTS.tempoToken);
    expect(result).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns the trimmed value on success', () => {
    if (!keychainAvailable) return; // only runs on supported platforms

    mockExecFileSync.mockReturnValue('my-secret-value\n');
    const result = getSecret(SECRET_ACCOUNTS.tempoToken);
    expect(result).toBe('my-secret-value');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns null when execFileSync throws (item not found)', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockImplementation(() => {
      throw new Error('command failed');
    });
    expect(getSecret(SECRET_ACCOUNTS.jiraToken)).toBeNull();
  });

  it('returns null when the stored value is blank', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockReturnValue('   \n');
    expect(getSecret(SECRET_ACCOUNTS.paserPassword)).toBeNull();
  });
});

// ── setSecret ─────────────────────────────────────────────────────────────────

describe('setSecret', () => {
  it('does not call execFileSync when keychain is unavailable', () => {
    if (keychainAvailable) return;

    setSecret(SECRET_ACCOUNTS.tempoToken, 'value');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('calls execFileSync with the correct tool and account on the current platform', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockReturnValue(undefined);
    setSecret(SECRET_ACCOUNTS.dyceRefreshToken, 'refresh-value');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);

    const [cmd, args] = mockExecFileSync.mock.calls[0] as [string, string[]];

    if (process.platform === 'darwin') {
      expect(cmd).toBe('security');
      expect(args).toContain('add-generic-password');
      expect(args).toContain('-U');
      expect(args).toContain('dyce-refresh-token');
      expect(args).toContain('refresh-value');
    } else if (process.platform === 'linux') {
      expect(cmd).toBe('secret-tool');
      expect(args).toContain('store');
      expect(args).toContain('dyce-refresh-token');
    } else if (process.platform === 'win32') {
      expect(cmd).toBe('powershell.exe');
      // value should be base64-encoded, not appear in plain text in args
      expect(JSON.stringify(args)).not.toContain('refresh-value');
      // but the base64 of 'refresh-value' should be present
      expect(JSON.stringify(args)).toContain(
        Buffer.from('refresh-value', 'utf-8').toString('base64')
      );
    }
  });

  it('propagates errors from the underlying tool (no silent swallow)', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockImplementation(() => {
      throw new Error('write failed');
    });
    expect(() => setSecret(SECRET_ACCOUNTS.tempoToken, 'v')).toThrow('write failed');
  });
});

// ── deleteSecret ──────────────────────────────────────────────────────────────

describe('deleteSecret', () => {
  it('does not call execFileSync when keychain is unavailable', () => {
    if (keychainAvailable) return;

    deleteSecret(SECRET_ACCOUNTS.tempoToken);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('calls execFileSync with the correct tool and account', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockReturnValue(undefined);
    deleteSecret(SECRET_ACCOUNTS.dyceAccessToken);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);

    const [cmd, args] = mockExecFileSync.mock.calls[0] as [string, string[]];
    if (process.platform === 'darwin') {
      expect(cmd).toBe('security');
      expect(args).toContain('delete-generic-password');
      expect(args).toContain('dyce-access-token');
    } else if (process.platform === 'linux') {
      expect(cmd).toBe('secret-tool');
      expect(args).toContain('clear');
      expect(args).toContain('dyce-access-token');
    } else if (process.platform === 'win32') {
      expect(cmd).toBe('powershell.exe');
    }
  });

  it('does not throw when the item is already absent', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockImplementation(() => {
      throw new Error('item not found');
    });
    expect(() => deleteSecret(SECRET_ACCOUNTS.jiraToken)).not.toThrow();
  });
});

// ── deleteAllSecrets ──────────────────────────────────────────────────────────

describe('deleteAllSecrets', () => {
  it('calls the underlying delete for every account when keychain is available', () => {
    if (!keychainAvailable) return;

    mockExecFileSync.mockReturnValue(undefined);
    deleteAllSecrets();
    expect(mockExecFileSync).toHaveBeenCalledTimes(Object.keys(SECRET_ACCOUNTS).length);
  });

  it('makes no calls when keychain is unavailable', () => {
    if (keychainAvailable) return;

    deleteAllSecrets();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
