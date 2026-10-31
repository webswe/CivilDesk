import { describe, expect, it } from 'vitest';
import { buildAgenda } from './agenda';
import type { Task, WorkspaceData } from '../services/workspace';
import type { ChallengeData } from '../services/challenges';
import type { ProjectsData } from '../services/projects';
import { previewWorkspace } from '../services/workspace';

const now = new Date(2026, 9, 31, 9, 0); // Saturday 31 October 2026, local time
const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: id, description: '', category: '', priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null, createdAtMs: 0, updatedAtMs: 0, completedAtMs: null, firstCompletedAtMs: null, projectId: null, ...over });
const workspace = (tasks: Task[], events: WorkspaceData['events'] = []): WorkspaceData => ({ ...structuredClone(previewWorkspace()), tasks, events, sessions: [] });
const noChallenges = { challenges: [], progress: [] } as unknown as ChallengeData;
const noProjects = { milestones: [] } as unknown as ProjectsData;

describe('My Day agenda', () => {
  it('separates overdue, due-today and upcoming tasks and ignores completed ones', () => {
    const a = buildAgenda(workspace([
      task('late', { dueDate: '2026-10-29' }), task('today', { dueDate: '2026-10-31' }), task('soon', { dueDate: '2026-11-03' }),
      task('far', { dueDate: '2026-12-25' }), task('done', { dueDate: '2026-10-31', completedAtMs: now.getTime() }),
    ]), noProjects, noChallenges, now);
    expect(a.overdue.map(t => t.id)).toEqual(['late']);
    expect(a.todayTasks.map(t => t.id)).toEqual(['today']);
    expect(a.upcoming.map(u => u.title)).toEqual(['soon']);
    expect(a.doneToday).toBe(1);
  });
  it('suggests the highest-priority task that is due now as the next focus', () => {
    const a = buildAgenda(workspace([task('a', { dueDate: '2026-10-31' }), task('b', { dueDate: '2026-10-31', priority: 'high' })]), noProjects, noChallenges, now);
    expect(a.next?.id).toBe('b');
  });
  it('suggests nothing when there are no open tasks', () => {
    expect(buildAgenda(workspace([]), noProjects, noChallenges, now).next).toBeNull();
  });
  it('puts all-day events before timed events in today\'s schedule', () => {
    const ev = (id: string, allDay: boolean, time: string | null) => ({ id, title: id, description: '', startDate: '2026-10-31', startTime: time, endDate: '2026-10-31', endTime: time ? '23:00' : null, allDay, timeZone: 'UTC', startAtMs: null, endAtMs: null, reminderOffsetMinutes: null, createdAtMs: 0, updatedAtMs: 0 });
    const a = buildAgenda(workspace([], [ev('timed', false, '10:00'), ev('allday', true, null)]), noProjects, noChallenges, now);
    expect(a.schedule.map(s => s.title)).toEqual(['allday', 'timed']);
  });
  it('shows engineering commitments only when the user has dated them and they are open', () => {
    const challenges = { challenges: [{ id: 'c1', title: 'Utility enclosure', checklist: ['x', 'y'] }], progress: [
      { challengeId: 'c1', status: 'In Progress', deadlineDate: '2026-11-02', checks: [0] },
      { challengeId: 'c2', status: 'Completed', deadlineDate: '2026-11-02', checks: [] },
      { challengeId: 'c3', status: 'In Progress', deadlineDate: null, checks: [] },
    ] } as unknown as ChallengeData;
    const projects = { milestones: [{ id: 'm1', title: 'Draft review', targetDate: '2026-11-04', completedAtMs: null }, { id: 'm2', title: 'Done one', targetDate: '2026-11-04', completedAtMs: 5 }] } as unknown as ProjectsData;
    const a = buildAgenda(workspace([]), projects, challenges, now);
    expect(a.upcoming.map(u => u.title)).toEqual(['Utility enclosure', 'Draft review']);
    expect(a.activeChallenge).toEqual({ id: 'c1', title: 'Utility enclosure', checks: 1, total: 2 });
    expect(buildAgenda(workspace([]), noProjects, noChallenges, now).upcoming).toEqual([]);
    expect(buildAgenda(workspace([]), noProjects, noChallenges, now).activeChallenge).toBeNull();
  });
});
