# Phase 4C — Personal Productivity

Goals, habits, routines, recurring responsibilities, daily priorities and a weekly review, built into the existing Personal section.

**Status:** implemented and committed locally; **not pushed**. Frontend checks pass locally. **Rust compilation, Clippy, Rust tests and every native E2E spec are pending**: this machine has no MSVC linker (Git's `link.exe` shadows it), so nothing that links a Rust binary could run. Nothing below claims otherwise.

## 1. Starting state

- Repository `C:\Users\Alejandro\Documents\GitHub\CivilDesk`, branch `main`, HEAD `37fe5ed`, clean working tree, no divergence from `origin/main` (`git fetch --dry-run` reported nothing).
- Verified baseline from Phase 4B: Windows CI green, 38 Rust tests, 54/54 native E2E, schema v7, upgrade v5→v7 passed.
- Schema version confirmed from source: `PRAGMA user_version = 7` was the last migration in `persistence.rs`.

## 2. Architecture audit

| Area | Finding | Consequence |
| --- | --- | --- |
| Personal page | Not a separate feature: `TasksPage` scoped to the `personal` area. An area is derived from the free-text `category` (`taskArea`). | Personal stays the home of the task list; new features sit beside it as in-page tabs. |
| Tasks | One `tasks` table. Completion goes through `set_task_completed` (25 XP, once per task id via `reward_events UNIQUE(kind, source_id)`). | Recurring occurrences are ordinary rows in this table. No second task system, no second completion state. |
| My Day | `buildAgenda` from tasks/events/challenges; Phase 3B.2 layout. | Extended with two compact sections; the agenda function and "Next up" are untouched. |
| Calendar | Projects tasks, events, milestones and study blocks from their own records; stores nothing for them. | Occurrences appear as tasks on their dates. Scheduled routines are projected the same way (no stored events). |
| Focus | `focus_sessions` is the single timer record, started with an optional task. | Personal priorities start Focus through the same call. No new timer, history or reward. |
| Pip | `award()` is idempotent and the only XP path. | No new reward events in this phase (section 11). |
| Migrations | Version-ordered `execute_batch` scripts, each in its own transaction. The E2E fixture extracts them from `persistence.rs`. | v8 follows the same shape, so the real-upgrade fixture builds v7 from the application's own SQL and the app upgrades it. |
| Preview store | Every service has a browser-preview mirror, and the Vitest App tests run on it. | The new service has a mirror; its tests assert the same invariants as the Rust tests. |

**Decision:** extend the existing services (tasks, Focus, Calendar, My Day). New tables hold only what has no home yet. Nothing duplicates a task or a completion.

## 3. Goals

`goals` (`binary` | `numeric` | `periodic`), `goal_targets`, `goal_entries`. A `CHECK` ties type to shape: binary has no target or period, numeric has a target, periodic has a target and a period (`daily` | `weekly` | `monthly`).

- **Progress is a list of entries**, not an editable total. Each entry has a date, a positive whole amount (`CHECK 1..1,000,000,000`), a note and an id; the id makes a repeated submit a no-op. Entries are never edited. A mistake is corrected by **voiding** the entry (it stays as history, flagged "Removed") and logging the right amount. Totals are the sum of non-voided entries, so they can never go negative.
- **Numeric** goals show a running total against the target. Reaching the target shows "target reached"; the goal is completed only when the user marks it.
- **Periodic** goals measure only the period that contains today. A new period starts at zero and earlier periods keep their own total and target (an "Earlier weeks" list).
- **Target changes:** `goal_targets(goal_id, effective_from, target)`. Editing a periodic target writes a row for the start of the *current* period; earlier periods keep what applied. A goal's type and period cannot change after creation.
- **Binary** goals: Complete / Reopen. Periodic goals cannot be completed (pause or archive them).
- Status: active, paused, archived, completed. Paused and archived goals cannot take progress. Nothing is deleted.
- No goal is ever completed because a task was; goals have no task link in this phase.

## 4. Habits

`habits`, `habit_schedules` (effective-dated), `habit_checkins` with `PRIMARY KEY(habit_id, occurrence_date)`.

- **Check-in** is idempotent by construction (one row per habit per day; `INSERT OR IGNORE`). Undo deletes the row; undoing a missing check-in changes nothing. Check-ins can be added for today or up to 30 days back, not for the future, not before the habit's start date, and only while the habit is active. A missed day creates nothing.
- **Schedule:** daily, or weekly with 1–7 days and optional preferred days (a hint only). Editing writes a schedule row effective from the **Monday of the current week**, so earlier weeks keep the schedule they had. Archived habits keep all history and cannot be edited.
- **Consistency rules** (`domain/personal.ts`, unit-tested with a fixed date):
  - *Daily habit:* current streak = consecutive days ending today; **a pending today does not break it** (it counts once done, and a missed yesterday breaks it). Best streak and total check-ins are shown separately. Adherence = check-ins ÷ days elapsed in the last 14 days, never counting days before the habit started.
  - *Weekly habit:* a week is met when its distinct check-in days reach that week's target. Streak = consecutive met weeks; the current week counts if met and is otherwise pending, not broken. A weekly habit is **not** broken by quiet days. A partial first week (the habit began mid-week) counts if met and is otherwise neutral. Adherence = met ÷ finished weeks (last four).
  - *Schedule changes:* a streak is measured in the unit of the **current** schedule (days or weeks) and starts at the switch, so unlike units are never mixed. Past check-ins still count in the total.
  - When nothing is expected yet, adherence is hidden instead of invented.
- Pausing does not freeze a streak (no pause history is recorded; see limitations).

## 5. Routines

`routines`, `routine_steps`, `routine_executions` with `UNIQUE(routine_id, occurrence_date)`, `routine_execution_steps`.

- A routine is an ordered checklist (1–40 steps) with an optional usual schedule (days, plus a time that requires days). Steps can be added, edited, removed and reordered.
- **Steps are not tasks** and create no tasks. (An explicit task link was feasible but deferred; see limitations.)
- **A run has its own identity** and **copies the steps when it starts**, so editing the routine later never changes a run already done or in progress. There is one run per routine per day: starting again returns the existing run with its progress, and starting today never touches yesterday's.
- Checking a step saves immediately, so **partial progress survives** closing the app. A run is **completed only when every step is checked**; completing twice changes nothing; a completed run is read-only. A partly done run stays "In progress" (and is shown as partly done in history).
- Routines can be paused or archived; history is kept.

## 6. Recurring responsibilities

`recurrence_rules` (the template) and `recurrence_occurrences` with `PRIMARY KEY(rule_id, occurrence_date)` and a unique index on `task_id`. Each occurrence is an **ordinary task** with a deterministic id `rec-<rule>-<date>`, category `Personal`, and the rule's title, priority, due time and reminder.

- **Rules:** daily; weekly on selected weekdays; monthly on a day 1–31. Optional start date, end date and due time. No yearly rule (it did not fit cleanly) and no RFC 5545 engine.
- **Bounded generation:** only `today` through a short horizon exist as tasks — **daily 2 days, weekly 14 days, monthly 35 days** ahead. Occurrences before today are never created, so an app left closed for months creates no backlog. `generate_recurring(today)` is idempotent and runs on startup, after every rule change, and when the local date changes while the app is open. Creation is transactional, and `(rule, date)` uniqueness prevents duplicates.
- **Monthly on the 29th/30th/31st:** the occurrence falls on the **last day of shorter months** (31st → Feb 28/29, Apr 30). It never skips a month and never spills into the next, so a deadline does not move unpredictably.
- **Complete:** the normal task checkbox. It completes only that occurrence; the others stay open. XP is the ordinary once-per-task reward.
- **Skip:** removes the open task and records the date as skipped so it is not generated again. It never counts as completed and pays nothing. A completed occurrence cannot be skipped. A skipped date from today onward can be **restored**.
- **Pause / end:** removes open future occurrences (today's task, completed work and skips stay). An ended rule cannot restart.
- **Edit:** text-only edits (title, notes, priority, reminder) update the open future tasks in place. Schedule edits (frequency, weekdays, day, dates, due time) re-plan the **open future** occurrences; completed and past ones are kept.
- A task the user deletes is treated as removed and is not recreated.
- Academic and engineering tasks are never converted; occurrences are always Personal.

## 7. Daily priorities

`daily_priorities(plan_date, task_id, position)`. `set_daily_priorities(date, ids, today)` replaces a day's list and is the one idempotent call behind choose, reorder and remove. At most **5**, no duplicates, only open tasks, only today and the next 7 days (earlier days are history). It never reads or writes the task itself, so a priority **never changes a due date or completion**, and removing one keeps the task. Deleting a task drops it from the plan. "Unfinished from your last plan" offers open tasks from the most recent earlier plan; nothing is carried over automatically.

## 8. Weekly review

`weeklyReview` in `domain/personal.ts`, shown on the Personal **Week** tab (with previous/next week). Counted only from authoritative records for the Monday–Sunday week: personal tasks completed (by local completion day), priorities planned and finished, habit check-ins against what was expected, routine runs completed or partly done, goal progress logged (voided entries excluded) and goals completed, and open personal tasks (overdue / due this week). Scheduled-but-unfinished work counts as nothing. School and Engineering are not included, and the page says so. With no activity it shows an explanatory empty state.

## 9. My Day

Layout unchanged (Next up → Today → Coming up). Two compact sections were added: **Today's priorities** under Today (complete, start Focus, reorder, remove, add) and **Habits and routines** in the side column (only habits still due and routines scheduled or unscheduled today; hidden when empty). A task that is both due today and a priority is listed once (under priorities). A priority due tomorrow is not shown as due today; it still appears in Coming up with its real due date.

## 10. Calendar and Focus

- **Calendar:** occurrences are tasks, so they appear on their actual dates; completing one removes it, as for any task. Personal tasks can be opened from the day detail ("Open … in Personal"). A routine with usual days **and** a time is projected onto those days with its own chip and opens the Routines tab; routines without a time, habits, goal dates and priorities never appear. No events are created.
- **Focus:** priorities have a **Focus** button using the existing `focus_action` with the task id. No timer, session table, history or reward was added. A goal-to-Focus association was not added (it would need a link that doesn't exist yet).

## 11. Pip

No Pip code, reward kind, achievement or cosmetic changed. Task completion (including a recurring occurrence) keeps its once-per-task 25 XP; Focus keeps its 50 XP. Habit check-ins, undoing them, goal entries and edits, routine runs and skipping or restoring occurrences award **nothing**, so none of them can be farmed. Finishing a routine or checking in a habit triggers the existing quiet `TASK_COMPLETED` reaction (it respects quiet mode, focus mode and the 60-second cooldown). No Pip panel was added to My Day.

## 12. SQLite v8 migration

`PRAGMA user_version` 7 → 8, one transaction. New tables: `goals`, `goal_targets`, `goal_entries`, `habits`, `habit_schedules`, `habit_checkins`, `routines`, `routine_steps`, `routine_executions`, `routine_execution_steps`, `recurrence_rules`, `recurrence_occurrences`, `daily_priorities`. No existing table is altered.

- Parents of history are `ON DELETE RESTRICT` (goals, habits, routines, rules are archived or ended, never deleted); `routine_execution_steps` cascade only from their own run; `daily_priorities` cascade from the task (it is a plan, not history); `recurrence_occurrences.task_id` is `SET NULL` so history of a skip or removal survives a deleted task.
- Indexes on goal entries, routine steps and priorities by date; a unique partial index on occurrence `task_id`.
- Verified locally in Node SQLite against the application's own migration SQL (extracted from `persistence.rs`): constraint rejections (binary with target, periodic without period, amount ≤ 0, daily with target 3), unique occurrence and run keys, restrict on deleting a habit with history, `ON CONFLICT` target upsert, idempotent step completion, `PRAGMA foreign_key_check` clean, and a pre-existing task category untouched.
- The "newer schema" test now uses version 9. A Rust test builds a genuine v7 file (drops every v8 table, sets version 7), reopens it, and checks tasks, category, XP, `quick_check`, `foreign_key_check`, version 8 and repeated initialization. The E2E fixture builds v5 from the application's own SQL; the app upgrades it through v8, and `db.mjs`/`verify-results.mjs` derive the expected version from `persistence.rs` automatically (now 8).

## 13. Date and time semantics

- All dates are local `YYYY-MM-DD` strings; "today" is passed in by the caller (the frontend uses its local date). Rust never reads the clock for these rules, so every rule is deterministic and tested with fixed dates. `dates.rs` and `domain/dates.ts` implement the same civil-date arithmetic (UTC day numbers; no instants), so **daylight-saving changes cannot skip or repeat a day**.
- Weeks run **Monday–Sunday**, like the Calendar and the Study goals; months are calendar months; a daily period is one local day.
- Check-ins and goal entries belong to the local day they are dated, never to a UTC day.
- Due times are wall-clock strings, as for every task; reminders keep using the existing DST-aware conversion.
- Tested: month and year boundaries, leap day and non-leap February, the 29th/30th/31st rule, week transitions (a Sunday belongs to the week that began the previous Monday), clocks-change weekends, a three-month absence, and period history across a period change.

## 14. Tests performed and results

Run locally on 2026-11-01:

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc -b`) | pass |
| `npm run lint` (ESLint) | pass, 0 warnings |
| `npm test` (Vitest) | **26 files, 165 tests pass** (includes the 5 E2E helper files, 27 tests) |
| `npm run build` | pass (the bundle is now ~503 kB, just over Vite's 500 kB advisory) |
| `node scripts/check-acceptance-config.mjs` | pass |
| `npm run check:e2e-isolation` | pass (`com.webswe.civildesk.e2e`) |
| `cargo fmt --check` | pass |
| `cargo check` / `clippy` / `cargo test` | **not run**: no linker (build scripts fail to link). Not retried, per instructions. |
| Native E2E | **not run** (needs Windows CI) |

New automated tests:

- **Rust (written, unexecuted):** 4 in `dates.rs` and 12 in `personal.rs` — goal validation and auditable entries; goal status rules and manual completion; periodic target history; habit idempotency and undo; habit schedule history; routine run uniqueness, partial progress and snapshotting; bounded generation with no duplicates and no backlog; weekly and monthly dates incl. Feb; completing vs skipping with XP checks; edit/pause/end re-planning; priorities not touching tasks; the genuine v7→v8 upgrade. Expected total 54 (38 + 16). The pure date module was type-checked locally with `rustc --emit=metadata`; the rest was formatted by rustfmt, which confirms it parses, but it has **not** been compiled.
- **Vitest:** `domain/dates.test.ts` (7 incl. DST and monthly edge cases), `domain/personal.test.ts` (goal periods and history, streaks, adherence, schedule change, carry-over, review), `services/personal.test.ts` (11, the preview mirror asserting the same invariants as Rust), `PersonalPage.test.tsx` (9 end-to-end UI flows on the real App: empty states, goal progress and correction, habit toggle + My Day, routine partial progress across navigation, recurring complete/skip, priorities not changing due dates, My Day de-duplication, weekly review, Calendar routine).
- The existing App tests needed no change. One product change was made because of them: the add-priority list labels every option with a due-date suffix so task titles are not repeated as bare text.

## 15. Native E2E coverage (prepared, not executed)

`e2e/specs/10-personal.e2e.mjs` (8 tests) uses the real UI and the app's own commands, and verifies persistence after a real restart: empty states; create a goal and record progress; backend rejection of 0 and negative progress; create a habit, check in, and prove repeated check-ins stay at one; create a routine, check a step (partial progress persisted), finish, and a second completion changes nothing, with no tasks created for steps; create a daily recurring responsibility (exactly 3 bounded occurrences with distinct dates) and complete one without completing the others; choose a priority with the due date unchanged and see it in My Day (not as due today); restart, check every record persisted, occurrences did not duplicate, and **Pip XP is exactly 25 with a single `task_completed` event**. `08-upgrade-v5` gained one test (v8 tables empty after upgrade, new goal/recurrence/priority accepted and kept after a restart, old tasks unchanged). The expected schema version in every spec's post-run database check is now 8 automatically. Expected native total: 54 + 9 = **63**. The infrastructure (tauri-driver, EdgeDriver, isolation guard, backup-API inspection, JUnit) was not changed.

## 16. UI evidence

No screenshots were captured this phase (the browser preview was not driven). The behaviour is evidenced by the UI tests above. Any screenshot added later must be labelled a browser preview; none claims native verification.

## 17. Known limitations

- Rust compile, Clippy, Rust tests and all native E2E are unverified until Windows CI.
- Pausing a habit does not freeze its streak; no pause history exists.
- Goals have no task link and routine steps have no task link; goal→Focus is not provided. These were deferred rather than half-built.
- Goal quantities and targets are whole numbers.
- Recurrence: no yearly rule; the horizon is fixed (2/14/35 days); a schedule edit re-plans open future occurrences, including any manual edits made to those tasks; future skips stay skipped (they only matter if the date still matches the rule).
- A routine run can only be completed with every step checked, and a completed run cannot be reopened.
- Priorities: max 5; today through the next 7 days; a deleted task leaves the plan.
- The weekly review covers Personal only.
- The browser-preview store reproduces the rules but is not the authoritative backend.
- The 60-second day-change check means occurrences appear within a minute of local midnight.

## 18. Git commits

On `main`, author and committer `webswe <botaa109@gmail.com>`, no attribution trailers:

1. `d37c1b5` Add schema v8 with goals, habits, routines, recurring task rules and daily priorities
2. `1be0cf7` Build the Personal workspace: goals, habits, routines, recurring tasks, daily priorities and weekly review
3. Add native E2E spec for personal productivity and extend the upgrade spec for schema v8
4. Document Phase 4C (this file and the acceptance-testing notes)

## 19. Remaining acceptance requirements

1. Owner approval to push, then Windows CI: `cargo clippy`, `cargo test` (expect 54), `cargo fmt --check`, frontend checks, NSIS packaging.
2. Native E2E: the existing 54 must still pass unchanged, plus the 9 new tests (expect 63), and the post-run database checks at schema v8.
3. Spot-check on a Windows build: create a recurring rule across a month end, restart the app on a later day, and confirm no backlog and no duplicate tasks.
4. Do not start Phase 4D until this is accepted.
