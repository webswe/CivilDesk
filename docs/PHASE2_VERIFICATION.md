# Phase 2 verification record

## Scope and Git boundary

Development started from clean `main` at `68e0b57`. Milestone 2A was committed separately as `385fb62`, and milestone 2B as `5ccf0e2`. These commits were pushed to `origin/main` with owner authorization. No Phase 2 release exists. The Phase 1 installer and its native acceptance results do **not** verify this source revision.

## Implemented behavior

- Tasks: create, edit, complete, reopen, delete with confirmation, subtasks, due date and optional time, category, priority, search, filters, sorting, and reminder offsets. Native commands use SQLite; browser preview task data is in memory only. A task earns its first-completion event once, even after reopening and recompleting.
- Focus: configurable focus and break minutes, optional linked task, start/pause/resume/stop/manual completion, history, and completed-session statistics. Remaining time is computed from stored timestamps. App restart pauses a running session without crediting completion. One completed session earns one event.
- Pip: 25 XP per distinct completed task and 50 XP per completed focus session; level is `floor(XP / 100) + 1`. Five active version-1 achievements: first task, five tasks, first focus session, three focus sessions, and level 5. The future weekly-goal achievement is inactive. Rosewood scarf, Berry style, and headphones are permanently unlocked and can be equipped. Celebration aura appears on level-5 celebrations. Focus Mode suppresses decorative reactions; rewards remain recorded.
- Calendar: separate all-day and timed events with CRUD, month/week/day views, task deadline markers, event details, and a dashboard preview. Timed events retain a UTC instant and originating time-zone label; the calendar shows them in the current local zone. Nonexistent DST wall times are rejected and the first occurrence of a repeated wall time is chosen.
- Reminders: optional task/event offsets, an in-app grouped banner while CivilDesk is open, preference toggle, quiet hours, overdue/upcoming lists, and a durable unique delivery claim. Focus sessions defer reminder alerts until focus ends. Date-only task reminders use 23:59 local time; all-day event reminders use 09:00 local time on the start date. No background process or native Windows toast is configured, so alerts cannot arrive while the app is closed. [Tauri's notification plugin documentation](https://v2.tauri.app/plugin/notification/) notes that Windows native notifications require an installed app.

## Data protection and migration

Migration 2 adds task/focus/progression tables and reward XP; migration 3 adds events and reminder tables. Both use transactions and retain the Phase 1 `app_state` and Pip personality record. A read-only backup of the existing Phase 1 database was copied into SQLite memory, then migrated to versions 2 and 3: both `PRAGMA quick_check` calls returned `ok`; the original file remained at version 1. Rust tests cover migration from Phase 1, task reward idempotence, focus early-completion rejection, reward/unlock persistence, event CRUD, reminder deduplication, and invalid date rejection. Those tests passed in Windows CI run [41166160695](https://github.com/webswe/CivilDesk/actions/runs/41166160695). An additional copy of the original database was seeded with Phase 1 preferences, companion state, reward, achievement, and cosmetic unlock, then the shipped migration SQL was applied: schema version 3 and `quick_check=ok`; seeded rows were preserved. The original Phase 1 database hash remained `24782E5030283C0E2B03F675BA310F97A5EFFCE1E36D8A148789167E514144AF`.

## Checks performed locally

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed. |
| ESLint | `npm run lint` passed. |
| Frontend tests | `npm test` passed: 4 files, 13 tests, including onboarding regression, task CRUD, calendar CRUD, focus timestamp behavior, DST gap/overlap, quiet hours, and preview reminder deduplication. |
| Production frontend bundle | `npm run build` passed. |
| Rust formatting | `cargo fmt --all -- --check` passed using the installed Rust toolchain. |
| Rust compilation, Clippy, Rust tests | Passed in Windows CI run `41166160695`. Local compilation remains unavailable because MSVC `link.exe` is absent. |
| Native Windows application | Tauri compilation and NSIS packaging passed in CI. The Phase 2 installer was retrieved and hashed: `39B8B841195E141BA8179552A6EA11BE3F32678E1CF1B447BCD96243EE2EAD2C`. Installed-app runtime remains unverified. |
| Browser screenshots | Frontend preview only, with temporary in-memory example data: [tasks](phase2-tasks-preview.png), [calendar](phase2-calendar-preview.png), [Pip customization](phase2-pip-customization-preview.png). They do not prove native operation. |

## Native acceptance before calling Phase 2 complete

1. Build and retrieve the separately identified [CivilDesk Acceptance installer](ACCEPTANCE_BUILD.md) through the manual GitHub Actions workflow after its reviewed commit is pushed with owner approval. Confirm its installer hash and path isolation before installation.
2. Install the acceptance artifact under the existing Windows account. Use only its separate application-data directory for a synthetic version-1 database, and verify migration to version 3, onboarding/settings/Pip preservation, task CRUD, completion rewards, focus pause across restarts, cosmetic persistence, calendar CRUD, and reminder claims across restarts. Test corrupt and future-schema databases on acceptance copies only. Never modify the original Phase 1 database.
3. Test a task and timed-event reminder in an installed app across quiet hours and focus mode. Verify duplicate suppression after restarting. Confirm no alert while CivilDesk is closed. Native OS toasts are outside the current implementation.
4. Uninstall CivilDesk Acceptance and confirm its user data remains and the regular CivilDesk files and database are unchanged. Phase 1 and Phase 2 production installers both use version `0.1.0`; a genuine version-to-version upgrade still requires a newer versioned installer and has not been performed.
