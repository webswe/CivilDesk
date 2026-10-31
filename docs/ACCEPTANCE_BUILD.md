# Isolated Windows acceptance build

CivilDesk Acceptance is a separate, manually built test application. Its source and UI are the Phase 2 application; only Tauri packaging identity and app directories differ. The production `tauri.conf.json`, CI workflow, and release workflow remain unchanged.

## Build and retrieve

1. Push the reviewed commit only with owner authorization. On GitHub, open **Actions → Acceptance Windows installer → Run workflow** on that commit. The workflow runs frontend checks, Rust formatting, Clippy, Rust tests, and the Tauri acceptance build on `windows-latest`.
2. Download the `CivilDesk-Acceptance-Windows-NSIS` workflow artifact. Extract `CivilDesk Acceptance_<version>_x64-setup.exe` and record its SHA-256 from the workflow's **Verify acceptance installer name** step. Compare the downloaded file's hash before running it.
3. No release, updater feed, or signing secret is involved. The unsigned test installer may show a Windows trust prompt. It is not a production release.

For a local Windows machine with a working MSVC linker, the equivalent command is:

```powershell
npm ci
node scripts/check-acceptance-config.mjs
npm run tauri build -- --bundles nsis --config src-tauri/tauri.acceptance.conf.json
```

Tauri applies the acceptance file with `--config` using JSON Merge Patch. The production build omits that flag. Do not combine this overlay with `tauri.release.conf.json` or enable updater artifacts for acceptance.

## Identity and paths

| Item | Production | Acceptance |
| --- | --- | --- |
| Product / NSIS install folder | `CivilDesk` | `CivilDesk Acceptance` |
| Tauri identifier | `com.webswe.civildesk` | `com.webswe.civildesk.acceptance` |
| Main executable | `civildesk.exe` | `civildesk-acceptance.exe` |
| Current-user install | `%LOCALAPPDATA%\CivilDesk` | `%LOCALAPPDATA%\CivilDesk Acceptance` |
| SQLite and settings | `%APPDATA%\com.webswe.civildesk\civildesk.sqlite3` | `%APPDATA%\com.webswe.civildesk.acceptance\civildesk.sqlite3` |
| Default WebView data | `%LOCALAPPDATA%\com.webswe.civildesk` | `%LOCALAPPDATA%\com.webswe.civildesk.acceptance` |
| Start menu shortcut | `Programs\CivilDesk.lnk` | `Programs\CivilDesk Acceptance\CivilDesk Acceptance.lnk` |

The acceptance overlay explicitly sets `appDirectoriesOverride.data` and `.localData` to the acceptance directories. Native startup calls `app.path().app_data_dir()` and appends only `civildesk.sqlite3`; it has no production path fallback. The window does not set `dataDirectory`, so Tauri uses the app-local data directory for WebView2. Browser preview's local-storage key is shared in source but each installed application's WebView directory is separate. Tauri's Windows NSIS installation and uninstall entries follow the distinct product name. The separate `mainBinaryName` also prevents an executable-name collision.

`node scripts/check-acceptance-config.mjs` checks the merged identities, directory paths, installer mode, WebView setting, updater setting, and the native path construction. Run it before every acceptance build. After installing, verify the actual paths and Windows uninstall entry before launching. Stop if any actual acceptance path resolves under a production path.

## Protected-data preflight

1. Close any regular CivilDesk process. Record the production database's absolute path, SHA-256, `PRAGMA user_version`, and `PRAGMA quick_check`. Record the existence and hashes of any production executable and Start menu shortcut. Never move or replace production data to make room for a test.
2. Confirm the installer file name and hash, `CivilDesk Acceptance` install directory, `civildesk-acceptance.exe`, separate Start menu folder, and separate HKCU uninstall entry. If an earlier acceptance install exists, inspect it before proceeding.
3. Confirm `%APPDATA%\com.webswe.civildesk.acceptance` and `%LOCALAPPDATA%\com.webswe.civildesk.acceptance` are distinct from the production directories. The acceptance database directory may be prepared with seeded test data while the acceptance app is closed.
4. Recalculate the production database hash after installation, after native testing, and after uninstall. If it changes unexpectedly, stop and report the discrepancy; do not silently restore it.

## Native test sequence

Use controlled local dates and real elapsed time. Do not change the Windows clock.

1. Install for the current user. Launch, complete onboarding, inspect the Rosewood interface and Pip, change settings, restart, and confirm settings and SQLite persistence.
2. Create and edit tasks with due dates, subtasks, categories, and priorities. Exercise search, sort, filters, completion, reopening, deletion, dashboard summaries, and restart persistence. Inspect the acceptance SQLite `tasks` table and integrity.
3. Exercise focus start, pause, resume, stop, and a one-minute completed session. Restart during a running session and confirm it recovers paused without a reward. Check history and Focus Mode behavior.
4. Record XP before and after distinct task and focus completions: 25 XP per task and 50 XP per focus session. Reopen and recomplete a task to check duplicate prevention. Reach the first-task, five-task, first-focus, three-focus, and level-five achievements with controlled work records. Equip scarf, Berry style, and headphones; confirm the visible Pip changes and persists after restart. Check quiet engagement, reduced motion, and hidden Pip.
5. Exercise calendar month, week, and day views; all-day and timed event CRUD; task deadline markers; local dates, a daylight-saving gap and overlap where applicable; and restart persistence.
6. Schedule task and event reminders a few minutes ahead. Keep the app open to observe the in-app banner; verify quiet hours defer it and restart does not repeat a delivered reminder. Reminders do not run while CivilDesk is closed, and this build has no native Windows toast.

For migration acceptance, close the app and prepare **only** the acceptance SQLite path with a synthetic schema-v1 database. Seed Phase 1 `app_state` preferences and companion JSON, including onboarding and Pip state, plus a valid legacy reward event, earned achievement, and cosmetic unlock. Keep a backup of this synthetic file. Launch the acceptance app, then verify `PRAGMA user_version=3`, `PRAGMA quick_check=ok`, the seeded rows, and new task, focus, calendar, and reminder tables. Phase 1 had no XP column in `reward_events` and no active reward engine, so its expected progression XP is zero; migration adds the column with default zero. Test new XP awards after migration. Do not copy, replace, or edit the production database.

## Uninstall and cleanup

Close CivilDesk Acceptance, run its own uninstaller from `%LOCALAPPDATA%\CivilDesk Acceptance`, and verify its executable, Start menu folder, and HKCU uninstall entry are removed. Check that acceptance SQLite data remains unless the uninstaller explicitly reports otherwise. Verify production files, shortcut, and database hash remain unchanged. These two installers currently both have version `0.1.0`; a same-version install is not a genuine version-to-version upgrade. Increment the app version before the next distributed release.

After explicit owner approval to delete disposable test data, remove only the verified `%APPDATA%\com.webswe.civildesk.acceptance` and `%LOCALAPPDATA%\com.webswe.civildesk.acceptance` directories. Confirm their resolved absolute paths and exact names first. Never delete the corresponding production directories.

Record each native observation, database query, installer hash, and any defect in `PHASE2_VERIFICATION.md`. Do not call Phase 2 accepted until the installed acceptance app has been exercised.
