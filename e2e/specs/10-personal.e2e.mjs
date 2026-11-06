// Personal productivity: goals, habits, routines, recurring responsibilities and daily priorities in the real application,
// with the authoritative backend. Nothing is faked: every record is created through the UI or the app's own commands, and
// persistence is checked after a genuine restart. Pip XP must only ever come from the one ordinary task completion.
import { $, expect } from '@wdio/globals';
import { button, dialogButton, field, go, invoke, localDate, onboard, reloadView, restartApp, seedTask, setField, waitForPersisted } from '../lib/app.mjs';

const tab = name => $(`//div[@aria-label="Personal view"]//button[normalize-space(.)="${name}"]`);
const openTab = async name => { await go('Personal'); await tab(name).click(); };
const today = () => localDate(0);
const GOAL = 'Read 300 pages';
const HABIT = 'Drink water';
const ROUTINE = 'Morning';
const RULE = 'Take out trash';
const LATER = 'Call landlord';

describe('personal productivity (real application)', () => {
  let landlord;
  before(async () => {
    await onboard();
    landlord = await seedTask({ title: LATER, category: 'Personal', dueDate: localDate(3) });
    await reloadView();
  });

  it('starts with honest empty states', async () => {
    await go('Personal');
    await expect($('//*[contains(.,"Nothing chosen yet")]')).toBeDisplayed();
    await tab('Goals').click();
    await expect($('//h2[normalize-space(.)="No goals yet"]')).toBeDisplayed();
    await tab('Habits').click();
    await expect($('//h2[normalize-space(.)="No habits yet"]')).toBeDisplayed();
    await tab('Routines').click();
    await expect($('//h2[normalize-space(.)="No routines yet"]')).toBeDisplayed();
    await tab('Week').click();
    await expect($('//h2[contains(.,"Nothing recorded")]')).toBeDisplayed();
  });

  it('creates a personal goal and records measurable progress', async () => {
    await openTab('Goals');
    await button('New goal').click();
    await $('//dialog[@open]').waitForDisplayed();
    await field('Title').setValue(GOAL);
    await setField(await field('Target'), '300');
    await field('Unit').setValue('pages');
    await dialogButton('Save goal').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    await button(`Log progress for ${GOAL}`).click();
    await $('//dialog[@open]').waitForDisplayed();
    await setField(await field('Amount'), '40');
    await dialogButton('Save progress').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    await expect($('//*[contains(normalize-space(.),"40 pages of 300 pages")]')).toBeDisplayed();
    const { goals, goalEntries } = await invoke('load_personal', {});
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ title: GOAL, kind: 'numeric', target: 300, unit: 'pages', status: 'active' });
    expect(goalEntries).toHaveLength(1);
    expect(goalEntries[0]).toMatchObject({ amount: 40, voidedAtMs: null });
  });

  it('rejects invalid progress in the backend', async () => {
    const goal = (await invoke('load_personal', {})).goals[0];
    for (const amount of [0, -5]) {
      await expect(invoke('add_goal_entry', { entry: { id: crypto.randomUUID(), goalId: goal.id, entryDate: today(), amount, note: '' }, today: today() })).rejects.toThrow(/positive whole number/);
    }
    expect((await invoke('load_personal', {})).goalEntries).toHaveLength(1);
  });

  it('creates a habit, checks in once, and never duplicates the check-in', async () => {
    await openTab('Habits');
    await button('New habit').click();
    await $('//dialog[@open]').waitForDisplayed();
    await field('Name').setValue(HABIT);
    await dialogButton('Save habit').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    const check = $(`//button[@role="checkbox"][@aria-label="Check in ${HABIT}"]`);
    await check.click();
    await expect($(`//button[@role="checkbox"][@aria-label="Undo today's check-in for ${HABIT}"]`)).toBeDisplayed();
    const habit = (await invoke('load_personal', {})).habits[0];
    for (let i = 0; i < 3; i++) await invoke('set_habit_checkin', { habitId: habit.id, date: today(), done: true, today: today() }); // repeated clicks
    const { habitCheckins } = await invoke('load_personal', {});
    expect(habitCheckins).toHaveLength(1);
    expect(habitCheckins[0]).toMatchObject({ habitId: habit.id, occurrenceDate: today() });
  });

  it('creates a routine, completes its steps, and finishes it once', async () => {
    await openTab('Routines');
    await button('New routine').click();
    await $('//dialog[@open]').waitForDisplayed();
    await field('Name').setValue(ROUTINE);
    await $('//dialog[@open]//input[@aria-label="Step 1"]').setValue('Make bed');
    await dialogButton('Add step').click();
    await $('//dialog[@open]//input[@aria-label="Step 2"]').setValue('Check calendar');
    await dialogButton('Save routine').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    await button(`Start ${ROUTINE}`).click();
    const list = '//div[@aria-label="Checklist for Morning"]';
    await $(`${list}//label[normalize-space(.)="Make bed"]//input`).click();
    await waitForPersisted('load_personal', d => d.executions.length === 1 && d.executions[0].steps.filter(s => s.doneAtMs).length === 1, 'the first checked step (partial progress)');
    expect((await invoke('load_personal', {})).executions[0].completedAtMs).toBeNull();
    await $(`${list}//label[normalize-space(.)="Check calendar"]//input`).click();
    const finish = button('Finish routine');
    await finish.waitForEnabled();
    await finish.click();
    await waitForPersisted('load_personal', d => d.executions[0]?.completedAtMs, 'the completed routine run');
    const run = (await invoke('load_personal', {})).executions[0];
    await invoke('complete_routine', { executionId: run.id }); // a second completion changes nothing
    const again = (await invoke('load_personal', {})).executions;
    expect(again).toHaveLength(1);
    expect(again[0].completedAtMs).toBe(run.completedAtMs);
    expect((await invoke('load_workspace', {})).tasks.filter(t => t.title === 'Make bed')).toHaveLength(0); // steps are not tasks
  });

  it('creates a recurring responsibility and completes one occurrence without completing the others', async () => {
    await go('Personal');
    await $('//summary[starts-with(normalize-space(.),"Recurring responsibilities")]').click();
    await button('New recurring task').click();
    await $('//dialog[@open]').waitForDisplayed();
    await field('Title').setValue(RULE);
    await setField(await field('Repeats', 'select'), 'daily');
    await dialogButton('Save recurring task').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    await waitForPersisted('load_workspace', d => d.tasks.filter(t => t.title === RULE).length === 3, 'three bounded occurrences');
    const occurrences = (await invoke('load_workspace', {})).tasks.filter(t => t.title === RULE);
    expect(occurrences.map(t => t.dueDate).sort()).toEqual([localDate(0), localDate(1), localDate(2)]);
    await $(`(//button[@aria-label="Complete ${RULE}"])[1]`).click();
    await waitForPersisted('load_workspace', d => d.tasks.filter(t => t.title === RULE && t.completedAtMs).length === 1, 'one completed occurrence');
    const after = (await invoke('load_workspace', {})).tasks.filter(t => t.title === RULE);
    expect(after.filter(t => t.completedAtMs)).toHaveLength(1);
    expect(after.filter(t => !t.completedAtMs)).toHaveLength(2);
    expect(after.find(t => t.completedAtMs).dueDate).toBe(localDate(0));
    const { occurrences: rows } = await invoke('load_personal', {});
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(o => o.occurrenceDate)).size).toBe(3);
  });

  it('selects a daily priority that does not change the task, and My Day reflects it', async () => {
    await go('Personal');
    await setField(await $('//select[@aria-label="Add a priority"]'), landlord.id);
    await waitForPersisted('load_personal', d => d.priorities.length === 1, 'the daily priority');
    const { priorities } = await invoke('load_personal', {});
    expect(priorities[0]).toMatchObject({ planDate: today(), taskId: landlord.id });
    const task = (await invoke('load_workspace', {})).tasks.find(t => t.id === landlord.id);
    expect(task.dueDate).toBe(localDate(3)); // a priority is not a deadline
    expect(task.completedAtMs).toBeNull();
    await go('My Day');
    await expect($(`//ul[@aria-label="Priorities for today"]//strong[normalize-space(.)="${LATER}"]`)).toBeDisplayed();
    await expect($('//*[@aria-label="Tasks for today"]//strong[normalize-space(.)="' + LATER + '"]')).not.toBeExisting(); // not due today
  });

  it('keeps everything after a restart and awards Pip XP exactly once', async () => {
    await restartApp();
    const personal = await invoke('load_personal', {});
    expect(personal.goals).toHaveLength(1);
    expect(personal.goalEntries).toHaveLength(1);
    expect(personal.habits).toHaveLength(1);
    expect(personal.habitCheckins).toHaveLength(1);
    expect(personal.routines).toHaveLength(1);
    expect(personal.executions).toHaveLength(1);
    expect(personal.rules).toHaveLength(1);
    expect(personal.occurrences).toHaveLength(3); // starting the app generated nothing twice
    expect(personal.priorities).toHaveLength(1);
    const workspace = await invoke('load_workspace', {});
    expect(workspace.tasks.filter(t => t.title === RULE)).toHaveLength(3);
    expect(workspace.progression.xp).toBe(25); // only the one ordinary task completion
    expect(workspace.progression.history.map(e => e.kind)).toEqual(['task_completed']);
    await openTab('Goals');
    await expect($('//*[contains(normalize-space(.),"40 pages of 300 pages")]')).toBeDisplayed();
    await tab('Habits').click();
    await expect($(`//button[@role="checkbox"][@aria-label="Undo today's check-in for ${HABIT}"]`)).toBeDisplayed();
    await tab('Routines').click();
    await expect($('//*[contains(normalize-space(.),"Done today")]')).toBeDisplayed();
    await go('Pip');
    await expect($('//*[contains(@class,"pip-level")]')).toHaveText(expect.stringContaining('25 XP'));
  });
});
