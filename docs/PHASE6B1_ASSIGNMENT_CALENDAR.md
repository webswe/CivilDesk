# Phase 6B.1 — Assignment Calendar (synthetic only)

## Verified D2L-CLI contract

At D2L-CLI commit `17cf68351468dd04db1b1cb005b146a0c5deb181`, the read-only machine command is `d2l assignments list --course <ASCII decimal course ID> --json --include-completeness`. It returns one object with required `assignments` and `completeness` keys. Each assignment has `id`, `course_id`, `name`, nullable `submission_status`, nullable `score`, and nullable `due_date`. The assignment ID is numeric in the verified provider route. Identity is **portal origin + course ID + assignment ID**, never a title or array position. CLI errors exit nonzero; raw stderr is never forwarded to React.

`completeness` has `status` (`below_page_size_boundary`, `potentially_truncated`, or `unknown`), `observed_row_count`, and nullable `page_size_ceiling`. Even `below_page_size_boundary` describes only one rendered page; it does not guarantee every assignment in a course was retrieved. The CLI does not offer verified pagination for this page. CivilDesk labels every snapshot as potentially incomplete and shows stronger warnings for uncertain or truncated pages and individual course failures.

The CLI exposes no description, source URL, verified completion enum, availability window, or submission action in this listing. `submission_status` and `score` are raw display text. Null `due_date` means no positively recognized date; it does not prove that no deadline exists. No grade data is used to infer assignments.

## Date and time semantics

The verified CLI emits timezone-naive ISO-8601 wall timestamps such as `2026-11-18T17:00:00`, or null. The provider displays no timezone. CivilDesk places a recognized timestamp on its **displayed civil date**, shows its displayed time, and labels the timezone unverified. It never interprets that value as UTC or the user's machine timezone, and never marks synthetic work overdue by comparing instants. Null deadlines go to Unscheduled; malformed timestamps fail the affected course read. The strict Rust adapter rejects date-only or offset-bearing values because the current CLI contract does not emit them; the frontend date utility handles those forms for future contract evolution and local date-only work. Daylight-saving gaps and repeated times remain displayed wall times, with no instant invented.

Local assignments use their authoritative CivilDesk task due date and optional time. Date-only local work remains date-only. No synthetic item is inserted into `tasks`, `courses`, `task_academic`, `calendar_events`, or any other SQLite table. Schema remains v10.

## Architecture and interaction

The restricted Rust command takes **no frontend course IDs or flags**. Each user-triggered refresh first reads the authorized synthetic course catalog, then reads at most 12 listed course IDs with the one fixed assignment command. Per-course parse or process failures are retained as warnings without discarding other courses. Every child uses the existing canonical executable and SHA-256 checks, synthetic adjacent executable and portal restriction, fixed application profile, cleared environment, bounded output, timeout, cancellation, and Windows Job Object cleanup. Production, Acceptance, and ordinary Dev builds cannot invoke a live assignment CLI. Debug Dev and browser preview return hard-coded fictional samples; only the isolated E2E identity with `notion-mock` can launch the synthetic fixture.

The School Assignment Calendar has month, week, and upcoming views, multi-course filters keyed by source identity, assignment details, an Unscheduled section, and a link back to the class. The School Overview links to the calendar. Local assignments and synthetic Brightspace assignments are visually and textually attributed. The in-memory snapshot survives a failed refresh with a stale indicator, but not an application restart. Reads require a user action; there is no polling or background sync. The global Calendar and Study Planner retain their existing behavior.

## Verification and limits

Synthetic fixtures cover duplicate assignment titles and IDs across courses, same-day deadlines, missing deadlines, partial page evidence, individual course failure, malformed JSON and records, excessive output, timeout, and cancellation. Frontend date tests cover month/year boundaries, date-only values, naive and offset timestamps, invalid dates, and daylight-saving transitions. Native E2E uses only the disposable `com.webswe.civildesk.e2e` identity and fixture, with no real Brightspace account or credential store.

The selected 12-course cap is explicit and warned about when exceeded. Full retrieval requires a verified pagination contract. Real-account enablement requires separate owner authorization and a reviewed live contract, including portal timezone semantics and completeness handling. This phase adds no submission, editing, grade, announcement, or import operation. The previously documented same-user executable replacement race remains.

Final local verification: 304 frontend tests, 141 Rust library tests, 27 E2E harness tests, TypeScript, ESLint, Rust formatting and Clippy, frontend production build, and isolation guards passed. The full Windows native suite passed 109 tests across 14 specifications, including 16 synthetic Brightspace tests and 16 Notion tests. Every isolated E2E database remained at schema v10 with SQLite integrity and foreign-key checks passing. Native WebView2 screenshots were reviewed for month, week, upcoming, and narrow detail views; direct Dev-window inspection was unavailable on the locked desktop.
