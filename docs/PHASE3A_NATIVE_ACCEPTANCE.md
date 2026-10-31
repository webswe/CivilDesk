# Phase 3A native acceptance evidence

Tested on Windows on 2026-10-31 against commit `9e463d4` and the installed **CivilDesk Acceptance 0.1.0** NSIS build. This document records observations, including checks that remain incomplete. Phase 3B was not started.

## Build and identity

- [Windows CI run 41173402437](https://github.com/webswe/CivilDesk/actions/runs/41173402437) succeeded: frontend typecheck, lint, tests and production build; Rust formatting, Clippy with warnings denied, 18 Rust tests; production Tauri compilation and NSIS packaging.
- [Acceptance run 41173744357](https://github.com/webswe/CivilDesk/actions/runs/41173744357) succeeded with the same checks, acceptance configuration validation, Tauri compilation, NSIS packaging, and installer hash output. No release was published.
- Acceptance installer `CivilDesk Acceptance_0.1.0_x64-setup.exe`: SHA-256 `4C17121C4E6DD9DFE5A0399A3857E3676F9730BB06BB60EEFB7232B14EDCE32D`, matching the workflow. Silent installation exited 0. Installed executable: `%LOCALAPPDATA%\CivilDesk Acceptance\civildesk-acceptance.exe`. The build uses `com.webswe.civildesk.acceptance` and `%APPDATA%\com.webswe.civildesk.acceptance\civildesk.sqlite3`. Its installation, shortcut and uninstall entry are separate from regular CivilDesk.
- The installed app opened and initialized a fresh schema-v4 database. `PRAGMA quick_check` returned `ok`; `PRAGMA foreign_key_check` returned no rows.

## Data protection

The production database was never opened by the acceptance app or migrated. Its SHA-256 before and after testing was `24782E5030283C0E2B03F675BA310F97A5EFFCE1E36D8A148789167E514144AF` (schema v1). The pre-existing acceptance database (schema v3) was backed up and moved aside before test launch. It was restored after testing with its original SHA-256 `B5836C651564D34407AF75C2B74EE769636E7D9B2B9AB015C351A8493699540C`. Both restored databases passed `quick_check` and `foreign_key_check`. The disposable fresh database and an untouched backup of the original acceptance database remain in the test-only temp directory `CivilDesk-Phase3A1-20261031`.

## Installed application observations

The tests below used the installed Windows executable and its Tauri commands, with disposable records only.

| Area | Observed result |
| --- | --- |
| Onboarding and settings | Completed onboarding. Saved quiet engagement and reduced motion; both persisted in the native snapshot, and the reduced-motion CSS class applied. |
| Project dashboard | Created academic Water Resources and professional Structural Engineering projects with different software, including custom QGIS. Search, discipline and status filters, name and target-date sorting, editing, status change, archive filtering, workspace navigation and empty states worked. |
| Project progress | Empty project displayed 0%. One completed task displayed 100%. With that task and two open milestones: 33%; with one milestone complete: 67%; with both complete: 100%; after reopening one: 67%; after deleting the other: 50%. |
| Tasks and Pip | Created a task in the project, completed and reopened it, and confirmed its first completion awarded 25 XP only once. Linked an existing task with a subtask, completed it, then removed the link; the task remained in Tasks with `projectId: null`. Total task XP was 50, with exactly two task reward events. |
| Milestones and Calendar | Created, edited, completed, reopened and deleted milestones. The November 15 deadline appeared in Calendar without inserting a `calendar_events` row. |
| Files | Added local references to disposable files with spaces and Unicode (`Δ`, `漢字`) in their paths. Opening the text file launched a new Notepad process through the OS association. Removed the CSV reference and confirmed the original file remained. The text file was relocated for a missing-file test, but the app could not be restarted afterward to observe its missing state. |
| Journal | Created two dated entries, saw newest first, edited one and deleted the other. A multiline technical description with special characters and a 4,703-character problem note were preserved through native save/load. A journal entry retained its file-reference ID. Restart persistence remains unverified. |
| Portfolio preparation | Candidate status and all seven preparation fields saved and loaded through the native command. No publish/export action was present; browser resource entries showed no external requests during this check. Restart persistence remains unverified. |
| Existing productivity | Created an all-day calendar event, completed a one-minute focus session after pause/resume, stopped a second session without XP, saved reminder quiet hours, received a due task reminder once, and equipped the earned Rosewood scarf. Focus completion awarded 50 XP once; total XP was 100 with `first_focus` and `first_task` achievements. One reminder-delivery row was recorded. |

Representative screenshots: [fresh onboarding](evidence/phase3a1/fresh-onboarding.png), [empty projects](evidence/phase3a1/projects-empty.png), [project overview](evidence/phase3a1/project-overview.png), [portfolio preparation](evidence/phase3a1/portfolio-prep.png).

## Migration evidence

The actual source SQL for migration v4 was extracted from `src-tauri/src/persistence.rs` and applied to a disposable SQLite backup of the preserved v3 acceptance database. All pre-existing table row values matched after migration, except for the intended nullable `tasks.project_id` column. The copy advanced to schema v4, retained its one task, two reward events, two achievements and two cosmetic unlocks, gave the old task a null project association, and passed `quick_check` and `foreign_key_check`. CI also passed the Rust v3-to-v4 migration unit test. **This does not establish that the installed app migrated the v3 copy**, because native startup was blocked before that test could run.

## Startup blocker and remaining checks

After the initial installed-app session was closed, the next launch failed while Tauri created its WebView2 window. The executable exited with code 101 and `HRESULT 0x800700AA` (resource in use). A later attempt with a fresh WebView profile exited with `HRESULT 0x8000FFFF` (catastrophic failure). No CivilDesk Acceptance process remained, and the pre-existing WebView profile was restored unchanged. These are observed Windows/WebView2 startup errors; their underlying environmental cause has not been established, and no application defect has been inferred from them.

The startup blocker prevented native verification of restart persistence, relocated-file detection and refusal to open, and installed-app migration of the v3 copy. Other checks still outstanding: opening disposable DWG/PDF/spreadsheet files through their associations, executable/shortcut rejection, and a fuller visual regression of Pip animations. The native file picker remains an existing usability limitation; file references currently use an absolute path field. No real engineering documents were touched.

**Acceptance status: BLOCKED — SPECIFIC DEFECTS REMAIN.** The demonstrated blocker is WebView2 window creation on subsequent launch. Re-run the outstanding native checks in a healthy Windows session before accepting Phase 3A or starting Phase 3B. No code change is justified yet without a reproducible application defect.
