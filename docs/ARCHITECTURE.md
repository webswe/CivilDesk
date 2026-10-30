# CivilDesk architecture

## Phase 1 boundary

React renders the desktop interface and owns transient navigation. TypeScript domain code owns authored Pip rules. `src/services/storage.ts` is the frontend persistence boundary. In Tauri it invokes Rust commands; in a browser preview it uses browser local storage for visual development only. Rust opens SQLite inside Tauri's per-user application-data directory (`app.path().app_data_dir()`) and applies migrations before the window is usable. The installed app never writes to its installation folder.

The initial SQLite migration uses `PRAGMA user_version` and an atomic transaction. `app_state` holds the small Phase 1 preferences and companion snapshot. `reward_events` has a unique `(kind, source_id)` constraint to protect future awards against repeats. `earned_achievements` and `cosmetic_unlocks` reference source events. No reward engine exists yet; experience, level, and coin fields are reserved and remain at their defaults. New migrations should be added in version order and tested on a copy of a previous database. Do not rewrite a shipped migration.

## Proposed entity relationships

When these features are implemented, use local UUID primary keys, creation and update timestamps, and explicit foreign keys:

- `projects` owns `milestones`; `tasks` may link to a project or milestone. `calendar_entries` may reference a task but remain independent.
- `goals` may link to tasks and habits through join tables. Courses own `assignments`; grade records belong to assignments.
- `challenge_definitions` are versioned content. `challenge_attempts` reference a definition version, include progress and user files, and may create a project. Engineering `skills` link to attempts and journal entries through evidence records.
- `portfolio_entries` may reference a project, but contain their own curated title, category, description, objectives, software, process, decisions, challenges, deliverables, outcomes, lessons, readiness, and export metadata. `portfolio_media` stores relative user-data paths and captions. Editing a working project must not silently rewrite a published case study.
- `notion_mappings` map an entity type and local UUID to a remote Notion ID and revision cursor. Never use remote IDs as local primary keys.

Store user media under the application-data directory with safe relative paths, and back up database plus media together. User-controlled files must never be assumed to be technically valid engineering work.

## Pip and graphics

The companion is an original SVG character in `PipIllustration.tsx`. CSS animates its body lightly. `pip.ts` handles intentional interactions, sleep, wake, focus priority, and reaction cooldowns without depending on SVG. Reduced motion stops the animation. Quiet mode suppresses unsolicited celebrations. Future ambient behavior should use a seeded random source and never interrupt focused work. A future floating desktop window can reuse the state machine and a lightweight SVG or Canvas renderer. A richer 2D scene may use PixiJS only if SVG/Canvas prove insufficient; 3D is not justified yet.

Future reward processing should consume idempotent activity events, evaluate versioned achievement definitions, and write earned rewards in one database transaction. It should never remove earned rewards for inactivity, block core features, or require daily engagement. Style, accessories, environment, and selections can be separate tables once customization exists. No microtransactions, telemetry, or AI services are planned.

## Challenge content format

Use reviewed, versioned JSON documents with `id`, `version`, `software` (`revit`, `civil3d`, `autocad`), `difficulty`, `title`, `brief`, `learningObjectives`, `instructions`, `starterMaterials`, `deliverables`, `checklist`, and `estimatedMinutes`. Validate with a schema at import time. Content authors must verify software-specific instructions; the app does not certify engineering correctness. Manual choice and weekly rotation can select the same definition records. A submitted attempt stores the exact definition version used.

## Notion boundary

The local database remains the source of truth. A future opt-in Notion adapter will map selected tasks, projects, notes, goals, and journal entries. Options are user-provided internal integration tokens for personal use or a public OAuth flow if a secure redirect and client registration are later established. Store credentials in Windows Credential Manager or another OS key store, never ordinary SQLite preferences. The sync engine should store remote IDs, last synced hashes or edit timestamps, and per-field conflict records; show conflicting edits to the user before overwriting either side. Offline changes queue locally. No authentication is attempted in Phase 1.

## Release design

CI runs frontend checks and a Windows native build. The release workflow is manual and targets an existing version tag; it prepares a draft GitHub Release. Before it is used, enable Tauri updater artifacts with a public updater key and test the signed update path from an installed prior version. Generate a Tauri signer key pair with the current CLI, put the private key and password in `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets, and ship only the public key. Tauri updater signatures authenticate update artifacts. Windows Authenticode signs the installer/executable for Windows trust prompts and requires a separate code-signing certificate and secure signing workflow. No private keys or certificate files belong in Git. Stable and prerelease update channels need separate published manifests and testing before automatic updates are enabled. The current release workflow has not been exercised and should remain draft until that process is verified.
