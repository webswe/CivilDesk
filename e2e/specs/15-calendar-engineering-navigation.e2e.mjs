// Navigation through the real E2E application and its disposable SQLite profile.
import { $, $$, browser, expect } from '@wdio/globals';
import { button, go, invoke, localDate, onboard, reloadView, restartApp, seedTask, waitForPersisted } from '../lib/app.mjs';

const projectId = 'navigation-project';
const archivedId = 'navigation-archived';
const taskId = 'navigation-task';
const archivedTaskId = 'navigation-archived-task';
const milestoneId = 'navigation-milestone';
const projectTitle = 'Navigation drafting project';
const milestoneTitle = 'Navigation drawing review';
const taskTitle = 'Navigation drawing task';
const archivedTaskTitle = 'Navigation archived task';

const project = (id, title, status) => ({
  id, title, description: '', discipline: 'Civil drafting', category: '', projectType: 'Educational',
  software: [], startDate: null, targetDate: null, status, priority: null,
  createdAtMs: 1, updatedAtMs: 1, completedAtMs: null, portfolioCandidate: false,
  portfolioSummary: '', objectives: '', contributions: '', skills: '', decisions: '', lessons: '',
});

const monday = date => {
  const day = new Date(date + 'T12:00:00');
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
};

const focusId = () => browser.execute(() => document.activeElement?.id);
const expectFocus = id => browser.waitUntil(async () => (await focusId()) === id, {
  timeout: 5000, timeoutMsg: 'Focus did not reach ' + id,
});
const selectedDetail = () => $('.calendar-detail');

