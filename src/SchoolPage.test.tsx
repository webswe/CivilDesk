import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { resetAcademicPreview } from './services/academic';
import { previewWorkspace } from './services/workspace';
import { localDate } from './domain/scheduling';
import { addDays } from './domain/agenda';

const today = localDate();
const tomorrow = localDate(addDays(new Date(), 1));

async function enter() {
  render(<App/>);
  fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Riley' } });
  fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
  await screen.findByRole('heading', { name: /Riley/ });
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const dialog = () => screen.getByRole('dialog');

async function createSemesterCourse() {
  fireEvent.click(screen.getByRole('button', { name: 'School' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create your first semester' }));
  fireEvent.change(within(dialog()).getByLabelText('Name'), { target: { value: 'Fall 2026' } });
  fireEvent.change(within(dialog()).getByLabelText('Start date'), { target: { value: '2026-08-24' } });
  fireEvent.change(within(dialog()).getByLabelText('End date'), { target: { value: '2026-12-18' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save semester' }));
  await screen.findByText('Active semester');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a course' }));
  fireEvent.change(within(dialog()).getByLabelText('Course code'), { target: { value: 'CSE 1321' } });
  fireEvent.change(within(dialog()).getByLabelText('Course name'), { target: { value: 'Programming and Problem Solving' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save course' }));
  await screen.findByRole('button', { name: /CSE 1321/ });
}
async function addCoursework(title: string, kind: string, due: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add coursework' }));
  fireEvent.change(within(dialog()).getByLabelText('Title'), { target: { value: title } });
  fireEvent.change(within(dialog()).getByLabelText('Type'), { target: { value: kind } });
  fireEvent.change(within(dialog()).getByLabelText('Due date'), { target: { value: due } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save coursework' }));
  await screen.findByRole('button', { name: 'Complete ' + title });
}

describe('academic workspace', () => {
  beforeEach(() => { localStorage.clear(); resetAcademicPreview(); const w = previewWorkspace(); w.tasks = []; w.sessions = []; w.events = []; w.progression.xp = 0; w.progression.history = []; });
  afterEach(() => cleanup());

  it('shows meaningful empty states without fabricated data', async () => {
    await enter();
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    expect(await screen.findByText('No semesters yet')).toBeInTheDocument();
    expect(screen.queryByText(/CSE|MATH|Fall/)).not.toBeInTheDocument();
  });

  it('creates a semester, course and coursework that appear in School, My Day, Calendar and Focus, and stay in sync on completion', async () => {
    await enter();
    await createSemesterCourse();
    expect((screen.getByRole('combobox', { name: 'Semester' }) as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Fall 2026 (active)');
    await addCoursework('Midterm exam', 'exam', today);
    await addCoursework('Lab 2', 'assignment', tomorrow);
    // The Needs attention list shows both with their course context.
    const attentionList = screen.getByRole('list', { name: 'Upcoming coursework' });
    expect(within(attentionList).getByText(/Exam · CSE 1321/)).toBeInTheDocument();

    // My Day: due-today coursework with a subtle course label; it can be opened and completed there.
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    const todayList = await screen.findByRole('list', { name: 'Tasks for today' });
    expect(within(todayList).getByText('Midterm exam')).toBeInTheDocument();
    expect(within(todayList).getByRole('button', { name: 'Open Midterm exam in CSE 1321' })).toBeInTheDocument();
    expect(screen.getByText('Lab 2')).toBeInTheDocument(); // Coming up

    // Calendar: a distinguishable chip for the exam on its due date.
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(await screen.findByText('Exam · Midterm exam')).toBeInTheDocument();

    // Focus preselects the coursework chosen from School.
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start focus for Lab 2' }));
    const select = await screen.findByRole('combobox', { name: 'Working on' });
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Lab 2 (Assignment · CSE 1321)');

    // Completing from My Day updates the course view.
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Midterm exam' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument());
    expect(previewWorkspace().progression.xp).toBe(25);
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    expect(await screen.findByText(/1 of 2 coursework items done/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /CSE 1321/ }));
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    expect(within(screen.getByRole('list', { name: 'Coursework' })).getByText('Midterm exam')).toBeInTheDocument();

    // Reopening from the course view returns it to My Day without a second XP award.
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Midterm exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    expect(await screen.findByRole('list', { name: 'Tasks for today' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Midterm exam' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument());
    expect(previewWorkspace().progression.xp).toBe(25);
  });

  it('opens coursework from My Day in its course and treats undated work as neither overdue nor due', async () => {
    await enter();
    await createSemesterCourse();
    await addCoursework('Read chapter 3', 'general', today);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Read chapter 3' }));
    fireEvent.change(within(dialog()).getByLabelText('Due date'), { target: { value: '' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save coursework' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    await screen.findByRole('heading', { name: /Riley/ });
    expect(screen.queryByRole('list', { name: 'Tasks for today' })).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('keeps unassigned School tasks visible and offers to add them to a course', async () => {
    await enter();
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    type('Title', 'Old statics homework');
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(await screen.findByText('Old statics homework')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other school tasks' })).toBeInTheDocument();
  });

  it('archives a semester without removing its coursework and returns it on restore', async () => {
    await enter();
    await createSemesterCourse();
    await addCoursework('Final project', 'assignment', tomorrow);
    window.confirm = () => true;
    fireEvent.click(screen.getByRole('button', { name: 'Archive semester' }));
    expect(await screen.findByText('Archived')).toBeInTheDocument();
    expect(previewWorkspace().tasks.map(t => t.title)).toContain('Final project');
    fireEvent.click(screen.getByRole('button', { name: 'Restore semester' }));
    await waitFor(() => expect(screen.queryByText('Archived')).not.toBeInTheDocument());
  });

  it('shows validation errors from the save inside the dialog', async () => {
    await enter();
    await createSemesterCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Add course' }));
    fireEvent.change(within(dialog()).getByLabelText('Course code'), { target: { value: 'cse 1321' } });
    fireEvent.change(within(dialog()).getByLabelText('Course name'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save course' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('already has a course with that code');
  });
});
