# Release Notes — v1.2.0

> Released 2026-05-27

## Highlights

This release fixes three bugs that caused the Dyce token to expire silently and `aion cron status` to always show an empty log. The root cause was that Azure AD SPA refresh tokens have a hard 24-hour lifetime — the previous 12-hour cron interval combined with a 5-minute refresh buffer left a window where the access token could expire between runs, and if the Mac was asleep or a cron cycle was missed, the refresh token itself would hit its 24-hour limit and become permanently dead.

Also fixes `aion --version` always reporting `1.0.0` regardless of the actual package version.

---

## Bug Fixes

### Cron interval reduced from 12 hours to 1 hour
`aion cron install` now registers the background job to run **every hour** instead of every 12 hours. This applies to all three platforms:

| Platform | Before | After |
|----------|--------|-------|
| macOS (launchd) | `StartInterval 43200` | `StartInterval 3600` |
| Linux (crontab) | `0 */12 * * *` | `0 * * * *` |
| Windows (Task Scheduler) | `/MO 12` | `/MO 1` |

Running every hour ensures the refresh token is rotated well within its 24-hour hard limit, even if one cycle is missed.

### Token refresh buffer raised from 5 minutes to 2 hours
The `isTokenExpired()` default buffer has been raised from 300 s to 7200 s. The hourly cron now proactively refreshes any token expiring within the next 2 hours, guaranteeing continuous coverage even across a missed cycle.

### `aion token-refresh` now writes to the log on every run
The command previously produced no output at all — leaving `/tmp/aion-token-refresh.log` permanently empty and making `aion cron status` useless. Every run now emits a timestamped line:

| Outcome | Log line |
|---------|----------|
| Token still valid | `[<timestamp>] token still valid — no refresh needed` |
| Refresh triggered | `[<timestamp>] access token expired — refreshing…` then `[<timestamp>] token refreshed successfully` |
| Refresh failed | `[<timestamp>] token-refresh failed: <error message>` |

`aion cron status` will always show the last meaningful line.

### `aion --version` now reflects the actual package version
The version string was hardcoded as `'1.0.0'` in `src/index.ts` regardless of what `package.json` said. It now reads `require('../package.json').version` so it always stays in sync.

---

## Upgrade

```bash
npm install -g aion-sync@latest
```

After upgrading, reinstall the cron job to apply the new 1-hour interval:

```bash
aion cron install
```

If your Dyce token is currently expired, re-authenticate first:

```bash
aion config re-auth-dyce
```

Then install the cron job — it will run immediately on load and keep the token alive automatically going forward.

---

# Release Notes — v1.1.0

> Released 2026-05-26

## Highlights

This release brings a major quality-of-life overhaul to the Aion CLI. It introduces new commands (`status`, `config export/import`, `token-refresh`, `cron`), convenience date shortcuts, automatic exponential-backoff retries, a verbose debug mode, and a background token-refresh mechanism so your Dyce session stays alive without daily copy-paste from DevTools.

The release also hardens the underlying API integrations: Jira deprecated-endpoint usage is removed, unnecessary Jira request volume is reduced, Tempo worklog queries are scoped to the authenticated user, and Dyce re-authentication is aligned with Azure tenant constraints.

All changes are **backward-compatible**. Existing `~/.aion/config.json` files are automatically migrated to include `schemaVersion: 1` on first load.

---

## New Commands

### `aion status`
Connectivity health check that shows a `✓` / `✗` per service (Tempo, Jira, Dyce, Paser) along with token-expiry detail. Exits with code `1` if any service is unreachable or unauthenticated.

### `aion config export [file]`
Exports the current config to a JSON file with `0600` permissions. Secrets are stripped by default; pass `--include-secrets` for a full backup.

### `aion config import <file>`
Imports and merges a previously exported config file. Runs schema migration and Zod validation before writing. Preserves existing keychain secrets when the export contains none.

