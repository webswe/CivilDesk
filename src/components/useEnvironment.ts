import { useEffect, useState } from 'react';

/** The operating-system reduced-motion preference, kept live. Absent matchMedia (tests) means no preference. */
export function usePrefersReducedMotion(): boolean {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(() => !!query()?.matches);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setReduced(q.matches);
    on();
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Marks the document while the window is hidden or minimised so decorative animation can pause. */
export function useWindowHidden(): void {
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('window-hidden', document.hidden);
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => { document.removeEventListener('visibilitychange', apply); document.documentElement.classList.remove('window-hidden'); };
  }, []);
}
