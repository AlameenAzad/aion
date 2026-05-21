# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest (`main`) | ✅ |
| Older releases | ❌ — please upgrade |

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via [GitHub's private vulnerability reporting](https://github.com/alameenazad/aion/security/advisories/new), or email the maintainers directly (see the package.json `author` field).

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions
- Any suggested mitigations

We aim to acknowledge reports within **48 hours** and provide a resolution timeline within **7 days** for critical issues.

---

## Scope

Issues that are **in scope:**

- Credential leakage (e.g. tokens written to stdout or logs)
- Arbitrary code execution via config file or CLI input
- Path traversal in config file handling
- Dependency vulnerabilities with a realistic attack vector for CLI users

Issues that are **out of scope:**

- Vulnerabilities in Tempo, Jira, or Dyce themselves — report those to their respective vendors
- Social engineering
- Attacks requiring physical access to the user's machine

---

## Security best practices for users

On **macOS, Linux, and Windows**, aion stores all API tokens and passwords in the OS credential store (macOS Keychain, GNOME Keyring / KWallet, Windows Credential Manager). Only non-sensitive settings are written to `~/.aion/config.json`.

On **unsupported platforms** (or when `AION_DISABLE_KEYCHAIN=1` is set), tokens fall back to `~/.aion/config.json` in plaintext. In that case:

- **Restrict file permissions:**
  ```bash
  chmod 600 ~/.aion/config.json
  ```

In all cases:

- Do not commit `~/.aion/config.json` to version control
- Use API tokens with the minimum required scopes (read-only Tempo, read-only Jira, write Dyce)
- Rotate tokens periodically and update aion with `aion setup`
- On shared machines, consider using a user account dedicated to aion
