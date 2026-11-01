import { beforeEach, describe, expect, it } from 'vitest';
import { addGoalEntry, completeRoutine, generateRecurring, loadPersonal, resetPersonalPreview, restoreOccurrence, saveGoal, saveHabit, saveRecurrence, saveRoutine, setDailyPriorities, setGoalStatus, setHabitCheckin, setHabitStatus, setRecurrenceStatus, setRoutineStatus, setRoutineStep, skipOccurrence, startRoutine, voidGoalEntry, type GoalInput, type RecurrenceInput } from './personal';
import { previewWorkspace, saveTask, setTaskCompleted, deleteTask } from './workspace';

const TODAY = '2026-11-04'; // Wednesday
const goal = (over: Partial<GoalInput> = {}): GoalInput => ({ id: 'g', title: 'Read', description: '', kind: 'numeric', target: 300, unit: 'pages', period: null, startDate: '2026-11-02', targetDate: null, ...over });
const rule = (over: Partial<RecurrenceInput> = {}): RecurrenceInput => ({ id: 'rule', title: 'Take out trash', description: '', priority: 'normal', frequency: 'daily', weekdays: [], monthDay: null, startDate: '2026-10-01', endDate: null, dueTime: null, reminderOffsetMinutes: null, ...over });
const taskIds = () => previewWorkspace().tasks.map(t => t.id).sort();
const reject = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };

beforeEach(() => { resetPersonalPreview(); const w = previewWorkspace(); w.tasks = []; w.sessions = []; w.progression.xp = 0; w.progression.history = []; w.progression.earned = []; w.progression.unlocked = []; });

describe('goals', () => {
  it('validates types, keeps entries auditable and rejects invalid progress', async () => {
    await reject(saveGoal(goal({ target: null })));
    await reject(saveGoal(goal({ kind: 'binary', target: 5 })));
    await reject(saveGoal(goal({ kind: 'periodic', period: null })));
    await saveGoal(goal(), TODAY);
    await addGoalEntry({ id: 'e1', goalId: 'g', entryDate: '2026-11-02', amount: 40, note: '' }, TODAY);
    await addGoalEntry({ id: 'e1', goalId: 'g', entryDate: '2026-11-02', amount: 40, note: '' }, TODAY); // repeated submit
    await addGoalEntry({ id: 'e2', goalId: 'g', entryDate: '2026-11-03', amount: 25, note: '' }, TODAY);
    for (const amount of [0, -5, 1.5]) await reject(addGoalEntry({ id: 'bad', goalId: 'g', entryDate: TODAY, amount, note: '' }, TODAY));
    await reject(addGoalEntry({ id: 'bad', goalId: 'g', entryDate: '2026-11-05', amount: 1, note: '' }, TODAY)); // future
    await reject(addGoalEntry({ id: 'bad', goalId: 'g', entryDate: '2026-11-01', amount: 1, note: '' }, TODAY)); // before the goal began
    await voidGoalEntry('e2'); await voidGoalEntry('e2');
    const data = await loadPersonal();
    expect(data.goalEntries).toHaveLength(2);
    expect(data.goalEntries.filter(e => e.voidedAtMs === null).map(e => e.id)).toEqual(['e1']);
    expect(previewWorkspace().progression.xp).toBe(0); // progress never pays XP
  });
  it('completion is manual, reopenable, and a repeating goal cannot be completed', async () => {
    await saveGoal(goal({ id: 'b', kind: 'binary', target: null }), TODAY);
    await saveGoal(goal({ id: 'w', kind: 'periodic', period: 'weekly', target: 100 }), TODAY);
    await setGoalStatus('b', 'completed'); await setGoalStatus('b', 'completed');
    expect((await loadPersonal()).goals.find(g => g.id === 'b')).toMatchObject({ status: 'completed' });
    await setGoalStatus('b', 'active');
    expect((await loadPersonal()).goals.find(g => g.id === 'b')).toMatchObject({ status: 'active', completedAtMs: null });
    await reject(setGoalStatus('w', 'completed'));
    await setGoalStatus('w', 'paused');
    await reject(addGoalEntry({ id: 'x', goalId: 'w', entryDate: TODAY, amount: 5, note: '' }, TODAY));
  });
  it('a periodic target change starts with the current period and leaves earlier ones alone', async () => {
    await saveGoal(goal({ kind: 'periodic', period: 'weekly', target: 100 }), '2026-11-02');
    await saveGoal(goal({ kind: 'periodic', period: 'weekly', target: 160 }), TODAY);
    await saveGoal(goal({ kind: 'periodic', period: 'weekly', target: 200 }), '2026-11-10');
    expect((await loadPersonal()).goalTargets.map(t => [t.effectiveFrom, t.target])).toEqual([['2026-11-02', 160], ['2026-11-09', 200]]);
    await reject(saveGoal(goal({ kind: 'periodic', period: 'monthly', target: 200 }), TODAY));
  });
});

