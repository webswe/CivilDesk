import { useCallback, useEffect, useRef, useState } from 'react';
import { presentedPose, reactTo, type PipPose, type PipReaction, type PipReactionEvent } from '../domain/pip';
import type { Engagement, PipState } from '../domain/types';

interface Inputs { baseline: PipState; focusActive: boolean; focusMode: boolean; engagement: Engagement }
/**
 * The single owner of the transient Pip expression. Authoritative events go in through `react`; the pure `reactTo` rules choose
 * a reaction; one timer returns Pip to its baseline. Nothing here writes to the database or to any reward, task or focus state.
 */
export function usePipController(inputs: Inputs, clock: () => number = Date.now) {
  const [reaction, setReaction] = useState<PipReaction | null>(null);
  const latest = useRef(inputs); latest.current = inputs;
  const memory = useRef({ lastCelebrationAt: 0, lastClickAt: 0, clickCount: 0, current: null as PipReaction | null });

  const react = useCallback((event: PipReactionEvent) => {
    const m = memory.current; const now = clock();
    const next = reactTo(event, { ...latest.current, now, lastCelebrationAt: m.lastCelebrationAt, lastClickAt: m.lastClickAt, clickCount: m.clickCount, current: m.current });
    if (!next) return null;
    if (event === 'PET' || event === 'EXPLORE') { m.lastClickAt = now; m.clickCount += 1; }
    else if (event !== 'WAKE') m.lastCelebrationAt = now;
    m.current = next; setReaction(next); return next;
  }, [clock]);

  // At most one timer: it ends the current reaction, and is cleared if the reaction changes or the component unmounts.
  useEffect(() => {
    if (!reaction) return;
    const wait = Math.max(0, reaction.until - clock());
    const id = setTimeout(() => { memory.current.current = null; setReaction(null); }, wait);
    return () => clearTimeout(id);
  }, [reaction, clock]);

  // Focus always wins; a reaction from before the session must not reappear afterwards.
  useEffect(() => { if ((inputs.focusActive || inputs.focusMode) && reaction) { memory.current.current = null; setReaction(null); } }, [inputs.focusActive, inputs.focusMode, reaction]);

  const pose: PipPose = presentedPose(inputs.baseline, inputs.focusActive, inputs.focusMode, reaction, clock());
  const message = reaction && reaction.until > clock() && pose === reaction.pose ? reaction.message : null;
  return { pose, message, react };
}
