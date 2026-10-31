# Phase 2 verification record

## Scope and Git boundary

Development started from clean `main` at `68e0b57`. Milestone 2A was committed separately as `385fb62`. No Phase 2 commit has been pushed or released. The Phase 1 installer and its native acceptance results do **not** verify this source revision.

## Implemented behavior

- Tasks: create, edit, complete, reopen, delete with confirmation, subtasks, due date and optional time, category, priority, search, filters, sorting, and reminder offsets. Native commands use SQLite; browser preview task data is in memory only. A task earns its first-completion event once, even after reopening and recompleting.
- Focus: configurable focus and break minutes, optional linked task, start/pause/resume/stop/manual completion, history, and completed-session statistics. Remaining time is computed from stored timestamps. App restart pauses a running session without crediting completion. One completed session earns one event.
- Pip: 25 XP per distinct completed task and 50 XP per completed focus session; level is `floor(XP / 100) + 1`. Five active version-1 achievements: first task, five tasks, first focus session, three focus sessions, and level 5. The future weekly-goal achievement is inactive. Rosewood scarf, Berry style, and headphones are permanently unlocked and can be equipped. Celebration aura appears on level-5 celebrations. Focus Mode suppresses decorative reactions; rewards remain recorded.
- Calendar: separate all-day and timed events with CRUD, month/week/day views, task deadline markers, event details, and a dashboard preview. Timed events retain a UTC instant and originating time-zone label; the calendar shows them in the current local zone. Nonexistent DST wall times are rejected and the first occurrence of a repeated wall time is chosen.
- Reminders: optional task/event offsets, an in-app grouped banner while CivilDesk is open, preference toggle, quiet hours, overdue/upcoming lists, and a durable unique delivery claim. Focus sessions defer reminder alerts until focus ends. Date-only task reminders use 23:59 local time; all-day event reminders use 09:00 local time on the start date. No background process or native Windows toast is configured, so alerts cannot arrive while the app is closed. [Tauri's notification plugin documentation](https://v2.tauri.app/plugin/notification/) notes that Windows native notifications require an installed app.

## Data protection and migration

Migration 2 adds task/focus/progression tables and reward XP; migration 3 adds events and reminder tables. Both use transactions and retain the Phase 1 `app_state` and Pip personality record. A read-only backup of the existing Phase 1 database was copied into SQLite memory, then migrated to versions 2 and 3: both `PRAGMA quick_check` calls returned `ok`; the original file remained at version 1. Rust tests cover migration from Phase 1, task reward idempotence, focus early-completion rejection, reward/unlock persistence, event CRUD, reminder deduplication, and invalid date rejection. These Rust tests are **not yet executed** for this revision.

## Checks performed locally

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed. |
| ESLint | `npm run lint` passed. |
| Frontend tests | `npm test` passed: 4 files, 13 tests, including onboarding regression, task CRUD, calendar CRUD, focus timestamp behavior, DST gap/overlap, quiet hours, and preview reminder deduplication. |
| Production frontend bundle | `npm run build` passed. |
| Rust formatting | `cargo fmt --all -- --check` passed using the installed Rust toolchain. |
| Rust compilation, Clippy, Rust tests | Not run successfully locally. `cargo check --locked` stops in dependency build scripts because MSVC `link.exe` is absent. No build gate was bypassed. |
| Native Windows application | Phase 2 executable, SQLite commands, NSIS installer, and interactive runtime are unverified until new CI and installed-app testing. |
| Browser screenshots | Frontend preview only, with temporary in-memory example data: [tasks](phase2-tasks-preview.png), [calendar](phase2-calendar-preview.png), [Pip customization](phase2-pip-customization-preview.png). They do not prove native operation. |

## Native acceptance before calling Phase 2 complete

1. Push the two Phase 2 commits only with owner approval. Review the Windows CI results for `cargo fmt`, Clippy, Rust tests, Tauri compilation, NSIS packaging, and artifact upload. Fix any native defects and rerun.
2. Install the new artifact in a disposable Windows profile. Back up a version-1 CivilDesk database and verify migration to version 3, onboarding/settings/Pip preservation, task CRUD, completion rewards, focus pause across restarts, cosmetic persistence, calendar CRUD, and reminder claims across restarts. Test corrupt and future-schema databases on copies only.
3. Test a task and timed-event reminder in an installed app across quiet hours and focus mode. Verify duplicate suppression after restarting. Confirm no alert while CivilDesk is closed. Native OS toasts are outside the current implementation.
4. Verify an upgrade from the Phase 1 installer with disposable data, then uninstall and confirm user data remains. This requires a second installer and has not yet been performed.
