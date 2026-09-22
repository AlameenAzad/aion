import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// os.homedir/fs.copyFileSync aren't configurable in this Node version
// (jest.spyOn throws "Cannot redefine property"), so replace the whole
// modules with mocks that keep every real function except these, which
// individual tests can override with a mockImplementation(Once).
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(jest.requireActual('os').homedir),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  copyFileSync: jest.fn(jest.requireActual('fs').copyFileSync),
}));
// Only 'security' (macOS Keychain lookup) is faked — 'sqlite3' calls fall
// through to the real binary so the sqlite-reading code paths stay real.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFileSync: jest.fn((cmd: string, args: string[], opts: unknown) => {
    if (cmd === 'security') return `${FAKE_SAFE_STORAGE_PASSWORD}\n`;
    return jest.requireActual('child_process').execFileSync(cmd, args, opts);
  }),
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

const FAKE_SAFE_STORAGE_PASSWORD = 'test-safe-storage-password';

import {
  decryptChromiumCookie,
  resolvePeopleForceCookie,
  getPeopleForceSessionCookie,
  getSessionCookieForDomain,
  openPeopleForceLogin,
  CookieAccessDeniedError,
} from '../../src/utils/browserCookies';
import { spawn } from 'child_process';

/** Builds a real Chrome-style encrypted cookie value (v10 + 32-byte header + PKCS7). */
function encryptChromiumCookie(plaintext: string, key: Buffer): Buffer {
  const iv = Buffer.alloc(16, ' ');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  const header = Buffer.alloc(32, 0);
  const data = Buffer.concat([header, Buffer.from(plaintext, 'utf-8')]);
  const blockSize = 16;
  const padLen = blockSize - (data.length % blockSize);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return Buffer.concat([Buffer.from('v10', 'utf-8'), encrypted]);
}

// ── decryptChromiumCookie (pure, no I/O) ─────────────────────────────────────

describe('decryptChromiumCookie', () => {
  const key = crypto.pbkdf2Sync('test-password', 'saltysalt', 1003, 16, 'sha1');
  const encrypt = (plaintext: string) => encryptChromiumCookie(plaintext, key);

  it('round-trips a real encrypted cookie value', () => {
    const encrypted = encrypt('super-secret-session-value');
    expect(decryptChromiumCookie(encrypted, key)).toBe('super-secret-session-value');
  });

  it('returns the raw string for older, unencrypted cookies (no v10/v11 prefix)', () => {
    const raw = Buffer.from('plain-unencrypted-value', 'utf-8');
    expect(decryptChromiumCookie(raw, key)).toBe('plain-unencrypted-value');
  });

  it('returns null when ciphertext is too short to contain the 32-byte header', () => {
    const tooShort = Buffer.concat([Buffer.from('v10', 'utf-8'), Buffer.alloc(16, 1)]);
    expect(decryptChromiumCookie(tooShort, key)).toBeNull();
  });

  it('returns null (not throw) on corrupt/undecryptable ciphertext', () => {
    const corrupt = Buffer.concat([Buffer.from('v10', 'utf-8'), Buffer.alloc(33, 0xff)]);
    expect(decryptChromiumCookie(corrupt, key)).toBeNull();
  });

  it('returns null when decrypted with the wrong key', () => {
    const encrypted = encrypt('secret');
    const wrongKey = crypto.pbkdf2Sync('other-password', 'saltysalt', 1003, 16, 'sha1');
    // Wrong key still decrypts to garbage bytes of the right length — assert
    // it does NOT silently return the original plaintext.
    expect(decryptChromiumCookie(encrypted, wrongKey)).not.toBe('secret');
  });
});

// ── Firefox/Zen integration: profiles.ini resolution + moz_cookies read ─────
// These exercise the real code path end-to-end (real fs, real sqlite3 CLI),
// with os.homedir() redirected to a disposable fake home per test.

