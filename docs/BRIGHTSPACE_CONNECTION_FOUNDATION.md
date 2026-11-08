# Brightspace connection foundation (Phase 6A.2)

CivilDesk integrates with the **D2L-CLI authentication contract v1** implemented
at D2L-CLI commit `17cf683`. Settings → Integrations → Brightspace stores a
portal origin and a trusted executable path. It can inspect local CLI
compatibility and credential state. It never logs in, retrieves academic data,
or claims server-confirmed authentication.

## Adapter boundary

The Rust `brightspace` module exposes only four Tauri commands:
`brightspace_configuration`, `brightspace_save_configuration`,
`brightspace_inspect`, and `brightspace_cancel`. React supplies a portal and
executable path only when saving nonsecret settings. It cannot supply a profile, command name, argument
vector, or child environment to inspection.

After validating the canonical executable path and its saved SHA-256 fingerprint,
the production adapter requires the executable filename `d2l.exe`. It runs
these exact argument vectors directly, without a shell:

```text
auth capabilities --json --contract-version 1
auth status --json --contract-version 1
```

The first response must have contract version `1` and capabilities
`credential_profiles_v2`, `origin_binding_v2`, `auth_status_json_v1`,
`read_courses`, `read_assignments`, `read_grades`, `read_announcements`,
`read_overview`, and `get_only_requests`. Discovery rejects unknown JSON keys,
missing capabilities, malformed output, and unsupported versions. Status rejects
unknown keys, wrong types, a profile or origin mismatch, unsupported state
combinations, and any claim of live authentication. CLI messages and stderr
are never forwarded to React. An older CLI is reported as incompatible.

The subprocess receives a small allowlist of Windows operating-system
environment variables plus explicitly set `D2L_CLI_PROFILE` and
`D2L_CLI_BASE_URL`. Inherited Python, keyring, proxy, and D2L-CLI selector
variables are cleared. The executable is invoked by its canonical absolute
path, not through PATH. Each command has a five-second deadline, 32 KiB stdout
limit, and 8 KiB stderr limit. Windows Job Object cleanup terminates descendants
when the process ends, is cancelled, times out, or exceeds a limit. One status
check runs at a time; Settings offers a Cancel check action. Output is parsed only
after the bounded process completes. A saved executable fingerprint is checked
again immediately before each launch. A file replacement between that check
and Windows process creation remains a narrow local same-user race; the adapter
does not claim to contain malicious processes with the same Windows privileges.

## App identity and configuration

The Tauri application identifier fixes the profile:

| CivilDesk build | D2L-CLI profile |
| --- | --- |
| `com.webswe.civildesk` | `civildesk-prod` |
| `com.webswe.civildesk.dev` | `civildesk-dev` |
| `com.webswe.civildesk.acceptance` | `civildesk-acceptance` |
| `com.webswe.civildesk.e2e` | `civildesk-e2e-synthetic`, only in the mock-feature build |

Unknown identities fail at startup. The E2E build rejects every portal except
`https://synthetic.example.test` and every executable except the dedicated
`brightspace-synthetic.exe` next to its own application binary. The real
D2L-CLI rejects the synthetic profile ID, providing another independent guard.
No production profile is selected by E2E tests.

The portal validator accepts only a bare ASCII HTTPS DNS origin, optionally
ending with `/` or using `:443`. It lowercases the host and removes the default
port. It rejects userinfo, paths, queries, fragments, IP literals, numeric
host encodings, nondefault ports, whitespace, and malformed labels. CivilDesk
also rejects punycode hosts conservatively. Its accepted origin set is thus
narrower than D2L-CLI's where punycode is concerned; it never silently
reinterprets a portal.

Configuration uses the existing SQLite `app_state` table under the key
`brightspace_connection_v1`. It stores only `portalOrigin`, `executablePath`,
and `executableSha256`. No schema migration, academic table, credential value,
cookie, or token is added. The file fingerprint is deliberately not returned
to the frontend. Saving settings does not run the CLI. The user must choose
**Inspect status** to perform the local check. There is no automatic sync.

## Status shown in Settings

The interface distinguishes missing or invalid configuration, unavailable or
changed executables, incompatible CLI contracts, authentication required,
credential present but unverified, portal mismatch, and credential/storage
errors. It explains that live verification is unavailable. It never shows a
green Connected state from a stored credential. The underlying v1 JSON contract
cannot prove server acceptance, identify the Brightspace account, or distinguish
session expiration from permission denial. A future approved live verification
contract is required before claiming an active connection.

## Synthetic verification

The native E2E workflow builds `brightspace-synthetic.exe` separately and
builds only the isolated `com.webswe.civildesk.e2e` app. The fixture accepts
the fixed v1 commands and synthetic profile/origin; it contains no credential
manager or HTTP client. The E2E harness controls a scenario file inside only
the isolated E2E application data folder for missing,
unverified, mismatch, corrupt, incompatible, malformed, oversized, timed-out,
and terminated responses. Static guards inspect the fixture and build path;
runtime guards compare the canonical fixture path and portal before spawning.
The existing isolated SQLite database, WebView profile, reset safeguards, and
Notion mock remain in place.

Real-account sign-in, live verification, School Overview, Classes, Assignment
Calendar, Study Planner, and academic retrieval require separate approval.
The eventual Assignment Calendar must use class filters and due dates without
creating duplicate global Calendar events.
