# Phase 3B.2 — UX Simplification, Information Architecture, Everyday Productivity

Base commit: `f8ff48c` (Phase 3B accepted). Scope: presentation layer only. No SQLite schema, Rust, Tauri configuration or application identity was changed.

## 1. Initial UX audit (before any change)

Findings from the source and from "before" screenshots (`docs/evidence/phase3b2/before/`).

| Area | Finding |
|---|---|
| Navigation | 9 groups and ~30 items. 14 of them (Goals, Habits, Courses, Assignments, Grades, Notes, Knowledge Map, three Portfolio items, Analytics, Progress Reports, Integrations, Backup and Restore) led to a "Coming in a future milestone" placeholder. Academics was visually as large as Engineering. Labels such as "Focus Sessions" and "Weekly Challenges" were architecture-flavoured. |
| Dashboard | A 216 px gradient hero with a generic sentence, a 3-step "next step" list that never changed, a large Pip card, then (below the fold) a challenge board, then five equally-weighted cards (tasks, upcoming, focus, Pip progress, calendar). Engineering challenges were always shown, even with nothing active. Nothing answered "what do I do today?" in one glance. |
| Defects | Calendar card on the Dashboard rendered `?` instead of an arrow/dash (encoding damage). Challenge cards were light cream on a dark Rosewood UI. |
| Tasks | One flat list; category was an unconstrained text box that did not drive any view. Every row showed "normal priority" and a category pill. |
| Pip | Occupied roughly a third of the Dashboard with a large illustration, heading, caption, two buttons and XP line, in a different place on the Pip page. |
| Chrome | "LOCAL FIRST" badge, "YOUR WORKSPACE" subtitle, an eyebrow label above nearly every title, and each page wrapped in a bordered panel (panel inside panel). |
| Task categorisation | Already exists as a free-text `category` on every task, plus `projectId` for project-linked tasks. There is no School/Personal/Engineering field and no course entity. |

Implemented before this phase: tasks and steps, calendar, focus sessions, reminders, Pip XP/cosmetics/achievements, engineering projects/milestones/journal/files, nine challenges, pathways, skills, history. Planned but **not** implemented (previously shown as placeholders): courses, grades, goals, habits, notes, portfolio, analytics, integrations, backup UI.

## 2. Navigation

Sidebar is now: **My Day, School, Personal, Engineering (collapsible), Calendar, Focus, Pip**, plus a quiet utility group (Reminders, Settings, About).

- Engineering group contains Projects, Challenges, Skills, Journal (the original page ids are unchanged). It auto-expands when one of its pages is active, collapses otherwise, and is exposed with `aria-expanded`/`aria-controls`.
- All placeholder entries were removed. Nothing in the sidebar leads to an empty page. Roadmap items are listed honestly on the About page.
- School and Personal are scoped views of the one task system (see §4). "All tasks" is one click away from My Day and from the area switcher on every task page.
- Pip, Wardrobe and Achievements are one section with a tab strip, so neither wardrobe nor achievements needs its own sidebar row.
- The breadcrumb shows the group or parent page and the current page (e.g. `Engineering > Challenges`, `My Day > All tasks`); parent crumbs are clickable. Sub-pages highlight their parent in the sidebar.
- Below 760 px the sidebar collapses to icons automatically (previously a CSS-only rule that could hide grouped items); the icon rail shows every Engineering page as its own icon.
- Model lives in `src/navigation.ts` and is unit-tested.

## 3. My Day (Dashboard)

Answers three questions, in this order:

1. **What should I focus on next?** — a single "Next up" strip with the one primary action, *Start focus*. The suggestion is deterministic: highest-priority overdue/due-today task, otherwise the earliest dated task, otherwise the first open task, otherwise "Nothing queued". Start focus opens Focus with that task preselected.
2. **What do I need to do today?** — today's calendar events (all-day first), then overdue and due-today tasks with one-click completion, and a compact progress line (`n of m done · x min focused`, only when real).
3. **What's coming up?** — the next 7 days of tasks and events. Engineering challenge deadlines and project milestones appear *only* when the user has set a date and they are open. An "In progress" card appears only when a challenge is actually in progress.

Removed from the default view: hero banner, static 3-step list, full challenge board, per-feature stat cards, Pip card. Data comes from `src/domain/agenda.ts` (pure, unit-tested); no placeholder or invented values.

## 4. Academic / personal / engineering organisation

- **Reused, no migration.** Areas are derived from the existing `category` text and `projectId` (`src/domain/areas.ts`): exact `School` / `Personal` / `Engineering`; legacy free text is classified by keyword (e.g. "Math homework" → School); empty → Personal (the previous default label); a project-linked task counts as Engineering unless explicitly School.
- The task dialog's free-text Category became an **Area** select (School/Personal/Engineering). An existing custom label is preserved as an extra option, so no stored data is lost or rewritten. New tasks default to the area of the page they were created from.
- The Calendar, My Day and reminders keep reading the same tasks. No second task system was introduced.
- Secondary task fields (description, steps, reminder) moved into a collapsed "Notes, steps and reminder" section that opens automatically when they contain data.
- **Documented gap / future approach:** there is no course entity, so School is a task view, not course management. A later milestone can add a `courseId` (or a first-class `area` column) and map the derived values onto it; `taskArea()` is the single place to change.

## 5. Pip

