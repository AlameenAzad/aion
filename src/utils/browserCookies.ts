import { execFileSync, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Single source of truth for supported browsers — schema.ts's zod enum and
 * every browser-choice prompt derive from this so adding one is a one-line change. */
export const SUPPORTED_BROWSERS = ['chrome', 'edge', 'brave', 'firefox', 'zen'] as const;

export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];

export const BROWSER_CHOICES: { name: string; value: SupportedBrowser }[] = [
  { name: 'Chrome', value: 'chrome' },
  { name: 'Edge', value: 'edge' },
  { name: 'Brave', value: 'brave' },
  { name: 'Firefox', value: 'firefox' },
  { name: 'Zen', value: 'zen' },
];

type ChromiumBrowser = Exclude<SupportedBrowser, 'firefox' | 'zen'>;

type FirefoxFamilyBrowser = Extract<SupportedBrowser, 'firefox' | 'zen'>;

/**
 * Zen is a Firefox fork with its own app-support dir but the same profiles.ini
 * format — see resolveDefaultFirefoxProfileDir. Only macOS/Linux paths are
 * distinguished per-fork here; Windows falls back to stock Firefox's path
 * (best-effort/unverified, same caveat as the rest of the Windows support).
 */
const FIREFOX_FAMILY_APP_DIR: Record<
  FirefoxFamilyBrowser,
  { darwin: string; linux: string; win32: string }
> = {
  firefox: {
    darwin: 'Library/Application Support/Firefox',
    linux: '.mozilla/firefox',
    win32: 'AppData/Roaming/Mozilla/Firefox',
  },
  zen: {
    darwin: 'Library/Application Support/zen',
    linux: '.zen',
    win32: 'AppData/Roaming/zen',
  },
};

const CHROMIUM_COOKIE_PATH: Record<
  ChromiumBrowser,
  { darwin: string; linux: string; win32: string }
> = {
  chrome: {
    darwin: 'Library/Application Support/Google/Chrome/Default/Cookies',
    linux: '.config/google-chrome/Default/Cookies',
    win32: 'AppData/Local/Google/Chrome/User Data/Default/Network/Cookies',
  },
  edge: {
    darwin: 'Library/Application Support/Microsoft Edge/Default/Cookies',
    linux: '.config/microsoft-edge/Default/Cookies',
    win32: 'AppData/Local/Microsoft/Edge/User Data/Default/Network/Cookies',
  },
  brave: {
    darwin: 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies',
    linux: '.config/BraveSoftware/Brave-Browser/Default/Cookies',
    win32: 'AppData/Local/BraveSoftware/Brave-Browser/User Data/Default/Network/Cookies',
  },
};

/** Windows only: where each browser keeps its AES key, DPAPI-wrapped, as JSON. */
const CHROMIUM_LOCAL_STATE_PATH: Record<ChromiumBrowser, string> = {
  chrome: 'AppData/Local/Google/Chrome/User Data/Local State',
  edge: 'AppData/Local/Microsoft/Edge/User Data/Local State',
  brave: 'AppData/Local/BraveSoftware/Brave-Browser/User Data/Local State',
};

