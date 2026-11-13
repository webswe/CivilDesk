# Brightspace connection foundation (Phase 6A.3 security readiness)

CivilDesk integrates with the **D2L-CLI authentication contract v1** implemented
at D2L-CLI commit `17cf683`. Settings → Integrations → Brightspace stores a
portal origin and a trusted executable path. Production inspects local CLI
capabilities only. It never checks credentials, logs in, retrieves academic data,
or claims server-confirmed authentication.

## Adapter boundary

The production inspection surface has four operational Tauri commands:
`brightspace_configuration`, `brightspace_save_configuration`,
`brightspace_inspect_capabilities`, and `brightspace_cancel`. React supplies a portal and
executable path only when saving nonsecret settings. It cannot supply a profile, command name, argument
vector, or child environment to inspection.

The registered `brightspace_inspect_synthetic_status` returns an error in normal builds. Its status
implementation is compiled only into the isolated `notion-mock` E2E build,
which requires the exact E2E identity and dedicated synthetic executable.
The shared process launcher rejects every other argument vector in normal builds.

After validating the canonical executable path and its saved SHA-256 fingerprint,
the production adapter requires the executable filename `d2l.exe`. It runs
this exact argument vector directly, without a shell:

```text
auth capabilities --json --contract-version 1
```

The first response must have contract version `1` and capabilities
`credential_profiles_v2`, `origin_binding_v2`, `auth_status_json_v1`,
`read_courses`, `read_assignments`, `read_grades`, `read_announcements`,
`read_overview`, and `get_only_requests`. Discovery rejects unknown JSON keys,
missing capabilities, malformed output, and unsupported versions. The isolated
E2E status path rejects
unknown keys, wrong types, a profile or origin mismatch, unsupported state
combinations, a claim that CivilDesk's supplied profile or portal is missing,
and any claim of live authentication. CLI messages and stderr
are never forwarded to React. An older CLI is reported as incompatible.

The production capability subprocess receives a small allowlist of Windows
operating-system environment variables. It does not need or receive
`D2L_CLI_PROFILE` or `D2L_CLI_BASE_URL`. The isolated synthetic build sets
those selectors for its test-only status and read scenarios. Inherited Python,
keyring, proxy, and D2L-CLI selector variables are cleared. The executable is invoked by its canonical absolute
path, not through PATH. Each command has a five-second deadline, 32 KiB stdout
limit, and 8 KiB stderr limit. Windows Job Object cleanup terminates descendants
when the process ends, is cancelled, times out, or exceeds a limit. One capability
check runs at a time; Settings offers a Cancel check action. Output is parsed only
after the bounded process completes. A saved executable fingerprint is checked
again immediately before each launch. A file replacement between that check
and Windows process creation remains a narrow local same-user race; the adapter
does not claim to contain malicious processes with the same Windows privileges.
The hash detects changes to the selected file; it does not establish its
publisher or make an untrusted file safe. Choose and keep `d2l.exe` in a
directory where untrusted software cannot replace it, review updates before
re-saving its fingerprint, and avoid shared writable or temporary directories.
Closing the remaining launch race would require binding verification to the
actual process image or launching suspended into a Job Object before resuming;
those are separate Windows process-control changes, not a code-signing
requirement. A same-user adversary can also alter CivilDesk settings or the CLI
credential store, outside this adapter's protection boundary.

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
**Inspect capabilities** to perform the local check. There is no automatic sync.

## Capability result shown in Settings

The production interface distinguishes missing or invalid configuration,
unavailable or changed executables, incompatible CLI contracts, and verified
capabilities. A successful result explicitly says credentials and account
connection were not checked. It never reports a stored credential or Connected
state. The isolated E2E command retains credential-status scenario coverage.

CivilDesk's own `not_configured` state means no saved settings. Because the
adapter supplies a validated profile and portal to the CLI, a CLI response
claiming either selector is missing or invalid is treated as incompatible.

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

