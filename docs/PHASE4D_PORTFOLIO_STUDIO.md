# Phase 4D — Portfolio Studio

Status: implemented locally and committed; **not pushed**. Native E2E and in-app visual review are still pending (see "Verification status").

## 1. Starting state
`main` at `48a4d3d`, equal to `origin/main`, clean tree. Schema v8, 47 tables, 63/63 native E2E, 54 Rust tests, 172 Vitest tests.

## 2. Architecture audit (what already existed)
| Area | Existing | Used by Portfolio Studio |
| --- | --- | --- |
| Project record | `engineering_projects` with `portfolio_candidate`, `portfolio_summary`, `objectives`, `contributions`, `skills`, `decisions`, `lessons`, `software_json`, dates, discipline, type | **Authoritative.** Summary, design objective, role, decisions and lessons are read and written on this row. Title, discipline, type and dates are read-only inside the studio. |
| Milestones | `project_milestones` | Reused. A selection table points at them; only title, date and completed state are ever exported (descriptions stay private). |
| Files | `project_files` (absolute path references, `display_name`, `category`) | Reused as the file-reference layer. A gallery image is a normal project file reference plus a gallery entry. |
| Challenges | `challenge_projects`, `challenge_progress`, `challenge_evidence`, `challenge_skills`, `engineering_skills` | Read-only source of *suggestions* (skills, software track, image evidence) from **completed** challenges linked to the project. Challenge notes are never read. |
| Journal, tasks | `project_journal`, `tasks.project_id` | Never exported. |
| UI | `ProjectsPage` tabs; old "Portfolio Preparation" tab (private notes) | The tab is replaced by **Portfolio**, which supersedes it. The old fields remain editable and are now the project-backed fields of the case study. |
| Persistence | `persistence.rs` migrations, `Database(Mutex<Connection>)` | Extended additively. |

## 3. New data model (schema v9, additive; 4 tables, 47 → 51)
All keyed to `engineering_projects(id)` with `ON DELETE CASCADE`; no existing table changed.
- `portfolio_case_studies(project_id PK)` — team kind, background, scope, constraints, approach, methodology, challenges, solutions, deliverables, outcomes.
- `portfolio_tools(id, project_id, kind software|skill, name NOCASE, skill_id → engineering_skills ON DELETE SET NULL, position)`, `UNIQUE(project_id, kind, name)`. Canonical skills are referenced where one was suggested; user-defined names are allowed.
- `portfolio_gallery(id, project_id, file_id → project_files ON DELETE CASCADE, caption, alt_text, position)`, `UNIQUE(project_id, file_id)`.
- `portfolio_milestones(project_id, milestone_id)` composite PK.

A project with no case study simply has no row; nothing is created until the user saves. Future collection support: every row is already project-scoped, and `portfolio_candidate` plus the readiness measure can drive a multi-project overview later (not built).

## 4. Authoring workflow
Engineering → Projects → select a project → **Portfolio** tab (no new sidebar entry). Sections: **Write**, **Software & skills**, **Gallery**, **Timeline**, **Preview & export**. Writing is plain text areas, grouped as Technical context / Engineering process / Results with progressive disclosure. Save is explicit ("Save draft"), unsaved edits survive switching sections, an "unsaved changes" indicator is shown, and save errors are displayed. A project-backed save and the case-study row are written in one SQLite transaction. A readiness line ("N of 7 parts started · still empty: …") describes completeness of writing, not quality of work. No AI text generation; nothing is pre-filled with claims.

