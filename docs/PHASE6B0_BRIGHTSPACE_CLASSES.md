# Phase 6B.0 — Brightspace Classes (synthetic only)

## Architecture and School integration

Classes is a view inside the existing School page. Overview, local course detail,
coursework, Study, semester management, and unassigned School tasks keep their
existing behavior. A compact Overview link opens Classes. Classes shows local
CivilDesk courses separately from synthetic Brightspace courses; opening a local
course returns to the existing editable course detail. No name or code matching
joins the two sources. No Brightspace row is inserted into `semesters`, `courses`,
`task_academic`, `study_blocks`, or any other SQLite table. No migration was added.

The React Classes view retains one successful synthetic snapshot in memory while
the School page remains mounted. It has explicit refresh, search, course cards,
and detail pages. A failed refresh keeps that snapshot and marks it stale. The
cache is lost on application restart. Offline mode keeps local courses and any
in-memory snapshot visible and disables refresh. Empty and unavailable states
are distinct. No background polling occurs.

## Verified D2L-CLI course contract

At D2L-CLI commit `17cf683`, the machine command is exactly
`d2l courses list --json`. Exit `0` emits one JSON object:

```json
{"courses":[{"id":"610101","code":"CIV 201","name":"Sample course","semester_name":"Sample term","is_active":true,"can_access":true,"is_new_enrollment":false,"start_date":null,"end_date":null}]}
```

Every course has all nine keys. `id` is an ASCII decimal org-unit identifier,
stable as a join key only within one portal. `code`, `name`, and `semester_name`
are source strings; empty strings are shown as unavailable. The three flags are
source booleans. Dates are nullable *raw provider strings* and are not parsed
into deadlines. Provider order is preserved. The CLI rejects a non-null
pagination bookmark instead of returning an incomplete first page. Anticipated
errors exit `1` with empty stdout and diagnostic stderr; usage errors exit `2`.
CivilDesk never forwards stderr or raw CLI messages to React.

The course listing does not supply instructor, description, meeting location,
source URL, assignment count, grades, announcements, due dates, or study links.
Those values are not fabricated or derived from matching local course names.
Course detail identifies the synthetic source, portal, and org-unit ID. Source
links are absent because no supported link field exists.

## Rust boundary and synthetic modes

The new Tauri command `brightspace_courses` takes no frontend arguments. Its
only subprocess vector is `courses list --json`. It reuses the stored canonical
executable path, SHA-256 check, fixed profile and portal, cleared child
environment, bounded stdout/stderr, five-second timeout, cancellation, Windows
Job Object cleanup, and capability check. The response parser requires the
exact envelope and record fields, numeric unique IDs, bounded fields and count,
and exit `0`. It returns portal provenance, retrieval time, `complete: true`,
and an empty structured warning list. The v1 course command has no structured
partial-success warnings; an indicated extra page is a CLI failure.

Production and Acceptance builds return a fixed unavailable error before
loading configuration or launching any process. Release Dev builds do the same.
The development app in debug mode provides a hard-coded sample catalog without
launching a CLI or reading credentials. Browser preview also uses clearly
labeled sample data. Only the `notion-mock` feature with the dedicated
`com.webswe.civildesk.e2e` identity can invoke a subprocess for course reads;
it permits only the adjacent `brightspace-synthetic.exe` and the synthetic
portal. Neither a user-supplied path nor an environment variable enables a
real academic read. The fixture has no HTTP or credential-store dependency.

Synthetic tests cover multiple courses, duplicate names with distinct IDs,
empty results, missing display metadata, malformed records and JSON, nonzero
exit, output overflow, timeout, cancellation, navigation, search, refresh
failure, restart, and isolation from local School records. The existing Notion
mock and E2E database safeguards remain in place.

## Limits and Phase 6B.1 dependencies

The snapshot is intentionally temporary and has no cross-restart history.
Course IDs are not globally unique; the UI keys them with portal provenance.
The existing same-user executable replacement race remains documented in
`BRIGHTSPACE_CONNECTION_FOUNDATION.md`. No real account, credential, or
Brightspace data was used. Live retrieval still needs separate authorization,
contract review, and safe failure and completeness testing against an approved
account before it can be enabled in regular builds.

Phase 6B.1 can add an assignment calendar filtered by portal and course ID,
with month and week views, unscheduled assignments, and study context. It must
verify assignment identity and due-date semantics before rendering events,
preserve incomplete-result warnings, and avoid duplicate global Calendar rows.
This milestone does not retrieve assignments or create due dates.
