# Native Windows acceptance procedure

These checks are pending a successful GitHub Actions Windows build. The CI artifact is an unsigned test installer, not a public release. Use a disposable Windows test account or VM. Do not perform corruption tests on a real user's database.

## Build and install

1. Review both CI jobs for the exact commit. Download the `CivilDesk-Windows-NSIS` artifact from the native job and record its SHA-256 checksum.
2. Install the NSIS package as the current user. Check the displayed product name and version. Confirm the app appears in Windows Apps and the Start menu. The installer should work offline, including on a test machine without WebView2, because it embeds the WebView2 offline installer. Confirm this with a disconnected VM, not only a machine that already has WebView2.
3. Confirm the executable resides in a user installation location and the database appears under Tauri's per-user application-data directory, not beside the executable. Locate `civildesk.sqlite3` by searching only the test user's application-data folders.

## Application behavior

4. Launch with a fresh test profile. Confirm onboarding asks for display name, Rosewood appearance, Pip visibility, and engagement level. Complete onboarding.
5. Confirm the dashboard renders with no internet connection and each sidebar destination opens either its implemented view or an explicitly labeled placeholder. Collapse the sidebar, restart, and confirm the choice persists.
6. Pet Pip, use Explore, let Pip sleep, and wake Pip. Confirm animation is visible when motion is allowed. Enable reduced motion and confirm the body animation stops. Hide Pip, restart, and confirm it stays hidden. Re-enable it in Settings.
7. Change display name, engagement, focus mode, and reduced motion. Quit completely and relaunch. Confirm every setting and onboarding completion persists. Confirm focus mode prevents decorative Pip reactions.
8. Inspect the SQLite file with a trusted SQLite client: `PRAGMA quick_check` should return `ok`, and `PRAGMA user_version` should return `1`. Confirm its modification time changes after saving settings. Do not edit it while CivilDesk is open.

## Failure and upgrade checks

9. In the disposable profile, close CivilDesk and copy the database to a backup. Replace only that test database with invalid bytes, then relaunch. CivilDesk should display an initialization error and offer retry; it must not silently reset the data. Restore the saved copy and confirm normal launch.
10. Install a newer test build over the previous one when available. Confirm onboarding and settings remain, the database remains in the same app-data location, and `PRAGMA quick_check` still returns `ok`.
11. Uninstall from Windows Apps. Confirm the executable and shortcuts are removed. Check whether the per-user data remains; preserve it unless the user explicitly requests deletion. Record actual behavior before release documentation promises retention.

The current app has no updater plugin or automatic update call. Before enabling updates, configure a public verification key, signed artifacts, and distinct stable and prerelease endpoints. Test a signed update from a previously installed version. Do not point a stable build at a prerelease feed.
