# Phase 5B — Notion source mapping design

**Status:** architectural decisions approved; design finalized for implementation planning. No implementation or migration is part of this document.
**Baseline inspected:** `84c02de` on `main`, SQLite schema v10. The final Windows CI and full native E2E regression baseline for this commit remains a prerequisite; implementation also requires owner approval of its scope.

## Owner-Approved Architectural Decisions

1. **Destination:** Phase 5B maps Personal tasks only. School, Engineering, Calendar, goals, routines, and other complex entities wait for their own relationship, validation, and date rules. Persist a versioned destination discriminator so later migrations can add types without reinterpreting `personal_task` rows.
2. **Disconnect:** saved mappings remain on this computer and become inactive. They do not preview while disconnected or under a different connection. Reconnection restores access only after reliable identity matching; an ambiguous or different identity requires explicit owner confirmation before any reassociation. The current token is never identity evidence.
3. **Completion:** a Notion `status` property, a `checkbox` property representing Completed, or both can be mapped. Status values require explicit `completed`, `not_completed`, or `in_progress` translations. Contradictory indicators create a conflict; no field silently wins and Phase 5B never completes a CivilDesk task.
4. **Dates:** date-only, timed, timezone-bearing, invalid, and unsupported values remain distinct. Personal tasks have `dueDate` and optional `dueTime` but no timezone or instant. Phase 5B maps date-only values only; a timed value is shown with an explanation of the lost time or timezone and is unresolved, without converting or dropping it.
5. **Drafts:** incomplete configurations can be saved locally as `draft`, with selected properties retained and missing mappings shown. A draft is never validated. `validated`, `needs_review`, and `inactive` have distinct lifecycle meanings below.

## 1. Scope and architectural findings

Phase 5B lets a person describe how one accessible **Notion data source** would be interpreted as a CivilDesk destination. The user can create, edit, inspect, and delete a local mapping. Saving it does **not** import, synchronize, or change a Notion page or a CivilDesk domain record. The preview is a temporary interpretation of a bounded sample, not a promise that the whole source is valid.

The existing integration uses a single local Notion connection. Its token is held in Windows Credential Manager under the application identity; SQLite v10 stores only connection metadata in `notion_connection` and remembered pages/data sources in `notion_sources`. Discovery distinguishes database containers from data sources. A database can have multiple data sources; only a data source has a property schema and queryable entries. The Rust `ReadOp` set and transport allowlist permit reads of `/v1/users/me`, search, databases, data sources, data-source queries, pages, and block children. The search and data-source query endpoints use POST with read semantics. The pinned Notion API version is `2026-03-11`; this design keeps it. Data-source queries already use pages of 10 entries, with cursors, bounded responses, timeouts, and sanitized errors.

The Phase 5A.1 workspace is a page inside CivilDesk with a resizable navigation pane and a data-source detail view. That view has Remember source, Open in Notion, a collapsed Properties list, a paginated table, breadcrumbs, and a compact drawer on narrow windows. `src/notion/Content.tsx` is the natural entry point for **Map to CivilDesk**. The existing table is for reading, not mapping: `PropertySchema` has a name, kind, and option names but no property ID; entry `Cell` has shortened display text and at most eight cells, with no typed raw date or option value. Mapping must therefore add a strict typed projection from the already allowed schema/query responses. It must not infer types or identity from the display cells.

The current connection metadata has workspace ID but no bot user ID. The existing `/users/me` response already has a bot user `id`, although `parse_me` currently discards it. Phase 5B must retain that ID, compare it with the response's `bot.workspace_id`, and use the pair as the available connection identity. Neither token possession nor a bot/workspace display name proves account continuity. If either ID is absent, identity is ambiguous: keep mappings inactive until the owner explicitly resolves the account association. Explicit disconnect currently deletes `notion_connection` and remembered sources; mapping rows must be independent of that cascade so they survive.

## 2. CivilDesk destination models examined