describe('habits', () => {
  it('check-ins are idempotent, undoable and limited to real days', async () => {
    await saveHabit({ id: 'h', name: 'Read', description: '', frequency: 'daily', targetCount: 1, preferredDays: [], startDate: '2026-11-02' }, TODAY);
    for (let i = 0; i < 3; i++) await setHabitCheckin('h', TODAY, true, TODAY);
    expect((await loadPersonal()).habitCheckins).toHaveLength(1);
    await reject(setHabitCheckin('h', '2026-11-05', true, TODAY)); // future
    await reject(setHabitCheckin('h', '2026-11-01', true, TODAY)); // before it started
    await setHabitCheckin('h', TODAY, false, TODAY); await setHabitCheckin('h', TODAY, false, TODAY);
    expect((await loadPersonal()).habitCheckins).toHaveLength(0);
    await setHabitCheckin('h', '2026-11-03', true, TODAY);
    await setHabitStatus('h', 'paused');
    await reject(setHabitCheckin('h', TODAY, true, TODAY));
    await setHabitStatus('h', 'archived');
    expect((await loadPersonal()).habitCheckins).toHaveLength(1); // archived habits keep their history
    await reject(saveHabit({ id: 'h', name: 'Read', description: '', frequency: 'daily', targetCount: 1, preferredDays: [], startDate: null }, TODAY));
  });
  it('schedule edits add a dated row instead of rewriting the past', async () => {
    await reject(saveHabit({ id: 'x', name: 'x', description: '', frequency: 'daily', targetCount: 3, preferredDays: [], startDate: null }, TODAY));
    await saveHabit({ id: 'h', name: 'Run', description: '', frequency: 'daily', targetCount: 1, preferredDays: [], startDate: '2026-11-02' }, '2026-11-02');
    await saveHabit({ id: 'h', name: 'Run', description: '', frequency: 'daily', targetCount: 1, preferredDays: [], startDate: null }, TODAY);
    expect((await loadPersonal()).habitSchedules).toHaveLength(1);
    await saveHabit({ id: 'h', name: 'Run', description: '', frequency: 'weekly', targetCount: 4, preferredDays: [4, 0, 0, 2], startDate: null }, '2026-11-10');
    const s = (await loadPersonal()).habitSchedules;
    expect(s.map(x => [x.frequency, x.effectiveFrom])).toEqual([['daily', '2026-11-02'], ['weekly', '2026-11-09']]);
    expect(s[1]!.preferredDays).toEqual([0, 2, 4]);
  });
});