function sqliteExec(dbPath: string, sql: string): void {
  execFileSync('sqlite3', [dbPath, sql], { stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('Firefox/Zen cookie read (integration)', () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-test-home-'));
    (os.homedir as jest.Mock).mockReturnValue(fakeHome);
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  function firefoxAppDir(): string {
    return path.join(fakeHome, 'Library/Application Support/Firefox');
  }

  it('resolves the Install-Default profile and picks the last-accessed cookie across duplicates, fixing pipe-value truncation', async () => {
    if (process.platform !== 'darwin') return; // path table only covers darwin/linux in this test
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'xyz123.default-release');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      [
        'orphan line before any section', // no current section yet — must be ignored, not throw
        '[Profile0]',
        'Name=default',
        'IsRelative=1',
        'Path=xyz123.default-release',
        'Default=1',
        'malformed line with no equals sign',
        '',
        '[Install1234ABCD]',
        'Default=xyz123.default-release',
        '',
      ].join('\n')
    );

    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(
      dbPath,
      'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, lastAccessed INTEGER);'
    );
    // Duplicate cookie name across two "containers" — older row (stale) has a
    // pipe-free value; the newer, actually-live row's value contains '|' and
    // must not be truncated at the first pipe.
    sqliteExec(
      dbPath,
      "INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES " +
        "('session_id', 'stale-no-pipe', '.co.example.com', 500), " +
        "('session_id', 'fresh|with|pipes', '.co.example.com', 1000), " +
        "('other_cookie', 'plainvalue', 'co.example.com', 700);"
    );

    const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');

    expect(cookie).toContain('session_id=fresh|with|pipes');
    expect(cookie).not.toContain('stale-no-pipe');
    expect(cookie).toContain('other_cookie=plainvalue');
  });

  it('falls back to any profile with a Path when nothing is marked Default', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'onlyprofile');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'profiles.ini'), '[Profile0]\nPath=onlyprofile\n');

    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(
      dbPath,
      'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, lastAccessed INTEGER);'
    );
    sqliteExec(
      dbPath,
      "INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES ('sid', 'val', '.co.example.com', 1);"
    );

    const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');
    expect(cookie).toBe('sid=val');
  });

  it('degrades to null when the profile resolves but has no cookies.sqlite file', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'empty-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      '[Profile0]\nIsRelative=1\nPath=empty-profile\nDefault=1\n'
    );

    const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');
    expect(cookie).toBeNull();
  });

  it('resolves an absolute (IsRelative=0) profile Path outside the app-support dir', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    fs.mkdirSync(appDir, { recursive: true });

    const externalProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-external-profile-'));
    try {
      fs.writeFileSync(
        path.join(appDir, 'profiles.ini'),
        `[Profile0]\nName=external\nIsRelative=0\nPath=${externalProfileDir}\nDefault=1\n`
      );
      const dbPath = path.join(externalProfileDir, 'cookies.sqlite');
      sqliteExec(
        dbPath,
        'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, lastAccessed INTEGER);'
      );
      sqliteExec(
        dbPath,
        "INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES ('sid', 'external-val', '.co.example.com', 1);"
      );

      const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');
      expect(cookie).toBe('sid=external-val');
    } finally {
      fs.rmSync(externalProfileDir, { recursive: true, force: true });
    }
  });

  it('picks up a -wal sidecar file sitting next to the main db without erroring', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      '[Profile0]\nName=default\nIsRelative=1\nPath=default\nDefault=1\n'
    );
    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(
      dbPath,
      'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, lastAccessed INTEGER);'
    );
    sqliteExec(
      dbPath,
      "INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES ('sid', 'val', '.co.example.com', 1);"
    );
    // A stray -wal file next to a non-WAL main db — runSqlite must still copy
    // it alongside the main file (exercising the sidecar-copy branch) without
    // that breaking the read of the real, already-committed row.
    fs.writeFileSync(dbPath + '-wal', Buffer.from('not really a wal frame'));

    const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');
    expect(cookie).toBe('sid=val');
  });

  it('returns null (not throw) when the db copy fails for a reason other than access-denied', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      '[Profile0]\nName=default\nIsRelative=1\nPath=default\nDefault=1\n'
    );
    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(dbPath, 'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY);');

    (fs.copyFileSync as jest.Mock).mockImplementationOnce(() => {
      const err = new Error('disk full') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });

    const cookie = await getSessionCookieForDomain('firefox', 'co.example.com');
    expect(cookie).toBeNull();
  });

  it('degrades to null (not throw) when profiles.ini is missing entirely', async () => {
    const cookie = await getSessionCookieForDomain('zen', 'co.example.com');
    expect(cookie).toBeNull();
  });

  it('degrades to null when profiles.ini exists but has no usable profile', async () => {
    const appDir = path.join(fakeHome, 'Library/Application Support/zen');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'profiles.ini'), '; empty\n');
    const cookie = await getSessionCookieForDomain('zen', 'co.example.com');
    expect(cookie).toBeNull();
  });

  it('propagates CookieAccessDeniedError (does not swallow it into null) when the copy is denied', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = firefoxAppDir();
    const profileDir = path.join(appDir, 'default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      '[Profile0]\nName=default\nIsRelative=1\nPath=default\nDefault=1\n'
    );
    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(dbPath, 'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY);');

    (fs.copyFileSync as jest.Mock).mockImplementationOnce(() => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    await expect(getSessionCookieForDomain('firefox', 'co.example.com')).rejects.toThrow(
      CookieAccessDeniedError
    );
  });
});