const CHROMIUM_SAFE_STORAGE: Record<ChromiumBrowser, { service: string; account: string }> = {
  chrome: { service: 'Chrome Safe Storage', account: 'Chrome' },
  edge: { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
  brave: { service: 'Brave Safe Storage', account: 'Brave' },
};

/** Linux only: libsecret item Chromium stores its AES-key password under. */
const LINUX_SAFE_STORAGE_APPLICATION: Record<ChromiumBrowser, string> = {
  chrome: 'chrome',
  edge: 'microsoft-edge',
  brave: 'brave',
};

/**
 * Opens PeopleForce's login page in the user's OS default browser — not a
 * browser Aion controls. If the user is already SSO'd into Microsoft there,
 * this can complete with zero further clicks. There is no way to script the
 * Outlook SSO + MFA flow itself (see design doc), so this is the interactive
 * step that has to happen once per session.
 */
export function openPeopleForceLogin(baseUrl: string): void {
  const url = `${baseUrl.replace(/\/$/, '')}/users/sign_in`;
  /* istanbul ignore next - spawns a real OS process, not exercised in tests */
  const platform = process.platform;
  /* istanbul ignore next */
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/**
 * Reads the PeopleForce session cookie live from the given browser's local
 * cookie store. Nothing is ever persisted by Aion — the cookie already lives
 * in the browser, this just reads it fresh each call so a re-login in the
 * browser is picked up automatically on the next run.
 */
/**
 * Thrown when the OS itself refuses to read the browser's cookie file — on
 * macOS this is TCC blocking access to Chrome/Edge/Brave's profile directory
 * (confirmed live: `EPERM` on both `cp` and a plain `fs.copyFileSync`, even
 * though `security find-generic-password` for the Safe Storage key works
 * fine). Distinct from "not logged in" — the fix is granting Full Disk
 * Access to the terminal/app running Aion, not logging in again.
 */
export class CookieAccessDeniedError extends Error {}

/**
 * Resolves the Cookie header to use for a PeopleForce request: a manually
 * pasted cookie (no OS permissions needed) takes priority when set, since a
 * user who configured one explicitly opted out of the disk-read path —
 * falling back to it silently would just re-trigger the Full Disk Access
 * problem they avoided. Throws with an actionable message when neither is
 * available/working, since every caller needs one before it can do anything.
 */
export async function resolvePeopleForceCookie(config: {
  baseUrl: string;
  browser?: SupportedBrowser;
  manualCookie?: string;
}): Promise<string> {
  if (config.manualCookie) return config.manualCookie;

  if (!config.browser) {
    throw new Error(
      'No PeopleForce session configured — run `aion config edit-peopleforce` to set one up.'
    );
  }

  const cookie = await getPeopleForceSessionCookie(config.browser, config.baseUrl);
  if (!cookie) {
    throw new Error(
      `Could not read a PeopleForce session cookie from ${config.browser} — log in again in your browser, or run \`aion config edit-peopleforce\` to switch to manual paste.`
    );
  }
  return cookie;
}

export async function getPeopleForceSessionCookie(
  browser: SupportedBrowser,
  baseUrl: string
): Promise<string | null> {
  return getSessionCookieForDomain(browser, new URL(baseUrl).hostname);
}

/**
 * Same cookie-read machinery as `getPeopleForceSessionCookie`, generalized to
 * any domain — used to read the `login.microsoftonline.com` AAD SSO session
 * cookie for Dyce's silent re-authentication (see resolveDyceToken).
 */
export async function getSessionCookieForDomain(
  browser: SupportedBrowser,
  domain: string
): Promise<string | null> {
  try {
    if (browser === 'firefox' || browser === 'zen') {
      return getFirefoxCookie(browser, domain);
    }
    return getChromiumCookie(browser, domain);
  } catch (err) {
    if (err instanceof CookieAccessDeniedError) throw err;
    return null;
  }
}

// ── Chromium family (Chrome / Edge / Brave) ────────────────────────────────
// Cookie values are AES-128-CBC encrypted with a key derived (PBKDF2) from a
// password stored in the OS keychain under a browser-specific service name.
// This is the same scheme tools like yt-dlp's --cookies-from-browser use.

function getChromiumDbPath(browser: ChromiumBrowser): string | null {
  const home = os.homedir();
  const rel =
    process.platform === 'darwin'
      ? CHROMIUM_COOKIE_PATH[browser].darwin
      : process.platform === 'linux'
        ? CHROMIUM_COOKIE_PATH[browser].linux
        : /* istanbul ignore next */ process.platform === 'win32'
          ? /* istanbul ignore next */ CHROMIUM_COOKIE_PATH[browser].win32
          : /* istanbul ignore next */ null;
  if (!rel) return null;

  const full = path.join(home, rel);
  if (fs.existsSync(full)) return full;

  /* istanbul ignore next - fallback for pre-"Network/" Chrome profile layout on Windows */
  if (process.platform === 'win32') {
    const legacy = path.join(home, rel.replace('/Network/Cookies', '/Cookies'));
    return fs.existsSync(legacy) ? legacy : null;
  }
  return null;
}

/**
 * macOS: password lives in Keychain under a browser-specific service name,
 * verified live (see decryptChromiumCookie doc). Linux: same PBKDF2 scheme
 * but a single iteration and a password Chromium stores via libsecret — falls
 * back to the well-known constant "peanuts" Chromium itself uses whenever no
 * secret-service keyring is available (e.g. headless/server installs), which
 * covers most real-world Linux boxes. Neither path has been verified against
 * a live Linux session (best-effort, matches the scheme documented by
 * chrome-cookies-secure / browser_cookie3 for these platforms).
 */
/* istanbul ignore next - requires a real OS keychain/keyring entry for the browser */
function getChromiumSafeStorageKey(browser: ChromiumBrowser): Buffer | null {
  if (process.platform === 'darwin') {
    const { service, account } = CHROMIUM_SAFE_STORAGE[browser];
    try {
      const password = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', service, '-a', account],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    } catch {
      return null;
    }
  }

  if (process.platform === 'linux') {
    const password = getLinuxSafeStoragePassword(browser) ?? 'peanuts';
    return crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
  }

  return null;
}

/* istanbul ignore next - requires a real Secret Service keyring on Linux */
function getLinuxSafeStoragePassword(browser: ChromiumBrowser): string | null {
  try {
    const application = LINUX_SAFE_STORAGE_APPLICATION[browser];
    const password = execFileSync(
      'secret-tool',
      ['lookup', 'application', application, 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return password || null;
  } catch {
    return null;
  }
}

/**
 * Windows: cookies are AES-256-GCM encrypted (not the CBC scheme mac/linux
 * use) with a per-profile key that is itself DPAPI-wrapped and stored in the
 * profile's "Local State" JSON file (`os_crypt.encrypted_key`, base64, with a
 * constant 5-byte "DPAPI" prefix to strip before unwrapping). Unwrapping
 * needs the real Windows DPAPI (CryptUnprotectData), which Node has no
 * built-in binding for, so this shells out to PowerShell's
 * System.Security.Cryptography.ProtectedData the same way keychain.ts already
 * does for Windows Credential Manager access. Best-effort/unverified (no
 * Windows machine to test against) — falls back to null (→ manual cookie
 * paste) on any failure, and does not cover Chrome's newer "App-Bound
 * Encryption" (Chrome 127+, needs an elevated helper process to decrypt).
 */
/* istanbul ignore next - requires a real Windows DPAPI-protected profile */
function getWindowsSafeStorageKey(browser: ChromiumBrowser): Buffer | null {
  try {
    const localStatePath = path.join(os.homedir(), CHROMIUM_LOCAL_STATE_PATH[browser]);
    if (!fs.existsSync(localStatePath)) return null;

    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8')) as {
      os_crypt?: { encrypted_key?: string };
    };
    const encryptedKeyB64 = localState.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) return null;

    const wrapped = Buffer.from(encryptedKeyB64, 'base64').subarray(5); // strip "DPAPI" prefix
    const wrappedB64 = wrapped.toString('base64');
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-OutputFormat',
        'Text',
        '-Command',
        `Add-Type -AssemblyName System.Security;` +
          `$b=[Convert]::FromBase64String('${wrappedB64}');` +
          `$d=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,` +
          `[System.Security.Cryptography.DataProtectionScope]::CurrentUser);` +
          `Write-Output ([Convert]::ToBase64String($d))`,
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    return output ? Buffer.from(output, 'base64') : null;
  } catch {
    return null;
  }
}

/**
 * Decrypts a Windows Chromium cookie value (AES-256-GCM): 3-byte v10/v11
 * prefix, 12-byte nonce, ciphertext, 16-byte auth tag appended at the end.
 * Unlike the mac/linux CBC scheme, there is no extra header to strip.
 */
/* istanbul ignore next - exercised only against real Windows cookie bytes */
function decryptWindowsCookie(encrypted: Buffer, key: Buffer): string | null {
  try {
    const prefix = encrypted.subarray(0, 3).toString('utf-8');
    if (prefix !== 'v10' && prefix !== 'v11') return encrypted.toString('utf-8');

    const nonce = encrypted.subarray(3, 15);
    const tag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(15, encrypted.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * The fixed 16-space IV scheme is correct (verified against the actively
 * maintained `chrome-cookies-secure` v3.0.2, updated 2026-04-16) — an
 * earlier version of this function wrongly guessed the IV had become
 * per-value. What actually changed: current Chrome prepends a constant
 * 32-byte (2 AES blocks) header before the real plaintext, which must be
 * discarded after decrypting — not scanned for heuristically, it's fixed.
 * Padding is handled manually (not via setAutoPadding) since the trailing
 * padding byte needs to be read before slicing the 32-byte header off.
 */
export function decryptChromiumCookie(encrypted: Buffer, key: Buffer): string | null {
  try {
    const prefix = encrypted.subarray(0, 3).toString('utf-8');
    if (prefix !== 'v10' && prefix !== 'v11') {
      // Older, unencrypted Chromium cookie.
      return encrypted.toString('utf-8');
    }

    const ciphertext = encrypted.subarray(3);
    if (ciphertext.length <= 32) return null;

    const iv = Buffer.alloc(16, ' ');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const padding = decrypted[decrypted.length - 1];
    const end = padding > 0 && padding <= 16 ? decrypted.length - padding : decrypted.length;
    return decrypted.subarray(32, end).toString('utf-8');
  } catch {
    return null;
  }
}

function runSqlite(dbPath: string, query: string): string[] {
  // Copy into a private, mode-0700 per-invocation dir — the source DB (and,
  // for Firefox, the copy itself) can contain live session cookie values, so
  // this must never land somewhere other local users can read it.
  // mkdtemp creates the directory with mode 0700 by default (POSIX mkdtemp semantics).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-cookies-'));
  const tmpPath = path.join(tmpDir, 'cookies.sqlite');
  try {
    try {
      fs.copyFileSync(dbPath, tmpPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        throw new CookieAccessDeniedError(
          "macOS is blocking access to your browser's cookie storage. Grant Full Disk Access " +
            'to the terminal app running aion: System Settings → Privacy & Security → Full Disk ' +
            'Access, then restart your terminal and try again.'
        );
      }
      throw err;
    }
    fs.chmodSync(tmpPath, 0o600);

    // Both Chromium's and Firefox's cookie DBs use WAL journal mode — recent
    // writes (e.g. a session cookie from a login that just happened) can sit
    // in the -wal sidecar file, uncommitted to the main .sqlite file, for a
    // while. Copying only the main file silently reads stale data. sqlite3
    // picks up -wal/-shm automatically as long as they sit next to the main
    // file under the same base name, so copy them too when present.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = dbPath + suffix;
      if (fs.existsSync(sidecar)) {
        fs.copyFileSync(sidecar, tmpPath + suffix);
        fs.chmodSync(tmpPath + suffix, 0o600);
      }
    }

    const output = execFileSync('sqlite3', [tmpPath, query], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').filter((line) => line.trim().length > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getChromiumCookie(browser: ChromiumBrowser, domain: string): string | null {
  const dbPath = getChromiumDbPath(browser);
  if (!dbPath) return null;

  // Windows uses a different key source (DPAPI-wrapped, from Local State)
  // and cipher (AES-256-GCM) than mac/linux (Keychain/libsecret password,
  // AES-128-CBC) — see getWindowsSafeStorageKey / decryptWindowsCookie.
  /* istanbul ignore next - requires a real Windows profile */
  const isWindows = process.platform === 'win32';
  /* istanbul ignore next - the Windows branch requires a real Windows profile */
  const key = isWindows ? getWindowsSafeStorageKey(browser) : getChromiumSafeStorageKey(browser);
  if (!key) return null;
  /* istanbul ignore next - the Windows branch requires a real Windows profile */
  const decrypt = isWindows ? decryptWindowsCookie : decryptChromiumCookie;

  // Exact host match only — a LIKE '%domain%' substring match previously
  // picked up cookies from unrelated hosts that merely contain the same
  // domain suffix (e.g. a stale app.peopleforce.io alongside the real
  // company subdomain), silently corrupting the Cookie header with
  // duplicate/wrong-session cookie names. `.domain` is the standard
  // leading-dot form for a cookie scoped to the whole domain.
  const escaped = domain.replace(/'/g, "''");
  const query =
    `SELECT name, hex(encrypted_value), last_access_utc FROM cookies ` +
    `WHERE host_key = '${escaped}' OR host_key = '.${escaped}' ORDER BY last_access_utc ASC;`;
  const lines = runSqlite(dbPath, query);

  // A Map keeps only one value per cookie name if a name exists under both
  // the exact host and the leading-dot domain. Order by last-accessed (not
  // creation time): a browser can hold multiple same-named cookies scoped to
  // different contexts (see the Firefox/Zen container comment below) where
  // the most-recently-created row isn't necessarily the one actually in use.
  const cookies = new Map<string, string>();
  for (const line of lines) {
    // Three pipe-delimited columns (name|hex(encrypted_value)|last_access_utc).
    // A cookie name is an HTTP token and hex() output is only [0-9a-f], so
    // neither of the first two fields can itself contain '|' — splitting and
    // taking the first two parts is safe (unlike the Firefox value field below).
    const [name, hex] = line.split('|');
    if (!name || !hex) continue;
    const value = decrypt(Buffer.from(hex, 'hex'), key);
    if (value) cookies.set(name, value);
  }

  if (cookies.size === 0) return null;
  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ');
}

// ── Firefox (and Firefox-family forks, e.g. Zen) ────────────────────────────
// cookies.sqlite is not encrypted at rest, so no key derivation is needed.
// Every Firefox-based browser keeps the same profiles.ini format in its own
// app-support dir, so resolving the active profile the same way the browser
// itself does (via profiles.ini) covers forks automatically — no per-fork
// hardcoding needed beyond knowing where each fork's app-support dir lives.

/** Parses a minimal INI file into {section: {key: value}} — no nesting, no typed values. */
function parseIni(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      current = sectionMatch[1];
      sections[current] = {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

/**
 * Resolves the profile directory a Firefox-family browser actually launches
 * with — via profiles.ini, not by guessing from profile-folder-name suffixes
 * (e.g. ".default-release"), which don't follow any fixed convention across
 * forks (confirmed live: Zen's profile dirs are named "np9...Default Profile"
 * / "9ao...Default (release)", neither of which is a suffix match).
 *
 * Preference order mirrors profiles.ini's own semantics: a per-install
 * `[InstallXXXX] Default=` entry (what actually launches) beats the
 * `[ProfileN] Default=1` marker (legacy, not updated by newer profile
 * managers), which beats just picking any profile.
 */
function resolveDefaultFirefoxProfileDir(appSupportDir: string): string | null {
  const iniPath = path.join(appSupportDir, 'profiles.ini');
  if (!fs.existsSync(iniPath)) return null;

  const sections = parseIni(fs.readFileSync(iniPath, 'utf-8'));
  const sectionList = Object.entries(sections);

  // A profile's Path may be absolute (IsRelative=0) — e.g. a profile moved off
  // the system disk, or created via the Profile Manager's "Choose Folder…".
  // path.join would silently mangle an absolute path into a nonexistent one.
  const resolve = (p: string): string => (path.isAbsolute(p) ? p : path.join(appSupportDir, p));

  const install = sectionList.find(([name, s]) => name.startsWith('Install') && s.Default);
  if (install) return resolve(install[1].Default);

  const defaultProfile = sectionList.find(([, s]) => s.Path && s.Default === '1');
  if (defaultProfile) return resolve(defaultProfile[1].Path);

  const anyProfile = sectionList.find(([, s]) => s.Path);
  return anyProfile ? resolve(anyProfile[1].Path) : null;
}

function getFirefoxCookiesDbPath(browser: FirefoxFamilyBrowser): string | null {
  const home = os.homedir();
  const rel =
    process.platform === 'darwin'
      ? FIREFOX_FAMILY_APP_DIR[browser].darwin
      : process.platform === 'linux'
        ? FIREFOX_FAMILY_APP_DIR[browser].linux
        : /* istanbul ignore next */ process.platform === 'win32'
          ? /* istanbul ignore next */ FIREFOX_FAMILY_APP_DIR[browser].win32
          : /* istanbul ignore next */ null;
  if (!rel) return null;

  const profileDir = resolveDefaultFirefoxProfileDir(path.join(home, rel));
  if (!profileDir) return null;

  const dbPath = path.join(profileDir, 'cookies.sqlite');
  return fs.existsSync(dbPath) ? dbPath : null;
}

function getFirefoxCookie(browser: FirefoxFamilyBrowser, domain: string): string | null {
  const dbPath = getFirefoxCookiesDbPath(browser);
  if (!dbPath) return null;

  // Exact host match — see the comment in getChromiumCookie on why a LIKE
  // substring match is wrong (it can pull in unrelated hosts sharing the
  // same domain suffix).
  //
  // Order by lastAccessed, not creationTime: Firefox/Zen scope cookies per
  // container (moz_cookies is unique on name+host+path+originAttributes), so
  // the same cookie name can have a separate row per container/workspace.
  // Verified live: a stale/guest session cookie in the default container had
  // a *newer* creationTime than the real, actively-used one sitting in a
  // different container (userContextId), whose lastAccessed was current —
  // picking by creationTime silently picked the wrong, unauthenticated one.
  const escaped = domain.replace(/'/g, "''");
  const query =
    `SELECT name, value FROM moz_cookies ` +
    `WHERE host = '${escaped}' OR host = '.${escaped}' ORDER BY lastAccessed ASC;`;
  const lines = runSqlite(dbPath, query);

  const cookies = new Map<string, string>();
  for (const line of lines) {
    // Cookie values legally contain '|' (RFC 6265 cookie-octet) — sqlite3's
    // list-mode delimiter isn't escaped, so split on the FIRST '|' only, or a
    // value containing one gets silently truncated.
    const sep = line.indexOf('|');
    if (sep === -1) continue;
    const name = line.slice(0, sep);
    const value = line.slice(sep + 1);
    if (!name) continue;
    cookies.set(name, value);
  }

  return cookies.size > 0
    ? Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ')
    : null;
}