| Model | Required identity and fields | Optional fields, states, dates, and relationships | Phase 5B decision |
| --- | --- | --- | --- |
| Personal task | Local task ID; title trimmed to 1–200 characters; category `Personal`; priority `low`, `normal`, or `high` (default `normal`) | Description up to 10,000 characters; due date `YYYY-MM-DD`; optional `HH:mm` requires a date; reminder 0–40,320 minutes; up to 100 subtasks with titles 1–200; completion is `completed_at_ms` plus `first_completed_at_ms`. There is no task timezone or absolute due instant. Task may have `project_id` FK to engineering project with `ON DELETE SET NULL`; Personal mapping leaves it null. Task IDs are unique, but titles are not. | **Initial supported mapping destination.** Configuration and preview only. |
| School assignment / coursework | A task plus `task_academic` link; existing course ID is required; work type is `assignment`, `quiz`, `exam`, or `general` | Course belongs to a semester (`ON DELETE RESTRICT`); course code unique within semester ignoring case. Coursework title, priority, and due date use task rules. `task_academic.task_id` is unique and cascades with task deletion; course deletion is restricted. Semester dates and active/archive rules affect usable courses. | Defer until explicit course binding and missing/archived-course behavior are designed. |
| Engineering project | Local ID, title, nonempty discipline (≤100 chars), status | Category/project type each ≤100; description ≤20,000; up to 30 software values; optional start/target dates with start ≤ target; status `Planning`, `In Progress`, `On Hold`, `Completed`, `Archived`; priority nullable `low/normal/high`; portfolio fields and completion timestamp have separate meaning. Project ID unique; title is not. | Defer: status is not task completion, discipline is required, portfolio state needs separate choices. |
| Engineering milestone | Local ID, existing project ID, title, target date | Description ≤10,000; completion timestamp. `project_id` FK `ON DELETE CASCADE`; no globally unique title. | Defer: requires explicit project binding and date. |
| Calendar event | Local ID, title, valid start and end dates, nonempty timezone | All-day has no times or instants. Timed events require start/end `HH:mm`, start/end epoch milliseconds, and end after start. Description ≤10,000; reminder 0–40,320. Title is not unique. | Defer: timezone and range interpretation require a dedicated design. |
| Goal | Local ID, title, kind `binary/numeric/periodic`, start date | Target/period shape depends on kind; status `active/paused/archived/completed`; target history and progress entries are separate tables. | Defer: a task status cannot stand in for goal progress. |
| Routine / habit | Local ID, name, schedule, status `active/paused/archived` | Routines have ordered steps and dated executions; habits have versioned schedules and check-ins. Their completion history is not a single status field. | Defer: occurrence and history semantics are incompatible with a flat data-source row. |

The `tasks` table also serves School coursework and project-linked tasks. A destination label is therefore a deliberate domain choice, not a synonym for the SQLite table name. CivilDesk task completion awards Pip XP exactly once through the domain command; **no Phase 5B path invokes that command**. Existing SQLite constraints are not a substitute for the Rust validators; mapping validation must mirror relevant limits without writing a task.

## 3. Initial destination and compatibility matrix

Initial scope is **Personal task**, with fixed `category = Personal`, `projectId = null`, empty subtasks, and no reminder unless a future explicit rule is added. No destination record is created. The mapping describes completion for preview and future import review, but Phase 5B never applies it. A single source maps to at most one destination at a time in this release; the data source may still be browsed normally. The stored `destination_type` and configuration version reserve an additive path for later destinations without a generic framework today.

