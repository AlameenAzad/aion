## Summary

Fixes three bugs that caused the Dyce token to expire silently and `aion cron status` to always show an empty log. Root cause: Azure AD SPA refresh tokens have a hard 24-hour lifetime; the previous 12-hour cron interval combined with a 5-minute refresh buffer meant the access token could expire between runs, and if the Mac was asleep or the cron missed a cycle, the refresh token itself would hit its 24-hour limit and become permanently dead.

Also fixes a long-standing issue where `aion --version` reported `1.0.0` regardless of the actual `package.json` version.

## Changes

- **Cron interval: 12 hours → 1 hour** — `aion cron install` now registers the background job to run every hour instead of every 12 hours; applies to all three platforms (launchd `StartInterval` 43200 → 3600, Linux crontab `0 */12` → `0 *`, Windows Task Scheduler `/MO 12` → `/MO 1`); this ensures the refresh token is rotated well within its 24-hour hard limit

- **`isTokenExpired` buffer: 5 min → 2 hours** — the default `bufferSeconds` in `isTokenExpired()` is raised from 300 to 7200; the hourly cron will now proactively refresh any token expiring within the next 2 hours, guaranteeing continuous coverage even if one cron cycle is missed

- **`aion token-refresh` logging** — the command previously produced no stdout/stderr output on any path, leaving `/tmp/aion-token-refresh.log` permanently empty and making `aion cron status` useless; every run now emits a timestamped line: `"token still valid — no refresh needed"`, `"access token expired — refreshing…"` + `"token refreshed successfully"`, or `"token-refresh failed: <error>"` so the log always reflects what happened and when

- **`aion --version` now reads from `package.json`** — the version string was hardcoded as `'1.0.0'` in `src/index.ts` regardless of the actual package version; replaced with `require('../package.json').version` so it always stays in sync

- **Version bump to 1.2.0**

## Type of change

- [x] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that causes existing functionality to change)
- [ ] Refactor / chore (no behavior change)
- [ ] Documentation update

## Testing

- [x] All 295 existing tests pass (`npm test`)
- [x] `msauth.test.ts` updated to reflect the new 2-hour buffer (buffer-boundary tests, `validConfig` token expiry, `resolveDyceToken` "still valid" test)
- [x] Verified `aion cron install` writes `StartInterval 3600` to the plist
- [x] Verified `/tmp/aion-token-refresh.log` is non-empty after job runs
- [x] Verified `aion cron status` shows last timestamped log line
- [x] Verified `aion --version` reports `1.2.0`

## Related issues

<!-- Closes #... -->