- Pip now lives in one consistent place: a small dock at the bottom of the sidebar (46 px, level, "here/resting"). Clicking the art pets/wakes Pip; clicking the name opens the Pip page. No XP prompts, no widget heading, no extra buttons.
- The Pip page keeps the full card (rest, explore, hide, level/XP) and adds tabs to Wardrobe and Achievements.
- Settings: "Dashboard widget" became "Sidebar companion" (same stored flag `dashboardPipEnabled`). Hiding Pip (Pip page or Settings) removes the dock; Pip page offers "Show Pip".
- Not changed: companion state machine, XP, cosmetics, achievements, persistence, reduced-motion handling. Engineering events still fire `ENGINEERING_ACCOMPLISHMENT` (no XP) exactly as before.

## 6. Visual clutter

- Pages no longer sit in a bordered panel; cards are used only for grouped content.
- Removed "LOCAL FIRST" badge, the sidebar subtitle, and most eyebrow labels; topbar and sidebar header reduced from 79 px to 56 px.
- One shared segmented control (task areas, Pip sections), one primary button per screen region, outlined low-contrast chips; priority chip only for high/low; overdue is the only coloured status.
- Challenge cards and status chips recoloured to the Rosewood dark surface (they were cream/white).
- Fixed the `?` encoding defect on the old calendar card (the card no longer exists).
- Dead CSS from the old dashboard was deleted from `styles.css`; new rules are in `src/ux.css`.

## 7. Preserved

Untouched logic: workspace/project/challenge services, Rust backend, database, Calendar page behaviour (only its helpers moved to `domain/agenda.ts`), Projects page, Challenges page (guided/professional modes, evidence, native file picker, project conversion, pathways, skills, history), focus engine, reminders, Pip engine. Verified by the existing suite plus new flow tests.

## 8. Tests and actual results (local, 2026-10-31)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (ESLint) | pass, 0 problems |
| `npm test` (Vitest) | 11 files, **47 tests pass** (was 8 files / 26) |
| `npm run build` | pass (CSS 36.2 kB, JS 383 kB) |
| `node scripts/check-acceptance-config.mjs` | pass |
| `cargo fmt --check` (src-tauri) | pass (no Rust files changed) |
| `cargo check/test` | **not run** — no Rust changes; the local MSVC linker limitation was not retried |

New tests: `areas.test.ts`, `agenda.test.ts`, `navigation.test.ts`, and five flows in `App.test.tsx` (grouped navigation and breadcrumb, area filing + My Day completion, no engineering noise on an empty day, Start focus preselecting the task, Pip tabs). Existing task, calendar and onboarding/Pip-persistence tests were updated for new labels only (e.g. nav `Tasks` → `Personal`, heading text).

No native app was launched in this phase. Nothing here claims native verification.

## 9. Visual evidence

Captured with headless Microsoft Edge against the Vite preview (browser mode, in-memory sample data entered through the UI), not the native app.

| Screen | Before | After |
|---|---|---|
| Dashboard / My Day | `evidence/phase3b2/before/dashboard.png` | `evidence/phase3b2/after/dashboard.png` |
| Tasks | `before/tasks.png` | `after/tasks.png` |
| Calendar | `before/calendar.png` | `after/calendar.png` |
| Challenges | `before/challenges.png` | `after/challenges.png` |
| Pip | `before/pip.png` | `after/pip.png` |
| 900 px window | `before/dashboard-narrow.png` | `after/dashboard-narrow.png` |
| 700 px icon rail | — | `after/dashboard-icons.png`, `after/projects-icons.png` |

## 10. Known limitations

- School is a view over tasks, not a course system; legacy categories are classified heuristically (an unusual label lands in Personal until the user picks an Area).
- Engineering tasks have an "Engineering tasks" page reachable from the task area switcher, not from the Engineering sidebar group (the group stays to the four existing destinations).
- Pip no longer appears on My Day. Users who liked the large widget lose it; the setting still hides the dock.
- Challenges and Projects pages keep their internal layout (tabs, cards, forms); only colour and chrome were reconciled. A deeper pass on those pages is a candidate for a later milestone.
- Next-up suggestion ties (same priority and due date) are ordered by input order.
- Screenshots use browser preview data; native rendering (WebView2, DPI scaling) is unverified.
- Preview-mode tests share in-memory workspace state within a test file, so tests that count tasks must run in the order written.

## 11. Git status

See the final report; commits are local and **not pushed**. Author `webswe <botaa109@gmail.com>`, no AI trailers.

## 12. Recommendation for native acceptance

Run the isolated Windows Acceptance build and check:

1. Existing data: tasks from Phase 2/3 appear in the right School/Personal/Engineering views; project-linked tasks appear under Engineering; none lost.
2. My Day with real data: overdue, today's events, Start focus with preselected task, one-click completion, Pip reaction to completion (and no XP from engineering events).
3. Engineering group: Projects, Challenges (start, evidence via native file picker, convert to project), Skills, Journal.
4. Sidebar at the minimum and a restored window width (icon rail at ≤760 px), keyboard tab order, visible focus rings, collapse/expand persistence.
5. Pip dock: pet/wake, open page, hide/show, reduced motion.
6. Calendar create/edit/delete and navigation unchanged; Reminders page reachable from the utility group.
7. Upgrade path: launching over an existing database must not prompt a migration (no schema change was made).