describe('routines', () => {
  const steps = [{ id: 's1', title: 'Make bed' }, { id: 's2', title: 'Review tasks' }];
  it('one run per day, partial progress is kept, history is snapshotted', async () => {
    await reject(saveRoutine({ id: 'r', name: 'Morning', description: '', scheduleDays: [], scheduleTime: null, steps: [] }));
    await reject(saveRoutine({ id: 'r', name: 'Morning', description: '', scheduleDays: [], scheduleTime: '07:00', steps }));
    await saveRoutine({ id: 'r', name: 'Morning', description: '', scheduleDays: [], scheduleTime: null, steps });
    await startRoutine('r', 'run-1', '2026-11-03', TODAY); await startRoutine('r', 'run-1b', '2026-11-03', TODAY);
    expect((await loadPersonal()).executions).toHaveLength(1);
    await setRoutineStep('run-1', 0, true);
    await reject(completeRoutine('run-1')); // a step is open: stays in progress
    await saveRoutine({ id: 'r', name: 'Morning', description: '', scheduleDays: [], scheduleTime: null, steps: [{ id: 's9', title: 'Stretch' }, steps[1]!] });
    const run = (await loadPersonal()).executions[0]!;
    expect(run.steps.map(s => s.title)).toEqual(['Make bed', 'Review tasks']);
    expect(run.steps[0]!.doneAtMs).not.toBeNull();
    await setRoutineStep('run-1', 1, true);
    await completeRoutine('run-1'); await completeRoutine('run-1');
    await reject(setRoutineStep('run-1', 1, false));
    await startRoutine('r', 'run-2', TODAY, TODAY);
    const data = await loadPersonal();
    expect(data.executions).toHaveLength(2);
    expect(data.executions.find(e => e.id === 'run-2')!.steps[0]!.title).toBe('Stretch');
    expect(previewWorkspace().tasks).toHaveLength(0); // steps are not tasks
    await setRoutineStatus('r', 'paused');
    await reject(startRoutine('r', 'run-3', '2026-11-02', TODAY));
  });
});

