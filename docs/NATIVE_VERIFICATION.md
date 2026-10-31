# Native Windows verification

## Verified build and installer

- Source commit: `1f519e0` on `main`.
- Windows CI run: https://github.com/webswe/CivilDesk/actions/runs/41144290755 (Phase 1.2, successful frontend and native jobs). The native job built the Tauri executable and NSIS package and uploaded `CivilDesk-Windows-NSIS`.
- Installer: `CivilDesk_0.1.0_x64-setup.exe`; SHA-256 `79229678ADB19310AAFB17A541E6DC909F71FDADBAB72E757E74D8CDE89849EE`; Authenticode status `NotSigned`. Verify this hash before running this exact artifact. It is a CI test installer, not a trusted production release.
- Phase 1.3 testing took place on Windows in the current user's account. Windows Sandbox was unavailable and this account was not an administrator. No pre-existing CivilDesk installation was present. The only existing CivilDesk database was the empty test database created during Phase 1.2: SQLite `quick_check=ok`, `user_version=1`, and zero rows in all four application tables. Its SHA-256 was `24782E5030283C0E2B03F675BA310F97A5EFFCE1E36D8A148789167E514144AF`. It was backed up before testing and restored byte-for-byte afterward. Do not repeat these database replacement tests on a profile containing real user data.

## Phase 1.3 results

| Check | Result |
| --- | --- |
| Current-user installation | **Pass.** Silent NSIS installation exited 0 without elevation. Windows registered CivilDesk 0.1.0 under `HKCU` and installed `civildesk.exe` and `uninstall.exe` in `%LOCALAPPDATA%\CivilDesk`. A Start menu shortcut was created. The executable and SQLite data are in separate directories. |
| Installed application startup | **Pass.** The installed executable opened a real Tauri/WebView2 window. The fresh test profile showed onboarding; completing it opened the dashboard. Pip could be petted and reacted. Settings changes to hide Pip and enable reduced motion saved without an error banner. |
| Restart persistence | **Pass.** After a full process restart, onboarding remained complete, the dashboard showed the chosen test name, Pip remained hidden, and reduced motion remained active. SQLite `quick_check=ok`, `user_version=1`, and the saved preferences and companion records were present. |
| Fresh database | **Pass.** With the disposable database removed while the app was closed, startup created a new SQLite database at `%APPDATA%\com.webswe.civildesk\civildesk.sqlite3` with `quick_check=ok`, schema version 1, and zero app-state rows. Onboarding appeared again. |
| Corrupt database | **Pass.** Replacing only the disposable database with invalid bytes produced the visible `CivilDesk could not open` screen, an SQLite initialization error, and a `Try again` button. The file's SHA-256 remained `11626154ACB504B3D0F0358F9E67E428CD1ABCD10671466137E2F78BA761576C`; no reset or overwrite occurred. |
| Unsupported future schema | **Pass.** A disposable SQLite database with `user_version=2` and a `marker=keep` row produced the visible unsupported-version initialization error and retry button. The marker and file hash remained unchanged. |
| Existing schema compatibility | **Pass.** The saved version-1 test profile reopened after the failure tests with its name, Pip visibility, and reduced-motion preferences intact. |
| Same-version reinstall | **Pass as a retention check.** Reinstalling the identical 0.1.0 package exited 0, left the database hash unchanged (`9B0C26958D55992D8C76BD4532279C43F661A7FEE9FCACDE7E533E05EE58595E`), and the app reopened with saved preferences. This is not a version upgrade or migration test. |
| Uninstall | **Pass.** Silent uninstallation exited 0 and removed the executable, uninstaller, Start menu shortcut, and `HKCU` uninstall entry. The SQLite file remained present with the same hash. The original empty test database was then restored exactly. |
| WebView2 already installed | **Partial.** The host had a WebView2 runtime and the installed app used it successfully. The Tauri bundle configuration specifies `webviewInstallMode: offlineInstaller`, and the CI package is substantially larger than the app executable. Installation on a disconnected machine without WebView2 was **not tested**; do not remove WebView2 from this production machine to simulate it. |
| Newer-version upgrade | **Not tested.** No second versioned installer exists. Same-version reinstall verifies retention only; a real upgrade must exercise a later signed test build and its migrations. |

The first sandboxed attempt to invoke the installer returned 0 but made no installation changes because writes outside the workspace were blocked. The successful installation, launch, reinstall, and uninstall checks used normal current-user filesystem access. No administrator token was used.

Local Phase 1.3 checks: `npm run typecheck` passed; `npm run lint` passed; `npm test` passed (2 files, 5 tests). The first test invocation inside the restricted sandbox failed before tests ran because `esbuild` could not spawn (`EPERM`); rerunning with normal child-process permissions passed. Rust tests and native compilation were already successful in the Phase 1.2 Windows CI run. This machine still lacks a working local MSVC linker, so they were not repeated locally.

## Security and release status

- The repository contains no tracked credential or private-key files. Source review found no application `fetch`/XHR calls, telemetry integration, or updater runtime. The only default window capability is `core:default`; the application writes SQLite through Rust into Tauri's per-user app-data path. This is a source/configuration review, not a packet capture or penetration test.
- The installer is unsigned. Tauri updater artifact signing is configured only for the manual draft-release workflow and requires GitHub Actions secrets. Windows Authenticode signing is a separate future requirement. No release was created during this verification.
- The app currently has no updater plugin or automatic update call; consequently it cannot silently install updates or consume a prerelease feed. Before enabling updates, configure the public verification key, signed artifacts, separate stable/prerelease endpoints, and test both channels with actual versioned packages.
- Uninstall retained the test database. Keep this behavior in future installers and verify it again during a real upgrade. No real user data was used in the recovery tests.

## Remaining acceptance procedure

1. In a disconnected disposable Windows VM or test account **without** WebView2, verify the hash above, install the NSIS package, and confirm onboarding starts. Confirm the runtime was installed from the embedded package without network access. Record VM image and Windows version.
2. When a newer CivilDesk test installer exists, back up a disposable version-1 profile, install the newer version over 0.1.0, and verify onboarding, settings, Pip state, data path, and `PRAGMA quick_check`. Test the new migration on a copy of the old database. Then uninstall and confirm the database remains.
3. Before a public release, configure and test Tauri updater signing, stable/prerelease feed separation, and Windows Authenticode signing. Repeat interactive install/upgrade/uninstall acceptance with the actual release artifact.
