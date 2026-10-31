import { describe, expect, it } from 'vitest';
import { transitionPip } from './pip';

const context = { focusMode: false, engagement: 'balanced' as const, lastReactionAt: 0, now: 100_000 };
describe('Pip behavior', () => {
  it('sleeps and wakes intentionally', () => { expect(transitionPip('awake','REST',context).state).toBe('sleeping'); expect(transitionPip('sleeping','PET',context).state).toBe('sleeping'); expect(transitionPip('sleeping','WAKE',context).state).toBe('awake'); });
  it('prioritizes focus above interaction and celebration', () => { expect(transitionPip('happy','FOCUS_START',context).state).toBe('focused'); expect(transitionPip('focused','TASK_COMPLETED',{...context,focusMode:true}).state).toBe('focused'); });
  it('respects quiet mode and cooldown', () => { expect(transitionPip('awake','TASK_COMPLETED',{...context,engagement:'quiet'}).state).toBe('awake'); expect(transitionPip('awake','TASK_COMPLETED',{...context,lastReactionAt:90_000}).state).toBe('awake'); expect(transitionPip('awake','TASK_COMPLETED',context).state).toBe('celebrating'); });
  it('reacts gently to engineering work without touching rewards',()=>{expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',context).state).toBe('celebrating');expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',{...context,engagement:'quiet'}).state).toBe('awake');expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',{...context,focusMode:true}).state).toBe('focused');});
});
