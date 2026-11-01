import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { resetAcademicPreview } from './services/academic';
import { resetPersonalPreview, saveRoutine } from './services/personal';
import { previewWorkspace, saveTask, type TaskInput } from './services/workspace';
import { localDate } from './domain/scheduling';
import { addDays } from './domain/dates';

const today = localDate();
const tomorrow = addDays(today, 1);

async function enter() {
  render(<App/>);
  fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Riley' } });
  fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
  await screen.findByRole('heading', { name: /Riley/ });
}
const nav = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name }));
async function openPersonal(tab?: string) {
  nav('Personal');
  await screen.findByRole('heading', { name: 'Personal' });
  if (tab) fireEvent.click(within(screen.getByRole('group', { name: 'Personal view' })).getByRole('button', { name: tab }));
}
const dialog = () => screen.getByRole('dialog');
const type = (label: string | RegExp, value: string, scope: () => HTMLElement = dialog) => fireEvent.change(within(scope()).getByLabelText(label), { target: { value } });
const click = (name: string | RegExp, scope: () => HTMLElement = () => document.body) => fireEvent.click(within(scope()).getByRole('button', { name }));
const task = (over: Partial<TaskInput>): TaskInput => ({ id: crypto.randomUUID(), title: 'Task', description: '', category: 'Personal', priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null, ...over });

