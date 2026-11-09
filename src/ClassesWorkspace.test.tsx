import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ClassesWorkspace } from './ClassesWorkspace';
import * as service from './services/brightspace';
import type { Course } from './services/academic';

vi.mock('./services/brightspace', () => ({ brightspaceCourses: vi.fn(), brightspaceCancel: vi.fn(), brightspaceCourseMode: vi.fn() }));
const fetchCourses = vi.mocked(service.brightspaceCourses);
const courseMode = vi.mocked(service.brightspaceCourseMode);
const course = (id: string, code: string) => ({ id, code, name: 'Shared title', semester_name: '', is_active: true, can_access: true, is_new_enrollment: false, start_date: null, end_date: null });
const snapshot = { portalOrigin: 'https://synthetic.example.test', mode: 'synthetic_cli' as const, retrievedAtMs: 1, complete: true, warnings: [], courses: [course('610101', 'CIV 201'), course('610102', 'CIV 202')] };
const local: Course = { id: 'local-1', semesterId: 'semester-1', code: 'CIV 201', name: 'Shared title', instructor: '', description: '', meetingSchedule: '', location: '', color: '#c58d9b', archived: false, createdAtMs: 1, updatedAtMs: 1 };
const refresh = async () => { const button = screen.getByRole('button', { name: 'Refresh sample' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); };
beforeEach(() => { vi.resetAllMocks(); courseMode.mockResolvedValue('synthetic_cli'); });
afterEach(cleanup);

it('loads only on explicit refresh and keeps duplicate names distinct by source id', async () => {
  fetchCourses.mockResolvedValueOnce(snapshot);
  const openLocal = vi.fn();
  render(<ClassesWorkspace active localCourses={[local]} onOpenLocal={openLocal}/>);
  expect(fetchCourses).not.toHaveBeenCalled();
  await refresh();
  const sample = await screen.findByRole('heading', { name: 'Brightspace courses' });
  const sampleSection = sample.closest('section')!;
  await waitFor(() => expect(within(sampleSection).getAllByRole('button')).toHaveLength(2));
  fireEvent.click(within(sampleSection).getAllByRole('button')[1]!);
  expect(screen.getByText('610102')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Classes' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search classes' }), { target: { value: 'CIV 201' } });
  expect(within(screen.getByRole('heading', { name: 'Brightspace courses' }).closest('section')!).getAllByRole('button')).toHaveLength(1);
  fireEvent.click(within(screen.getByRole('heading', { name: 'Your local courses' }).closest('section')!).getByRole('button'));
  expect(openLocal).toHaveBeenCalledWith('local-1');
});

it('retains the last successful sample with a stale warning after a refresh error', async () => {
  fetchCourses.mockResolvedValueOnce(snapshot).mockRejectedValueOnce('The synthetic CLI returned an invalid course list.');
  render(<ClassesWorkspace active localCourses={[]} onOpenLocal={vi.fn()}/>);
  await refresh();
  expect(await screen.findByText(/Synthetic Brightspace · ID 610101/)).toBeInTheDocument();
  await refresh();
  expect(await screen.findByText(/last successful sample/)).toBeInTheDocument();
  expect(screen.getByText(/Synthetic Brightspace · ID 610102/)).toBeInTheDocument();
});

it('shows empty and offline states without altering local courses', async () => {
  fetchCourses.mockResolvedValueOnce({ ...snapshot, courses: [] });
  render(<ClassesWorkspace active localCourses={[local]} onOpenLocal={vi.fn()}/>);
  await refresh();
  expect(await screen.findByText('The sample course list is empty.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Your local courses' })).toBeInTheDocument();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  fireEvent.offline(window);
  expect(screen.getByText(/Offline · showing/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeDisabled();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

it('does not offer refresh in regular builds', async () => {
  courseMode.mockResolvedValueOnce('unavailable');
  render(<ClassesWorkspace active localCourses={[local]} onOpenLocal={vi.fn()}/>);
  expect(await screen.findByText('Brightspace course retrieval is unavailable in this build.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh sample' })).toBeNull();
  expect(fetchCourses).not.toHaveBeenCalled();
});