| CivilDesk field | Required? | Accepted Notion property types | Interpretation and limits |
| --- | --- | --- | --- |
| Title | Yes | `title` only | Exactly one title property ID. Trim for interpreted value; blank or >200 characters is a row error. Show original text alongside interpreted text. |
| Description | No | `rich_text` | Plain text only; blank becomes `''`; >10,000 characters is a row error, never silently truncate. |
| Priority | No | `select`, `status` | Explicit option translations to `low/normal/high`; default `normal` may be selected for empty values only. Unknown nonempty options are unresolved, not defaulted. Status used here is independent of completion. |
| Due date | No | `date` | A single date-only start maps to `YYYY-MM-DD`; empty maps to null. Date ranges, timed values, malformed dates, and timezone-bearing values are unresolved. Show the original and explain that `dueDate`/`dueTime` cannot retain timezone or absolute-instant semantics; do not silently discard time or shift a date. |
| Completion | No | `status` with explicit translations and/or `checkbox` representing Completed | Status options translate explicitly to `completed`, `not_completed`, or `in_progress`; the checkbox is true/false. Unknown or empty status is unresolved. If both are mapped and contradict, mark the row conflicting, with no preferred value. No completion timestamp or XP is synthesized. |

Display-supported `formula`, `rollup`, relation, people, files, multi-select, number, URL, email, phone, created/edited time, and unique ID are **not** accepted for these initial fields. Unsupported fields are listed with their type and reason; they never silently coerce to text. Date and title properties must be read by stable Notion property ID, not by their current name. Keep names only as labels. Prefer Notion option IDs for translations when present, with names as display hints; if an option lacks a usable stable ID, require an explicit name-keyed rule and mark rename risk.

## 4. Typed mapping configuration

The proposed versioned local object is conceptually:

```ts
type Destination = 'personal_task';
type PropertyRef = { id: string; nameHint: string; expectedType: string };
type OptionRule<T extends string> = { optionId: string | null; nameHint: string; value: T };
type PersonalTaskRules = {
  title?: PropertyRef; // absent in a draft only
  description?: PropertyRef;
  priority?: { property: PropertyRef; options: OptionRule<'low' | 'normal' | 'high'>[]; emptyDefault: 'normal' | null };
  dueDate?: PropertyRef;
  completion?: {
    checkbox?: PropertyRef;
    status?: { property: PropertyRef; options: OptionRule<'completed' | 'not_completed' | 'in_progress'>[] };
  };
};
type SourceMapping = {
  id: string; configVersion: 1;
  ownerWorkspaceId: string; ownerBotId: string;
  dataSourceId: string; databaseId: string | null;
  destination: Destination; rules: PersonalTaskRules;
  lifecycleState: 'draft' | 'validated' | 'needs_review';
  lastSchemaValidatedAtMs: number | null; schemaSignature: string | null;
  createdAtMs: number; updatedAtMs: number;
};
type EffectiveState = SourceMapping['lifecycleState'] | 'inactive';
```

This is a **configuration**, not a cached Notion document or an import manifest. No token, full page/row, sample value, inferred local task ID, or authoritative record is persisted. The backend normalizes Notion UUIDs where applicable, checks allowed destination/field/type combinations and lengths, rejects duplicate property bindings where they would be ambiguous, and validates all enum output values. Notion property IDs and option IDs are opaque strings: do not assume they are UUIDs. A name hint may be refreshed after a rename without changing the ID binding. `validated` means that the configuration and current schema were valid when checked; it never means every source row was examined. A preview can add row warnings without rewriting the saved mapping.

**Lifecycle:** `draft` is saved but incomplete or deliberately not validated; it retains partial property choices, displays missing required mappings, and cannot be treated as ready. `validated` requires a current matching connection identity, accessible data-source schema, required title binding, compatible property types, complete explicit enum translations, and no configuration ambiguity. It does not certify unsampled records. `needs_review` means a formerly validated or submitted configuration has schema drift, a failed check, or a reconnection awaiting revalidation; it retains the rules for editing. `inactive` is the effective state while disconnected or while the current identity does not match, regardless of the persisted lifecycle state. Inactive mappings are visible and deletable locally but cannot query or preview Notion. This effective state is derived from the current connection, so a disconnect never needs to delete or rewrite the saved rules.

