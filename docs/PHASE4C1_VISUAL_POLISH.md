# Phase 4C.1 — Visual polish, readability and interface refinement

Presentation only. No schema, migration, Rust, Tauri identity, E2E infrastructure or product-behavior changes.

## 1. Initial UI audit
Read `PersonalPage`, `DailyPriorities`, `TasksPage` (`ProductivityPages.tsx`), `MyDay`, `ChallengesPage`, `ux.css` and `styles.css`, plus the Vitest and native E2E specs that touch them. The owner's two native screenshots were taken as the starting evidence and checked against the code.

## 2. Problems confirmed in code
- Personal rendered two adjacent segmented groups (feature tabs, then task-area filter) with equal weight.
- `DailyPriorities` rendered a disabled `<select>` reading "No open tasks to choose" when no task existed.
- The task-list empty state was a large dashed card with an `h2`, and used the same text for "no tasks" and "filters hide your tasks".
- Several secondary styles were 9–11px (`.soft-button`, `.text-link`, `.time-zone-note`, `.task-meta span`, …).
- A challenge with every criterion checked still showed only "In Progress"; completion is a separate, deliberate "Mark completed" action. That separation is intentional and unchanged.

## 3. Typography
Small shared scale in `ux.css` (`--fs-xs` 12px, `--fs-sm` 13px, `--fs-md` 14px, `--text-muted`). Secondary text, buttons, tags, notes and dialog labels now sit at 12px or above. Serif headings are unchanged.

## 4. Navigation
Personal feature tabs stay under the page heading. The task-area filter (All/School/Personal/Engineering) moved under the "Tasks" heading and is a quieter, borderless control (`areaSwitcherInList`, Personal only). Same buttons, same `aria-pressed`, same filtering; School and the other task pages are untouched.

## 5. Empty states
- Priorities with no task at all: no selector; one sentence plus an "Add a task to start" button that opens the existing new-task dialog. With tasks, the selector is unchanged.
- The "Priorities are a plan…" footnote now shows only once a priority exists.
- Task list: compact inline strip. Three cases: nothing exists ("Add your first task"), filters hide tasks ("Clear search and filter"), all tasks done ("Show completed tasks").

## 6. My Day
- Calmer empty-day copy; one next action instead of several.
- Priorities get an explicit 28px gap below Today; aside sections use a consistent 30px; column gap 48px; headings 12px uppercase.
- Max width (1040px) is unchanged; no decorative content added.

## 7. Personal layout
Consistent 26px section rhythm, list heading spacing, toolbar controls aligned at 40px.

## 8. Engineering completion clarity
When all criteria are checked and the challenge is not completed, the Progress card shows a status note explaining that "Mark completed" finishes it. The My Day "In progress" card appends "ready to mark completed". The existing "N of N criteria checked" element is unchanged, so native spec `05-engineering` selectors are unaffected. State transitions, persistence, project conversion, skills and XP policy are untouched.

## 9. Goals, Habits, Routines, Weekly review
No behavior changes. Only the shared type-scale bump applies (habit day buttons, weekday chips, review text, goal detail headings). No further changes were made because there was no UI evidence beyond the font sizes.

## 10. Responsive
Existing breakpoints (900/760/720) and icon-rail sidebar kept. The area filter goes full width at 760px and compact empty states wrap. Not visually verified at 1600/1280/900/760/700 (see limitations).

## 11. Accessibility
Real buttons for new empty-state actions; compact empty state uses `role="status"`; challenge note uses `role="status"`; filter keeps `role="group"` + `aria-pressed`; focus-visible and reduced-motion rules untouched.

## 12. Tests and results
- `tsc -b` typecheck: pass. ESLint: pass.
- Vitest: 26 files, 172 tests, all pass (7 new: area filter placement, empty priorities, selector with tasks, first-task action, filtered-vs-empty and cleared filter, all-done state, challenge completion note).
- Production build: pass. `check:e2e-isolation`: pass. `check-acceptance-config.mjs`: pass. `cargo fmt --check`: pass.
- Native E2E: **not run** (nothing was pushed). Baseline remains 63/63 on the prior commit.

## 13. Known limitations
- **No before/after screenshots were captured** — neither browser-preview nor native. Visual results are therefore unverified; layout, spacing and contrast need an owner look.
- Responsive widths were not inspected visually.
- The area filter is moved only on Personal. School keeps its existing placement.
- "Next up" and the Coming-up panel are unchanged.

## 14. Files changed
`src/ux.css`, `src/ProductivityPages.tsx`, `src/PersonalPage.tsx`, `src/personal/DailyPriorities.tsx`, `src/MyDay.tsx`, `src/ChallengesPage.tsx`, `src/PersonalPage.test.tsx`, `src/ChallengesPage.test.tsx`, this document.

## 15. Git state
Based on `e7a627b` on `main`. Local commits only; nothing pushed, no release.

## 16. Native verification required
After the owner approves a push: run Normal CI and Native E2E (expect 63/63), then open the installed Acceptance app and review Personal Overview (empty and populated), My Day, a fully-checked engineering challenge, and a ~700px window.
