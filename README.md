<div align="center">

<pre align="center">
     /\    |_   _|/ __ \ | \ | |
    /  \     | | | |  | ||  \| |
   / /\ \    | | | |  | || . ` |
  / ____ \  _| |_| |__| || |\  |
 /_/    \_\|_____|\____/ |_| \_|
</pre>

**Eternal. Automatic. Effortless.**

*αἰών — eternal time, the ever-turning cycle*

[![CI](https://github.com/alameenazad/aion/actions/workflows/ci.yml/badge.svg)](https://github.com/alameenazad/aion/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/aion-sync?color=cyan)](https://www.npmjs.com/package/aion-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![CodeQL](https://github.com/alameenazad/aion/actions/workflows/codeql.yml/badge.svg)](https://github.com/alameenazad/aion/actions/workflows/codeql.yml)

Project site: https://alameenazad.github.io/aion/

</div>

---

**aion** is a zero-friction CLI tool that syncs your logged time from [Tempo](https://www.tempo.io/) (Jira) into [Dyce](https://www.dyce.cloud/) — so you only ever log time once.

- Fetches worklogs from Tempo for any date range
- Enriches them with Jira issue titles
- Uses Tempo user-scoped worklog queries (fewer unnecessary API calls)
- Uses Jira enhanced search (`/rest/api/3/search/jql`) with batching to reduce duplicate lookups
- Maps Jira projects → Dyce customers / jobs / tasks (configured once)
- Detects vacation, sick leave, and public holiday entries — each routed to a dedicated Dyce target
- Auto-matches Paser.io requests by date range for vacation and sick leave
- Silently skips already-synced entries (no duplicates, ever)
- Keeps your Dyce session alive automatically via a background token-refresh job (`aion cron install`)
- Rich terminal UI: ASCII banner, spinners, colorized preview table

---

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
  - [aion setup](#aion-setup)
  - [aion status](#aion-status)
  - [aion sync](#aion-sync)
  - [aion preview](#aion-preview)
  - [aion config](#aion-config)
  - [aion token-refresh](#aion-token-refresh)
  - [aion cron](#aion-cron)
- [Global flags](#global-flags)
- [Configuration file](#configuration-file)
- [Date range flags](#date-range-flags)
- [Vacation / leave detection](#vacation--leave-detection)
- [How synced entries are tracked](#how-synced-entries-are-tracked)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Requirements

| Dependency | Version |
|---|---|
| Node.js | ≥ 18 |
| Tempo | Cloud (API v4) |
| Jira | Cloud (API v3) |
| Paser | Cloud |
| Dyce | Cloud |

---

## Install

```bash
npm install -g aion-sync
```

Or run without installing:

```bash
npx aion-sync setup
```

---

## Quick start

```bash
# 1. Run the interactive setup wizard once
aion setup

# 2. Preview what would be synced this month
aion preview

# 3. Sync!
aion sync
```

---

## Commands

### `aion setup`

Interactive wizard that walks you through connecting Tempo, Jira, Paser, and Dyce.

```
Steps:
  [1/7] Tempo API         — token + region
  [2/7] Jira API          — base URL, email, token (also fetches your accountId)
  [3/7] Dyce API          — client_id, scope, refresh_token (from DevTools),
                            x-instance, x-company, resource auto-detection
  [4/7] Paser API         — base URL, email, password, account selection
  [5/7] Project mappings  — Jira project key → Dyce Customer / Job / Job Task
  [6/7] Leave detection   — which Jira tickets mean vacation/leave, then configure a
                            separate Dyce target for Vacation, Sick Leave, and Public Holiday
  [7/7] Save              — stores tokens in OS Keychain (macOS/Linux/Windows) and
                            writes non-sensitive settings to ~/.aion/config.json;
                            offers to install the background token-refresh job (recommended)
