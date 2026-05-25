import * as childProcess from 'child_process';

// Mock the entire child_process module so we never call real system tools.
jest.mock('child_process');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Re-require the keychain module after manipulating env / platform so that the
 * module-level constants (PLATFORM, keychainAvailable) are re-evaluated.
 */
function loadKeychain(opts: { disableKeychain?: boolean } = {}) {
  jest.resetModules();
  if (opts.disableKeychain) {
    process.env.AION_DISABLE_KEYCHAIN = '1';
  } else {
    delete process.env.AION_DISABLE_KEYCHAIN;
  }
  return require('../../src/config/keychain') as typeof import('../../src/config/keychain');
}

function mockExecFileSync() {
  // Re-require child_process after resetModules so the mock is fresh.
  return (require('child_process') as typeof childProcess).execFileSync as jest.Mock;
}

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.AION_DISABLE_KEYCHAIN;
});

// ── SECRET_ACCOUNTS shape ─────────────────────────────────────────────────────

describe('SECRET_ACCOUNTS', () => {
  it('contains the expected account name constants', () => {
    const { SECRET_ACCOUNTS } = loadKeychain();
    expect(SECRET_ACCOUNTS.tempoToken).toBe('tempo-token');
    expect(SECRET_ACCOUNTS.jiraToken).toBe('jira-token');
    expect(SECRET_ACCOUNTS.dyceRefreshToken).toBe('dyce-refresh-token');
    expect(SECRET_ACCOUNTS.dyceAccessToken).toBe('dyce-access-token');
    expect(SECRET_ACCOUNTS.paserPassword).toBe('paser-password');
  });
});

// ── keychainAvailable ─────────────────────────────────────────────────────────

describe('keychainAvailable', () => {
  it('is false when AION_DISABLE_KEYCHAIN=1', () => {
    const { keychainAvailable } = loadKeychain({ disableKeychain: true });
    expect(keychainAvailable).toBe(false);
  });

  it('is true on a supported platform without the disable flag', () => {
    const { keychainAvailable } = loadKeychain();
    const supported = ['darwin', 'linux', 'win32'].includes(process.platform);
    expect(keychainAvailable).toBe(supported);
  });
});

// ── getSecret — keychain disabled ────────────────────────────────────────────

describe('getSecret (keychain disabled)', () => {
  it('returns null and never calls execFileSync', () => {
    const { getSecret, SECRET_ACCOUNTS } = loadKeychain({ disableKeychain: true });
    const exec = mockExecFileSync();

    expect(getSecret(SECRET_ACCOUNTS.tempoToken)).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});

// ── getSecret — keychain enabled ─────────────────────────────────────────────

describe('getSecret (keychain enabled)', () => {
  it('returns the trimmed secret value on success', () => {
    const { getSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockReturnValue('my-secret-value\n');

    expect(getSecret(SECRET_ACCOUNTS.tempoToken)).toBe('my-secret-value');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns null when execFileSync throws (item not found)', () => {
    const { getSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(getSecret(SECRET_ACCOUNTS.jiraToken)).toBeNull();
  });

  it('returns null when the stored value is blank', () => {
    const { getSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockReturnValue('   \n');

    expect(getSecret(SECRET_ACCOUNTS.paserPassword)).toBeNull();
  });
});

// ── setSecret — keychain disabled ────────────────────────────────────────────

describe('setSecret (keychain disabled)', () => {
  it('does nothing when keychain is unavailable', () => {
    const { setSecret, SECRET_ACCOUNTS } = loadKeychain({ disableKeychain: true });
    const exec = mockExecFileSync();

    setSecret(SECRET_ACCOUNTS.tempoToken, 'value');
    expect(exec).not.toHaveBeenCalled();
  });
});

// ── setSecret — keychain enabled ─────────────────────────────────────────────

describe('setSecret (keychain enabled)', () => {
  it('calls the correct tool with the correct account and value', () => {
    const { setSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockReturnValue(undefined);

    setSecret(SECRET_ACCOUNTS.dyceRefreshToken, 'refresh-value');
    expect(exec).toHaveBeenCalledTimes(1);

    const [cmd, args] = exec.mock.calls[0] as [string, string[]];
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
      expect(JSON.stringify(args)).not.toContain('refresh-value');
      expect(JSON.stringify(args)).toContain(
        Buffer.from('refresh-value', 'utf-8').toString('base64')
      );
    }
  });

  it('propagates errors from the underlying tool (no silent swallow)', () => {
    const { setSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockImplementation(() => {
      throw new Error('write failed');
    });

    expect(() => setSecret(SECRET_ACCOUNTS.tempoToken, 'v')).toThrow('write failed');
  });
});

// ── deleteSecret — keychain disabled ─────────────────────────────────────────

describe('deleteSecret (keychain disabled)', () => {
  it('does nothing when keychain is unavailable', () => {
    const { deleteSecret, SECRET_ACCOUNTS } = loadKeychain({ disableKeychain: true });
    const exec = mockExecFileSync();

    deleteSecret(SECRET_ACCOUNTS.tempoToken);
    expect(exec).not.toHaveBeenCalled();
  });
});

// ── deleteSecret — keychain enabled ──────────────────────────────────────────

describe('deleteSecret (keychain enabled)', () => {
  it('calls the correct tool and account', () => {
    const { deleteSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockReturnValue(undefined);

    deleteSecret(SECRET_ACCOUNTS.dyceAccessToken);
    expect(exec).toHaveBeenCalledTimes(1);

    const [cmd, args] = exec.mock.calls[0] as [string, string[]];
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

  it('does not throw when the item is already absent (error swallowed)', () => {
    const { deleteSecret, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockImplementation(() => {
      throw new Error('item not found');
    });

    expect(() => deleteSecret(SECRET_ACCOUNTS.jiraToken)).not.toThrow();
  });
});

// ── deleteAllSecrets ──────────────────────────────────────────────────────────

describe('deleteAllSecrets (keychain disabled)', () => {
  it('makes no calls when keychain is unavailable', () => {
    const { deleteAllSecrets } = loadKeychain({ disableKeychain: true });
    const exec = mockExecFileSync();

    deleteAllSecrets();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('deleteAllSecrets (keychain enabled)', () => {
  it('calls delete once per account', () => {
    const { deleteAllSecrets, SECRET_ACCOUNTS } = loadKeychain();
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) return;

    const exec = mockExecFileSync();
    exec.mockReturnValue(undefined);

    deleteAllSecrets();
    expect(exec).toHaveBeenCalledTimes(Object.keys(SECRET_ACCOUNTS).length);
  });
});
