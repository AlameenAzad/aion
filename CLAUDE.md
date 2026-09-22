# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsup → dist/index.js (CJS, shebang prepended)
npm test               # jest (all tests in tests/)
npm run test:coverage  # jest --coverage (must hit ≥90% on all metrics)
npx jest tests/utils/mapping.test.ts   # run a single test file
npm run lint           # eslint src tests
npm run lint:fix       # eslint --fix
npm run format         # prettier --write src tests
npm run dev            # ts-node src/index.ts (run without building)
node dist/index.js     # run the built CLI
```

Coverage is enforced at 90% for statements/branches/functions/lines. `src/commands/**`, `src/index.ts`, `src/ui/**` (thin inquirer/ora/chalk passthrough wrappers), and `src/utils/leaveSetup.ts` (interactive wizard, same class as `commands/**`) are excluded from coverage collection.

## Architecture

### CLI entry and commands

`src/index.ts` wires all Commander subcommands. Every command checks `configExists()` before running (except `setup`), prints the banner where appropriate, then delegates to a `run*()` function in `src/commands/`.

Date-range flags (`--today`, `--yesterday`, `--week`, `--last-week`, `--last-month`, `--from`/`--to`) are shared between `sync` and `preview` via the `DateFlags` interface in `src/utils/date.ts`. `getDateRange(opts)` resolves them to `{ from, to }` ISO strings.

`--verbose` is a global flag on the root program. It calls `setVerbose(true)` via a `.hook('preAction')`, which enables `verboseLog()` output to stderr in all API clients and the retry interceptor.

### Config system (`src/config/`)

The config lives at `~/.aion/config.json` (mode 0600) and is validated with Zod.

**Two schemas exist intentionally:**
- `FileConfigSchema` — secrets are optional (they may be in the OS keychain instead)
- `ConfigSchema` — all secrets required; this is what the runtime uses

`loadConfig()` does: read JSON → `migrateRawConfig()` (stamps `schemaVersion: 1` on old files) → validate with `FileConfigSchema` → overlay keychain secrets → validate with `ConfigSchema`. A one-time migration rewrites the file without secrets after a successful keychain write.

`saveConfig()` calls `persistSecretsToKeychain()` first. Secrets are only stripped from the JSON file if all keychain writes succeed, preventing silent data loss.

**Keychain** (`src/config/keychain.ts`) uses `security` on macOS, `secret-tool` on Linux, and `PasswordVault` on Windows, grouped under service name `aion-sync`. Set `AION_DISABLE_KEYCHAIN=1` to bypass it (useful in tests).

**Sync log** (`src/config/synclog.ts`) persists a `Set<number>` of Tempo worklog IDs at `~/.aion/synced.json`. `loadSyncedIds()` / `markSynced()` are the only public API. Any worklog ID already in the set is marked `skipped` and never re-sent to Dyce.

**Setup draft** (`src/config/manager.ts` — `SetupDraft`) saves partial setup progress at `~/.aion/setup-draft.json` so multi-step setup can resume after interruption.

**Leave provider** (`config.leaveProvider: 'paser' | 'peopleforce'`) picks which of `config.paser` / `config.peopleforce` is active; only one is normally populated. Undefined `leaveProvider` with `config.paser` set falls back to Paser (pre-migration default). `ensureLeaveProviderNotice` (`src/utils/leaveProviderNotice.ts`) shows a one-time prompt (`peopleforceNoticeShown`) nudging existing Paser users toward PeopleForce.

**Dyce silent re-auth** (`config.dyce.browser`, falls back to `config.peopleforce?.browser`; `config.dyce.silentReauthDisabled` is an explicit opt-out): Dyce's SPA refresh token has a hard 24h *absolute* lifetime — refreshing does not reset it. `silentlyReauthenticateDyce()` (`src/api/msauth.ts`) works around this by reusing the browser's live Microsoft/AAD SSO session cookie (read via `getSessionCookieForDomain` in `src/utils/browserCookies.ts`) to redo a PKCE `prompt=none` authorize/token exchange with no user interaction, exactly mirroring what Dyce's own web app does silently. `ensureDyceAutoReauthNotice` (`src/utils/dyceAutoReauthNotice.ts`) is the equivalent one-time notice for this (`dyceAutoReauthNoticeShown`), and `configureDyceSilentReauth` (`src/utils/dyceSilentReauthSetup.ts`) is the shared prompt/verify/save flow used by both that notice and `aion config re-auth-dyce`.

### Sync / Preview flow

Both `runSync` and `runPreview` share the same pipeline up to the write step. `runPreview` calls `runSync` with `dryRun: true`.

1. Load config, resolve date range, load synced IDs
2. Pre-validation: find Jira project keys with no Dyce mapping (prompts inline to create one)
3. Fetch Tempo worklogs
4. Enrich with Jira issue titles (batch JQL queries via `getIssuesBatch` / `getIssuesByIdBatch`)
5. Fetch leave cases from whichever provider is active (Paser or PeopleForce, per `config.leaveProvider`) and match by date to vacation worklogs
6. Build `TableRow[]`: classify each worklog as `synced`, `skipped`, `pending`, or `vacation`
7. For vacation entries: prompt for leave type, resolve the leave request ID (auto-matched or manual), resolve Dyce target
8. Confirm → call `dyce.createTimeRecording()` for each pending row → `markSynced()`

### Mapping logic (`src/utils/mapping.ts`)

`findMappings(issueKey, mappings)` returns exact issue-key matches first (e.g. `INP1-11755`), falling back to project-prefix matches (e.g. `INP1`). This allows per-issue overrides.

Vacation entries are detected by `isVacationEntry()` against `config.vacationPrefixes`. When a worklog is a vacation entry, `config.leaveTypeMappings.{vacation|sickLeave|publicHoliday}` takes precedence over regular project mappings.

### API clients (`src/api/`)

All clients use Axios with `applyRetryInterceptor()` attached — 3 attempts, exponential backoff (1s/2s), respects `Retry-After` on 429.

- **`TempoClient`** — fetches worklogs by accountId and date range from the Tempo API.
- **`JiraClient`** — resolves issue keys and summaries via JQL batch queries (`getIssuesBatch`, `getIssuesByIdBatch`).
- **`DyceClient`** — creates time recordings. Requires `x-instance` and `x-company` headers. Uses OData pagination for listing.
- **`PaserClient`** — authenticates (cookie-based), fetches leave cases for date matching.
- **`PeopleForceClient`** (`src/api/peopleforce.ts`) — session-cookie authenticated (no login flow of its own); scrapes leave requests from server-rendered HTML via `cheerio` (`parseLeaveRequestRows`). The cookie comes from `resolvePeopleForceCookie` (`src/utils/browserCookies.ts`): a manually pasted cookie, or auto-read from the browser's cookie store (Chrome/Edge/Brave/Firefox/Zen).
- **`msauth.ts`** — handles Dyce OAuth2 via Microsoft device code flow (`getDeviceCode` / `pollForToken`). `resolveDyceToken(config)` auto-refreshes using the stored refresh token, falling back to `silentlyReauthenticateDyce()` (browser-SSO-based) when the refresh token itself has expired, and writes the new token back via `updateConfig()`.

### Build

`tsup` bundles `src/index.ts` → `dist/index.js` as CJS. The `#!/usr/bin/env node` shebang is injected via the `banner` config in `tsup.config.ts`. Only `dist/` and `README.md`/`LICENSE` are published.

### Website

`website/` is a static landing page (no build step) deployed via GitHub Pages (`.github/workflows/pages.yml`). The JS fetches live GitHub API data for the repo pulse section and runs an animated terminal demo loop.