describe('Calendar and engineering navigation (isolated native application)', () => {
  let challengeId;
  let challengeTitle;
  let projectDay;
  let challengeDay;
  let original;

  before(async () => {
    await onboard();
    projectDay = localDate();
    challengeDay = localDate(1);
    const challenges = await invoke('load_challenges', {});
    challengeId = challenges.challenges[0].id;
    challengeTitle = challenges.challenges[0].title;

    await invoke('save_project', { project: project(projectId, projectTitle, 'Planning') });
    await invoke('save_project', { project: project(archivedId, 'Navigation archived project', 'Archived') });
    const savedTask = await seedTask({ id: taskId, title: taskTitle, category: 'Engineering', dueDate: projectDay });
    await invoke('associate_task', { taskId: savedTask.id, projectId });
    await waitForPersisted('load_workspace', data => data.tasks.find(t => t.id === savedTask.id)?.projectId === projectId, 'project task association');
    const savedArchivedTask = await seedTask({ id: archivedTaskId, title: archivedTaskTitle, category: 'Engineering', dueDate: projectDay });
    await invoke('associate_task', { taskId: savedArchivedTask.id, projectId: archivedId });
    await waitForPersisted('load_workspace', data => data.tasks.find(t => t.id === savedArchivedTask.id)?.projectId === archivedId, 'archived project task association');
    await invoke('save_milestone', { milestone: {
      id: milestoneId, projectId, title: milestoneTitle, description: '', targetDate: projectDay,
      completedAtMs: null, createdAtMs: 1, updatedAtMs: 1,
    } });
    const week = monday(projectDay);
    await invoke('challenge_action', { id: challengeId, action: 'start', week, mode: 'guided', notes: null, deadline: null, check: null });
    await invoke('challenge_action', { id: challengeId, action: 'deadline', week, mode: null, notes: null, deadline: challengeDay, check: null });
    await invoke('link_challenge_project', { challengeId, projectId });
    original = {
      projects: await invoke('load_projects', {}),
      challenges: await invoke('load_challenges', {}),
      workspace: await invoke('load_workspace', {}),
    };
    expect(original.workspace.tasks.find(t => t.id === savedTask.id)).toMatchObject({ projectId, dueDate: projectDay, completedAtMs: null });
    expect(original.workspace.tasks.find(t => t.id === savedArchivedTask.id)).toMatchObject({ projectId: archivedId, dueDate: projectDay, completedAtMs: null });
    expect(original.projects.milestones.find(m => m.id === milestoneId)).toMatchObject({ projectId, targetDate: projectDay, completedAtMs: null });
    expect(original.projects.projects.find(p => p.id === archivedId)?.status).toBe('Archived');
    await reloadView();
  });

  it('opens the exact project task and milestone, then restores Calendar focus', async () => {
    await go('Calendar');
    await button('Week').click();
    await $(`#calendar-day-${projectDay}`).click();
    await button('Open project for ' + taskTitle).click();
    await expect($(`//h1[normalize-space(.)="${projectTitle}"]`)).toBeDisplayed();
    await expectFocus('project-tasks-' + taskId);
    await button('Back to Calendar').click();
    await expectFocus('calendar-project-task-' + taskId);
    await expect(button('Week')).toHaveAttribute('aria-pressed', 'true');
    expect(await $(`#calendar-day-${projectDay}`).getAttribute('class')).toContain('selected');
    await button('Open project for ' + milestoneTitle).click();
    await expect($(`//h1[normalize-space(.)="${projectTitle}"]`)).toBeDisplayed();
    await expectFocus('project-milestones-' + milestoneId);
    await button('Back to Calendar').click();
    await expectFocus('calendar-project-milestone-' + milestoneId);
    await expect(button('Week')).toHaveAttribute('aria-pressed', 'true');
    expect(await $(`#calendar-day-${projectDay}`).getAttribute('class')).toContain('selected');
    await button('Month').click();
  });

  it('opens the exact dated challenge and returns to its challenge-only day', async () => {
    await $(`#calendar-day-${challengeDay}`).click();
    const detail = selectedDetail();
    await expect(detail.$(`#calendar-challenge-${challengeId}`)).toBeDisplayed();
    expect((await detail.$$('.calendar-detail-row')).length).toBe(1);
    await expect(detail.$('p')).not.toBeExisting();
    await button('Open challenge ' + challengeTitle).click();
    await expect($(`//h1[normalize-space(.)="${challengeTitle}"]`)).toBeDisplayed();
    await expectFocus('challenge-heading');
    await button('Back to Calendar').click();
    await expectFocus('calendar-challenge-' + challengeId);
    await button('Open challenge ' + challengeTitle).click();
    await button('View on Calendar').click();
    await expectFocus('calendar-challenge-' + challengeId);
    expect(await $(`#calendar-day-${challengeDay}`).getAttribute('class')).toContain('selected');
  });

  it('opens an archived project without changing its status', async () => {
    if (!(await $(`#calendar-day-${projectDay}`).isExisting())) await button('Previous period').click();
    await $(`#calendar-day-${projectDay}`).click();
    await button('Week').click();
    await button('Open project for ' + archivedTaskTitle).click();
    await expect($('//h1[normalize-space(.)="Navigation archived project"]')).toBeDisplayed();
    await expectFocus('project-tasks-' + archivedTaskId);
    await button('Back to Calendar').click();
    await expectFocus('calendar-project-task-' + archivedTaskId);
    await expect(button('Week')).toHaveAttribute('aria-pressed', 'true');
    expect(await $(`#calendar-day-${projectDay}`).getAttribute('class')).toContain('selected');
    await button('Month').click();
  });

  it('keeps the linked challenge and case study workspace reachable by exact relationship', async () => {
    await $(`#calendar-day-${challengeDay}`).click();
    await button('Open challenge ' + challengeTitle).click();
    await button('Open workspace').click();
    await expect($(`//h1[normalize-space(.)="${projectTitle}"]`)).toBeDisplayed();
    await button('Review challenge').click();
    await expect($(`//h1[normalize-space(.)="${challengeTitle}"]`)).toBeDisplayed();
    await button('Open case study').click();
    await expect($('//div[@role="tablist" and @aria-label="Project workspace"]//button[@role="tab" and @aria-selected="true" and normalize-space(.)="Portfolio"]')).toBeDisplayed();
  });

  it('does not create records or change progress through navigation or restart', async () => {
    await restartApp();
    const current = {
      projects: await invoke('load_projects', {}),
      challenges: await invoke('load_challenges', {}),
      workspace: await invoke('load_workspace', {}),
    };
    expect(current.projects.projects).toEqual(original.projects.projects);
    expect(current.projects.milestones).toEqual(original.projects.milestones);
    expect(current.challenges.progress).toEqual(original.challenges.progress);
    expect(current.challenges.projects).toEqual(original.challenges.projects);
    expect(current.workspace.tasks).toEqual(original.workspace.tasks);
    expect(current.workspace.events).toEqual(original.workspace.events);
    expect(current.workspace.tasks.find(t => t.id === taskId)?.projectId).toBe(projectId);
    expect(current.workspace.tasks.find(t => t.id === archivedTaskId)?.projectId).toBe(archivedId);
    expect(current.projects.milestones.find(m => m.id === milestoneId)?.projectId).toBe(projectId);
    expect(current.projects.projects.find(p => p.id === archivedId)?.status).toBe('Archived');
    expect(current.projects.projects.filter(p => p.id === projectId)).toHaveLength(1);
    expect(current.workspace.tasks.filter(t => t.id === taskId || t.id === archivedTaskId)).toHaveLength(2);
    expect(current.challenges.progress.filter(p => p.challengeId === challengeId)).toHaveLength(1);
    await go('Calendar');
    await $(`#calendar-day-${challengeDay}`).click();
    await expect(button('Open challenge ' + challengeTitle)).toBeDisplayed();
    expect((await $$(`.calendar-detail #calendar-challenge-${challengeId}`)).length).toBe(1);
  });
});