**Transitions:** Creating a mapping, including a draft, first requires a verified owner identity. Save Draft creates/updates `draft` after local structural validation, even with no title mapping; it must report missing requirements. Save Validated Mapping runs current schema validation and enters `validated` only if complete. Editing a validated rule returns it to `draft` until revalidated. A schema/type/option change moves `validated` to `needs_review`; a temporary network failure keeps the saved rules and shows an unavailable check, without claiming schema drift. Disconnect overlays `inactive`. On reconnection with the same reliably recognized identity, a former draft returns to `draft`; a former validated mapping becomes `needs_review` until an explicit schema recheck; a former needs-review mapping stays there. If identity is missing or different, keep `inactive`, present the stored owner identity and current identity where available, and require the owner to confirm any deliberate association. Confirmation alone never claims the accounts are the same: a different identity requires an owner-confirmed copy under the new owner key and full schema validation, while missing IDs must be resolved before preview. The old mapping remains intact until the owner explicitly deletes it.

Saving performs only a local mapping-table write. Editing retains the mapping ID and uses an optimistic `updatedAtMs` check to avoid overwriting an older editor; deleting requires explicit user action and affects only that row. Status and priority translation choices are retained in drafts even when incomplete; unknown enum values remain unresolved.

Identity rule: one mapping per `(owner_workspace_id, owner_bot_id, data_source_id)` for Phase 5B. `database_id` is context, not identity, and a database container itself cannot be mapped. This key permits mappings from older identities to remain inactive when a new account is connected. A later destination expansion can add destination types and, if needed, a broader uniqueness rule in an additive migration; `personal_task` rows retain their original meaning. A mapping is usable only when the current `(workspace_id, bot_id)` exactly matches its stored owner pair and the source is accessible; source name and connection token are never used for matching.

## 5. Status, priority, and completion rules

Never infer meaning from words such as “Done,” “High,” or a Notion status group. The user maps each source option to a destination value. Show a table of source option name and selected output; use option ID as key when available. New or removed options move a `validated` mapping to `needs_review`; drafts remain drafts and report missing translations. Renamed options with the same ID update the label and remain bound. Deleted properties, changed types, or an option ID that now means something else block a ready state. No fuzzy matching and no fallback of an unknown nonempty option to `normal` or `not_completed`.

Task priority has three values; project status has five different values and is deferred. Priority can have an explicit `normal` default for an **empty** mapped property, or remain unresolved. Unknown nonempty options are never defaulted. Task completion is Boolean, with a timestamp and exactly-once reward only when the existing domain command is used in a later milestone. Phase 5B does not call it.

For a mapped completion `status`, each currently advertised option requires an explicit translation: `completed` means completed, `not_completed` means not completed, and `in_progress` means not completed with progress context. These translations never create a completion timestamp. An unknown status or empty status is `unresolved`, not presumed open. For a mapped Completed checkbox, `true` means completed and `false` means not completed; a missing/null value is unresolved. If both are mapped, compare their completion Boolean on every sampled row. `completed` versus false, or `not_completed`/`in_progress` versus true, is a **conflict**. Show both original values, each interpretation, and “Choose how to resolve this in the source or mapping before a future import”; do not display a preferred combined completion value. If one side is empty/unknown, show `unresolved` and the known side without asserting agreement. A mapping with neither indicator shows completion as **not mapped**, rather than inventing a default state. Preview never marks a CivilDesk task complete.

## 6. Validation and read-only preview

Validation has two levels:

1. **Configuration/schema:** verify current `(workspace ID, bot ID)`; read the current data-source schema; require a title property for `validated` but not `draft`; resolve each property ID; compare types; validate translation coverage, duplicate/conflicting bindings, and optional defaults. A rename with stable ID is informational. Deleted/inaccessible property, type change, disconnected or different account, missing title, or inaccessible source blocks `validated`. An offline response means validation could not run, not proof of deletion. Report precisely which required bindings or translations are missing in a draft.
2. **Sample rows:** query the source with the existing 10-entry cursor page size; show source page ID, original typed values, interpreted CivilDesk values, row-level errors/warnings, excluded rows, and decisions needed. Empty optional values use documented null/default rules. Blank title, over-limit text, invalid or ranged date, unknown enum, missing status, and completion conflict are visible per row. They are never quietly dropped. Source properties that cannot map are listed separately. A draft may preview mapped fields when identity matches, but all unmapped required fields remain visibly incomplete.

