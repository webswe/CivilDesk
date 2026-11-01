# Phase 4E — Pip Evolution

Status: **implemented locally and committed; not pushed; native E2E not yet run; visual review by the owner pending.**

## 1. Starting Git state
`main` at `95b7b31`, equal to `origin/main`, working tree clean.

## 2. Existing Pip architecture (audited, not replaced)
- `src/domain/pip.ts` — pure `transitionPip(state, event, context)`; persisted `PipState` lives in the companion record (SQLite `settings`, key `companion`).
- `src/components/PipIllustration.tsx` — original SVG; CSS animation (`pip-bob`, `pip-breathe`) in `styles.css`; `still` class when reduced motion.
- `App.tsx` — `PipDock` (sidebar), `PipCard` (Pip page), `Settings` (Show Pip, Sidebar companion, Engagement level quiet/balanced/playful, Focus mode, Reduced motion), `pip()` dispatcher.
- Rust `productivity.rs` — `reward_events` (idempotent `INSERT OR IGNORE`, 25 XP per task/focus), `earned_achievements`, `cosmetic_unlocks`, `pip_customization`, `equip_cosmetic` (rejects locked items). Level = `xp / 100 + 1`.
- `ProductivityPages.tsx` — Wardrobe and Achievements pages; `workspace.ts` — definitions and the browser-preview store.

### Defects found in the existing behaviour (fixed)
1. Transient states (`celebrating`, `affectionate`, `curious`) were **written to the database**, and nothing ever sent `IDLE`, so Pip stayed celebrating until the next event and **after a restart**.
2. Every click saved the snapshot (a database write per click, no throttle).
3. Completing a focus session could leave the persisted state `focused` when the celebration was suppressed.
4. The OS reduced-motion preference only applied `animation-duration: .01ms` to infinite animations (a rapid loop) instead of stopping them.
5. Celebration was triggered by comparing history length in one handler, so task completion from other paths (and focus completion) had separate, partial logic.

## 3. Reused components
Everything above. No new XP processor, no parallel state store, no new tables.

## 4–5. Companion states and transition rules
Persisted baseline (unchanged values): `awake`, `relaxed`, `sleeping`, `focused`. Transient poses (presentation only, never saved): `affectionate`, `curious`, `happy`, `celebrating`, `waking`.

Presentation priority (`presentedPose`): hidden/disabled (nothing rendered) → sleeping → focus (active session or Focus mode) → live reaction → calm baseline. Any legacy persisted expression (`celebrating`, `affectionate`, …, and a stale `focused`) is shown as `awake`, so nothing replays after a restart.
Reactions last 1.2–4.5 s, are cleared by **one** timer owned by `usePipController`, are dropped when focus starts, and cannot queue.

## 6. Productivity reaction mapping
| Verified event | Source | Reaction |
|---|---|---|
| New `reward_events` row, kind `task_completed` | backend | celebrating + "Another task finished." |
| New `reward_events` row, kind `focus_completed` | backend | celebrating + "Focus session complete." |
| Newly earned achievement | backend | celebrating + "Achievement unlocked!" (outranks the task/focus that earned it) |
| Habit check-in / routine completion | existing `onProgress` after a successful save | happy + "Nice work!" (no XP) |
| Click / Explore | user | affectionate → curious → happy cycle (deterministic) |

Not wired (no authoritative completion event is exposed to the front end that is not already a reward event): milestone completion, challenge completion, goal completion. They are listed under limitations rather than inferred from UI lists.

## 7. XP preservation
No reward amounts, thresholds or award code paths changed. Reactions only *read* `workspace.progression`. `detectRewardSignal` seeds on first load, so remounts, reloads and restarts never replay. Clicks never touch the database.

## 8. Achievement integration
Added `ten_tasks` (Dusk Pip) and `ten_focus` (Sage Pip), awarded with `count >= 10` through the existing idempotent `achievement()`; a user already past ten receives it on their next completion, earlier rewards untouched, XP unchanged. Achievements page now shows measurable progress for unearned items (`achievementProgress`), from XP and the reward history (complete for any target below ten), and nothing otherwise. Earn dates are not shown: the front end does not receive them.

