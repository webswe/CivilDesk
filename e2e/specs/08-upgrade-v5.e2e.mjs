// File-based upgrade: the real application opens a genuine schema-v5 database (written by the harness before launch,
// see e2e/lib/fixture.mjs) and must migrate it in place to the current schema without losing or reclassifying data.
// The harness then checks the resulting file: current schema version, quick_check and foreign_key_check.
import { $, expect } from '@wdio/globals';
import { button, go, invoke, localDate, navButton, restartApp, taskFixture, taskRow, waitForPersisted, waitReady } from '../lib/app.mjs';

const SEEDED_TASKS = 5;
const openEngineering = async label => {
  const toggle = navButton('Engineering');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await go(label);
};

describe('upgrade from a schema-v5 file (real application)', () => {
  before(async () => { await waitReady(); });

  it('opens the upgraded profile without onboarding and keeps existing tasks in My Day', async () => {
    await expect($('#display-name')).not.toBeExisting();
    await expect($('//h1')).toHaveText(expect.stringContaining('Upgrade'));
    await expect($('//*[@aria-label="Tasks for today"]//strong[normalize-space(.)="Statics homework"]')).toBeDisplayed(); // overdue School task
    await expect($('//section[@aria-labelledby="upcoming-heading"]//strong[normalize-space(.)="Book dentist"]')).toBeDisplayed();
  });

  it('keeps old School tasks as unassigned work and does not invent courses', async () => {
    await go('School');
    await expect($('//h2[normalize-space(.)="No semesters yet"]')).toBeDisplayed();
    await expect(taskRow('Statics homework')).toBeDisplayed();
    await expect(taskRow('Legacy math task')).toBeDisplayed();
    await expect($('//article[.//strong[normalize-space(.)="Legacy math task"]]//span[normalize-space(.)="Math homework"]')).toBeDisplayed(); // category preserved, not rewritten
    await go('Personal');
    await expect(taskRow('Book dentist')).toBeDisplayed();
    await expect(taskRow('Statics homework')).not.toBeExisting();
  });

  it('keeps the engineering project and Pip history', async () => {
    await openEngineering('Projects');
    await expect($('//button[contains(@class,"project-title")][normalize-space(.)="Footbridge Study"]')).toBeDisplayed();
    await go('Pip');
    await expect($('//*[contains(@class,"pip-level")]')).toHaveText(expect.stringContaining('75 XP'));
  });

  it('exposes empty academic and study data and the original records through the app', async () => {
    const academic = await invoke('load_academic', {});
    expect(academic).toEqual({ semesters: [], courses: [], work: [] });
    const study = await invoke('load_study', {});
    expect(study).toEqual({ blocks: [], goals: [], sessions: [] });
    const workspace = await invoke('load_workspace', {});
    expect(workspace.tasks).toHaveLength(SEEDED_TASKS);
    expect(workspace.events).toHaveLength(1);
    expect(workspace.sessions).toHaveLength(1);
    expect(workspace.sessions[0]).toMatchObject({ id: 'old-session', status: 'completed', courseId: null, studyBlockId: null }); // old history is kept, not guessed into a course
    expect(workspace.progression.xp).toBe(75);
    const projects = await invoke('load_projects', {});
    expect(projects.projects).toHaveLength(1);
    expect(projects.milestones).toHaveLength(1);
    expect(workspace.tasks.find(t => t.id === 't-project').projectId).toBe('proj-1');
  });

  it('accepts new academic and study records on the upgraded file and keeps everything after a restart', async () => {
    const task = taskFixture({ title: 'Upgrade exam', category: 'School', dueDate: localDate(6) });
    await invoke('save_semester', { semester: { id: 'up-sem', name: 'Upgrade term', institution: '', startDate: localDate(-30), endDate: localDate(60), makeActive: true } });
    await invoke('save_course', { course: { id: 'up-course', semesterId: 'up-sem', code: 'UPG 101', name: 'Upgrade', instructor: '', description: '', meetingSchedule: '', location: '', color: '' } });
    await invoke('save_coursework', { coursework: { task, courseId: 'up-course', workType: 'exam', referenceNotes: '' } });
    await invoke('save_study_block', { block: { id: 'up-block', courseId: 'up-course', taskId: task.id, title: 'Review', startDate: localDate(1), startTime: '09:00', durationMinutes: 45 } });
    await waitForPersisted('load_study', s => s.blocks.length === 1, 'the study block on the upgraded database');
    await restartApp();
    const workspace = await invoke('load_workspace', {});
    expect(workspace.tasks).toHaveLength(SEEDED_TASKS + 1);
    expect((await invoke('load_academic', {})).work).toHaveLength(1);
    expect((await invoke('load_study', {})).blocks[0]).toMatchObject({ id: 'up-block', taskId: task.id, status: 'planned' });
    await go('School');
    await expect(button('Plan study for Upgrade exam')).toBeDisplayed();
    await expect(taskRow('Statics homework')).toBeDisplayed();
  });
});
