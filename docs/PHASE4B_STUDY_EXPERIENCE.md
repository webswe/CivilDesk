# Phase 4B — Study Experience

Planning, Focus, progress and exam preparation on top of the Phase 4A academic foundation.

**Status:** implemented and committed locally; **not pushed**. Frontend checks pass locally. Rust compilation/tests and every native E2E spec are **pending** (no MSVC linker on this machine).

## 1. Starting state

- Branch `main`, HEAD `0f5c22e` (equal to `origin/main`), clean working tree. Schema v6.
- Verified baseline from Phase 4A: CI green (28 Rust tests), 41/41 native E2E tests, schema v6, integrity ok.

## 2. Architecture audit

| Area | Finding |
| --- | --- |
| Focus timer | `focus_sessions` is already the persistent record: `id` (primary key), `task_id` (`ON DELETE SET NULL`), `status` (`running`/`paused`/`stopped`/`completed`), planned `duration_minutes`, `elapsed_ms`, `run_started_at_ms`, `finished_at_ms`. One active session at a time (partial unique index). |
| Lifecycle | `start` inserts a running row. `pause`/`resume` move the elapsed clock. `stop` ends without completion. `complete` is accepted only while running and only once `elapsed ≥ planned duration`; completing an already completed session returns success without writing. |
| Rewards | `complete` awards 50 XP through `award()` with `reward_events UNIQUE(kind, source_id)`, so repeated or concurrent completion cannot pay twice. Task completion XP is separate (25 XP, once per task id). |
| Restart | On startup any `running` session becomes `paused` with its run clock cleared. Time since the last resume/pause is **not** added: an interrupted session can only under-count, never invent time. It can be resumed, completed (if enough time has accrued) or stopped. |
| Reading sessions | `workspace()` returns the latest 200 sessions only, so totals must not be derived from it. |
| Academic context (4A) | `task_academic` links tasks to courses; courses are never deleted. |

**Decision: reuse and extend `focus_sessions`; add no timer and no second session table.** Sessions started from academic context simply record `course_id` (and `study_block_id`); the task is already `task_id`. Because the session row is the only record, a completion cannot produce a second history row, a second time total or a second reward. A *study block* is only a plan.

## 3. Existing Focus behaviour kept (and defined for study)

| Event | Result for study |
| --- | --- |
| Start | Session row created with course/task/block context. Not counted. |
| Pause / resume | Elapsed time accrues only while running. Not counted until completed. |
| Complete (timer finished) | Counted, once. Credited time is `MIN(elapsed_ms, session length)`: it comes from the timer, never from the block's plan or from how long a finished timer was left running. |
| Complete again | Success, no change (no duplicate row, minutes or XP). |
| Stop / cancel | Not counted. |
| Close the app | Running session is saved as paused. |
| Restart | Session is paused, resumable. Unrecoverable time is not fabricated (limitation, section 17). |

## 4. Study-block model

`study_blocks`: `id`, `course_id` (FK, restrict), optional `task_id` (FK, `ON DELETE SET NULL`), `title`, `start_date`, `start_time`, `duration_minutes` (5–480), `status` (`planned` | `cancelled`), timestamps, `cancelled_at_ms`.

- **Time convention:** local wall-clock date and time strings, like task deadlines. A block's end is wall-clock start plus duration, so 22:00 stays 22:00 across a daylight-saving change, and a block that crosses midnight ends on the next local date.
- **State is derived, not stored:** `completed` when a completed Focus session links to it; `missed` when its end has passed with no such session; `upcoming` otherwise; `cancelled` is the stored soft-cancel. Missed blocks count for nothing and are never rescheduled automatically.
- **Soft cancel and history:** cancelling keeps the row (restorable). A block that has been studied cannot be cancelled or rescheduled. There is no delete.
- **Validation (Rust, mirrored in the preview store):** valid date/time, duration range, course exists and its course and semester are not archived (new plans only), and optional coursework must belong to the same course.
- Completing the linked assignment does not touch its blocks. Moving coursework to another course (or unlinking it) detaches the block from the task but keeps the block and its course.

## 5. Focus integration

