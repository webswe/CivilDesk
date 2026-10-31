# Phase 3B implementation and native acceptance

## Data model and behavior

Schema v5 adds challenge identities and immutable content versions, pathways and prerequisites, weekly settings and assignments, user progress, checklist rows, evidence references, skill relationships, project relationships, and engineering events. Migration is transactional. The bundled library is seeded at startup with `INSERT OR IGNORE`; a later content version can be added without replacing a version already used by progress. Progress pins its content version. Existing schema v4 rows are retained. Evidence and project files store paths and metadata; CivilDesk does not copy or alter engineering documents.

The nine bundled challenges are three AutoCAD exercises (drafting, site plan, sheet layout), three Civil 3D exercises (survey surface, alignment/profile, conceptual corridor), and three Revit exercises (basic BIM, illustrative foundations, coordinated documents). All examples are fictional educational work. The Civil 3D point coordinates are original and included in the instructions. No bundled proprietary DWG or RVT asset is implied.

Weeks are local civil weeks, Monday 00:00 through the following Sunday 23:59:59 in the computer's current time zone. The frontend sends the Monday `YYYY-MM-DD` date; Rust validates that it is a Monday. Assignment rows use a unique `(week_start, challenge_id)` key and are never regenerated after insertion. Automatic rotation is opt in, runs for the current week only, and excludes completed challenges. It does not backfill missed weeks. Manual selection is independent of automatic track preferences. Skipped challenges have no penalty. A time-zone change can alter which local week is current; existing assignment rows remain intact.

The Skills view counts objectives in self-reported completed challenge versions. It is a learning indicator, not a competency credential. `engineering_events` records challenge starts, completions, completed pathways, and projects created from challenges with unique `(kind, source_id)` keys. These events award no XP. Pip may react to a completion or challenge-created project using its existing quiet, Focus Mode, and reduced-motion behavior. Existing task and focus rewards are unchanged.

The official Tauri 2 dialog plugin has only `dialog:allow-open` in the main window capability. Its picker supports multiple common engineering documents and returns paths. Rust checks file existence and rejects executable or shortcut references. No broad filesystem plugin permission or shell opener was added. Manual absolute paths remain an advanced option.

## Checks completed locally

- TypeScript typecheck, ESLint, frontend production build, and 26 Vitest tests passed. The tests include a check that the weekly preview follows the same rotation as the native assigner (reference values computed independently from the Rust hash) and a rendered check of the Upcoming section.
- `cargo fmt --check` passed.
- `scripts/verify_challenge_migration.py` executed the shipped v1-v5 SQL on an in-memory database with preserved v4 project and task rows; `quick_check`, `foreign_key_check`, challenge records, and duplicate assignment rejection passed. It also extracts the SQL literals that `challenges.rs` runs (seeding, weekly assignment, start/upsert, checklist, completion, events, evidence, project conversion, and every read query) and executes them against a fresh v5 schema, covering seed idempotence, assignment/event/evidence uniqueness, the one-created-project index, and foreign keys. This checks the SQL, not the Rust code.
- Rust compile, Clippy, and Rust unit tests are pending. This host lacks the MSVC linker (`link.exe`), so `cargo check` stops at the first crate build script; no Rust code in this phase has been compiled locally. `#[allow(clippy::too_many_arguments)]` was added to the eight-argument `challenge_action` method and command so CI's `-D warnings` Clippy run is not tripped. Cargo's project-scoped config sends build output to `E:/build/cargo-target/civildesk`. No production database was opened for these checks.
- Browser-preview screenshots: [weekly board](evidence/phase3b/challenge-board-preview.png) and [challenge workspace](evidence/phase3b/challenge-workspace-preview.png). They show the Rosewood interface and readable challenge content; they do not verify native file selection or installed-app persistence.

## Native acceptance procedure

After the owner authorizes a push of the reviewed implementation, run the existing Windows CI and isolated acceptance-build workflow at that commit. Do not use the production installer or database for testing. Confirm `node scripts/check-acceptance-config.mjs` and the acceptance installer hash before installing. Use a distinct acceptance profile and disposable files with Unicode names and spaces in paths.

1. Back up a **copy** of a schema-v4 acceptance database; install and launch the Phase 3B acceptance build. Verify schema v5, retained project/task/calendar/Pip data, `PRAGMA quick_check`, and `PRAGMA foreign_key_check`. Restart twice.
2. Open Weekly Challenges. Verify all nine challenges, both learning modes, pathways, Skills, and the current-week empty state. Enable automatic assignments with selected tracks and difficulty; restart and confirm the same assignment IDs. Manually add a different challenge, then repeat the action and confirm no duplicate row. Inspect a later week without creating a backlog.
3. Start a challenge, switch modes, check requirements, save notes, set a date, attach a disposable DWG/DXF/PDF/CSV or screenshot, complete, reopen, and revisit. Confirm the stored file remains byte-identical and a relocated file is marked missing. Confirm completion says self reported.
4. Use **Browse Files** in both Engineering Projects and a challenge. Exercise multi-selection, cancel, Unicode/spaces, and an unsupported or executable file through advanced path entry. Check that no command shell opens. Link an existing project and create a project from a challenge twice; confirm one created project, preserved challenge identity/objectives, and metadata-only evidence references.
5. Inspect challenge deadlines in Calendar and the challenge summary on Dashboard. Check tasks, focus sessions, existing XP, and calendar CRUD for regressions. Complete a challenge in normal, quiet, Focus Mode, and reduced-motion conditions; verify no engineering XP and no reaction for a skipped challenge. Check `engineering_events` uniqueness.
6. Capture installed-app screenshots of the board and detail workspace. Record CI run IDs, installer hash, database integrity, native observations, and any WebView2 sandbox failure separately from application defects.

The restricted-tool WebView2 filesystem sandbox issue identified in Phase 3A may recur. If it does, rerun the acceptance executable in the established unrestricted installed-app environment before attributing startup failure to CivilDesk.

## Current acceptance status

**IMPLEMENTED — NATIVE VERIFICATION PENDING.** Rust compilation (including the Rust unit tests in `challenges.rs` and `persistence.rs`), Clippy, CI, the installed Windows picker, database migration in the installed app, and native screenshots remain unverified. The screenshots above are browser previews. Do not advance to Phase 3C on this record alone.
