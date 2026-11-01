import type { Engagement, PipState } from './types';

export type PipEvent = 'PET' | 'EXPLORE' | 'REST' | 'WAKE' | 'IDLE' | 'TASK_COMPLETED' | 'ENGINEERING_ACCOMPLISHMENT' | 'FOCUS_START' | 'FOCUS_END';
export interface PipContext { focusMode: boolean; engagement: Engagement; lastReactionAt: number; now: number }
export interface PipTransition { state: PipState; lastReactionAt: number }

export function transitionPip(state: PipState, event: PipEvent, context: PipContext): PipTransition {
  if (event === 'FOCUS_START') return { state: 'focused', lastReactionAt: context.lastReactionAt };
  if (event === 'FOCUS_END') return { state: 'relaxed', lastReactionAt: context.lastReactionAt };
  if (context.focusMode) return { state: 'focused', lastReactionAt: context.lastReactionAt };
  if (event === 'WAKE') return { state: 'awake', lastReactionAt: context.lastReactionAt };
  if (event === 'REST') return { state: 'sleeping', lastReactionAt: context.lastReactionAt };
  if (state === 'sleeping') return { state, lastReactionAt: context.lastReactionAt };
  if (event === 'PET') return { state: 'affectionate', lastReactionAt: context.now };
  if (event === 'EXPLORE') return { state: 'curious', lastReactionAt: context.now };
  if (event === 'TASK_COMPLETED' || event === 'ENGINEERING_ACCOMPLISHMENT') {
    if (context.engagement === 'quiet' || context.now - context.lastReactionAt < 60_000) return { state, lastReactionAt: context.lastReactionAt };
    return { state: 'celebrating', lastReactionAt: context.now };
  }
  if (event === 'IDLE') return { state: state === 'celebrating' || state === 'affectionate' || state === 'curious' ? 'relaxed' : state, lastReactionAt: context.lastReactionAt };
  return { state, lastReactionAt: context.lastReactionAt };
}

// ---------------------------------------------------------------------------------------------------------------------
// Phase 4E: transient reactions. Persisted state (PipState in the companion record) is only a calm baseline. Short-lived
// expressions are chosen here from verified events and live in the presentation layer, so they never survive a restart.
// Priority when presenting: sleeping > focus > active reaction > baseline. Hidden/disabled Pip renders nothing at all.
// ---------------------------------------------------------------------------------------------------------------------
export type PipPose = PipState | 'waking';
export type PipReactionEvent = 'PET' | 'EXPLORE' | 'WAKE' | 'TASK_COMPLETED' | 'FOCUS_COMPLETED' | 'ACHIEVEMENT' | 'HABIT_PROGRESS' | 'ENGINEERING_ACCOMPLISHMENT';
export interface PipReaction { pose: PipPose; until: number; message: string | null; rank: number }
export interface ReactionContext {
  baseline: PipState; focusActive: boolean; focusMode: boolean; engagement: Engagement;
  now: number; lastCelebrationAt: number; lastClickAt: number; clickCount: number; current: PipReaction | null;
}
type ReactionPose = 'affectionate' | 'curious' | 'happy' | 'celebrating' | 'waking';
export const REACTION_MS: Record<ReactionPose, number> = { affectionate: 3500, curious: 3000, happy: 3000, celebrating: 4500, waking: 1200 };
export const CLICK_GAP_MS = 700;
export const CELEBRATION_COOLDOWN_MS = 60_000;
export const ACHIEVEMENT_COOLDOWN_MS = 10_000;
/** Deterministic variation: successive clicks cycle through a fixed set instead of repeating or randomising. */
export const CLICK_CYCLE = ['affectionate', 'curious', 'happy'] as const;
const MESSAGES: Partial<Record<PipReactionEvent, string>> = {
  TASK_COMPLETED: 'Another task finished.', FOCUS_COMPLETED: 'Focus session complete.', ACHIEVEMENT: 'Achievement unlocked!',
  HABIT_PROGRESS: 'Nice work!', ENGINEERING_ACCOMPLISHMENT: 'Nice work!',
};
const RANK: Record<ReactionPose, number> = { waking: 1, affectionate: 1, curious: 1, happy: 2, celebrating: 3 };