describe('recurring responsibilities', () => {
  it('generates a bounded window once and never before today', async () => {
    await saveRecurrence(rule(), TODAY);
    await generateRecurring(TODAY); await generateRecurring(TODAY);
    expect(taskIds()).toEqual(['rec-rule-2026-11-04', 'rec-rule-2026-11-05', 'rec-rule-2026-11-06']);
    await generateRecurring('2027-02-10'); // the app was closed for three months: no backlog
    expect(previewWorkspace().tasks.filter(t => t.dueDate! >= '2027-02-10')).toHaveLength(3);
    expect(previewWorkspace().tasks).toHaveLength(6);
    expect((await loadPersonal()).occurrences).toHaveLength(6);
  });
  it('uses the documented dates for weekly and monthly rules', async () => {
    await saveRecurrence(rule({ id: 'tue', frequency: 'weekly', weekdays: [1] }), TODAY);
    await saveRecurrence(rule({ id: 'rent', frequency: 'monthly', monthDay: 31 }), '2027-02-28');
    const due = (prefix: string) => previewWorkspace().tasks.filter(t => t.id.startsWith(prefix)).map(t => t.dueDate).sort();
    expect(due('rec-tue-')).toEqual(['2026-11-10', '2026-11-17']);
    expect(due('rec-rent-')).toEqual(['2027-02-28', '2027-03-31']);
  });
  it('completing and skipping occurrences are independent and neither duplicates a reward', async () => {
    await saveRecurrence(rule(), TODAY);
    await setTaskCompleted('rec-rule-2026-11-04', true); await setTaskCompleted('rec-rule-2026-11-04', true);
    expect(previewWorkspace().progression.xp).toBe(25);
    expect(previewWorkspace().tasks.find(t => t.id === 'rec-rule-2026-11-05')!.completedAtMs).toBeNull();
    await reject(skipOccurrence('rec-rule-2026-11-04'));
    await skipOccurrence('rec-rule-2026-11-05');
    await generateRecurring(TODAY);
    expect(taskIds()).not.toContain('rec-rule-2026-11-05');
    expect(previewWorkspace().progression.xp).toBe(25);
    await restoreOccurrence('rule', '2026-11-05', TODAY);
    expect(taskIds()).toContain('rec-rule-2026-11-05');
    await deleteTask('rec-rule-2026-11-06'); // a deleted occurrence stays removed
    await generateRecurring(TODAY);
    expect(taskIds()).not.toContain('rec-rule-2026-11-06');
    expect((await loadPersonal()).occurrences.find(o => o.occurrenceDate === '2026-11-06')!.taskId).toBeNull();
  });
  it('editing, pausing and ending re-plan only the future', async () => {
    await saveRecurrence(rule({ id: 'w', frequency: 'weekly', weekdays: [1] }), TODAY);
    await saveRecurrence(rule({ id: 'w', frequency: 'weekly', weekdays: [3] }), TODAY);
    expect(previewWorkspace().tasks.map(t => t.dueDate).sort()).toEqual(['2026-11-05', '2026-11-12']);
    await saveRecurrence(rule({ id: 'w', frequency: 'weekly', weekdays: [3], title: 'Bins out' }), TODAY);
    expect(previewWorkspace().tasks.every(t => t.title === 'Bins out')).toBe(true);
    await setTaskCompleted('rec-w-2026-11-05', true);
    await setRecurrenceStatus('w', 'paused', '2026-11-06');
    expect(taskIds()).toEqual(['rec-w-2026-11-05']);
    await generateRecurring('2026-11-06');
    expect(taskIds()).toHaveLength(1);
    await setRecurrenceStatus('w', 'active', '2026-11-06');
    expect(taskIds()).toHaveLength(3);
    await setRecurrenceStatus('w', 'ended', '2026-11-06');
    expect(taskIds()).toEqual(['rec-w-2026-11-05']);
    await reject(setRecurrenceStatus('w', 'active', '2026-11-06'));
    await reject(saveRecurrence(rule({ id: 'w', frequency: 'weekly', weekdays: [3] }), '2026-11-06'));
    await reject(saveRecurrence(rule({ id: 'x', frequency: 'weekly', weekdays: [] }), TODAY));
    await reject(saveRecurrence(rule({ id: 'x', frequency: 'monthly', monthDay: 32 }), TODAY));
    await reject(saveRecurrence(rule({ id: 'x', endDate: '2026-09-01' }), TODAY));
  });
});

describe('daily priorities', () => {
  const add = (id: string) => saveTask({ id, title: id, description: '', category: 'Personal', priority: 'normal', dueDate: '2026-11-20', dueTime: null, subtasks: [], reminderOffsetMinutes: null });
  it('plans without changing tasks, reorders, removes and rejects bad input', async () => {
    for (const id of ['a', 'b', 'c']) await add(id);
    await setDailyPriorities(TODAY, ['b', 'a'], TODAY); await setDailyPriorities(TODAY, ['b', 'a'], TODAY);
    expect((await loadPersonal()).priorities.map(p => p.taskId)).toEqual(['b', 'a']);
    expect(previewWorkspace().tasks.map(t => t.dueDate)).toEqual(['2026-11-20', '2026-11-20', '2026-11-20']);
    await setDailyPriorities(TODAY, ['a'], TODAY);
    expect(previewWorkspace().tasks).toHaveLength(3); // removed from the plan, not deleted
    await reject(setDailyPriorities(TODAY, ['a', 'a'], TODAY));
    await reject(setDailyPriorities(TODAY, ['a', 'b', 'c', 'a', 'b', 'c'], TODAY));
    await reject(setDailyPriorities(TODAY, ['missing'], TODAY));
    await reject(setDailyPriorities('2026-11-03', ['a'], TODAY)); // the past is history
    await setTaskCompleted('c', true);
    await reject(setDailyPriorities(TODAY, ['a', 'c'], TODAY));
    await deleteTask('a');
    expect((await loadPersonal()).priorities).toHaveLength(0);
  });
});