## 5. Software and skills
User-chosen only. Suggestions (project software, completed linked challenges' track and skills) are shown separately with an explicit **Add** button. Listing a tool never implies proficiency; the export headings are "Software used" and "Skills practiced".

## 6. Gallery
Add by native file picker or an absolute-path field. Rust validates: absolute path, regular file (symbolic links refused), ≤ 25 MB, extension in PNG/JPEG/GIF/WebP **and** matching magic bytes (SVG and everything else refused). Caption, alt text, reorder (up/down), remove, preview dialog, "File missing" state. Removing deletes only the gallery entry: the project file reference and the original file are untouched (tested). Existing project attachments and challenge evidence are offered as optional suggestions only; nothing is auto-included. Thumbnails are served as validated data URLs, so the app CSP is unchanged.

## 7. Challenge integration
Suggestions only (see §2). No public entry is created, completion is not treated as competence, notes are not copied, challenge state/XP code is untouched.

## 8. Preview
`preview_case_study` renders the **same HTML** as the export (one renderer, images embedded as data URLs). It is shown in a fully sandboxed `<iframe sandbox="" srcdoc>` together with a "What will be included" list, "Not included" statement and warnings (missing/invalid images, empty summary).

## 9. Export format
`<chosen folder>/<Safe-Title>/` containing `index.html`, `assets/image-NN.<ext>` and a `.civildesk-export` marker. Single self-contained page: inline CSS, no scripts, no external requests, `Content-Security-Policy` meta (`default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`), `referrer=no-referrer`, responsive, print stylesheet, semantic headings, alt text. Asset names are generated from position and detected content type, so user filenames never reach disk or HTML and collisions are impossible. Markdown export was **not** implemented (optional; deferred).

## 10. Privacy model
Three layers: stored project data → presentation content (case-study fields, listed tools, gallery entries, selected milestones) → export, which is built from an explicit allowlist in `gather()`. Never exported: absolute paths, source filenames, journal entries, tasks, reminders, project description, milestone notes, unselected milestones/files, database ids, challenge notes, academic/personal data. Case studies are private drafts by default and nothing is uploaded anywhere.

## 11. Export security
HTML-escaped everywhere (`& < > " '`, NUL dropped); destination must be an existing, ordinary, absolute folder without `.`/`..`, not a device path, not a symlink; the export folder is always a direct child of it; reserved Windows names, trailing dots and separators are neutralised in the folder name; verbatim `\\?\` prefix is removed for display; an existing export is never replaced without explicit approval **and** only if it carries our marker (otherwise refused even with approval); failed exports are cleaned up.

## 12. Tests
| Suite | Result |
| --- | --- |
| Rust (`cargo test`) | **69 pass** (was 54). New: HTML escaping and folder names, base64, verbatim path, image validation by content, case-study round trip and no project duplication, restart persistence, tools, gallery lifecycle and file safety, milestones, export allowlist/leak checks/portability, overwrite protection, destination validation, missing images, cascade delete, **v8→v9 migration with integrity and foreign-key checks**. One further test is an env-gated manual inspection helper. |
| Vitest | **186 pass** (was 172) — Studio UI (empty draft, save/restart, unsaved text, tools, suggestions-not-claims, gallery lifecycle, project-image suggestions, timeline, browser-mode notice) and domain logic (readiness, suggestions). |
| Typecheck, ESLint, build, Clippy `-D warnings`, `cargo fmt --check`, E2E-isolation, Acceptance and dev config checks | pass |
| Existing migration fixtures | Three historical-upgrade tests (academic v5, study v6, personal v7) now also drop the v9 tables when rebuilding old databases and expect v9 — the same fixture correction made for v8. Assertions are otherwise unchanged. |
| Native E2E | New `e2e/specs/11-portfolio.e2e.mjs` (project → case study → tools → gallery → timeline → preview → export → on-disk inspection → overwrite protection → restart → project data intact → gallery removal keeps the file). **Written and syntax-checked but not executed**: it needs the CI WebDriver environment and nothing may be pushed without approval. Expected total after a run: 63 + 8 = 71. |

## 13. Verification status
- Exported site: generated by the real Rust code from a realistic sample, opened in Microsoft Edge independently of CivilDesk at 1600, 1280, 900, 760 and 700 px; the folder was **moved** and re-opened (images still resolve). Screenshots: `docs/phase4d/export-*.png`. These are **browser renders of the exported HTML, not CivilDesk UI**.
- CivilDesk's own Portfolio Studio screens (forms, gallery, preview pane, narrow layouts) have **not been visually inspected**, neither in browser preview nor in the native dev window. `npm run tauri dev` was not driven. **Visual acceptance is pending.**
- Not verified in the real app: native file/folder pickers, thumbnail loading through the Tauri command, iframe preview inside WebView2.

## 14. Known limitations
- Preview and export are desktop-only; the browser preview supports authoring only.
- No Markdown/PDF export; no multi-project collection page (data model is ready for it).
- Gallery supports raster images only; export needs an existing absolute folder path (picker or typed).
- Case-study text is plain text (paragraph breaks only).
- Local-file DRM or locked files are reported as unreadable, not retried.
- `e2e/lib/db.test.mjs` failed once in a full parallel Vitest run (temp-dir snapshot listing) and passed on rerun; it is unrelated to this work but looks timing-sensitive.

## 15. Remaining work
Run CI + native E2E after owner approval; visual review of the Portfolio tab in `npm run tauri dev` (disposable data in the `.dev` profile) at 1600/1280/900/760/700 px; decide on Markdown export and a portfolio overview.

## 16. Files changed
Rust: `src-tauri/src/portfolio.rs` (new), `lib.rs`, `persistence.rs` (v9), `academic.rs`/`study.rs`/`personal.rs` (test fixtures only). Frontend: `src/portfolio/PortfolioStudio.tsx` + test, `src/services/portfolio.ts`, `src/domain/portfolio.ts` + test, `src/ProjectsPage.tsx`, `src/App.tsx`, `src/ux.css`. E2E: `e2e/specs/11-portfolio.e2e.mjs`. Docs: this file and `docs/phase4d/`.

## 17. Git state
Local commits on `main` after `48a4d3d`; nothing pushed, no release. Pip XP, challenge, School, Personal, Calendar, Focus and identity code are untouched, and no portfolio XP was added.
