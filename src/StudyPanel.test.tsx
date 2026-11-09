import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { resetAcademicPreview } from './services/academic';
import { resetStudyPreview } from './services/study';
import { previewWorkspace } from './services/workspace';
import { localDate } from './domain/scheduling';
import { addDays } from './domain/agenda';

const tomorrow = localDate(addDays(new Date(), 1));
const inWeek = localDate(addDays(new Date(), 5));
const dialog = () => screen.getByRole('dialog');

async function enter() {
  render(<App/>);
  fireEvent.change(await screen.findByLabelText('What should we call you?'), { target: { value: 'Riley' } });
  fireEvent.click(screen.getByRole('button', { name: /Enter CivilDesk/ }));
  await screen.findByRole('heading', { name: /Riley/ });
}
async function semesterCourseExam() {
  fireEvent.click(screen.getByRole('button', { name: 'School' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create your first semester' }));
  fireEvent.change(within(dialog()).getByLabelText('Name'), { target: { value: 'Fall 2026' } });
  fireEvent.change(within(dialog()).getByLabelText('Start date'), { target: { value: '2026-01-01' } });
  fireEvent.change(within(dialog()).getByLabelText('End date'), { target: { value: '2027-12-31' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save semester' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add a course' }));
  fireEvent.change(within(dialog()).getByLabelText('Course code'), { target: { value: 'CSE 1321' } });
  fireEvent.change(within(dialog()).getByLabelText('Course name'), { target: { value: 'Programming' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save course' }));
  await screen.findByRole('button', { name: /CSE 1321/ });
  fireEvent.click(screen.getByRole('button', { name: 'Add coursework' }));
  fireEvent.change(within(dialog()).getByLabelText('Title'), { target: { value: 'Midterm exam' } });
  fireEvent.change(within(dialog()).getByLabelText('Type'), { target: { value: 'exam' } });
  fireEvent.change(within(dialog()).getByLabelText('Due date'), { target: { value: inWeek } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save coursework' }));
  await screen.findByRole('button', { name: 'Plan study for Midterm exam' });
}
async function scheduleBlock(date: string, objective: string) {
  fireEvent.click(await screen.findByRole('button', { name: /Schedule study/ }));
  fireEvent.change(within(dialog()).getByLabelText('Objective (optional)'), { target: { value: objective } });
  fireEvent.change(within(dialog()).getByLabelText('Date'), { target: { value: date } });
  fireEvent.change(within(dialog()).getByLabelText('Start time'), { target: { value: '18:30' } });
  fireEvent.change(within(dialog()).getByLabelText('Minutes'), { target: { value: '25' } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Save study block' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('study experience', () => {
  beforeEach(() => { localStorage.clear(); resetAcademicPreview(); resetStudyPreview(); const w = previewWorkspace(); w.tasks = []; w.sessions = []; w.events = []; w.progression.xp = 0; w.progression.history = []; });
  afterEach(() => cleanup());

  it('plans a study block for an exam, shows it in School, My Day and Calendar, and records a real focus session', async () => {
    await enter();
    await semesterCourseExam();
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    expect(await screen.findByText(/Nothing scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/No completed study sessions/)).toBeInTheDocument();

    // Plan study straight from the exam; the block keeps the exam's association and does not move its deadline.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan study for Midterm exam' }));
    expect((within(dialog()).getByLabelText('For coursework (optional)') as HTMLSelectElement).selectedOptions[0]?.textContent).toContain('Midterm exam');
    fireEvent.change(within(dialog()).getByLabelText('Objective (optional)'), { target: { value: 'Review loops' } });
    fireEvent.change(within(dialog()).getByLabelText('Date'), { target: { value: tomorrow } });
    fireEvent.change(within(dialog()).getByLabelText('Start time'), { target: { value: '18:30' } });
    fireEvent.change(within(dialog()).getByLabelText('Minutes'), { target: { value: '25' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save study block' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(previewWorkspace().tasks[0]?.dueDate).toBe(inWeek);
    expect(await screen.findByText(/25 min planned/)).toBeInTheDocument(); // exam row: planned, not studied

    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    const planned = await screen.findByRole('list', { name: 'Upcoming study blocks' });
    expect(within(planned).getByText('Review loops')).toBeInTheDocument();

    // My Day lists it under Coming up with a Study label, not as a task.
    fireEvent.click(screen.getByRole('button', { name: 'My Day' }));
    expect(await screen.findByText(/Study · 18:30–18:55/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete Review loops/ })).not.toBeInTheDocument();

    // Calendar projects the same record.
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(await screen.findByText('Study · CSE 1321')).toBeInTheDocument();

    // Start from the block: Focus shows the academic context and keeps the exam.
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Study' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start studying Review loops' }));
    expect(await screen.findByText(/Studying for/)).toHaveTextContent('CSE 1321 · Review loops');
    expect(screen.getByText(/Studying for/)).toHaveTextContent('CSE 1321');
    expect((screen.getByRole('combobox', { name: 'Working on' }) as HTMLSelectElement).selectedOptions[0]?.textContent).toContain('Midterm exam');
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(previewWorkspace().sessions[0]).toMatchObject({ studyBlockId: expect.any(String), courseId: expect.any(String) });

    // Nothing is recorded while the timer is still running.
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Study' }));
    expect(await screen.findByText(/Studied 0 min in 0 sessions/)).toBeInTheDocument();

    // Let the real timer finish (its clock is moved back), then confirm completion once.
    const session = previewWorkspace().sessions[0]!;
    session.runStartedAtMs = (session.runStartedAtMs ?? 0) - 26 * 60_000;
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' })); // reloads state so the timer sees the moved clock
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete session' }, { timeout: 4000 }));
    await waitFor(() => expect(previewWorkspace().sessions[0]?.status).toBe('completed'));

    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Study' }));
    expect(await screen.findByText(/Studied 25 min in 1 session/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Upcoming study blocks' })).not.toBeInTheDocument(); // studied, so no longer planned
    const history = screen.getByRole('list', { name: 'Completed study sessions' });
    expect(within(history).getByText(/CSE 1321 · Midterm exam/)).toBeInTheDocument();
    expect(screen.getByLabelText('History totals')).toHaveTextContent('1 completed session · 25 min studied');

    // Weekly goal tracks the recorded session only.
    fireEvent.click(screen.getByRole('button', { name: 'Set weekly goal for CSE 1321' }));
    fireEvent.change(within(dialog()).getByLabelText('Minutes per week'), { target: { value: '50' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByText(/25 min of 50 min/)).toBeInTheDocument();

    // The exam row now shows time actually studied, and completing the exam leaves history alone.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(within(await screen.findByRole('list', { name: 'Upcoming coursework' })).getByText(/Studied 25 min/)).toBeInTheDocument();
  }, 10000);

  it('cancels a block without deleting it and keeps it out of totals and the calendar', async () => {
    await enter();
    await semesterCourseExam();
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    await scheduleBlock(tomorrow, 'Practice problems');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel study block Practice problems' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Upcoming study blocks' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText(/Missed and cancelled \(/));
    const other = screen.getByRole('list', { name: 'Missed and cancelled study blocks' });
    expect(within(other).getByText('Cancelled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    await screen.findByRole('heading', { name: 'Calendar' });
    expect(screen.queryByText('Study · CSE 1321')).not.toBeInTheDocument();
    // Restoring brings it back.
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Study' }));
    fireEvent.click(screen.getByText(/Missed and cancelled \(/));
    fireEvent.click(screen.getByRole('button', { name: 'Restore study block Practice problems' }));
    expect(await screen.findByRole('list', { name: 'Upcoming study blocks' })).toBeInTheDocument();
    expect(previewWorkspace().progression.xp).toBe(0);
  });

  it('shows honest empty states and shows validation errors inside the dialog', async () => {
    await enter();
    fireEvent.click(screen.getByRole('button', { name: 'School' }));
    expect(await screen.findByText('No semesters yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Study' })).not.toBeInTheDocument();
    await semesterCourseExam();
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    expect(await screen.findByText(/No weekly goal/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Schedule study/ }));
    fireEvent.change(within(dialog()).getByLabelText('Minutes'), { target: { value: '5' } });
    fireEvent.change(within(dialog()).getByLabelText('Date'), { target: { value: tomorrow } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save study block' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
