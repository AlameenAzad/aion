# PeopleForce as a second leave provider

Date: 2026-09-21

## Context

Aion currently supports one leave-tracking provider, Paser
(`src/api/paser.ts`, `src/utils/paser.ts`), hardcoded as a single
optional `config.paser` block. The company is migrating to
PeopleForce. Existing Paser users need a path to switch; new users
need to be able to pick either provider during setup.

PeopleForce's officially documented REST API
(`https://developer.peopleforce.io`) only supports a single
company-wide `X-API-KEY` (admin-issued, full read/write access to all
employees' HR data). That doesn't fit Aion's per-user model — Aion is
a local CLI with no backend, and this user has no admin access to
generate one, and it should not be issued once and copied into every
employee's laptop even if it could be (one shared secret with
company-wide HR access, not scoped per person).

PeopleForce also does not offer self-serve OAuth app registration —
confirmed against `developer.peopleforce.io/docs`, no client
registration flow exists. The "Connections" panel under
Preferences → Security is PeopleForce's own pre-approved marketplace
(Slack/Teams/vendor AI connectors), not something a third-party app
can register into.

The company's PeopleForce login is Outlook (Microsoft) SSO only — no
password to submit. This rules out scripting a Paser-style
`authenticate(email, password)` call, and rules out Aion's existing
Dyce-style device-code OAuth (`src/api/msauth.ts`) too, since that
only works because Aion holds its own Entra app registration that
Dyce's backend trusts — Aion has no such registration in PeopleForce's
tenant.

**Resolved approach**: session-cookie auth, captured from the user's
own default browser after a one-time interactive SSO login, the same
family of trick tools like `yt-dlp --cookies-from-browser` use for
cookie-only sites. No credential (password, API key, or cookie) is
ever persisted by Aion — the cookie is read live from the browser's
own local cookie store on each run, and re-captured whenever it
expires.

## Goals

- Users can configure PeopleForce as their leave provider during
  `setup`, alongside the existing Paser option.
- Existing Paser users get a one-time, non-blocking notice on
  upgrade: "PeopleForce support added — still using Paser, or want to
  switch?" No forced migration, no repeated nagging.
- Sync/preview/status all work against whichever provider is
  configured, through one normalized data path.
- No PeopleForce secret is ever written to `~/.aion/config.json` or
  requested to be typed into Aion directly.

## Non-goals

- Supporting a company-wide API key flow (no admin access to issue
  one; would need a shared-secret distribution model this CLI's
  architecture doesn't have).
- Fully headless/non-interactive PeopleForce login. MFA + Conditional
  Access make scripting the Microsoft login form both fragile and a
  likely policy violation — out of scope.
- Running multiple leave providers simultaneously in one sync.

## Config schema (`src/config/schema.ts`)

Add a top-level discriminator and a new optional provider block:

```ts
leaveProvider: z.enum(['paser', 'peopleforce']).optional(),

peopleforce: z.object({
  baseUrl: z.string().url().default('https://app.peopleforce.io'),
  browser: z.enum(['chrome', 'edge', 'brave', 'firefox']),
}).optional(),
```

`config.paser` is untouched. Both `FileConfigSchema` and
`ConfigSchema` get the same two fields (no secret split needed for
`peopleforce` — see Keychain below). `schemaVersion` bumps 1 → 2.

Note what's deliberately **not** here: no `apiKey`, no `email`, no
`password`, no stored cookie. `browser` just tells Aion which local
browser profile to read the session cookie from.

## Cookie capture (`src/utils/browserCookies.ts`, new)

`getPeopleForceSessionCookie(browser, baseUrl): Promise<string | null>`

- Locates the named browser's local cookie store (Chromium-family:
  SQLite `Cookies` DB, values decrypted via OS keychain — macOS
  Keychain, Windows DPAPI, Linux libsecret; Firefox: `cookies.sqlite`,
  unencrypted on disk).
- Filters to the `peopleforce.io` domain, returns the session cookie
  as a `Cookie: name=value` header string.