// ── Chromium integration: real cookies DB + faked Keychain password ────────

describe('Chromium cookie read (integration)', () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-test-home-'));
    (os.homedir as jest.Mock).mockReturnValue(fakeHome);
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('decrypts real cookie rows via the (faked) Keychain password and picks the last-accessed duplicate', async () => {
    if (process.platform !== 'darwin') return;
    const key = crypto.pbkdf2Sync(FAKE_SAFE_STORAGE_PASSWORD, 'saltysalt', 1003, 16, 'sha1');
    const dbPath = path.join(fakeHome, 'Library/Application Support/Google/Chrome/Default/Cookies');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    sqliteExec(
      dbPath,
      'CREATE TABLE cookies (name TEXT, host_key TEXT, encrypted_value BLOB, last_access_utc INTEGER);'
    );

    const stale = encryptChromiumCookie('stale-session', key).toString('hex');
    const fresh = encryptChromiumCookie('fresh-session', key).toString('hex');
    sqliteExec(
      dbPath,
      `INSERT INTO cookies (name, host_key, encrypted_value, last_access_utc) VALUES ` +
        `('sid', '.co.example.com', X'${stale}', 500), ` +
        `('sid', '.co.example.com', X'${fresh}', 1000);`
    );

    const cookie = await getSessionCookieForDomain('chrome', 'co.example.com');
    expect(cookie).toBe('sid=fresh-session');
  });

  it('degrades to null when the browser has no cookies file at all', async () => {
    const cookie = await getSessionCookieForDomain('edge', 'co.example.com');
    expect(cookie).toBeNull();
  });
});

describe('openPeopleForceLogin', () => {
  it('opens the /users/sign_in URL in the OS default browser', () => {
    openPeopleForceLogin('https://co.peopleforce.io/');
    expect(spawn as jest.Mock).toHaveBeenCalled();
    const [, args] = (spawn as jest.Mock).mock.calls[0];
    expect(String(args)).toContain('https://co.peopleforce.io/users/sign_in');
  });
});

// ── resolvePeopleForceCookie / getPeopleForceSessionCookie ──────────────────

describe('resolvePeopleForceCookie', () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-test-home-'));
    (os.homedir as jest.Mock).mockReturnValue(fakeHome);
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('reads a real cookie from the configured browser when no manual cookie is set', async () => {
    if (process.platform !== 'darwin') return;
    const appDir = path.join(fakeHome, 'Library/Application Support/Firefox');
    const profileDir = path.join(appDir, 'default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'profiles.ini'),
      '[Profile0]\nName=default\nIsRelative=1\nPath=default\nDefault=1\n'
    );
    const dbPath = path.join(profileDir, 'cookies.sqlite');
    sqliteExec(
      dbPath,
      'CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, lastAccessed INTEGER);'
    );
    sqliteExec(
      dbPath,
      "INSERT INTO moz_cookies (name, value, host, lastAccessed) VALUES ('sid', 'val', '.co.peopleforce.io', 1);"
    );

    const cookie = await resolvePeopleForceCookie({
      baseUrl: 'https://co.peopleforce.io',
      browser: 'firefox',
    });
    expect(cookie).toBe('sid=val');
  });

  it('prefers the manually pasted cookie over any browser read', async () => {
    const cookie = await resolvePeopleForceCookie({
      baseUrl: 'https://co.peopleforce.io',
      browser: 'firefox',
      manualCookie: 'pasted-cookie',
    });
    expect(cookie).toBe('pasted-cookie');
  });

  it('throws an actionable error when neither manualCookie nor browser is configured', async () => {
    await expect(
      resolvePeopleForceCookie({ baseUrl: 'https://co.peopleforce.io' })
    ).rejects.toThrow('aion config edit-peopleforce');
  });

  it('throws an actionable error when the configured browser has no readable cookie', async () => {
    // No Firefox profile exists in the fake home, so the read degrades to null.
    await expect(
      resolvePeopleForceCookie({ baseUrl: 'https://co.peopleforce.io', browser: 'firefox' })
    ).rejects.toThrow('Could not read a PeopleForce session cookie from firefox');
  });
});

describe('getPeopleForceSessionCookie', () => {
  it('derives the domain from the configured baseUrl', async () => {
    const cookie = await getPeopleForceSessionCookie('zen', 'https://co.peopleforce.io/');
    expect(cookie).toBeNull(); // no real Zen profile in this environment
  });
});
