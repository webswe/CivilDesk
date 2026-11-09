import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ClassInformation } from './ClassInformation';
import type { BrightspaceAnnouncement, BrightspaceGradeItem, ClassSnapshot } from './services/brightspace';

const course = { id: '610101', code: 'CIV 201', name: 'Fictional structures', semester_name: '', is_active: true, can_access: true, is_new_enrollment: false, start_date: null, end_date: null };
const grade = (label: string, displayed_points: string | null): BrightspaceGradeItem => ({ course_id: course.id, label, displayed_points, displayed_grade: null, displayed_weight: null, feedback_availability: 'unknown' });
const announcement = (id: string, title: string, body: string | null): BrightspaceAnnouncement => ({ course_id: course.id, announcement_id: id, title, body, detail_reference: `/d2l/le/news/${course.id}/${id}/view` });
const snapshot = <T,>(items: T[], error: string | null = null): ClassSnapshot<T> => ({ portalOrigin: 'https://synthetic.example.test', mode: 'synthetic_cli', retrievedAtMs: 1, courses: [course], results: [{ courseId: course.id, retrievedAtMs: 1, completeness: error ? null : 'unknown', error, items }], limitedCourseCount: false });
const props = {
  course, portal: 'https://synthetic.example.test', mode: 'synthetic_cli' as const, offline: false,
  onBack: vi.fn(), onOpenCalendar: vi.fn(),
  grades: { snapshot: snapshot([grade('Duplicate title', '0'), grade('Duplicate title', null), grade('Long fictional title', 'A')]), busy: false, error: '', refresh: vi.fn(async () => {}) },
  announcements: { snapshot: snapshot([announcement('501', 'Duplicate update', '<script>alert(1)</script> https://outside.example.test'), announcement('502', 'Duplicate update', null)]), busy: false, error: '', refresh: vi.fn(async () => {}) },
};
afterEach(cleanup);

it('keeps grade display strings exact and treats blank values as unknown, with ephemeral row identity', () => {
  render(<ClassInformation {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Grades' }));
  expect(screen.getAllByText('Duplicate title')).toHaveLength(2);
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getByText('Not shown by source; not zero')).toBeInTheDocument();
  expect(screen.getAllByText(/grading state unknown/)).toHaveLength(3);
  expect(screen.getAllByText(/no stable grade-item ID/)).toHaveLength(3);
  expect(screen.getByText(/completeness is unknown/)).toBeInTheDocument();
});

it('renders announcement markup and external references as inert text, without invented metadata', () => {
  const { container } = render(<ClassInformation {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Announcements' }));
  expect(screen.getAllByText('Duplicate update')).toHaveLength(2);
  expect(screen.getByText("<script>alert(1)</script> https://outside.example.test")).toBeInTheDocument();
  expect(container.querySelector('script, iframe, img, a')).toBeNull();
  expect(screen.getAllByText(/Publication date and author unavailable/)).toHaveLength(2);
});

it('shows stale cached items after a failed course read, but no false empty claim', () => {
  const failed = { ...props, grades: { ...props.grades, snapshot: snapshot([grade('Cached item', '0')], 'This course could not be read.') } };
  render(<ClassInformation {...failed}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Grades' }));
  expect(screen.getByText('Cached item')).toBeInTheDocument();
  expect(screen.getByText(/may be stale/)).toBeInTheDocument();
  expect(screen.queryByText(/No grade items were returned/)).toBeNull();
});

it('distinguishes empty and offline states and keeps refresh explicit', () => {
  const empty = { ...props, offline: true, announcements: { ...props.announcements, snapshot: snapshot<BrightspaceAnnouncement>([]) } };
  render(<ClassInformation {...empty}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Announcements' }));
  expect(screen.getByText(/No announcements were returned in the available page/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh sample' })).toBeDisabled();
  expect(empty.announcements.refresh).not.toHaveBeenCalled();
  expect(within(screen.getByRole('navigation', { name: 'Class information' })).getByRole('button', { name: 'Assignments' })).toBeInTheDocument();
});