## 9. New cosmetics
Two original SVG colour variants of the existing body: **Dusk Pip** (lavender), **Sage Pip** (sage). Same silhouette, so scarf and headphones layer correctly. No new category, no rendering rewrite.

## 10. Wardrobe behaviour
Locked/Unlocked/Equipped text with requirement; locked items show a disabled "Locked" button (and the backend still rejects them); Preview never equips; "Restore default look" retained; equipped state persists (`pip_customization`).

## 11. Companion settings
Existing controls retained. The Engagement help text now states exactly what each level does: **Quiet** — Pip only responds to clicks; **Balanced/Playful** — brief celebration and short message, never during focus. No new preference fields were added (that would have needed a Rust struct change). *Animation intensity* and a separate *messages* toggle were deliberately not added: Quiet covers messages, reduced motion covers movement.

## 12. Focus suppression
Active session or Focus mode: no reactions, clicks included; a reaction pending when focus starts is cleared. Rewards earned during focus are still paid, are recorded as seen, and are **not** celebrated later.

## 13. Accessibility
OS `prefers-reduced-motion` (live) and the app setting both give a still Pip (state still readable from face, caption and `aria-label`, e.g. "Pip is celebrating"); the message region is `aria-live="polite"`; Preview buttons have specific labels; no audio, no flashing (blink is a single slow eyelid close every ~6.5 s; no looping effects).

## 14. Persistence changes
None to the schema (still v9, 51 tables). Cosmetic ids `dusk`/`sage` are stored in existing text columns.

## 15–16. Animation and performance
CSS-only transforms on the existing SVG; no animation library. One timer at most, cleaned up on unmount; no per-frame React state; animation paused while the window is hidden (`visibilitychange` → `window-hidden`); infinite animations are removed, not shortened, under reduced motion.

## 17–18. Test results (this machine)
- Frontend: **209 tests / 30 files** pass (baseline 186). New: reaction rules, presentation priority, reward-signal dedupe, controller timers/cooldown/focus/quiet/unmount, wardrobe lock/preview/equip, achievement progress, App-level pet-not-persisted, achievement celebration, quiet mode, reduced motion.
- `tsc`, ESLint, production build: pass.
- Rust: **72 tests** pass (baseline 69); `cargo fmt --check` and `cargo clippy -D warnings` clean. New: ten-task unlock with XP unchanged and locked rejection, pre-4E user upgrade (single award, earlier rewards kept), ten-focus unlock, persistence across reopen.

## 19. Native E2E coverage
New `e2e/specs/12-pip-evolution.e2e.mjs` (6 tests; expected total **77**). **Not run**: it executes in GitHub Actions after an authorised push, and `tauri-driver` is not available locally. Covers: calm start and clicks without XP or saved-state change; locked wardrobe, preview, backend refusal; XP once + celebration + no replay after reload; equip and restart persistence; focus quiet + reward still paid + no stale focus; reduced motion + persistence. It asserts semantic pose labels, not timing. Known risk: the celebration assertion relies on a 4.5 s window.

## 20–21. Local visual verification and screenshots
Real `App` rendered in preview mode in headless Edge (not the Tauri window) using a temporary harness that has been removed. `docs/phase4e/`: `pip-1280.png`, `pip-760.png`, `ward-1280.png`, `ward-700.png`, `ach-1280.png`. Inspected: new styles with scarf/headphones, wardrobe states, achievements with progress, collapsed dock at 700 px. **Not inspected:** actual animation motion (stills cannot show it), the Tauri window, 900/1600 px, hidden-window pausing. Harness artifacts visible in some shots (styles set without unlocking, cleared history) are not app behaviour.

## 22. Known limitations
Milestone/challenge/goal reactions not wired; no earn dates; progress for history-based counts is limited to the 50 most recent reward events; `sleepy`/`bored`/`startled` poses remain defined but are not triggered; `waking` is shown only when Pip is woken.

## 23. Remaining risks
Native E2E unrun; 06-pip's existing "Pip likes having you around." assertion now depends on the 3.5 s affectionate window being still open when the page opens (a fast WebDriver flow, but timing-sensitive); animation feel unreviewed.

## 24. Final Git state
See the final report. Local commits only; nothing pushed.
