# Phase 4A — Academic Foundation

Semesters, courses, and coursework (assignments, quizzes, exams) for CivilDesk's School section.

**Status:** implemented and committed locally; **not pushed**. Frontend checks pass locally. Rust compilation, Rust tests and the native Windows E2E run are **pending** (no MSVC linker on this machine; see section 17).

## 1. Starting repository state

- Branch `main`, HEAD `3f0905d` ("Inspect the E2E database through SQLite's backup API after verified shutdown"), working tree clean.
- SQLite schema version **5** (verified in `persistence.rs`: `if version > 5` guard and `PRAGMA user_version = 5` as the last migration).
- Baseline: 69 Vitest tests, native E2E suite of 32 tests (specs 01–06) previously green on windows-2022.

## 2. Architecture audit

| Area | Finding |
| --- | --- |
| Tasks | One `tasks` table. Fields: title, description, free-text `category`, priority, `due_date`/`due_time` (local, date-only allowed), subtasks as JSON, reminder offset, `completed_at_ms`, `first_completed_at_ms`, optional `project_id`. |
| Area classification | There is no area column. `taskArea(category, hasProject)` derives School / Personal / Engineering from the category text, so legacy custom categories keep working. |
| Completion & XP | `set_task_completed` is the only completion path. It awards 25 XP via `reward_events UNIQUE(kind, source_id)` and `first_completed_at_ms`, so reopening and re-completing never pays twice. |
| My Day | `buildAgenda` is a pure function over the task list: overdue / due today / upcoming (7 days) / next. |
| Calendar | Projects open tasks by `dueDate` at render time. No duplicate events are stored for tasks. |
| Focus | `focus_sessions.task_id` references `tasks`; the page takes an initial task id. |
| Engineering link | `tasks.project_id` is a nullable foreign key: the established pattern for "metadata attached to a task". |

**Decision.** Academic data uses the same pattern as projects: an optional side table linked 1:1 to `tasks` (`task_academic`). The task stays the single record of title, deadline, priority, steps and completion; `task_academic` only says *which course* and *what type*. I chose a side table over extra nullable columns on `tasks` so the `tasks` schema (and every existing query) is untouched, and so the cascade rules are explicit. Because completion lives only on the task, School, My Day, Calendar, Focus and Pip cannot disagree.

## 3. Academic data model

```
semesters 1 ── * courses 1 ── * task_academic 1 ── 1 tasks (existing)
```

- **semesters**: `id`, `name`, `institution`, `start_date`, `end_date`, `is_active`, `archived`, timestamps. `CHECK(end_date >= start_date)`, `CHECK(NOT (is_active AND archived))`, partial unique index so **at most one** semester is active.
- **courses**: `id`, `semester_id` (FK, `ON DELETE RESTRICT`), `code`, `name`, `instructor`, `description`, `meeting_schedule`, `location`, `color`, `archived`, timestamps. Unique `(semester_id, code COLLATE NOCASE)`: the same code may exist in different semesters but not twice in one.
- **task_academic**: `task_id` PK → `tasks(id) ON DELETE CASCADE`, `course_id` → `courses(id) ON DELETE RESTRICT`, `work_type` in `assignment | quiz | exam | general`, `reference_notes`, `created_at_ms`.

Courses are always identified by id, never by name or code. There is no delete command for semesters or courses (only archive), and the foreign keys would refuse it anyway while coursework exists.

## 4. SQLite migration (v5 → v6)

`migrate()` gained a `version < 6` block (single `BEGIN IMMEDIATE … COMMIT`, sets `user_version = 6`). The "newer than supported" guard now rejects versions above 6. No existing table is altered, so tasks, calendar events, engineering projects/challenges, Pip data and categories are untouched by construction. Historical School tasks are **not** converted into invented courses: they stay as unassigned School tasks.

Verification actually performed on this machine (disposable databases in `%TEMP%`, with SQLite 3.49.1; the SQL was extracted from `persistence.rs`):

