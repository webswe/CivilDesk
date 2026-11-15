# Tester installer rehearsal preparation

This is a **local-only preparation**. No installer has been run from this branch. No workflow has been dispatched.

## Source and activation boundary

- Baseline installer source: `7d293bbc61dce674d796220e3241571a9f15aa6b`, version `0.1.0`.
- Candidate installer source: the reviewed future `release-prep/tester-0.1.1` commit, version `0.1.1`. Record its full SHA before execution.
- The manual workflow is inert while `APPROVED_CANDIDATE_SHA` is `UNSET`. GitHub permits manual dispatch only for a workflow present on the default branch. A separate owner-reviewed, workflow-only placement on `main` and exact SHA setting are therefore prerequisites. Do not merge the entire release-preparation branch into `main` merely to enable dispatch.
- The workflow checks out both exact SHAs without persisted Git credentials, uses a GitHub-hosted `windows-2022` runner, grants only `contents: read`, and uses no repository secrets or upload action. It never creates a tag or release.
- These checks protect this disposable rehearsal from accidental inputs; they do not establish GitHub protected-environment authorization for the deferred privileged installation work.

## Rehearsal sequence

1. Build the ordinary `currentUser` NSIS installer from each exact source. Record both SHA-256 values and Authenticode statuses. The hashes are observed outputs; byte-for-byte reproducibility is not assumed.
2. Require a fresh hosted runner with no existing CivilDesk installation or data directory. Install baseline `0.1.0` silently. Verify `%LOCALAPPDATA%\CivilDesk`, its executable version, HKCU uninstall entry, and executable inventory. Launch the actual `com.webswe.civildesk` app to create schema v10 and seed its challenge library.
3. Add only synthetic preferences, a project and associated task, milestone, Calendar event, started challenge with user-set deadline and evidence, portfolio case study and gallery, plus a disposable external file under `RUNNER_TEMP`. No Credential Manager entry or real service is used. Probe the installed app through read-only native commands over a temporary loopback WebView2 diagnostic port.
4. Close the app cleanly. Record identifiers, selected values, record counts, SQLite schema, `quick_check`, `foreign_key_check`, and the attachment hash. Use SQLite's online backup API twice to create a validated pre-upgrade backup and an independent rollback snapshot. Never copy an active database file.
5. Install `0.1.1` in place. Verify installed executable and HKCU versions, launch and probe the app, compare all synthetic records, close, restart, and compare again. Verify the external file is untouched.
6. Uninstall and confirm application files and HKCU registration are removed while synthetic SQLite and external files remain. Reinstall the baseline, restore the separate rollback snapshot only while the app is closed and no SQLite sidecars exist, launch, and verify the original synthetic records through native commands and SQLite. Uninstall again. The hosted runner and its data are then discarded.

The database snapshot does **not** back up external referenced files or Windows Credential Manager secrets. The synthetic external file is checked separately. The app uses the normal production identity on a disposable hosted runner so the installer registration and data path are authentic; the existing E2E identity is not substituted.

## Explicitly incomplete scenarios

The primary workflow keeps CivilDesk closed during upgrade to make backup and record comparisons deterministic. The following are separate disposable-runner variations and are **NOT VERIFIED** by the primary workflow:

| Scenario | Controlled check and evidence required | Current limitation |
| --- | --- | --- |
| App running during upgrade | Start the baseline binary from a clean synthetic snapshot; invoke the candidate installer with a bounded timeout; record installer exit, app process state, registration and installed version; return to the clean snapshot before the primary upgrade. | NSIS may prompt or block differently in silent and interactive modes. A timed-out attempt is not a pass. |
| User cancels installer | Drive the interactive NSIS dialog on a disposable Windows desktop and cancel before writing files; verify the old binary, HKCU registration, SQLite and attachments remain. | No deterministic dialog driver is in this milestone. |
| Installer fails partway | Use a disposable snapshot and a controlled installer failure after writes begin; verify package and data state, then restore the snapshot. | GitHub-hosted runners do not offer a VM snapshot of the entire runner. Killing NSIS at an arbitrary instant would not give reproducible evidence and is not automated. |
| Permission-denied update | Deny modification of **only the disposable install directory** on a separate hosted-runner scenario; restore its original ACL in `finally`; verify refusal and intact synthetic data. | Not included in the primary workflow, and no ACL change is made locally. |
| Reinstall old version after a failed upgrade | First establish a specific, reproducible failure above; reinstall the exact baseline installer, restore the separately verified SQLite snapshot while the app is closed, and prove native commands and record integrity. | The primary workflow proves rollback after a *successful* upgrade and uninstall, not after a failed upgrade. |

These variations must not be simulated on the owner's host or by corrupting the runner OS; if a safe runner variation cannot be designed, report the limitation.

The workflow records Authenticode status but does not sign either installer. An unsigned result must be reported as unsigned. WebView2 `offlineInstaller` is checked in configuration and both installers are built, but the hosted runner normally has WebView2; an actual no-WebView2 offline installation remains **NOT VERIFIED**. Installed executable inventory and absence of test binaries, databases, and `.env` files are checked; a full release-artifact secret scan and publisher-authenticity review remain separate release gates. Production D2L-CLI stays disabled and no protected `perMachine` installation is exercised.

The local version-only commit changes `package.json`, root `package-lock.json` metadata, `src-tauri/Cargo.toml`, the `civildesk` entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. It does not enable the updater or alter the existing manual release workflow.
