# Phase 6B.3 — Assignment to Study planning

## Existing integration points

The Assignment Calendar projects local School coursework and in-memory synthetic Brightspace assignments into one view. Local coursework retains its `taskId` and local course ID. Synthetic rows retain portal origin, course ID, and assignment ID in their calendar key. The existing School Study view owns `BlockDialog`, `saveStudyBlock`, and `StudyView`. A saved block contains a local course ID and optional local task ID. `StudyView` starts Focus through the existing `startStudy` path, which carries the block, course, and task context into the existing Focus lifecycle. The Focus completion path remains the sole writer of credited study time and Pip XP.

## Handoff and confirmation

Each assignment detail has **Plan Study Session**. For a local assignment, School rechecks the authoritative task-to-course link, verifies that the course and semester are writable, then opens the existing Study Planner dialog. The dialog names the CivilDesk local source, course, and available due date/time. The objective is prefilled from the title (limited to the existing 120-character input), while the exact local task ID remains the persistent link. The student chooses a study date, start time, and duration; date and time start blank. Selecting the assignment or opening the dialog creates nothing. Only **Save study block** calls the existing study-block writer. Cancel creates nothing. Study shows the saved block and offers a back link to the originating assignment while that local item remains available. Starting Focus is a separate user action.

The existing study-block schema has no notes field; the objective field is available. No migration was needed. The assignment due date stays context in the calendar and coursework selector. It is never copied into the study schedule. Local study dates and times use the planner's existing local wall-clock convention.

## Synthetic boundary

The local study writer requires a local course row and validates local coursework links. A synthetic Brightspace assignment has neither, so its action opens an in-memory planning preview with fictional source attribution and manually chosen date, time, and duration. It never calls `saveStudyBlock`, creates local coursework, or starts Focus. The preview disappears on close or restart. The source key distinguishes portal, course, and assignment, including duplicate titles and IDs in different courses. A Brightspace deadline without a verified timezone remains labeled unverified and is never used as a study time. Missing deadlines are supported.

Future live-source planning would need separate owner authorization, a reviewed live assignment contract, and an explicit provenance-aware local planning model. This milestone does not enable real account access, academic import, synchronization, CLI permissions, or changes to Grades and Announcements.

## Persistence and verification

Confirmed local study blocks persist through the existing SQLite schema v10. Planned time never credits Focus time or XP. Focus start, pause, resume, stop, completion, and rewards stay in the existing lifecycle. No source assignment or global Calendar event is duplicated; the existing study-block projection supplies the planned Calendar entry.

The frontend handoff tests cover local identity, long titles, explicit action, synthetic preview, and cancellation. Native E2E covers local confirmation and persistence, Focus navigation without automatic session creation, synthetic nonpersistence, restart clearing, and narrow WebView2 screenshots of the local dialog and synthetic preview. The full regression suite and per-specification SQLite integrity and foreign-key checks provide the remaining baseline evidence. Windows briefly held the isolated E2E profile folder after application exit during verification, so the harness now uses Node's bounded retry for deletion of the same exact guard-validated E2E paths. It never retries failed tests or broadens deletion to another identity.

Final local verification: TypeScript, ESLint, production frontend build, Rust formatting, Clippy, and Brightspace/Notion isolation guards passed. The default frontend command passed 311 tests across 40 files after extending the existing long StudyPanel lifecycle test's timeout to ten seconds without changing assertions. The Rust library passed 143 tests and the E2E harness passed 27. Full native WebView2 E2E passed 116 tests across 14 specifications, including 23 Brightspace and 16 Notion tests. Every specification produced a schema v10 database with SQLite integrity OK and zero foreign-key violations. The actual narrow native WebView2 views were inspected; a separate unlocked development desktop was not needed.

Known limits: synthetic planning remains a preview; the current local study-block model cannot store a source provenance record or notes. The local objective may be shortened for its 120-character field, but the task ID remains authoritative. A synthetic preview cannot be restored after restart. The same-user executable replacement limitation documented for Brightspace remains unchanged.