### `aion token-refresh`
Silent command that calls `resolveDyceToken()` and exits `0` on success or `1` on failure. Produces no terminal output on success — safe to run as a scheduled job.

### `aion cron install / uninstall / status`
Registers, removes, or inspects an OS-level background job that runs `aion token-refresh` every 12 hours. Platform-aware:

| Platform | Mechanism |
|----------|-----------|
| macOS    | launchd   |
| Linux    | user crontab |
| Windows  | Task Scheduler |

The first-run setup wizard now offers to install the cron job automatically after configuration is complete.

---

## New Features

### Automatic Update Check
On every `aion sync` / `aion preview` invocation, the CLI compares the running version against the latest published version on npm. If an update is available, a yellow notice is shown in the banner with the new version number and the install command. Results are cached in `~/.aion/update-check.json` for 24 hours — npm is never hit more than once per day. Failures are silently swallowed so offline or restricted environments are unaffected.

### Date Shortcuts
`--yesterday`, `--last-week`, and `--last-month` flags are now available on both `sync` and `preview`. Precedence order:

```
today > yesterday > week > lastWeek > lastMonth > from/to > default
```

### Exponential Backoff Retry
An Axios interceptor is now attached to all four API clients (Tempo, Jira, Dyce, Paser). Behaviour:

- Retries network errors, `5xx` responses, and `429 Too Many Requests`
- Respects the `Retry-After` response header on 429
- Up to **3 attempts** with 1 s → 2 s backoff
- Non-retryable `4xx` errors fail immediately without retrying

### `--verbose` Global Flag
Pass `--verbose` to any command to print the HTTP method, URL, and response status for every API call. Output is written to stderr to avoid colliding with spinner lines or structured output.

### Pre-Sync Validation
Before confirming a sync, the CLI checks that every non-vacation Jira project key has a corresponding Dyce mapping. For any missing keys, it offers inline mapping creation without aborting the run.

### Inline Mapping Creation with Prefill
`runConfigAddMapping` now accepts an optional `prefillKey` to skip the Jira key prompt — used by the pre-sync validation flow to streamline the mapping wizard.

### Config Schema Versioning
A `schemaVersion` field (default `1`) has been added to `ConfigSchema`. `migrateRawConfig()` stamps any config file that is missing this field on load, keeping existing files in sync transparently.

---

## Bug Fixes & API Stabilization

### Tempo: User-Scoped Worklog Endpoint
Worklog retrieval has been migrated to the user-scoped endpoint `/4/worklogs/user/{accountId}`, reducing over-fetching and cutting unnecessary API calls.

### Jira: Deprecated Search Endpoint Removed
Migrated from the deprecated `/rest/api/3/search` to `/rest/api/3/search/jql` to prevent `410 Gone` errors.

### Jira: Reduced Request Volume
Removed per-worklog issue-ID fetching. Issue IDs are now resolved in a single batched JQL query (`id in (...)`) and summaries are reused from the ID-batch result before any key-based enrichment.

### Sync Mapping Guard
Stopped synthesizing fake project keys during pre-validation. This prevents false mapping warnings and incorrect skips for worklogs that do not require a Dyce mapping.

### Dyce Re-Auth Flow Hardening
`aion config re-auth-dyce` is now a manual refresh-token update only. The device-code path has been removed due to Azure tenant behaviour requiring client credentials (`AADSTS7000218`) and non-extendable SPA refresh-token lifetime constraints (`AADSTS700084`).

---

## Internal / Developer Changes

- **`src/utils/execFileNoThrow`** — new shared utility that runs subprocesses safely via the non-shell `execFile` API (prevents shell injection). Returns `{ stdout, stderr, exitCode }` without throwing; used by all cron platform implementations.
- **Test coverage** — existing suites updated and expanded for Jira enhanced search + batch-by-ID behaviour, retry/verbose behaviour, schema migration, and date handling.

---

## Upgrade

```bash
npm install -g aion-sync@latest
```

No manual migration steps are required. Your existing `~/.aion/config.json` will be migrated automatically on first run.