The preview is read-only and user initiated. Limit each preview request to three cursor pages, **at most 30 records total**; support Previous/Next within fetched pages and a clear **“Sample: N records shown; total source size unknown”** label. If Notion reports `has_more` or `incomplete`, say so. A new explicit preview request may refresh the sample and rechecks schema first; it does not silently continue beyond 30. A cursor is ephemeral; raw rows and typed values live only in bounded memory while the editor is open and are discarded on navigation/close. Do not write them to SQLite, logs, telemetry, or domain tables. Truncate *display* safely if needed, but validate against the full bounded property value and show an explicit truncation warning. Backend projection should expose only the mapped fields plus concise unsupported-field metadata, not arbitrary full page JSON. An empty source shows zero sampled entries, with schema validation still possible; it cannot establish row validity. Inactive mappings cannot initiate any query, even if the saved data-source ID is syntactically valid.

The typed projection should preserve Notion date `start`, `end`, and `time_zone`/offset metadata as supplied, and preserve option IDs, names, Boolean values, and property IDs. Date-only remains a calendar date and is never passed through a timezone conversion. CivilDesk Personal tasks store `dueDate` and optional `dueTime` as wall-clock values, with **no timezone identifier, UTC offset, or absolute due instant**. A timed Notion date therefore remains unresolved under the approved Phase 5B mapping rule, including when it has no explicit timezone. Preview shows its original timestamp and explains that mapping just the date would lose time, while mapping date plus time would still lose timezone/instant semantics when supplied. Ranges and malformed values are also unresolved. No hidden midnight assumption or silent truncation is allowed.

## 7. Workspace experience

Add **Map to CivilDesk** to the data-source header actions beside Remember source and Open in Notion. A database container first leads to its chosen data source; page documents have no mapping action. Opening a mapping replaces the main content pane with a full-width Rosewood editor while retaining the workspace toolbar, breadcrumb, and sidebar context. Use a clear Back/Cancel route to the source. Do not introduce a permanent sidebar item or a large technical modal.

Editor order: source card (name, parent database, account identity when known, last checked, active/inactive state) → destination card (Personal task only) → property assignments → status and priority translation tables plus checkbox interpretation → validation summary → paginated read-only preview → **Save Draft**, **Save Validated Mapping**, and **Cancel**. Save Draft remains available with missing required fields and lists them; Save Validated Mapping is enabled only after a successful current identity/schema check and complete configuration. An existing mapping opens as Edit Mapping with a separate Delete Mapping action. An inactive mapping opens in local edit/review mode with preview and validation disabled until matching identity is verified. Explain near both save actions: “Saves mapping rules on this computer. No Notion pages or CivilDesk tasks change.” Display schema drift and completion conflicts prominently and provide Recheck schema. Distinguish saved draft, validated configuration, needs review, inactive mapping, schema checked, and sample checked states. Provide keyboard reachable selects/checkboxes, fieldset legends, label/description associations, visible focus, an `aria-live` result summary, table headers for original and interpreted values, and narrow stacked cards with no page-level horizontal overflow. Keep the existing read-only banner accurate: local configuration changes are allowed, Notion and domain records remain read-only.

## 8. SQLite v11 proposal

Version 10 is current. Phase 5B needs **one** new mapping table; it does not need source-record or preview tables. Proposed migration 11 also extends `notion_connection` with a nullable `bot_id`, populated from the existing `/users/me` bot user `id` on the next verified connection. Existing connections with null bot ID must be checked before a mapping can be created, restored, validated, or previewed. The mapping table has **no foreign key to `notion_connection`**, because that row is deleted on disconnect. A representative schema:

