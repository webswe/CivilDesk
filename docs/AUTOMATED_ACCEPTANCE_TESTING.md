# Automated Native Acceptance Testing

Status: **framework and suite written and statically validated; not yet executed against the real binary.** The native proof of concept can only run on a Windows GitHub Actions runner (this machine has no MSVC linker and no `tauri-driver`), and running it requires pushing the workflow, which has not been authorised. Until the first green run, treat every native claim below as *designed*, not *verified*. See "Validation evidence".

## 1. Approach chosen

| Option | Verdict |
|---|---|
| `tauri-driver` + `msedgedriver` + WebdriverIO (the documented Tauri 2 route) | **Chosen.** Drives the unmodified app binary over WebDriver. No plugin or code is added to the application. |
| `@wdio/tauri-service` | Rejected for now. It is convenient, but its embedded mode needs a test plugin compiled into the app, which this milestone avoids so no testing capability can ever ship. |
| Electron / replacing Tauri | Not considered. |
| Windows UI Automation (PowerShell/pywinauto) | Reserved for native dialogs and the installer (section 6). Not used for in-app UI. |

How it works: `tauri-driver` starts the real `civildesk-e2e.exe`, WebView2 is automated through `msedgedriver`, and WebdriverIO sends commands. The same JS runs against the same Rust/SQLite backend a user runs.

## 2. Architecture

```
.github/workflows/e2e-windows.yml   manual workflow (workflow_dispatch)
src-tauri/tauri.e2e.conf.json       build-time identity for the test binary only
e2e/
  wdio.conf.mjs                     starts tauri-driver, resets E2E data, screenshots on failure, SQLite check per session
  lib/guard.mjs                     the only code that deletes anything (see section 3)
  lib/app.mjs                       selectors and helpers: role/label/text based, no coordinates
  lib/db.mjs                        read-only SQLite inspection, expected schema version from persistence.rs
  specs/01..06-*.e2e.mjs            acceptance specs
  scripts/verify-results.mjs        final gate: SQLite health + JUnit failures
scripts/check-e2e-config.mjs        isolation checks (also run in normal CI)
```

Specs use XPath over ARIA labels, roles and visible text. The app needed no `data-testid` additions.

## 3. Data isolation guarantees

1. **Own identity.** The test binary is built with `tauri.e2e.conf.json`: identifier `com.webswe.civildesk.e2e`, binary `civildesk-e2e`, data under `%APPDATA%\com.webswe.civildesk.e2e` and `%LOCALAPPDATA%\com.webswe.civildesk.e2e`. Production (`com.webswe.civildesk`) and Acceptance (`com.webswe.civildesk.acceptance`) paths are never read or written.
2. **No test code in the app.** No Rust change, no plugin, no capability change, no env-var data override. `scripts/check-e2e-config.mjs` fails if Cargo.toml gains a test plugin, capabilities change, any Rust or app source mentions the E2E identity/WebDriver, or the release/Acceptance workflows or configs reference the E2E build. It runs in the normal CI frontend job.
3. **Guarded cleanup.** `guard.mjs` deletes only the two exact E2E identity folders, verifies the folder name and that its parent is `%APPDATA%`/`%LOCALAPPDATA%`, explicitly refuses the production and Acceptance names, and refuses to run outside CI unless `CIVILDESK_E2E_ALLOW_RESET=1`. Unit tests cover refusals and prove neighbouring folders survive.
4. **Clean slate per spec file.** The E2E profile is wiped before each spec file, so specs are order-independent. Restarts inside a spec (`browser.reloadSession`) keep the data, which is how persistence is tested.
5. **Predictable data.** Specs create data through the UI, or through the app's own IPC commands (`save_task`, `save_event`) for fixtures such as overdue tasks and legacy categories.
6. **Never shipped.** The workflow builds `--debug --no-bundle` and uploads no installer. The release and Acceptance builds use different configs.
7. **Harness failures are fatal.** WebdriverIO only logs launcher-hook errors; hooks are wrapped so a failed reset or missing binary exits non-zero (found and fixed during local dry-run).

## 4. Setup and commands

Requirements (CI installs all of them): Windows with WebView2 runtime, Rust, Node 24, `cargo install tauri-driver --locked`, a matching `msedgedriver` on PATH (`msedgedriver-tool`, as documented by Tauri).

```
npm run tauri build -- --debug --no-bundle --config src-tauri/tauri.e2e.conf.json
npm ci --prefix e2e
cd e2e
npm run test:smoke      # proof of concept only
npm test                # all specs
npm run verify          # SQLite health + JUnit gate
```

