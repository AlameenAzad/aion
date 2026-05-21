# Contributing to aion

Thank you for taking the time to contribute! This guide covers everything you need to get up and running.

---

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Getting started](#getting-started)
- [Development workflow](#development-workflow)
- [Updating GitHub Actions pins](#updating-github-actions-pins)
- [Project structure](#project-structure)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Testing](#testing)
- [Code style](#code-style)

---

## Code of conduct

Be respectful, constructive, and welcoming. Harassment of any kind will not be tolerated.

---

## Getting started

**Prerequisites:** Node.js ≥ 18, npm ≥ 9, git

```bash
# Fork and clone the repo
git clone https://github.com/alameenazad/aion.git
cd aion

# Install dependencies
npm install

# Verify everything works
npm test
npm run build
```

You do **not** need real Tempo, Jira, or Dyce credentials to work on the codebase — the API clients are fully tested with mocks.

---

## Development workflow

```bash
npm test                 # run the full test suite
npm run test:coverage    # tests + HTML/lcov coverage report
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier write
npm run format:check     # Prettier check (same as CI)
npx tsc --noEmit         # type-check without emitting
npm run build            # compile to dist/
```

To test the CLI locally after building:

```bash
npm run build
node dist/index.js --help
node dist/index.js preview --today
```

Or link it globally for the duration of development:

```bash
npm link
aion --help
```

---

## Updating GitHub Actions pins

Workflow actions are pinned to full commit SHAs in `.github/workflows/*.yml` for supply-chain safety.

When updating an action:

1. Find the latest trusted release/tag in the action repository.
2. Resolve the tag to a commit SHA.
3. Replace the `uses:` line with `owner/repo@<sha>` and keep an inline comment with the human-friendly version.
4. Run CI and open a focused PR (only workflow pin updates).

Example:

```bash
# Resolve a tag to SHA
git ls-remote https://github.com/actions/checkout refs/tags/v5

# Then update workflow usage like this:
# uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
```

Notes:

- Prefer stable release tags over branch heads.
- Update related actions together when practical (for example checkout/setup-node pairs).
- Mention the source release notes link in the PR description.

---

## Project structure

```
src/
├── index.ts              Commander root — wires all commands
├── api/
│   ├── tempo.ts          Tempo API client (paginated GET /4/worklogs)
│   ├── jira.ts           Jira API client (batch issue lookup)
│   └── dyce.ts           Dyce API client (POST timeRecordings, OData lookups)
├── commands/
│   ├── setup.ts          Interactive 6-step setup wizard
│   ├── sync.ts           Main sync flow
│   ├── preview.ts        Dry-run (delegates to sync with dryRun=true)
│   └── config.ts         config list / add-mapping / set-vacation
├── config/
│   ├── schema.ts         Zod validation schema
│   ├── manager.ts        ~/.aion/config.json read/write
│   └── synclog.ts        ~/.aion/synced.json duplicate prevention
├── ui/
│   ├── banner.ts         figlet + gradient ASCII art
│   ├── spinner.ts        ora wrappers
│   ├── table.ts          Colorized worklog table
│   └── prompts.ts        inquirer helpers
└── utils/
    ├── date.ts           Date range flags, ISO datetime builder
    └── mapping.ts        Jira key → Dyce mapping resolver

tests/                    Mirrors src/ structure, Jest + ts-jest
```

**Important version constraints** — the project uses CJS (not ESM) for cross-platform compatibility. These packages must stay at their last CJS-compatible versions:

| Package | Max CJS version | Reason |
|---|---|---|
| `chalk` | `^4` | v5 is ESM-only |
| `ora` | `^5` | v6 is ESM-only |
| `inquirer` | `^8` | v9 is ESM-only |
| `boxen` | `^5` | v6 is ESM-only |

Do **not** upgrade these without migrating the entire project to ESM first.

---

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `test` | Adding or updating tests |
| `refactor` | Code change with no behavior change |
| `chore` | Build, deps, CI changes |
| `docs` | Documentation only |
| `perf` | Performance improvement |

**Examples:**

```
feat(sync): add --week flag for weekly date range
fix(dyce): handle empty value array in OData response
test(tempo): add pagination test for 60+ worklogs
chore(deps): bump axios to 1.8.0
```

---

## Pull request process

1. **Open an issue first** for non-trivial changes — discuss the approach before writing code.
2. Branch off `main`: `git checkout -b feat/my-feature`
3. Make your changes, add/update tests.
4. Ensure CI passes locally:
   ```bash
   npm run lint && npm run format:check && npx tsc --noEmit && npm test && npm run build
   ```
5. Open a PR against `main` using the PR template.
6. A maintainer will review within a few days. Please be patient and responsive to feedback.

**One PR per concern.** Large, unrelated changes are harder to review and slower to merge.

---

## Testing

Tests live in `tests/` and mirror the `src/` structure. We use **Jest** with **ts-jest**.

```bash
npm test                 # all tests
npm run test:coverage    # with coverage (target: >80% overall)
```

**Guidelines:**

- Every new function/module needs a corresponding test file
- API clients are tested with `jest.mock('axios')` — no real network calls
- Filesystem operations use `jest.mock('fs')`
- Keep tests deterministic: use `jest.useFakeTimers()` for date-dependent tests
- Avoid snapshot tests — they're brittle for CLI output

---

## Code style

- **TypeScript strict mode** — no `any` in `src/` (warnings in test files are ok)
- **ESLint + Prettier** enforce style automatically — run `npm run lint:fix && npm run format` before committing
- Unused variables must be prefixed with `_` (e.g., `_err` in catch blocks you don't need)
- Prefer `const` over `let` wherever possible
- Async functions should propagate errors to the caller rather than swallowing them silently