describe('personal workspace', () => {
  beforeEach(() => {
    localStorage.clear(); resetAcademicPreview(); resetPersonalPreview();
    const w = previewWorkspace(); w.tasks = []; w.sessions = []; w.events = []; w.progression.xp = 0; w.progression.history = []; w.progression.earned = []; w.progression.unlocked = [];
  });
  afterEach(() => cleanup());

  it('opens on an Overview that keeps the task list and shows honest empty states', async () => {
    await enter(); await openPersonal();
    expect(screen.getByRole('group', { name: 'Personal view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing chosen yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Habits and routines for today' })).not.toBeInTheDocument();
    for (const [tab, empty] of [['Goals', 'No goals yet'], ['Habits', 'No habits yet'], ['Routines', 'No routines yet']] as const) {
      fireEvent.click(within(screen.getByRole('group', { name: 'Personal view' })).getByRole('button', { name: tab }));
      expect(await screen.findByRole('heading', { name: empty })).toBeInTheDocument();
    }
    fireEvent.click(within(screen.getByRole('group', { name: 'Personal view' })).getByRole('button', { name: 'Week' }));
    expect(await screen.findByRole('heading', { name: /Nothing recorded yet this week/ })).toBeInTheDocument();
  });

  it('records goal progress, corrects it without erasing history, and completes a yes/no goal by hand', async () => {
    await enter(); await openPersonal('Goals');
    click('New goal');
    type('Title', 'Read 300 pages'); type('Target', '300'); type('Unit', 'pages');
    click('Save goal', dialog);
    await screen.findByText(/0 pages of 300 pages/);
    click('Log progress for Read 300 pages');
    type(/Amount/, '40');
    click('Save progress', dialog);
    expect(await screen.findByText(/40 pages of 300 pages/)).toBeInTheDocument();
    expect(screen.getByLabelText('Progress for Read 300 pages')).toHaveAttribute('value');
    click('Show details for Read 300 pages');
    click(/^Remove 40 pages entry/);
    expect(await screen.findByText(/0 pages of 300 pages/)).toBeInTheDocument();
    expect(screen.getByText(/Removed \(kept in history\)/)).toBeInTheDocument();
    // A negative amount is stopped by the form (min 1); nothing is recorded.
    click('Log progress for Read 300 pages');
    type(/Amount/, '-3'); click('Save progress', dialog);
    expect(dialog()).toBeInTheDocument();
    click('Cancel', dialog);
    expect(screen.getByText(/0 pages of 300 pages/)).toBeInTheDocument();
    // A yes/no goal is never completed automatically.
    click('New goal'); fireEvent.change(within(dialog()).getByLabelText('Type'), { target: { value: 'binary' } });
    type('Title', 'Organize workspace'); click('Save goal', dialog);
    expect(await screen.findByText(/Not done yet/)).toBeInTheDocument();
    click('Mark Organize workspace complete');
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen Organize workspace' }));
    expect(await screen.findByRole('button', { name: 'Mark Organize workspace complete' })).toBeInTheDocument();
    expect(previewWorkspace().progression.xp).toBe(0); // goals never pay XP
  });

  it('a habit check-in toggles once, shows in My Day only while due, and never pays XP', async () => {
    await enter(); await openPersonal('Habits');
    click('New habit'); type('Name', 'Drink water'); click('Save habit', dialog);
    const check = await screen.findByRole('checkbox', { name: 'Check in Drink water' });
    expect(check).toHaveAttribute('aria-checked', 'false');
    nav('My Day');
    const due = await screen.findByRole('list', { name: 'Habits and routines for today' });
    fireEvent.click(within(due).getByRole('button', { name: 'Check in Drink water' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Habits and routines for today' })).not.toBeInTheDocument());
    await openPersonal('Habits');
    const done = await screen.findByRole('checkbox', { name: "Undo today's check-in for Drink water" });
    expect(done).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Streak 1 day/)).toBeInTheDocument();
    fireEvent.click(done);
    expect(await screen.findByRole('checkbox', { name: 'Check in Drink water' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/No streak yet/)).toBeInTheDocument();
    expect(previewWorkspace().progression.xp).toBe(0);
  });

  it('runs a routine checklist, keeps partial progress across navigation, and finishes it once', async () => {
    await enter(); await openPersonal('Routines');
    click('New routine'); type('Name', 'Morning'); type('Step 1', 'Make bed');
    click('Add step'); type('Step 2', 'Check calendar');
    click('Save routine', dialog);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Morning' }));
    const list = await screen.findByRole('group', { name: 'Checklist for Morning' });
    expect(within(list).getByRole('button', { name: /Finish routine/ })).toBeDisabled();
    fireEvent.click(within(list).getByLabelText('Make bed'));
    expect(await screen.findByText(/1 of 2 steps/)).toBeInTheDocument();
    nav('My Day'); await openPersonal('Routines');
    expect(await screen.findByText(/In progress · 1 of 2/)).toBeInTheDocument();
    click('Continue Morning');
    const again = await screen.findByRole('group', { name: 'Checklist for Morning' });
    expect(within(again).getByLabelText('Make bed')).toBeChecked();
    fireEvent.click(within(again).getByLabelText('Check calendar'));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Checklist for Morning' })).getByRole('button', { name: /Finish routine/ })).toBeEnabled());
    click(/Finish routine/);
    expect(await screen.findByText(/Done today/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Morning' })).not.toBeInTheDocument(); // today's run exists: no second run
    expect(previewWorkspace().tasks).toHaveLength(0);
    expect(previewWorkspace().progression.xp).toBe(0);
  });

  it('a recurring task creates ordinary tasks; completing or skipping one leaves the others alone', async () => {
    await enter(); await openPersonal();
    fireEvent.click(screen.getByText(/Recurring responsibilities \(0\)/));
    click('New recurring task'); type('Title', 'Take out trash'); fireEvent.change(within(dialog()).getByLabelText('Repeats'), { target: { value: 'daily' } });
    click('Save recurring task', dialog);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Complete Take out trash' })).toHaveLength(3));
    expect(previewWorkspace().tasks.every(t => t.id.startsWith('rec-'))).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Complete Take out trash' })[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Complete Take out trash' })).toHaveLength(2));
    expect(previewWorkspace().progression.xp).toBe(25);
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip Take out trash' })[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Complete Take out trash' })).toHaveLength(1));
    expect(previewWorkspace().progression.xp).toBe(25); // skipping is not completing
    expect(previewWorkspace().tasks).toHaveLength(2);
    expect(screen.getByText(/Skipped/)).toBeInTheDocument();
  });

  it('chooses a daily priority without changing its due date, shows it in My Day, and removes it without deleting the task', async () => {
    await saveTask(task({ id: 'landlord', title: 'Call landlord', dueDate: tomorrow }));
    await enter(); await openPersonal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a priority' }), { target: { value: 'landlord' } });
    const plan = await screen.findByRole('list', { name: 'Priorities for today' });
    expect(within(plan).getByText('Call landlord')).toBeInTheDocument();
    expect(within(plan).getByText(/Tomorrow/)).toBeInTheDocument();
    expect(previewWorkspace().tasks[0]!.dueDate).toBe(tomorrow);
    nav('My Day');
    const myDay = await screen.findByRole('list', { name: 'Priorities for today' });
    expect(within(myDay).getByText('Call landlord')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument(); // not due today: never listed as due today
    const coming = screen.getByRole('region', { name: 'Coming up' });
    expect(within(coming).getByText('Call landlord')).toBeInTheDocument(); // still an upcoming deadline
    click("Remove Call landlord from today's priorities");
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Priorities for today' })).not.toBeInTheDocument());
    expect(previewWorkspace().tasks).toHaveLength(1);
    expect(previewWorkspace().tasks[0]!.dueDate).toBe(tomorrow);
  });

  it('a task due today that is also a priority appears once in My Day', async () => {
    await saveTask(task({ id: 'due-today', title: 'Pay parking', dueDate: today }));
    await enter(); await openPersonal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a priority' }), { target: { value: 'due-today' } });
    await screen.findByRole('list', { name: 'Priorities for today' });
    nav('My Day');
    await screen.findByRole('list', { name: 'Priorities for today' });
    expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Pay parking').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: 'Complete Pay parking' })).toHaveLength(1);
  });

  it('the weekly review counts only finished work', async () => {
    await saveTask(task({ id: 'done', title: 'Water plants' })); await saveTask(task({ id: 'open', title: 'Plan trip', dueDate: addDays(today, 3) }));
    await enter(); await openPersonal();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Water plants' }));
    await screen.findByText('Tasks');
    fireEvent.click(within(screen.getByRole('group', { name: 'Personal view' })).getByRole('button', { name: 'Week' }));
    expect(await screen.findByText('1 personal task completed.')).toBeInTheDocument();
    expect(screen.queryByText(/Plan trip/)).not.toBeInTheDocument();
  });

  it('shows a routine on the Calendar only when it has days and a time', async () => {
    await saveRoutine({ id: 'timed', name: 'Evening reset', description: '', scheduleDays: [0, 1, 2, 3, 4, 5, 6], scheduleTime: '21:00', steps: [{ id: 's', title: 'Tidy' }] });
    await saveRoutine({ id: 'plain', name: 'Anytime stretch', description: '', scheduleDays: [], scheduleTime: null, steps: [{ id: 's2', title: 'Stretch' }] });
    await enter(); nav('Calendar');
    expect(await screen.findByRole('button', { name: 'Open routine Evening reset' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open routine Anytime stretch' })).not.toBeInTheDocument();
  });
});