- Fresh database creation reaches v6, `quick_check = ok`.
- A genuine v5 database seeded with tasks, an engineering project and a reward event upgraded to v6 with all rows intact, `quick_check = ok`, `foreign_key_check` empty, and three empty academic tables.
- Constraint behaviour confirmed: reversed dates rejected; second active semester rejected; active+archived rejected; duplicate course code in a semester rejected (case-insensitive) but allowed across semesters; unknown semester rejected; invalid work type rejected; second link for one task rejected; deleting a course or semester with dependents blocked; deleting a task removes only its link.
- The `save_task` upsert keeps the category of an academic task when a generic form tries to change it.

The Rust unit tests that exercise the same behaviour through the real code (`academic.rs` tests, updated version assertions in `persistence.rs`, including a v5→v6 upgrade run twice for idempotency) are written but **have not been executed** (section 17). Production and Acceptance databases were never opened.

## 5. Semesters

Create, edit, archive/restore, switch (selector), and explicitly set active. Dates are validated in the form and again in Rust. The active semester shows an "Active semester" tag. Saving or editing never changes which semester is active. The only automatic behaviour: the *New semester* dialog pre-ticks "Make this the active semester" when no semester is active yet; the user can untick it. Archiving deactivates the semester but keeps courses and coursework; archived semesters stay selectable (grouped under "Archived") and refuse new courses.

## 6. Courses

Code, name, optional instructor, location, meeting schedule, description, colour (six Rosewood-compatible swatches), archive/restore, move to another non-archived semester. **Meeting schedule is a plain note.** Reliable recurring schedules would need a second recurrence engine or silent Calendar events, both ruled out by the brief; schedule → Calendar integration is documented as a later enhancement (section 16).

## 7. Coursework

Created from the course (or the School header). Type, course, due date/time, priority, reminder, instructions, reference notes, steps (existing subtasks). Edit, complete/reopen (the shared task toggle), move between courses (change the Course field), delete.

- New coursework is filed under category `School`. An existing task assigned to a course keeps its stored category (no silent reclassification), and the app treats linked tasks as School work regardless of category.
- Editing an academic task from a generic form cannot change its category (`upsert_task` keeps it).
- Undated coursework is valid, sorts last, and is never overdue or due today.
- Unassigned School tasks remain in the "Other school tasks" list on the School page with an **Add to course** action.

## 8. School screen

Same single sidebar entry. Top: semester selector, active tag, edit/archive, *New semester / Add course / Add coursework*. **Needs attention** is one ordered list (overdue → today → next 14 days; first row tagged "Next"); each item appears once. **Courses** are compact cards with open count and next deadline, followed by a one-line progress summary. A collapsed section holds completed work and archived courses. Below, the existing task list is kept as **Other school tasks** (it excludes linked coursework, so nothing is duplicated). A course opens a detail view with filters Open / Assignments / Quizzes & exams / Completed. Empty states exist for no semesters, no courses, no coursework, no upcoming deadlines and nothing completed; none show invented data.

## 9. My Day

No new widget. Coursework flows through `buildAgenda` unchanged, so due-today, overdue, Coming up and "Next up" behave exactly as for other tasks. Academic items carry a subtle label ("Exam · CSE 1321") that opens the item in its course. Completing from My Day uses the existing handler.

## 10. Calendar

Open coursework appears on its due date through the existing task projection (no stored events). Chips read "Exam · title" / "Quiz · title" / "Assignment · title" with distinct colours for exams and quizzes; the day detail links to the course. Completed work is hidden, the existing convention for all tasks. Personal events are untouched.

## 11. Focus

Each open coursework row has *Start focus*. It sets the same initial task id and opens the existing Focus page; the task dropdown and recent-session list show the course label ("Lab 2 (Assignment · CSE 1321)"). No separate timer.

## 12. Pip