Before real-account testing, the owner must approve an institution portal and
account, review the installed CLI binary and its location, decide how its v2
credential will be created, and use a non-E2E CivilDesk identity. The
Brightspace adapter did not authenticate an account, inspect a Brightspace
credential, or contact Brightspace during this review.

Before Phase 6B read-only retrieval, define the approved course and assignment
API contract, validate response shapes and origin binding, bound pagination and
timeouts, sanitize errors, and keep retrieval behind the same fixed profile and
executable checks. Live account acceptance remains unproven and must not be
inferred from a stored credential. Real-account sign-in, live verification,
School Overview, Classes, Assignment Calendar, Study Planner, and academic
retrieval require separate owner authorization.

The eventual Assignment Calendar must use class filters and due dates without
creating duplicate global Calendar events.

## Frozen Windows package trust (prepared, not approved for installation)

`src-tauri/src/brightspace_package.rs` verifies PyInstaller one-directory
packages. The approved trust record must be compiled into a reviewed CivilDesk
build and must name a manifest **outside** the package plus its exact SHA-256.
The selected path, package contents, and writable SQLite settings cannot supply
that expected digest. The production approval record is currently empty, so a
directory containing `_internal` is rejected during configuration and again
before process launch. Existing standalone launcher settings and the dedicated
synthetic E2E executable retain their previous behavior. A saved frozen-package
mode also prevents a future approved package from reverting to executable-only
checks if `_internal` disappears.

The verifier requires a canonical package directory and `d2l.exe` at its root.
It verifies the manifest digest before parsing, accepts only schema
`civildesk-d2l-windows-onedir-v1`, rejects malformed records and unsafe paths,
checks every listed file's size and SHA-256, and rejects missing, modified, or
**extra files and directories**. It rejects links and Windows reparse points
inside the package, including junctions. The manifest is not stored inside the
package. Failure returns a fixed, sanitized trust error and prevents launch;
there is no fallback to hashing only `d2l.exe` for a frozen package. The
fixed capability command, validated portal configuration, cleared child
environment, timeout, output limits, cancellation, and strict JSON parsing
remain in force.

The candidate at D2L-CLI source commit `3ce1648` is **unsigned**. Its manifest
and executable were verified against independently recorded hashes, but no
production trust anchor has been provisioned. Two builds from the same pinned
inputs differed in `d2l.exe` and `base_library.zip`; byte-for-byte
reproducibility is not established. Before installation, review and approve
the precise package and manifest digest, provision the trusted manifest apart
from the package, compile the digest and location into a reviewed CivilDesk
build, place the package in a controlled directory, verify it before selection,
and preserve the previous installation for side-by-side rollback. Do not
overwrite a configured package in place or silently accept a changed hash.

Offline tests of the candidate confirmed contract-v1 capability JSON and
configuration failures that stop before credential access. The exported source
passed 1,603 tests, including synthetic Chromium frame regressions. Frozen
browser behavior and valid-profile credential status remain unverified. The
candidate includes Playwright's Node driver and Python
library but **does not include Chromium**. Playwright 1.63.0 expects a matching
browser revision, normally found in the Windows `ms-playwright` user cache or
an explicitly selected `PLAYWRIGHT_BROWSERS_PATH`. An isolated revision-1243
browser runtime was verified and used for source tests, but not exercised by
the frozen executable. A separately approved browser runtime and frozen
synthetic browser test are prerequisites before login evaluation.
The current adapter clears `PLAYWRIGHT_BROWSERS_PATH` from child processes, so
any future browser launch through CivilDesk would use Playwright's default
per-user cache unless a separately reviewed allowlist or bundled browser path
is added. The packaged Node driver is present; it is not a browser binary.
The native E2E Notion harness uses a process-memory credential store selected
only by the exact E2E identity. Its static guards reject `cmdkey` and real
credential-store access from the synthetic harness.

Hashing proves correspondence to the approved manifest at check time. It does
not establish publisher identity, contain a same-user attacker, or remove the
replacement window between verification and Windows process creation. A
same-user attacker may also alter the CivilDesk binary, settings, package, or
credential store. Production academic reads remain build-gated off.
