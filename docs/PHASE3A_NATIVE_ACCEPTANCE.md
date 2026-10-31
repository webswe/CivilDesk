# Phase 3A native acceptance

Phase 3A adds SQLite schema version 4 and a local engineering project workspace. Frontend tests and production build do not prove that the Tauri commands, Windows file associations, or migration work in the native application.

## Data and migration

Use an isolated acceptance build and a copy of a version 3 database. Keep the original Phase 1 database untouched. Confirm that opening CivilDesk migrates the copy to version 4, preserves preferences, tasks, calendar events, focus history, and Pip XP, and gives old tasks a null project association. Reopen the build to confirm the migration is idempotent. Confirm an unsupported future schema is rejected without replacement. Check `PRAGMA foreign_key_check` on the acceptance database.

## Project workspace

Create an academic project and a professional development project. Check custom categories, disciplines, multiple software names, dates, priorities, status changes, archive filtering, search, sort, and reopening. Create and edit a task in the existing task screen, associate it with a project, complete it from the project, reopen it, and remove the association. Confirm the task remains in Tasks and the first completion awards Pip XP once. Check project progress with no work, with mixed tasks and milestones, and after reopening work.

Create, edit, complete, reopen, and delete a milestone. Verify its target date appears in Calendar without a new calendar event row. Add a journal entry with detailed technical text and a related file reference; edit and reopen it to confirm the text is unchanged. Fill every portfolio preparation field, then confirm the data is private and no publishing or export action appears.

## Files and Windows behavior

Reference a DWG, PDF, spreadsheet, and an uncommon document using absolute paths. Open each with its Windows associated application. Move one file and confirm CivilDesk marks it missing and refuses to open it. Remove a reference and confirm the original file remains. Confirm executable and shortcut extensions are rejected. File selection currently uses an absolute path field; a native file picker has not been added.

## Gates

Run `npm run lint`, `npm test -- --run`, `npm run build`, `cargo fmt --all -- --check`, and `cargo test` in the established Windows CI environment. Build and launch the isolated acceptance application. Capture screenshots of the project dashboard, all workspace sections, milestone calendar presentation, missing file state, and portfolio preparation. Do not label Phase 3A verified until these native checks pass.

The current local Rust toolchain cannot complete `cargo check`: the first attempt reported missing Rust library metadata and a single-job retry reported that `link.exe` is unavailable. This is an environment blocker, not a passing native result. Do not repeatedly install MSVC locally; use the existing Windows CI and acceptance build when authorized.