```

Re-run at any time to reconfigure. You can also use `aion config` sub-commands to make targeted changes without going through the full wizard.

---

### `aion status`

Check connectivity to all configured services at once — useful for debugging auth failures.

```bash
aion status
```

Shows a `✓` / `✗` row for Tempo, Jira, Dyce, and Paser (if configured), plus the Dyce token expiry. Exits with code `1` if any service fails.

---

### `aion sync`

Syncs Tempo worklogs to Dyce. Defaults to the **current calendar month**.

```bash
aion sync                        # current month
aion sync --today                # today only
aion sync --yesterday            # yesterday only
aion sync --week                 # this week
aion sync --last-week            # last week
aion sync --last-month           # last calendar month
aion sync --from 2026-05-01 --to 2026-05-14
```

**What happens:**

1. Validates that all Jira project keys in the worklogs have Dyce mappings — offers to add any missing ones inline before proceeding
2. Fetches worklogs from Tempo (user-scoped)
3. Enriches with Jira issue titles using batched `/search/jql` lookups
4. Shows a preview table with status for each entry
5. Auto-matches Paser.io vacation/sick requests by date range
6. If multiple Paser requests match one day, prompts you to choose
7. If no Paser request matches, asks for manual Paser request ID
8. Asks for confirmation, then POSTs to Dyce
9. Marks synced IDs in `~/.aion/synced.json` (prevents duplicates)

---

### `aion preview`

Dry run — shows the preview table without syncing anything.

```bash
aion preview
aion preview --today
aion preview --yesterday
aion preview --last-week
aion preview --last-month
aion preview --from 2026-04-01 --to 2026-04-30
```

---

### `aion config`

Manage your configuration without re-running the full wizard.

```bash
aion config list            # show current config (tokens masked)
aion config add-mapping     # add/update a Jira → Dyce project mapping
aion config set-vacation    # update vacation/leave prefixes AND Dyce targets per leave type
aion config edit-paser      # update Paser credentials/account
aion config re-auth-dyce    # update Dyce token pair from a fresh refresh_token
aion config export          # export config to a JSON file
aion config export --file ~/backup.json --include-secrets  # include plaintext tokens
aion config import backup.json  # import/merge config from a previously exported file
```

`aion config re-auth-dyce` is the recommended recovery path when Dyce token refresh fails (for example after the refresh token has expired due to extended inactivity).

**Example `config list` output:**

```
Current Configuration
──────────────────────────────────────────────────

Tempo:
  Region/Base URL : https://api.eu.tempo.io
  Account ID      : abc123def456
  Token           : abcd••••••••5678

Jira:
  Base URL        : https://mycompany.atlassian.net
  Email           : dev@mycompany.com
  Token           : abcd••••••••5678

Dyce:
  Instance        : my-dyce-instance
  Company         : my-company
  Resource No     : EMP001
  Token           : abcd••••••••5678

Project Mappings:
  PROJ — Backend Work
    Customer : C001 (Acme Corp)
    Job      : J042 (Q2 Development)
    Job Task : T003 (Development)

Vacation Prefixes:
  VAC, LEAVE, SICK

Leave Type Mappings:
  vacation     : C002 / J-VAC / T-VAC
  sickLeave    : C002 / J-SICK / T-SICK
  publicHoliday: C002 / J-HOL / T-HOL