`focus_action(start, …)` takes optional `course_id` and `study_block_id`. Before inserting, `resolve_focus_context` fills in missing context (a block supplies its course and task; an academic task supplies its course) and rejects contradictions (block of another course, task of another course, cancelled or missing block, missing course). Sessions started from the general Focus page with an academic task selected are therefore credited to the task's course; sessions with no academic link are ordinary Focus sessions and are not study. Entry points: a study block (My Day or Study view), a course (Start focus), coursework (existing button) and the general Focus page. The Focus page shows "Studying for CSE 1321 · objective" with a Clear button; the task selector shows course labels.

## 6. Study history

`load_study` returns blocks, goals and every completed Focus session that has a course (not capped at 200). The Study view shows recent sessions (course, coursework, credited time, finish time), with period totals for This week, Last week and All time. Planned minutes, completed minutes and completed session count are labelled separately; cancelled and missed blocks are in a collapsed section and add to neither total. Each session id is counted once in totals.

## 7. Weekly goals

`study_goals(course_id, effective_week, weekly_minutes, weekly_sessions)`: a target that applies from a Monday until a later row replaces it. A row with both targets empty means "no goal from here". Editing in the current week writes that week's row, so earlier weeks keep the target they had and history does not change. Weeks run Monday to Sunday in local time (same as the Calendar); a session counts in the week of the local day it finished. Progress is computed only from completed sessions of that course. Goals are per course; there is no generic personal-goal engine.

## 8. Exam preparation

Open quizzes and exams have a **Plan study** action that opens the block dialog with the course and the assessment preselected. The row shows "Studied N min, M min planned" (planned = upcoming blocks only; studied = completed sessions linked to that task). Study blocks never change the due date, and changing the due date does not move blocks; if a block falls after the deadline the dialog says so. No schedule is generated.

## 9. School UX

Same single sidebar entry. Compact **Overview | Study** switch under the semester bar.

- **Overview:** unchanged priorities (needs attention, courses). Study appears only as one quiet line ("Next study: … · Studied N min this week · Open Study") when there is something to say.
- **Course detail:** one line of study status with *Schedule study* and *Start focus*.
- **Study view:** Schedule study / Start a focus session; Planned study; This week (totals, per-course goal progress, Set/Edit goal); Study history; missed and cancelled blocks behind a disclosure.
- Empty states: no courses, nothing scheduled, no weekly goal, no completed sessions; none show invented numbers.

## 10. My Day and Calendar

- **My Day:** today's study blocks appear in a separate "Study blocks today" list (time, objective, course, Start; blocks whose time has passed say "Earlier today"); upcoming blocks appear in Coming up with a "Study" label. They are never tasks, never overdue, and studied or cancelled blocks are omitted. My Day's task hierarchy and "Next up" are unchanged.
- **Calendar:** blocks are projected from the study-block record (no events are stored), with their own teal chip, in the month/week/day grid and the day detail, where clicking opens the block in School's Study view. Cancelled blocks are hidden. Blocks crossing midnight appear on both dates.

## 11. Pip

No Pip code changed. Study-session completion uses the existing Focus reward (50 XP, once per session id). Cancelling blocks, viewing progress and restarting award nothing. There are no new achievements or cosmetics.

## 12. SQLite migration (v6 → v7)

`migrate()` gains a `version < 7` block (one `BEGIN IMMEDIATE … COMMIT`): creates `study_blocks` and `study_goals`, adds `focus_sessions.course_id` (`ON DELETE RESTRICT`) and `focus_sessions.study_block_id` (`ON DELETE SET NULL`), indexes, `user_version = 7`. The "newer than supported" guard is now 7. Existing rows are untouched; old Focus sessions get `NULL` context (they are not guessed into courses). Because courses are never deleted and sessions keep `course_id` independently of tasks, history survives task completion, task deletion and course/semester archiving.

## 13. Database upgrade verification

| Check | How | Result |
| --- | --- | --- |
| v6 → v7 SQL, constraints, FK behaviour | Real SQLite (3.49.1) on disposable files, SQL extracted from `persistence.rs` | **Run locally: pass** (version 7, `quick_check` ok, `foreign_key_check` empty, existing session untouched, check/FK constraints behave, task delete nulls links) |
| Rust migration tests (`study::tests::migration_from_v6…`, updated version assertions) | `cargo test` | written, **not run locally** |
| **File-based v5 → v7 through the real application** (Phase 4A gap) | `e2e/lib/fixture.mjs` builds a genuine v5 database from the app's own migration SQL, seeds tasks (School, legacy category, Personal, engineering-linked, completed), a project and milestone, a calendar event, a finished Focus session and Pip rewards/achievements, and writes it into the disposable E2E folder **before the app launches** (`onWorkerStart`, only for a spec named `*upgrade-v5*`). Spec `08-upgrade-v5` then checks the UI and IPC, adds academic/study data, restarts. The harness's post-run check records version, `quick_check` and (new) `foreign_key_check`; `verify-results` fails on any violation or wrong version. | fixture builder verified locally by unit tests (genuine v5, expected rows, FK-clean, refuses to overwrite, writes only under the E2E identity folder); **native run pending** |

