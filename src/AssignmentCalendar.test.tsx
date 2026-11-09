import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AssignmentCalendar } from './AssignmentCalendar';
import * as service from './services/brightspace';
import type { WorkspaceData } from './services/workspace';
import type { AcademicData } from './services/academic';

vi.mock('./services/brightspace', () => ({ brightspaceAssignments: vi.fn(), brightspaceCancel: vi.fn(), brightspaceCourseMode: vi.fn() }));
const load = vi.mocked(service.brightspaceAssignments);
const mode = vi.mocked(service.brightspaceCourseMode);
const course = (id: string, code: string) => ({ id, code, name: 'Shared title', semester_name: '', is_active: true, can_access: true, is_new_enrollment: false, start_date: null, end_date: null });
const item = (course_id: string, id: string, name: string, due_date: string | null) => ({ id, course_id, name, due_date, submission_status: null, score: null });
const sample: service.AssignmentSnapshot = { portalOrigin: 'https://synthetic.example.test', mode: 'synthetic_cli', retrievedAtMs: 1, limitedCourseCount: false, courses: [course('610101', 'CIV 201'), course('610202', 'CIV 202')], results: [
  { courseId: '610101', completeness: { status: 'below_page_size_boundary', observed_row_count: 2, page_size_ceiling: 50 }, error: null, assignments: [item('610101', '801', 'Design brief', '2027-01-02T17:00:00'), item('610101', '802', 'Reflection', null)] },
  { courseId: '610202', completeness: { status: 'potentially_truncated', observed_row_count: 1, page_size_ceiling: 1 }, error: null, assignments: [item('610202', '801', 'Design brief', '2027-01-02T23:59:00')] },
] };
const academic: AcademicData = { semesters: [], courses: [{ id: 'local-1', semesterId: 's', code: 'LOCAL 1', name: 'Local class', instructor: '', description: '', meetingSchedule: '', location: '', color: '#7aa7d2', archived: false, createdAtMs: 1, updatedAtMs: 1 }], work: [{ taskId: 'task-1', courseId: 'local-1', workType: 'assignment', referenceNotes: '' }] };
const data = { tasks: [{ id: 'task-1', title: 'Local paper', dueDate: '2027-01-02', dueTime: null, description: '', completedAtMs: null }] } as WorkspaceData;
const renderCalendar = () => render(<AssignmentCalendar active data={data} academic={academic} requestedCourse={null} onOpenCourse={vi.fn()} onOpenLocalAssignment={vi.fn()}/>);
beforeEach(() => { vi.resetAllMocks(); mode.mockResolvedValue('synthetic_cli'); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });
afterEach(cleanup);

it('shows local work before refresh, then preserves duplicate synthetic titles and uncertainty', async () => {
  load.mockResolvedValue(sample);
  renderCalendar();
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
  expect(screen.getByText('Local paper')).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sample' }));
  expect(await screen.findByText(/source page may be truncated/i)).toBeInTheDocument();
  expect(screen.getAllByText('Design brief').length).toBe(2);
  expect(screen.getAllByText(/timezone unverified/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByRole('button', { name: 'Next academic period' })).toBeInTheDocument();
});

it('filters by stable course key and opens unscheduled assignment details', async () => {
  load.mockResolvedValue(sample);
  renderCalendar();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sample' }));
  await screen.findByText(/source page may be truncated/i);
  const filter = screen.getByText('CIV 201 · Shared title').closest('label')!;
  fireEvent.click(within(filter).getByRole('checkbox'));
  const unscheduled = screen.getByRole('heading', { name: 'Unscheduled' }).parentElement!;
  fireEvent.click(within(unscheduled).getByRole('button', { name: /Reflection/ }));
  expect(screen.getByRole('dialog', { name: 'Assignment details' })).toHaveTextContent('No recognized due date');
  fireEvent.click(screen.getByRole('button', { name: /Back to calendar/ }));
  fireEvent.click(screen.getByRole('button', { name: 'All classes / clear filters' }));
  expect(within(filter).getByRole('checkbox')).not.toBeChecked();
});

it('retains stale sample after failure and keeps local work offline', async () => {
  load.mockResolvedValueOnce(sample).mockRejectedValueOnce(new Error('secret data'));
  renderCalendar();
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sample' }));
  await screen.findByText(/source page may be truncated/i);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sample' }));
  expect(await screen.findByText(/showing stale sample data/)).toBeInTheDocument();
  expect(screen.queryByText('secret data')).toBeNull();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); fireEvent.offline(window);
  expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeDisabled();
  expect(screen.getByText('Local paper')).toBeInTheDocument();
});