```sql
ALTER TABLE notion_connection ADD COLUMN bot_id TEXT;
CREATE TABLE notion_source_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  owner_workspace_id TEXT NOT NULL,
  owner_bot_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  database_id TEXT,
  destination_type TEXT NOT NULL CHECK(length(destination_type) BETWEEN 1 AND 64),
  rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
  config_version INTEGER NOT NULL CHECK(config_version >= 1),
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN
    ('draft','validated','needs_review')),
  last_schema_validated_at_ms INTEGER,
  schema_signature TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(updated_at_ms >= created_at_ms),
  UNIQUE(owner_workspace_id, owner_bot_id, data_source_id, destination_type)
);
CREATE INDEX notion_mapping_owner ON notion_source_mappings(owner_workspace_id, owner_bot_id);
PRAGMA user_version = 11;
```

Run inside the existing `BEGIN IMMEDIATE` migration transaction, preserving all v10 rows. Rust must validate `rules_json` against a versioned typed struct, maximum serialized size, property and option IDs/types, destination allowlist (`personal_task` in v11), enum domains, normalized source/owner UUIDs where applicable, and timestamp coherence; `json_valid` alone is insufficient. The open SQL discriminator and version check allow later *additive* destination/config versions without changing or reinterpreting existing Personal mappings. Phase 5B service validation enforces one mapping per owner/source across destination types in the same write transaction; the SQL uniqueness key still permits later multi-destination support without dropping data. Do not FK to `notion_sources`: remembering a source is optional and removing it from navigation should not silently delete its mapping.

On disconnect, the existing `notion_connection` row and credential may be removed as today, while `notion_source_mappings` remains untouched; `inactive` is computed from connection availability/identity rather than stored as a lossy state. This also preserves whether an inactive mapping was a draft or needed review. On a same-identity reconnect, a previously validated mapping must recheck its schema before it returns to `validated`. On a different identity, retain the old owner key and keep the row inactive; an owner-confirmed copy for the new identity is a separate mapping subject to fresh source access and schema validation, not an automatic rebind. Missing identity IDs do not authorize a copy or preview. The short schema signature can hash property IDs, types, and option IDs to detect drift without retaining rows; human-readable names remain only in the configuration hints. Rollback should restore from a database backup or use a deliberate down migration that drops only the new table/column (SQLite column removal requires table rebuild on some versions); never reset CivilDesk data. Test upgrade from v10 and foreign-key integrity. No migration is executed by this design session.

## 9. Security and future compatibility

Keep the existing fixed Notion host, pinned API version, ID/cursor normalization, closed `ReadOp` set, credential isolation, response bounds, and mock-only loopback override. New mapping schema/preview commands may call only existing read operations; mapping CRUD commands may write only `notion_source_mappings` and nonsecret connection metadata. They must not call `save_task`, `set_task_completed`, academic/project/calendar writes, reward functions, or any Notion mutation. They must not read unrelated user credentials. Check identity in the backend on every schema/preview operation, not only when the editor opens; this prevents an inactive mapping from querying a source after account replacement. A local draft edit or explicit deletion requires no Notion call. Untrusted Notion strings render as text, never HTML. Errors must not contain tokens or raw response bodies. Validation of a saved mapping is user initiated; no background polling. Avoid storing private sample content in logs/screenshots except explicit isolated synthetic test evidence.

Later one-time imports would need a provenance record keyed by connection/workspace/bot identity, data-source ID, Notion page ID, destination type, local record ID, mapping version, and source last-edited timestamp (or a stable content fingerprint). Duplicate detection and conflict review must compare that provenance with the current local record; title is not a key. A later import must explicitly decide completed-task/XP semantics and timezone conversion. None of these tables or workflows belong in Phase 5B.

## 10. Test plan

