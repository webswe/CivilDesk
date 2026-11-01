import { describe, expect, it } from 'vitest';
import { detectRewardSignal, transitionPip, reactTo, presentedPose, CLICK_CYCLE, type ReactionContext, type PipReaction } from './pip';

const context = { focusMode: false, engagement: 'balanced' as const, lastReactionAt: 0, now: 100_000 };
describe('Pip behavior', () => {
  it('sleeps and wakes intentionally', () => { expect(transitionPip('awake','REST',context).state).toBe('sleeping'); expect(transitionPip('sleeping','PET',context).state).toBe('sleeping'); expect(transitionPip('sleeping','WAKE',context).state).toBe('awake'); });
  it('prioritizes focus above interaction and celebration', () => { expect(transitionPip('happy','FOCUS_START',context).state).toBe('focused'); expect(transitionPip('focused','TASK_COMPLETED',{...context,focusMode:true}).state).toBe('focused'); });
  it('respects quiet mode and cooldown', () => { expect(transitionPip('awake','TASK_COMPLETED',{...context,engagement:'quiet'}).state).toBe('awake'); expect(transitionPip('awake','TASK_COMPLETED',{...context,lastReactionAt:90_000}).state).toBe('awake'); expect(transitionPip('awake','TASK_COMPLETED',context).state).toBe('celebrating'); });
  it('reacts gently to engineering work without touching rewards',()=>{expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',context).state).toBe('celebrating');expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',{...context,engagement:'quiet'}).state).toBe('awake');expect(transitionPip('awake','ENGINEERING_ACCOMPLISHMENT',{...context,focusMode:true}).state).toBe('focused');});
});

const rc = (o: Partial<ReactionContext> = {}): ReactionContext => ({ baseline: 'awake', focusActive: false, focusMode: false, engagement: 'balanced', now: 1_000_000, lastCelebrationAt: 0, lastClickAt: 0, clickCount: 0, current: null, ...o });
describe('Pip reactions (phase 4E)', () => {
  it('stays silent during focus, sleep and quiet mode, except an explicit wake', () => {
    expect(reactTo('TASK_COMPLETED', rc({ focusActive: true }))).toBeNull();
    expect(reactTo('PET', rc({ focusMode: true }))).toBeNull();
    expect(reactTo('TASK_COMPLETED', rc({ baseline: 'sleeping' }))).toBeNull();
    expect(reactTo('TASK_COMPLETED', rc({ engagement: 'quiet' }))).toBeNull();
    expect(reactTo('WAKE', rc({ baseline: 'sleeping' }))?.pose).toBe('waking');
  });
  it('celebrates verified accomplishments briefly with a short message, then respects the cooldown', () => {
    const r = reactTo('TASK_COMPLETED', rc())!;
    expect(r.pose).toBe('celebrating'); expect(r.message).toBe('Another task finished.'); expect(r.until - 1_000_000).toBeLessThan(10_000);
    expect(reactTo('TASK_COMPLETED', rc({ lastCelebrationAt: 1_000_000 - 30_000 }))).toBeNull();
    expect(reactTo('FOCUS_COMPLETED', rc())!.message).toBe('Focus session complete.');
    expect(reactTo('HABIT_PROGRESS', rc())!.pose).toBe('happy');
  });
  it('lets an achievement outrank a celebration already showing, but combines plain bursts', () => {
    const showing: PipReaction = { pose: 'celebrating', until: 1_003_000, message: 'x', rank: 3 };
    expect(reactTo('ACHIEVEMENT', rc({ current: showing, lastCelebrationAt: 1_000_000 - 20_000 }))!.message).toBe('Achievement unlocked!');
    expect(reactTo('TASK_COMPLETED', rc({ current: showing }))).toBeNull();
  });
  it('varies clicks deterministically and ignores rapid clicking', () => {
    expect(CLICK_CYCLE.map((_, i) => reactTo('PET', rc({ clickCount: i }))!.pose)).toEqual([...CLICK_CYCLE]);
    expect(reactTo('PET', rc({ lastClickAt: 1_000_000 - 100 }))).toBeNull();
    expect(reactTo('PET', rc({ engagement: 'quiet', clickCount: 1 }))!.pose).toBe('affectionate');
  });
  it('presents sleeping, then focus, then an active reaction, then a calm baseline', () => {
    const live: PipReaction = { pose: 'celebrating', until: 2_000, message: null, rank: 3 };
    expect(presentedPose('sleeping', true, false, live, 1_000)).toBe('sleeping');
    expect(presentedPose('awake', true, false, live, 1_000)).toBe('focused');
    expect(presentedPose('awake', false, true, live, 1_000)).toBe('focused');
    expect(presentedPose('awake', false, false, live, 1_000)).toBe('celebrating');
    expect(presentedPose('awake', false, false, live, 2_000)).toBe('awake');
  });
  it('never shows a stale persisted expression after a restart', () => {
    for (const legacy of ['celebrating', 'affectionate', 'curious', 'happy', 'startled', 'bored', 'sleepy', 'focused'] as const) expect(presentedPose(legacy, false, false, null, 1)).toBe('awake');
    expect(presentedPose('relaxed', false, false, null, 1)).toBe('relaxed');
  });
});

describe('reward signal detection', () => {
  const h = (id: string, kind = 'task_completed') => ({ id, kind });
  it('records existing rewards on first observation without reacting', () => {
    const first = detectRewardSignal(null, [h('a'), h('b')], ['first_task']);
    expect(first.event).toBeNull();
    expect(detectRewardSignal(first.next, [h('a'), h('b')], ['first_task']).event).toBeNull();
  });
  it('reacts once to a new reward event and never to the same one again', () => {
    const seen = detectRewardSignal(null, [h('a')], []).next;
    const one = detectRewardSignal(seen, [h('b'), h('a')], []);
    expect(one.event).toBe('TASK_COMPLETED');
    expect(detectRewardSignal(one.next, [h('b'), h('a')], []).event).toBeNull();
  });
  it('prefers an achievement over the task that earned it, and maps focus completion', () => {
    const seen = detectRewardSignal(null, [], []).next;
    expect(detectRewardSignal(seen, [h('a')], ['first_task']).event).toBe('ACHIEVEMENT');
    expect(detectRewardSignal(seen, [h('f', 'focus_completed')], []).event).toBe('FOCUS_COMPLETED');
  });
});
