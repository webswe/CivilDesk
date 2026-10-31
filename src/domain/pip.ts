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