- Returns `null` if the browser isn't installed, the profile can't be
  read, or no matching cookie is found (treated as "not logged in
  here").

`openPeopleForceLogin(baseUrl)` — opens the default OS browser (via
`open` package or `child_process` `open`/`start`/`xdg-open`) to
PeopleForce's login page. If the user is already SSO'd into Microsoft
in that browser, this can complete with zero further clicks.

Dependency choice (Chromium cookie decryption in particular) needs a
maintained npm package evaluated during implementation — flagging
this as an implementation-time decision, not resolving it here in the
design.

## `PeopleForceClient` (`src/api/peopleforce.ts`, new)

Mirrors `PaserClient`'s shape but with cookie-based, not
password-based, auth:

- `constructor(baseUrl, sessionCookie)`
- `testConnection()` — hits the leave-requests list endpoint,
  distinguishes "not logged in / cookie expired" from other errors so
  callers can re-trigger login specifically on auth failure.
- `getLeaveCases({ from, to, pageSize?, maxPages? })` — paginated GET
  against PeopleForce's **internal** (SPA-facing, not the documented
  public v3 partner API — that one requires the company API key we
  don't have) leave-requests endpoint, cookie-authenticated.

**Open unknown, must be captured empirically before implementation
starts**: the exact internal endpoint path, request shape (may need a
CSRF token alongside the cookie, common in Rails-style apps like
Paser's own backend), and response shape the PeopleForce SPA itself
uses for "my leave requests." This requires inspecting real network
traffic from a logged-in session — first implementation task, not
guessable from public docs (which only cover the company-key partner
API).

Compare: PeopleForce's *documented* partner API already gives clean
fields — `starts_on`, `ends_on`, `leave_type`, `state` — no
Paser-style title-regex parsing needed. The internal endpoint likely
has similar structured fields (it's the source the frontend renders
from) but field names need confirming once captured.

## Normalized leave case (`src/utils/leave.ts`, new)

```ts
interface LeaveCase {
  id: string;
  provider: 'paser' | 'peopleforce';
  title: string;
  startDate: string;
  endDate: string;
  leaveType: 'vacation' | 'sickLeave' | 'unsupported';
  isApprovedOrCompleted: boolean;
}
```

`parsePaserCase` (existing, moved/adapted) and new
`parsePeopleForceCase` both map into this shape.
`findCasesMatchingDate` and `classifyLeaveType` become
provider-agnostic, operating on `LeaveCase[]` instead of raw
`PaserCase[]`.

## `sync.ts` changes

Replace the single `if (config.paser)` block (lines ~159-207) with a
branch on `config.leaveProvider` that produces `LeaveCase[]` either
way:

```ts
let leaveCases: LeaveCase[] = [];
if (config.leaveProvider === 'paser' && config.paser) {
  leaveCases = await fetchPaserCases(config.paser, range);
} else if (config.leaveProvider === 'peopleforce' && config.peopleforce) {
  leaveCases = await fetchPeopleForceCases(config.peopleforce, range);
}
```

Everything downstream (worklog date-matching, leave-type prompt,
request-ID resolution, Dyce description string) already operates
conceptually on the normalized fields and needs only its input type
changed from `ParsedPaserCase` to `LeaveCase` — no behavioral change
for existing Paser users.

`isApprovedOrCompleted` becomes a per-provider mapper feeding the
shared field (Paser: `state`/`stage` strings; PeopleForce: `state`
field, mapped during `parsePeopleForceCase`).

## Setup wizard (`src/commands/setup.ts`)

Step 4 becomes "Leave Platform":

1. Prompt: Paser / PeopleForce / skip.
2. **Paser**: unchanged existing flow.
3. **PeopleForce**: prompt for `browser` choice → call
   `openPeopleForceLogin(baseUrl)` → prompt "press Enter once you're
   logged in" → `getPeopleForceSessionCookie()` → `testConnection()`.
   On failure (cookie not found / expired), show the reason and offer
   retry. No credential is written to `draft.peopleforce` — only
   `{ baseUrl, browser }`.
4. Save `draft.leaveProvider` + provider block, same resume pattern
   as today (`draft.step >= 4 && draft.peopleforce`).

## Existing-user notice (non-blocking)

New `notifyLeaveProviderChoice(config)`, called once after
`loadConfig()` in commands gated by `configExists()` (sync, preview,
status — not `setup`, not `config`). Fires only when:
`config.paser` is set, `config.leaveProvider` is unset, and
`config.peopleforceNoticeShown` is not `true`.

Shows: "Aion now supports PeopleForce as a leave provider. Still
using Paser, or want to switch?"

- **Still using Paser**: stamp `leaveProvider: 'paser'`,
  `peopleforceNoticeShown: true`, save, continue — shown once, never
  again.
- **Switch**: run the same PeopleForce mini-setup as step 4 above
  inline, stamp `leaveProvider: 'peopleforce'` +
  `peopleforceNoticeShown: true`, save, continue.
- **Skip for now**: stamp `peopleforceNoticeShown: true` only
  (`leaveProvider` stays unset, `config.paser` keeps working exactly
  as today via the existing untouched code path) — asked once, not
  nagged again, free to switch later via `config` command.

`migrateRawConfig` (`src/config/manager.ts`) bumps `schemaVersion` to
2 and defaults `peopleforceNoticeShown: false` on legacy files — this
is the first migration this function does beyond stamping a version
number, but the shape of the change (default a new optional field) is
the same pattern.

## Keychain (`src/config/keychain.ts`)

**No new entry.** Unlike Paser's password, PeopleForce needs no
persisted secret — the session cookie is read live from the browser's
own store each run and never written to Aion's config or keychain.
This sidesteps the "who else can read this secret" concern entirely
for PeopleForce.

## Other touchpoints

- `src/commands/config.ts` — add `runConfigEditPeopleForce()`
  mirroring `runConfigEditPaser()` (re-run browser choice + login +
  test), plus a generic way to switch `leaveProvider` later (reuses
  the same prompt as the one-time notice).
- `src/commands/status.ts` — branch on `config.leaveProvider` for the
  connectivity check (PeopleForce: attempt cookie read +
  `testConnection()`, report "not logged in" distinctly from "not
  configured").
- `src/commands/configExport.ts` — `peopleforce` block has nothing to
  strip/merge (no secret in it), unlike `paser`'s password handling.
- `src/index.ts` — no new CLI flags needed beyond what `setup`/`config`
  already expose; PeopleForce's `browser` field replaces Paser's
  `accountId`-style step-through prompts.

## Testing

- Unit tests for `parsePeopleForceCase`, `classifyLeaveType` /
  `findCasesMatchingDate` against the shared `LeaveCase` shape.
- `browserCookies.ts` — unit test the parsing/filtering logic with a
  fixture cookie DB; the actual OS-keychain decryption path is
  integration-only (can't reasonably run in CI), so it needs a thin
  seam (injectable decrypt function) to keep the rest unit-testable
  and hit the 90% coverage bar.
- `sync.ts` branch coverage for both providers using mocked clients,
  same pattern as existing Paser tests.

## Post-implementation: verified against a real session

Everything below was unknown at design time and has since been
confirmed against a real logged-in `kruschecompany.peopleforce.io`
session, with implementation updated accordingly:

- **Not an internal JSON API.** PeopleForce's web app is server-rendered
  (Rails + Turbo/Hotwire), not a SPA calling a JSON endpoint.
  `PeopleForceClient.getLeaveCases()` fetches `/people/{id}/leave` and
  parses the real HTML — `#leave-requests-frame` scoped, one
  `<tr data-row-id="{id}">` per request (the page's separate History
  ledger table reuses the same attribute for unrelated rows — scoping
  to the frame matters). See the class doc in `src/api/peopleforce.ts`.
- **PeopleForce is subdomain-per-company** (`https://<company>.peopleforce.io`),
  not `app.peopleforce.io` as originally assumed — fixed in the setup
  prompt/default.
- **Chromium's cookie encryption**: the fixed-16-space IV scheme is
  still correct (cross-checked against `chrome-cookies-secure` v3.0.2,
  updated 2026-04-16), but current Chrome prepends a constant 32-byte
  header before the real plaintext that must be sliced off after
  decrypting — an earlier implementation attempt guessed wrong here
  (assumed a per-value IV) before this was found.
- **Cookie domain scoping bug found and fixed**: the original query
  used `host_key LIKE '%domain%'`, a substring match broad enough to
  pull in cookies from unrelated hosts. Fixed to exact host (or
  leading-dot parent-domain) matching for both Chromium and Firefox.
- **macOS Full Disk Access is a real, confirmed blocker** — `EPERM` on
  reading the Cookies file even after `security find-generic-password`
  succeeds — likely to be MDM-blocked on managed company laptops. This
  is why the manual-cookie-paste fallback (`config.peopleforce.manualCookie`,
  stored in keychain) was added as the primary path, not just a
  contingency: `promptPeopleForceSetup` offers it first, and auto-detect
  falls back to it automatically on `CookieAccessDeniedError`.
- **CSRF token**: not needed for these GET requests in practice — no
  `X-CSRF-Token` header was required once the cookie set and domain
  scoping were both correct.

## Linux / Windows Chromium decrypt (added, unverified)

Implemented in `browserCookies.ts` but **not tested against a real Linux or
Windows machine** (only macOS was live-verified) — best-effort per the
publicly documented Chromium `os_crypt` scheme:

- **Linux**: same AES-128-CBC + fixed-16-space-IV + 32-byte-header scheme as
  macOS, but key = `PBKDF2(password, 'saltysalt', 1, 16, sha1)` (1 iteration,
  not 1003) where `password` is looked up via `secret-tool` against
  Chromium's libsecret schema, falling back to the constant `'peanuts'`
  Chromium itself uses whenever no Secret Service keyring is available
  (common on headless/server Linux — covers most real-world cases even
  without a working keyring integration).
- **Windows**: a different scheme entirely — AES-256-GCM, no 32-byte header.
  The AES key is DPAPI-wrapped and stored base64-encoded in the profile's
  `Local State` JSON (`os_crypt.encrypted_key`, 5-byte `'DPAPI'` prefix
  stripped before unwrapping). Node has no DPAPI binding, so unwrapping
  shells out to PowerShell's `System.Security.Cryptography.ProtectedData`
  (same pattern already used in `keychain.ts` for Credential Manager).
  Does **not** cover Chrome's newer "App-Bound Encryption" (Chrome 127+),
  which needs an elevated helper process to decrypt — that case degrades
  gracefully to `null` (→ manual-paste fallback prompt), same as any other
  decrypt failure.

## Remaining open items

1. Linux and Windows decrypt paths above are unverified — no Linux/Windows
   machine to test against this session. Both fail closed to `null` and the
   UI falls back to manual cookie paste, so a wrong guess degrades rather
   than breaks.
2. Manual-paste cookie expiry behavior (how often it actually needs
   re-pasting) hasn't been observed over time yet — first real usage
   will tell.
3. Windows Chrome 127+'s App-Bound Encryption is not supported (see above).
