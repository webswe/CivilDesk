import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePipController } from './usePipController';

const base = { baseline: 'awake' as const, focusActive: false, focusMode: false, engagement: 'balanced' as const };
let t = 1_000_000;
const clock = () => t;
beforeEach(() => { vi.useFakeTimers(); t = 1_000_000; });
afterEach(() => vi.useRealTimers());
const advance = (ms: number) => act(() => { t += ms; vi.advanceTimersByTime(ms); });

describe('usePipController', () => {
  it('celebrates, shows a short message, and returns to the baseline on its own', () => {
    const { result } = renderHook(() => usePipController(base, clock));
    act(() => { result.current.react('TASK_COMPLETED'); });
    expect(result.current.pose).toBe('celebrating'); expect(result.current.message).toBe('Another task finished.');
    advance(5_000);
    expect(result.current.pose).toBe('awake'); expect(result.current.message).toBeNull();
  });
  it('ignores rapid clicks, cycles the click reaction, and never stacks timers', () => {
    const { result } = renderHook(() => usePipController(base, clock));
    act(() => { result.current.react('PET'); }); const first = result.current.pose;
    act(() => { result.current.react('PET'); });
    expect(result.current.pose).toBe(first);
    advance(800); act(() => { result.current.react('PET'); });
    expect(result.current.pose).not.toBe(first);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('stays quiet during focus and drops a pending reaction when focus starts', () => {
    const { result, rerender } = renderHook((p: typeof base) => usePipController(p, clock), { initialProps: base });
    act(() => { result.current.react('TASK_COMPLETED'); });
    rerender({ ...base, focusActive: true });
    expect(result.current.pose).toBe('focused');
    act(() => { expect(result.current.react('TASK_COMPLETED')).toBeNull(); });
    rerender(base);
    expect(result.current.pose).toBe('awake');
  });
  it('respects quiet mode for celebrations and clears its timer on unmount', () => {
    const { result, unmount } = renderHook(() => usePipController({ ...base, engagement: 'quiet' }, clock));
    act(() => { expect(result.current.react('TASK_COMPLETED')).toBeNull(); result.current.react('PET'); });
    expect(result.current.pose).toBe('affectionate');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lets a sleeping Pip stay asleep', () => {
    const { result } = renderHook(() => usePipController({ ...base, baseline: 'sleeping' }, clock));
    act(() => { expect(result.current.react('PET')).toBeNull(); });
    expect(result.current.pose).toBe('sleeping');
  });
});