Locally use `CIVILDESK_E2E_ALLOW_RESET=1` and `CARGO_TARGET_DIR` if your target is elsewhere (`CIVILDESK_E2E_BINARY` overrides the binary path). Local checks that need no native tooling: `npm run check:e2e-isolation`, `npx vitest run e2e/lib`.

## 5. GitHub Actions

`Native E2E (Windows)` is **manual only** (`workflow_dispatch`, input `suite`: `smoke` or `full`, default `smoke`). It installs dependencies, runs the isolation checks, builds the E2E binary, installs (and caches) `tauri-driver`/`msedgedriver`, prints the WebView2 version, runs the suite, always runs the verification gate, captures a desktop screenshot on failure, and uploads `e2e/results` (JUnit, WebdriverIO logs, tauri-driver log, per-failure screenshot + page HTML). The job fails if any test, SQLite check or schema-version check fails. It is not wired into push CI. Recommended promotion: run `smoke` until green, then `full` several times, then consider a scheduled run.

## 6. Coverage

| Area | Spec | Covered |
|---|---|---|
| PoC | 01 | launch real binary, window rendered, onboarding, My Day, create task, restart, persistence, clean exit |
| School/Personal | 02 | create/classify, Area default per page, All tasks chips, legacy custom categories preserved, edit, complete/reopen, My Day consistency |
| My Day | 03 | empty day, today/overdue/upcoming/events, 30-day task excluded, one-click completion + progress, Start focus preselects task |
| Navigation | 04 | grouping, no placeholders, Engineering expand, breadcrumbs, keyboard Tab/Enter, narrow icon rail (700 px), collapsed state survives restart |
| Engineering | 05 | nine challenges, pathways, Skills, start/check/complete, challenge-to-project, project journal, Journal page, no Pip XP change |
| Pip | 06 | dock pet/open, Pip page, Wardrobe, Achievements, XP 25 persisted, hide/show persisted |
| Persistence | all | restart in 01/04/06; after every session SQLite `quick_check` is `ok` and `user_version` equals the highest migration in `persistence.rs` (currently 5), i.e. no unexpected or missing migration |

## 7. Not automated (manual checklist)

Not exercised by this framework; do not treat as verified:

- **Native Windows file picker** (open, select, cancel) and file-evidence attachment through it. WebDriver cannot reach OS dialogs. A UI Automation script could, but it would be unproven in CI; the Rust path validation is covered by Rust tests and the "absolute path" attach field is plain web UI that could be added to a spec.
- **NSIS installer, installed-app startup, upgrade-over-existing-install.** The suite tests the portable E2E binary, not the installer. Use the existing `Acceptance Windows installer` workflow and the manual steps in `PHASE3B2_UX_SIMPLIFICATION.md` section 12.
- **Existing-data compatibility with the owner's real database.** Migrations from older schemas are covered by Rust unit tests in `persistence.rs`; E2E only proves a fresh database and restarts.
- Visual correctness, DPI scaling, real window-restore behaviour, WebView2 version drift.

## 8. Validation evidence (actual)

Local, 2026-10-31 (no native execution possible on this machine):

- `npm run typecheck`, `eslint .`, `npm test` (13 files, 54 tests, including 7 new harness tests for the guard and database inspection), `check-acceptance-config`, `check:e2e-isolation`: pass.
- All spec/config files parse (`node --check`); `wdio run` loads the config and fails fast with the intended message when the binary is missing. That dry run exposed two real harness bugs (logger folder deleted by `onPrepare`; hook errors swallowed), both fixed.
- **Not yet done:** building `civildesk-e2e.exe`, launching it, the PoC, and the full suite. They require the Windows runner. Specs 02-06 were written before the PoC was proven; they are staged behind `suite=full` and should be expected to need selector fixes on first execution.

## 9. Known limitations

- Unproven in CI: the `msedgedriver-tool` step (documented by Tauri but pinned to a personal repo's default branch), runner interactivity, and exact XPath/ARIA behaviour under msedgedriver.
- Each spec file launches the app at least once; the full suite is roughly 6 launches plus restarts.
- Fixture seeding through `window.__TAURI_INTERNALS__.invoke` depends on the IPC shape of `save_task`/`save_event`; schema changes there need fixture updates.
- Test dates use the runner clock and time zone; a run spanning midnight could flake.
- Debug build is used for speed; it does not prove release-profile behaviour.
- The suite does not run `cargo`-level tests; those stay in CI.
