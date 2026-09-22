# Test Plan — feature/aion-improvements

## Automated tests

Run with `npm test`. All 253 tests pass across 15 suites.

### New / updated suites

| Suite | Tests | What's verified |
|---|---|---|
| `tests/utils/verbose.test.ts` | 5 | `setVerbose`/`isVerbose` toggle; `verboseLog` writes to stderr only when enabled; silent when disabled |
| `tests/utils/retry.test.ts` | 6 | Interceptor registered once; 4xx non-429 throws immediately; 500 retries and resolves; network error retries; `Retry-After` header respected; stops after `MAX_ATTEMPTS` |
| `tests/utils/date.test.ts` | +6 | `--yesterday`; `--last-week` (Sunday–Saturday, dayjs default locale); `--last-month`; precedence: `yesterday > lastWeek > lastMonth` |
| `tests/config/schema.test.ts` | +4 | `schemaVersion` defaults to `1`; accepts explicit `1`; rejects non-integer; `migrateRawConfig` stamps missing version; skips existing; handles non-object input |
| `tests/api/tempo.test.ts` `dyce.test.ts` `jira.test.ts` `paser.test.ts` | updated | `axios.create` mock includes `interceptors` so constructor no longer throws |
| `tests/config/manager.test.ts` `manager.keychain.test.ts` | updated | `validConfig` fixture includes `schemaVersion: 1` |
| `tests/api/msauth.test.ts` | updated | `validConfig` fixture includes `schemaVersion: 1` |

---

## Manual smoke tests

### `aion status`

- [ ] All services healthy → all rows show `✓`, exit code `0`
- [ ] Dyce token expired → `✗` row with hint to run `aion config re-auth-dyce`, exit code `1`
- [ ] Bad Tempo token → `✗` row for Tempo only, exit code `1`
- [ ] Paser not configured → Paser row is skipped entirely

### `aion config re-auth-dyce`

- [ ] Run `aion config re-auth-dyce` with valid `client_id` + `scope` + fresh `refresh_token` from DevTools → Dyce credentials verify and config updates
- [ ] Run with an expired refresh token (`AADSTS700084`) → clear auth failure message, no partial config write
- [ ] Run with invalid token payload/client mismatch → clear auth failure message, existing config remains usable

### `--verbose` global flag

- [ ] `aion --verbose sync --today` → `[verbose]` lines appear on **stderr**, not stdout
- [ ] `aion sync --today` (no flag) → no verbose lines on stderr
- [ ] `aion --verbose status` → HTTP calls for each service are logged

### Retry / rate limiting

- [ ] Force a non-retryable 4xx (e.g. wrong credentials) → fails immediately with no retry delay
- [ ] If a service returns `429` with `Retry-After: 2` → waits ~2 s, retries, succeeds

### Date shortcuts

- [ ] `aion preview --yesterday` → date range is yesterday only
- [ ] `aion preview --last-week` → Sunday–Saturday of the preceding week
- [ ] `aion preview --last-month` → first–last day of the preceding calendar month
- [ ] `aion preview --last-week --last-month` → `--last-week` wins (precedence)
- [ ] `aion preview --today --last-month` → `--today` wins

### Pre-sync validation + inline mapping

- [ ] Remove a mapping from config; run `aion sync --today` with a worklog for that project → warned about unmapped key, offered to add mapping inline
- [ ] Accept inline mapping → mapping saved to config, entry syncs successfully in the same run
- [ ] Decline inline mapping → sync continues, unmapped entry is skipped

### `aion config export`

- [ ] `aion config export` → creates `./aion-config-export.json` with `0600` permissions; tokens are masked/absent
- [ ] `aion config export --include-secrets` → tokens present in output file
- [ ] `aion config export --file ~/backup.json` → file written to custom path

### `aion config import`

- [ ] `aion config import backup.json` → diff summary shown, config updated, existing keychain secrets preserved if export had none
- [ ] `aion config import <invalid-json>` → clear error message, original config unchanged
- [ ] Import a config missing `schemaVersion` → `migrateRawConfig` stamps it `1`, import succeeds

### Config schema migration

- [ ] Manually remove `schemaVersion` from `~/.aion/config.json`; run any command → field silently stamped to `1`, no error or user prompt