No Pip code changed. Completion goes through `set_task_completed`, which awards 25 XP once per task id. Tests confirm complete → reopen → complete yields 25 XP, from both the Rust store and the preview store, and the App test confirms completing in My Day then re-completing from the course view still totals 25 XP.

## 13. Tests

Local (all run on this machine):

| Check | Result |
| --- | --- |
| `tsc -b` | pass |
| `eslint .` | pass, 0 warnings |
| Vitest | **90 passed** (was 69): +8 domain, +7 service, +6 component/integration |
| `vite build` | pass |
| `npm run check:e2e-isolation` | pass (`com.webswe.civildesk.e2e`) |
| `cargo fmt --check` | pass |
| v5→v6 migration + constraints on real SQLite | pass (section 4) |

New tests cover: semester creation/switching/archiving, course associations and same-code courses across semesters, assignment/quiz/exam types, completion synchronisation and single XP, unassigned School tasks, deadline ordering and undated work, My Day and Calendar projections, course switching, archive behaviour, category preservation, and in-dialog validation errors.

**Not run locally:** `cargo check`, `cargo test`, `cargo clippy` (cannot link: no MSVC). I reviewed the Rust by hand for type and borrow issues, but it has not been compiled, so treat it as unverified until CI or the Windows runner builds it.

## 14. E2E (prepared, not executed)

`e2e/specs/07-academic.e2e.mjs` (9 tests) uses existing helpers and the E2E-only identity. Flow: empty state → create semester → create course → create exam and assignment → School list → My Day (today + Coming up + label) → Calendar chip → Start focus preselection → complete from My Day → School, Calendar and course view agree → IPC check of one task, one link, one XP event → restart the app → data persists. Specs 01–06 are unchanged and the School page still exposes the controls they use (`New task`, `Filter tasks`, the Area field). The isolation guard and workflow files were not modified. The expected schema version is read from `persistence.rs`, so the existing result verifier now expects 6.

## 15. Existing functionality preserved

School "New task", search/filter/sort and completion remain; Personal, All tasks, Engineering, Pip, Focus and reminders are unchanged; the sidebar has no new entries. Legacy categories such as "Math homework" still classify as School and are not rewritten.

## 16. Known limitations

- Rust code is uncompiled and untested locally (section 17).
- Meeting schedule is free text; no Calendar integration yet.
- Coursework has no delete-course or delete-semester path (archive only).
- Calendar hides completed work (existing convention).
- "Needs attention" covers the viewed semester's non-archived courses; overdue work in an archived course is still shown in My Day and Calendar but not on the School overview.
- Reminders for coursework reuse the existing task reminder offsets (None / at due time / 1 hour / 1 day).
- The unassigned-task list still exposes the generic task dialog, whose Area field can move an unassigned task out of School; linked coursework is protected.

## 17. Native acceptance requirements

Before treating Phase 4A as accepted, on the Windows runner (after owner-approved push):

1. CI: `cargo fmt`, `cargo clippy`, `cargo test` (new `academic::tests`, updated `persistence::tests`).
2. Manual `e2e-windows` workflow: expect specs 01–07 green (32 existing + 9 new tests).
3. Optionally, with a copy of a v5 Acceptance database: install the Acceptance build, confirm v6, existing data present, School shows old School tasks as unassigned.

## 18. Evidence

Screenshots in `docs/phase4a/` are **browser-preview captures** (headless Edge against the Vite dev server, in-memory preview store), **not native Windows acceptance results**: `01-school-empty`, `02-semester-dialog`, `03-school-overview`, `04-coursework-dialog`, `05-course-detail`, `06-my-day`, `07-calendar`, `08-school-narrow` (700 px). In the screenshot data, all coursework is under CSE 1321 only because the capture script used the default course.

## 19. Git

See the final report for commit hashes. Author/committer `webswe <botaa109@gmail.com>`, no attribution trailers, nothing pushed, no release published.