/** The pose to draw. Sleeping and focus always win; an expired reaction is ignored; legacy persisted poses relax to awake. */
export function presentedPose(baseline: PipState, focusActive: boolean, focusMode: boolean, reaction: PipReaction | null, now: number): PipPose {
  if (baseline === 'sleeping') return 'sleeping';
  if (focusActive || focusMode) return 'focused';
  if (reaction && reaction.until > now) return reaction.pose;
  return baseline === 'relaxed' ? 'relaxed' : 'awake';
}

/** Chooses a reaction for an event, or null when it should be silent. Never touches XP, achievements or application data. */
export function reactTo(event: PipReactionEvent, c: ReactionContext): PipReaction | null {
  if (c.baseline === 'sleeping' && event !== 'WAKE') return null;
  if (event === 'WAKE') return { pose: 'waking', until: c.now + REACTION_MS.waking, message: null, rank: RANK.waking };
  if (c.focusActive || c.focusMode) return null;
  if (event === 'PET' || event === 'EXPLORE') {
    if (c.now - c.lastClickAt < CLICK_GAP_MS) return null;
    const pose: ReactionPose = event === 'EXPLORE' ? 'curious' : c.engagement === 'quiet' ? 'affectionate' : CLICK_CYCLE[c.clickCount % CLICK_CYCLE.length] ?? 'affectionate';
    if (c.current && c.current.until > c.now && c.current.rank > RANK[pose]) return null;
    return { pose, until: c.now + REACTION_MS[pose], message: null, rank: RANK[pose] };
  }
  if (c.engagement === 'quiet') return null;
  const gap = event === 'ACHIEVEMENT' ? ACHIEVEMENT_COOLDOWN_MS : CELEBRATION_COOLDOWN_MS;
  if (c.now - c.lastCelebrationAt < gap) return null;
  const pose: ReactionPose = event === 'HABIT_PROGRESS' ? 'happy' : 'celebrating';
  // A rapid burst is combined into the reaction already showing instead of queuing a second one for later.
  if (c.current && c.current.until > c.now && c.current.rank >= RANK[pose] && event !== 'ACHIEVEMENT') return null;
  return { pose, until: c.now + REACTION_MS[pose], message: MESSAGES[event] ?? null, rank: RANK[pose] };
}

export interface RewardSeen { ids: Set<string>; earned: Set<string> }
/**
 * Turns authoritative reward data (reward_events and earned achievements, already deduplicated by the backend) into at most
 * one reaction event. The first observation only records what already exists, so a restart, remount or reload never replays
 * old celebrations. Anything new while Pip is quiet is still recorded as seen and is never queued for later.
 */
export function detectRewardSignal(prev: RewardSeen | null, history: { id: string; kind: string }[], earned: string[]): { next: RewardSeen; event: PipReactionEvent | null } {
  const next: RewardSeen = { ids: new Set(history.map(h => h.id)), earned: new Set(earned) };
  if (!prev) return { next, event: null };
  const fresh = history.filter(h => !prev.ids.has(h.id));
  if (earned.some(id => !prev.earned.has(id))) return { next, event: 'ACHIEVEMENT' };
  if (fresh.some(h => h.kind === 'focus_completed')) return { next, event: 'FOCUS_COMPLETED' };
  if (fresh.some(h => h.kind === 'task_completed')) return { next, event: 'TASK_COMPLETED' };
  return { next, event: null };
}

/**
 * Measurable progress toward an achievement, from data the app already holds (total XP and the recent reward history). Only
 * counts that the data can establish are returned; anything else is null so the interface never invents a number.
 * Reward history is limited to the 50 most recent events, which is complete for every target below ten.
 */
export function achievementProgress(id: string, p: { xp: number; history: { kind: string }[] }): { current: number; target: number } | null {
  const count = (kind: string) => p.history.filter(h => h.kind === kind).length;
  const targets: Record<string, [number, number]> = {
    first_task: [count('task_completed'), 1], five_tasks: [count('task_completed'), 5], ten_tasks: [count('task_completed'), 10],
    first_focus: [count('focus_completed'), 1], three_focus: [count('focus_completed'), 3], ten_focus: [count('focus_completed'), 10],
    level_five: [p.xp, 400],
  };
  const t = targets[id];
  return t ? { current: Math.min(t[0], t[1]), target: t[1] } : null;
}
