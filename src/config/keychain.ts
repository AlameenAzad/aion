import { execFileSync } from 'child_process';

/**
 * Service name that groups all aion secrets inside the OS credential store.
 * Used as the keychain service / secret-tool attribute / PasswordVault resource.
 */
const SERVICE = 'aion-sync';

/** Canonical account names for every persisted secret. */
export const SECRET_ACCOUNTS = {
  tempoToken: 'tempo-token',
  jiraToken: 'jira-token',
  dyceRefreshToken: 'dyce-refresh-token',
  dyceAccessToken: 'dyce-access-token',
  paserPassword: 'paser-password',
} as const;

export type SecretAccount = (typeof SECRET_ACCOUNTS)[keyof typeof SECRET_ACCOUNTS];

type Platform = 'macos' | 'linux' | 'windows' | 'none';

function detectPlatform(): Platform {
  if (process.env.AION_DISABLE_KEYCHAIN === '1') return 'none';
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    /* istanbul ignore next */
    case 'linux':
      return 'linux';
    /* istanbul ignore next */
    case 'win32':
      return 'windows';
    /* istanbul ignore next */
    default:
      return 'none';
  }
}

const PLATFORM: Platform = detectPlatform();

/**
 * True when the host OS has a supported credential store.
 * Covers macOS (Keychain), Linux (Secret Service via secret-tool), and
 * Windows (Credential Manager via PasswordVault WinRT API).
 * Set AION_DISABLE_KEYCHAIN=1 to force the plaintext-file fallback.
 */
export const keychainAvailable = PLATFORM !== 'none';

// ── macOS — security(1) CLI ───────────────────────────────────────────────────

function macGet(account: SecretAccount): string | null {
  const v = execFileSync(
    'security',
    ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  return v || null;
}

function macSet(account: SecretAccount, value: string): void {
  // -U replaces the existing entry rather than erroring on a duplicate.
  execFileSync(
    'security',
    ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value],
    { stdio: 'pipe' }
  );
}

function macDelete(account: SecretAccount): void {
  execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account], {
    stdio: 'pipe',
  });
}

// ── Linux — secret-tool (libsecret) ──────────────────────────────────────────
// Requires the `libsecret-tools` package (e.g. `apt install libsecret-tools`).
// Falls back transparently to the plaintext file when not installed.

/* istanbul ignore next */
function linuxGet(account: SecretAccount): string | null {
  const v = execFileSync('secret-tool', ['lookup', 'service', SERVICE, 'account', account], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return v || null;
}

/* istanbul ignore next */
function linuxSet(account: SecretAccount, value: string): void {
  // secret-tool reads the secret from stdin to avoid it appearing in ps output.
  execFileSync(
    'secret-tool',
    ['store', '--label', `${SERVICE}:${account}`, 'service', SERVICE, 'account', account],
    { input: value, stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

/* istanbul ignore next */
function linuxDelete(account: SecretAccount): void {
  execFileSync('secret-tool', ['clear', 'service', SERVICE, 'account', account], {
    stdio: 'pipe',
  });
}

// ── Windows — PasswordVault WinRT API via PowerShell ─────────────────────────
// Available on Windows 8+ (PowerShell 5+). The secret value is base64-encoded
// before being passed to PowerShell so that special characters cannot break
// the script or cause injection.

/* istanbul ignore next */
const PS_VAULT_INIT =
  `[Windows.Security.Credentials.PasswordVault,` +
  `Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null;` +
  `$ErrorActionPreference='Stop';` +
  `$v=New-Object Windows.Security.Credentials.PasswordVault;`;

/* istanbul ignore next */
function runPS(script: string): string {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command', script],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

/* istanbul ignore next */
function winGet(account: SecretAccount): string | null {
  const result = runPS(
    `${PS_VAULT_INIT}` +
      `$c=$v.Retrieve('${SERVICE}','${account}');` +
      `$c.RetrievePassword();` +
      `Write-Output $c.Password`
  );
  return result || null;
}

/* istanbul ignore next */
function winSet(account: SecretAccount, value: string): void {
  // Encode the value so arbitrary characters never break the PowerShell literal.
  const b64 = Buffer.from(value, 'utf-8').toString('base64');
  runPS(
    `${PS_VAULT_INIT}` +
      `try{$old=$v.Retrieve('${SERVICE}','${account}');$v.Remove($old)}catch{}` +
      `$pw=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'));` +
      `$c=New-Object Windows.Security.Credentials.PasswordCredential('${SERVICE}','${account}',$pw);` +
      `$v.Add($c)`
  );
}

/* istanbul ignore next */
function winDelete(account: SecretAccount): void {
  // Wrap Retrieve in try/catch so deleting an absent entry is a no-op.
  runPS(`${PS_VAULT_INIT}` + `try{$c=$v.Retrieve('${SERVICE}','${account}');$v.Remove($c)}catch{}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a secret from the OS credential store.
 * Returns null when the item is absent, the store is unavailable, or the
 * underlying tool fails for any reason.
 */
export function getSecret(account: SecretAccount): string | null {
  if (!keychainAvailable) return null;
  try {
    switch (PLATFORM) {
      case 'macos':
        return macGet(account);
      /* istanbul ignore next */
      case 'linux':
        return linuxGet(account);
      /* istanbul ignore next */
      case 'windows':
        return winGet(account);
      /* istanbul ignore next */
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Store a secret in the OS credential store, replacing any existing entry.
 *
 * Unlike getSecret this function **throws** on failure. The caller
 * (persistSecretsToKeychain in manager.ts) catches the error and falls back to
 * keeping the secret in the config file, preventing silent data loss.
 */
export function setSecret(account: SecretAccount, value: string): void {
  if (!keychainAvailable) return;
  switch (PLATFORM) {
    case 'macos':
      macSet(account, value);
      break;
    /* istanbul ignore next */
    case 'linux':
      linuxSet(account, value);
      break;
    /* istanbul ignore next */
    case 'windows':
      winSet(account, value);
      break;
  }
}

/**
 * Remove a single secret from the OS credential store.
 * No-ops when the item is already absent or the store is unavailable.
 */
export function deleteSecret(account: SecretAccount): void {
  if (!keychainAvailable) return;
  try {
    switch (PLATFORM) {
      case 'macos':
        macDelete(account);
        break;
      /* istanbul ignore next */
      case 'linux':
        linuxDelete(account);
        break;
      /* istanbul ignore next */
      case 'windows':
        winDelete(account);
        break;
    }
  } catch {
    // Already absent — ignore.
  }
}

/**
 * Remove all aion secrets from the OS credential store.
 * Called when the user re-runs `aion setup` to avoid stale entries.
 */
export function deleteAllSecrets(): void {
  for (const account of Object.values(SECRET_ACCOUNTS)) {
    deleteSecret(account as SecretAccount);
  }
}