The guard code was not weakened: the fixture goes through `assertDisposable`/`assertE2eDatabase`, and only the E2E identity folder is touched. No production or Acceptance database was opened.

## 14. Tests and actual results

Local (executed here):

| Check | Result |
| --- | --- |
| `tsc -b` | pass |
| `eslint .` | pass, 0 warnings |
| Vitest | **121 passed** in 22 files (was 90): +15 study domain, +8 study services, +3 study UI/integration, +4 fixture, +1 verify-results |
| `vite build` | pass |
| `npm run check:e2e-isolation` | pass (`com.webswe.civildesk.e2e`) |
| `cargo fmt --check` | pass |
| SQL migration/constraints on real SQLite | pass (section 13) |

**Not executed locally:** `cargo check`, `cargo clippy`, `cargo test`, and all native E2E. New Rust tests (10 in `study.rs`) cover: block create/edit/reschedule/validation, soft cancel and restore, session context and timer-based credit, idempotent completion with a single XP award, stopped/general sessions not counting, rejected inconsistent context, goal rules and history, history surviving task deletion and course archive, block detachment when coursework moves, and v6 → v7 preservation and repeatability. The earlier Phase 4A lesson applies: a clean local TypeScript run says nothing about Rust, so CI must compile it before anything is trusted.

Covered by the Vitest suites: week and midnight/DST boundaries, session-week assignment, planned versus completed separation, goal versioning, exam preparation totals, My Day and Calendar projections, archived-course rules, cancel/restore, validation messages, and a full browser-preview flow that finishes a session through the real Focus code path.

## 15. Native E2E readiness

Existing specs 01–07 are untouched (41 tests). New:

- `08-upgrade-v5.e2e.mjs` (5 tests): section 13.
- `09-study.e2e.mjs` (8 tests): empty states; plan study for an exam (deadline unchanged); My Day and Calendar projection; start Focus from a block with context; **a real one-minute Focus session** run to completion by the application's own timer (no fabricated session), with recorded credit of exactly 60 000 ms and a single 50 XP reward; School totals, history and weekly goal; persistence after restart; soft cancellation.

Expected total: **54 tests**. The only long wait is the one-minute timer (test timeout 150 s). Nothing in the Windows Server 2022 / tauri-driver / EdgeDriver / backup-API setup changed; the only harness changes are the guarded fixture hook and the foreign-key check.

## 16. Screenshots (browser preview only)

`docs/phase4b/` — headless Edge against the Vite dev server with the in-memory preview store. **These are browser previews, not native Windows results.** Included: block dialog, School overview with exam preparation, Study view, My Day, Calendar, Focus started from a block, goal dialog, Study view after a real one-minute session (progress and history), and a 700 px window.

## 17. Known limitations

- Rust and native behaviour are unverified until CI and the Windows runner run.
- Time between the last pause/resume and an application close is lost, so an interrupted session under-counts rather than inventing time (existing Focus semantics).
- Study blocks are single events: no recurrence and no automatic rescheduling of missed blocks.
- Blocks and goals are per course; the Focus page's course context is cleared by navigating elsewhere.
- Moving coursework to another course detaches its study blocks from the task (blocks stay on their original course).
- A block time that has already passed can still be saved (useful for logging a plan late); it shows as missed.
- Calendar shows blocks as chips; it has no hourly time grid.
- The preview store does not model Focus XP (native tests cover it).

## 18. Git

See the final report. Author/committer `webswe <botaa109@gmail.com>`, no attribution trailers, nothing pushed, no release published.

## 19. Remaining native acceptance

1. Owner-approved push, then CI: `cargo fmt`, `clippy -D warnings`, `cargo test` (new `study::tests`), packaging.
2. Native E2E `suite=full`: expect 54 tests across specs 01–09, schema v7, `quick_check` ok, no foreign-key violations (the verifier prints and enforces this).
3. Review the upgrade spec's result specifically; it is the first file-based migration proof.
