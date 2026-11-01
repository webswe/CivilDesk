import { useEffect, useId, useRef, type ReactNode } from 'react';
import { weekdayNames } from '../domain/dates';
import type * as service from '../services/personal';

/** Runs a save and refreshes everything; resolves to an error message (for the open dialog) or null. */
export type Run = (operation: () => Promise<void>) => Promise<string | null>;
export interface PersonalOps {
  saveGoal: typeof service.saveGoal; setGoalStatus: typeof service.setGoalStatus; addGoalEntry: typeof service.addGoalEntry; voidGoalEntry: typeof service.voidGoalEntry;
  saveHabit: typeof service.saveHabit; setHabitStatus: typeof service.setHabitStatus; setHabitCheckin: typeof service.setHabitCheckin;
  saveRoutine: typeof service.saveRoutine; setRoutineStatus: typeof service.setRoutineStatus; startRoutine: typeof service.startRoutine; setRoutineStep: typeof service.setRoutineStep; completeRoutine: typeof service.completeRoutine;
  saveRecurrence: typeof service.saveRecurrence; setRecurrenceStatus: typeof service.setRecurrenceStatus; skipOccurrence: typeof service.skipOccurrence; restoreOccurrence: typeof service.restoreOccurrence;
  setDailyPriorities: typeof service.setDailyPriorities;
}
export type PersonalTab = 'overview' | 'goals' | 'habits' | 'routines' | 'week';

/** A modal form. Rendered only while open, so each opening starts from a fresh draft. */
export function FormDialog({ title, submitLabel, error, onClose, onSubmit, children }: { title: string; submitLabel: string; error: string; onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog className="rose-dialog" ref={ref} onClose={onClose} aria-labelledby={id}><form onSubmit={e => { e.preventDefault(); onSubmit(); }}><h2 id={id}>{title}</h2>{children}{error && <p role="alert" className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">{submitLabel}</button></div></form></dialog>;
}

/** Monday–Sunday toggles (0 = Monday). A fieldset with a legend keeps it accessible by keyboard and screen reader. */
export function WeekdayPicker({ legend, value, onChange }: { legend: string; value: number[]; onChange: (days: number[]) => void }) {
  return <fieldset className="weekday-picker"><legend>{legend}</legend>{weekdayNames.map((name, day) => <label key={name} className="weekday-chip"><input type="checkbox" checked={value.includes(day)} onChange={e => onChange(e.target.checked ? [...value, day].sort() : value.filter(d => d !== day))}/><span>{name}</span></label>)}</fieldset>;
}