**Rust/unit and persistence:** save/reload/edit/delete a partial `draft` and a complete `validated` mapping; ensure a draft retains selections and lists missing title/translations; test `draft → validated → needs_review`, inactive overlay, matching reconnect with revalidation, mismatched/ambiguous identities, owner-confirmed copy, and explicit deletion. Test unique owner/source behavior, optimistic update conflict, v10→v11 migration preserving all existing rows, disconnect preserving mapping rows, FK and `PRAGMA integrity_check`; malformed/oversize JSON, bad IDs, unknown config version and unsupported destination. Test missing/renamed/deleted/type-changed property, option ID rename and new option, blank/long title, priority translations and empty-only default, `completed`/`not_completed`/`in_progress`/unknown/empty status, true/false/null checkbox, contradictions, date-only preservation, explicit timezone, unsupported timed/ranged/invalid dates, empty source, 10-entry cursors and 30-entry request cap, inaccessible/offline/auth-failed state, and no token or raw row stored. Assert schema validation is not reported as whole-source validation.

**Frontend:** source-only Map action and breadcrumb return; Save Draft, Save Validated Mapping, edit/cancel/delete and inactive local review; each save explains that it does not import. Test clear lifecycle labels, missing-required summaries, accessible field labels and conflict explanations, Rosewood narrow layout, preview original/interpreted columns, timezone-loss warnings, warning/excluded counts, empty source, pagination/sample limit, schema drift, disconnected/mismatched account, and unsupported properties. Use synthetic fixtures, never the owner's workspace.

**Native E2E, isolated `com.webswe.civildesk.e2e` + loopback Notion mock:** persist draft and validated configurations across restart; edit and delete; disconnect and confirm the rows persist but preview is blocked; reconnect with matching, different, and missing identity; confirm no automatic cross-account binding. Preview multiple pages and show the 30-record limit; change schema/option IDs and verify revalidation; show completion conflicts and missing status translations; preserve date-only values and explain unsupported timed/timezone values. Inspect SQLite to prove only mapping/connection metadata changed and no task/academic/project/calendar/reward rows changed; assert every Notion request remains on the allowlist, no create/update/delete route is used, token remains in the CivilDesk Credential Manager identity only, and no production/Acceptance profile is touched. Keep the existing 16 Notion tests and full native suite as regression gates; do not use private Notion data in committed fixtures. The pending baseline on `84c02de` must finish before implementation begins.

## 11. Implementation phases and risks

1. After the pending baseline, add typed property-ID and option-ID schema/value projections plus isolated parser tests, keeping the 5A.1 reader unchanged.
2. Add v11 persistence and narrow mapping validation commands; test migration, identity, read-only boundaries, and CRUD.
3. Add the workspace editor, translation controls, bounded preview, and synthetic browser/native tests.
4. Run TypeScript, ESLint, Vitest, Rust checks, E2E isolation/Notion mock guard, native E2E, and packaging before asking for implementation acceptance.

Main risks are Notion schema drift, absent/changed option IDs, account changes within one workspace, date/time ambiguity, very long or unsupported values, and accidental interpretation of a 30-row sample as a full-source guarantee. Fail closed on identity/type mismatch, present row conflicts, and state sample bounds plainly. The current display parser truncates cells, so reusing it for validation would produce false clean results. The old v10 connection row lacks a stored bot ID until it is checked again. Preserving disconnected mappings makes their local metadata durable, so the UI must offer explicit deletion without implying a disconnect erases it.

## 12. Remaining technical uncertainties and implementation gate

The current parser has not exposed property IDs, option IDs, or the bot user ID to mapping code. Implementation must verify the exact IDs and date payloads returned by the pinned API using the isolated mock and safe parser tests; if an option ID is absent, the name-keyed fallback must remain explicitly fragile. Confirm whether a particular Notion integration can return a missing `workspace_id`; in that case the approved identity policy keeps mapping inactive until a reliable pair is available. These are implementation facts to test, not new owner policy choices. The selected 10-entry query size and 30-entry preview cap are design constraints, not evidence of full-source validity.

**Implementation recommendation:** the design is ready for owner review. Phase 5B implementation remains NO-GO until the pending Windows CI and full native E2E regression baseline on `84c02de` passes and the owner approves the implementation scope. This design session does not dispatch verification, create a migration, import records, or start Phase 5C.