```

---

### `aion token-refresh`

Silently refreshes the Dyce access token using the stored refresh token and persists the new token pair to config. Exits `0` on success with no output, or exits `1` with an error message on failure — safe to use as a cron/launchd target.

```bash
aion token-refresh
```

You rarely need to run this manually — it's the command that the background job (installed by `aion cron install`) calls every 12 hours.

---

### `aion cron`

Manages the OS-level background job that keeps your Dyce session alive by running `aion token-refresh` every 12 hours. Because each successful token refresh issues a new refresh token and resets the 24-hour expiry window, this prevents the session from expiring during periods of inactivity.

```bash
aion cron install     # register the background job
aion cron uninstall   # remove it
aion cron status      # show whether it's installed and the last log line
```

**Platform behaviour:**

| Platform | Mechanism | Interval |
|----------|-----------|----------|
| macOS | `launchd` plist in `~/Library/LaunchAgents/` | every 12 h |
| Linux | User crontab (`0 */12 * * *`) | every 12 h |
| Windows | Task Scheduler (`schtasks`) | every 12 h |

The job runs `aion token-refresh` and writes output (errors only) to `/tmp/aion-token-refresh.log`. You can tail that file to confirm the job is working.

If you opted out during `aion setup` you can always enable it later:

```bash
aion cron install
```

---

## Global flags

| Flag | Description |
|---|---|
| `--verbose` | Print verbose HTTP request/response debug info to stderr |
| `--version` | Show the installed aion version |
| `--help` | Show help text for any command |

```bash
aion --verbose sync --today        # sync today with full debug output
aion --verbose status              # check connectivity with debug info
```

---

## Configuration file

Non-sensitive settings are stored at `~/.aion/config.json`. Tokens are never logged to the terminal (always masked).

On **macOS, Linux, and Windows**, API tokens and passwords are stored in the OS credential store (macOS Keychain, GNOME Keyring / KWallet, or Windows Credential Manager) and are **omitted from the config file**. On unsupported platforms, tokens fall back to the config file — restrict permissions with `chmod 600 ~/.aion/config.json` in that case.

```jsonc
{
  "tempo": {
    // token stored in OS Keychain (omitted from file when keychain is available)
    "baseUrl": "https://api.eu.tempo.io",
    "accountId": "your-jira-account-id"
  },
  "jira": {
    "baseUrl": "https://yourcompany.atlassian.net",
    "email": "you@company.com"
    // token stored in OS Keychain
  },
  "dyce": {
    // token + refreshToken stored in OS Keychain
    "instance": "your-instance",
    "company": "your-company",
    "resourceNo": "EMP001",
    "resourceId": "uuid-optional"
  },
  "paser": {
    "baseUrl": "https://app.paser.io",
    "email": "you@company.com",
    // password stored in OS Keychain
    "accountId": 90
  },
  "mappings": [
    {
      "jiraProjectKey": "PROJ",
      "label": "Backend Work",
      "dyce": {
        "customerNo": "C001",
        "jobNo": "J042",
        "jobTaskNo": "T003"
      }
    }
  ],
  "vacationPrefixes": ["VAC", "LEAVE", "SICK"],
  "leaveTypeMappings": {
    "vacation": {
      "label": "Vacation",
      "dyce": { "customerNo": "C002", "jobNo": "J-VAC", "jobTaskNo": "T-VAC" }
    },
    "sickLeave": {
      "label": "Sick Leave",
      "dyce": { "customerNo": "C002", "jobNo": "J-SICK", "jobTaskNo": "T-SICK" }
    },
    "publicHoliday": {
      "label": "Public / Bank Holiday",
      "dyce": { "customerNo": "C002", "jobNo": "J-HOL", "jobTaskNo": "T-HOL" }
    }
  }
}
```

---

## Date range flags

| Flag | Description |
|---|---|
| *(none)* | Current calendar month |
| `--today` | Today only |
| `--yesterday` | Yesterday only |
| `--week` | Current week |
| `--last-week` | Previous week |
| `--last-month` | Previous calendar month |
| `--from YYYY-MM-DD` | Start date (uses today as end if `--to` is omitted) |
| `--to YYYY-MM-DD` | End date (requires `--from`) |

---

## Vacation / leave detection

If a worklog's Jira issue key matches any value in `vacationPrefixes` (e.g. `VAC-12` matches `VAC`, or an exact ticket like `INP1-11755`), aion treats it as a leave entry.

**During sync you choose the leave type:**

| Type | Paser ID required? | Dyce target |
|---|---|---|
| Vacation | Yes | `leaveTypeMappings.vacation` |
| Sick Leave | Yes | `leaveTypeMappings.sickLeave` |
| Public / Bank Holiday | No | `leaveTypeMappings.publicHoliday` |

Each leave type is logged to its **own** Dyce customer / project / task — completely separate from your regular work mappings. If no dedicated mapping is configured for a type, aion falls back to the regular Jira project mapping and shows a warning.

**Paser auto-matching (Vacation & Sick Leave):**

1. Looks up Paser requests where the worklog day falls inside the request date range
2. Auto-uses the matching request ID when there is exactly one match
3. Prompts you to choose when multiple requests overlap the same day
4. Falls back to manual Paser ID entry when no match is found

If a matched request is not `Approved`/`Completed`, aion shows a warning but still lets you proceed.

Configure prefixes and Dyce targets during setup (Step 6) or with `aion config set-vacation`.

---

## How synced entries are tracked

Every successfully synced Tempo worklog ID is appended to `~/.aion/synced.json`. On subsequent runs, any worklog whose ID is already in this file is silently skipped — so you can safely re-run `aion sync` multiple times without creating duplicate entries in Dyce.

To re-sync an entry, remove its ID from `~/.aion/synced.json`.

---

## Dyce auth troubleshooting

### Preventing expiry (recommended)

Dyce refresh tokens expire after 24 hours of inactivity. The best way to avoid this is to install the background refresh job:

```bash
aion cron install
```

This runs `aion token-refresh` every 12 hours, resetting the expiry window automatically. The setup wizard offers to do this for you at the end of first-run configuration.

### Recovering from an expired session

If `aion status` or `aion sync` reports a Dyce refresh failure such as `AADSTS700084`, run:

```bash
aion config re-auth-dyce
```

Then provide a fresh `refresh_token` from your normal Dyce browser session (DevTools → Network → token request payload).

**Common error codes:**

| Code | Cause | Fix |
|------|-------|-----|
| `AADSTS700084` | SPA refresh token expired (24 h inactivity limit) | Run `aion config re-auth-dyce` with a fresh token; then install `aion cron` to prevent recurrence |
| `AADSTS7000218` | Azure tenant requires client credentials for device-code flow | Use manual refresh-token mode via `aion config re-auth-dyce` |

---

## Getting your API tokens

| Service | Where to find it |
|---|---|
| **Tempo** | Tempo app → Settings → API integration → New Token |
| **Jira** | https://id.atlassian.com/manage-profile/security/api-tokens |
| **Dyce** | In your normal Dyce browser session: DevTools → Network → token request payload (`client_id`, `scope`, `refresh_token`); `x-instance`/`x-company` from Dyce API request headers or `/api/settings` |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.

---

## License

[MIT](LICENSE) © aion contributors
