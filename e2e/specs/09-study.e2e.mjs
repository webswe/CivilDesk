// Study experience: plan study for an exam, see it in School / My Day / Calendar, start Focus from a block, finish a
// real (one-minute) Focus session, and check recorded time, history and the weekly goal, before and after a restart.
// Nothing here fabricates a completed session: the application's own timer must run to completion.
import { $, browser, expect } from '@wdio/globals';
import { button, dialogButton, field, go, invoke, localDate, onboard, reloadView, restartApp, setField, taskFixture, waitForPersisted } from '../lib/app.mjs';

const EXAM = 'Midterm exam';
const PLAN = 'Review chapter 5';
const NOW_BLOCK = 'Practice problems';
const todayStudy = () => $('//*[@aria-label="Study blocks today"]');
const studyTab = () => $('//div[@aria-label="School view"]//button[normalize-space(.)="Study"]');

describe('study experience (real application)', () => {
  let exam;
  before(async () => {
    await onboard();
    exam = taskFixture({ title: EXAM, category: 'School', dueDate: localDate(5) });
    await invoke('save_semester', { semester: { id: 'st-sem', name: 'Fall', institution: '', startDate: localDate(-30), endDate: localDate(90), makeActive: true } });
    await invoke('save_course', { course: { id: 'st-course', semesterId: 'st-sem', code: 'CSE 1321', name: 'Programming', instructor: '', description: '', meetingSchedule: '', location: '', color: '' } });
    await invoke('save_coursework', { coursework: { task: exam, courseId: 'st-course', workType: 'exam', referenceNotes: '' } });
    await reloadView();
  });

  it('starts with honest empty study states', async () => {
    await go('School');
    await studyTab().click();
    await expect($('//*[contains(.,"Nothing scheduled")]')).toBeDisplayed();
    await expect($('//h2[contains(.,"No completed study sessions")]')).toBeDisplayed();
  });

  it('plans study for the exam without moving its deadline', async () => {
    await $('//div[@aria-label="School view"]//button[normalize-space(.)="Overview"]').click();
    await button(`Plan study for ${EXAM}`).click();
    await $('//dialog[@open]').waitForDisplayed();
    await expect(field('For coursework', 'select')).toHaveText(expect.stringContaining(EXAM));
    await field('Objective').setValue(PLAN);
    await setField(await field('Date'), localDate(1));
    await setField(await field('Start time'), '18:30');
    await dialogButton('Save study block').click();
    await $('//dialog[@open]').waitForDisplayed({ reverse: true });
    const workspace = await invoke('load_workspace', {});
    expect(workspace.tasks.find(t => t.id === exam.id).dueDate).toBe(localDate(5));
    await studyTab().click();
    await expect($(`//ul[@aria-label="Upcoming study blocks"]//strong[normalize-space(.)="${PLAN}"]`)).toBeDisplayed();
  });

  it('shows the planned block in My Day (Coming up) and in the Calendar', async () => {
    await go('My Day');
    await expect($('//section[@aria-labelledby="upcoming-heading"]//small[contains(.,"Study ·")]')).toBeDisplayed();
    await go('Calendar');
    await expect($('//span[contains(@class,"calendar-chip") and contains(@class,"study") and normalize-space(.)="Study · CSE 1321"]')).toBeDisplayed();
  });

  it('plans a second block for today and starts Focus from it in My Day', async () => {
    await invoke('save_study_block', { block: { id: 'st-now', courseId: 'st-course', taskId: exam.id, title: NOW_BLOCK, startDate: localDate(0), startTime: '12:00', durationMinutes: 30 } });
    await reloadView();
    await go('My Day');
    await expect(todayStudy().$(`.//strong[normalize-space(.)="${NOW_BLOCK}"]`)).toBeDisplayed();
    await button(`Start studying ${NOW_BLOCK}`).click();
    await expect($('//h1[normalize-space(.)="Focus"]')).toBeDisplayed();
    await expect($('//*[contains(@class,"focus-context")]')).toHaveText(expect.stringContaining(`CSE 1321 · ${NOW_BLOCK}`));
    const select = await $('//label[starts-with(normalize-space(.),"Working on")]//select');
    expect(await browser.execute(el => el.selectedOptions[0].textContent, select)).toContain(EXAM);
  });

  it('runs a real one-minute focus session and records its actual time', async function () {
    this.timeout(150000); // the application's own one-minute timer must really finish
    await setField(await $('//label[starts-with(normalize-space(.),"Focus minutes")]//input'), '1');
    await button('Start focus').click();
    await $('//button[normalize-space(.)="Pause"]').waitForDisplayed();
    const during = await invoke('load_study', {});
    expect(during.sessions).toHaveLength(0); // a running session is not study time
    await $('//button[normalize-space(.)="Complete session"]').waitForDisplayed({ timeout: 120000, timeoutMsg: 'The one-minute focus timer never finished.' });
    await button('Complete session').click();
    await waitForPersisted('load_study', s => s.sessions.length === 1, 'the completed study session');
    const { sessions } = await invoke('load_study', {});
    expect(sessions[0]).toMatchObject({ courseId: 'st-course', taskId: exam.id, studyBlockId: 'st-now' });
    expect(sessions[0].creditedMs).toBe(60000); // the timer's minute, not the block's 30 planned minutes
    const workspace = await invoke('load_workspace', {});
    expect(workspace.progression.history.filter(e => e.kind === 'focus_completed')).toHaveLength(1);
    expect(workspace.progression.xp).toBe(50);
  });

  it('shows recorded study time, history and the weekly goal in School', async () => {
    await go('School');
    await studyTab().click();
    await expect($('//*[@aria-label="Weekly study totals"]')).toHaveText(expect.stringContaining('Studied 1 min in 1 session'));
    await expect($(`//ul[@aria-label="Upcoming study blocks"]//strong[normalize-space(.)="${NOW_BLOCK}"]`)).not.toBeExisting(); // studied, so no longer planned
    await expect($('//ul[@aria-label="Completed study sessions"]//strong')).toHaveText(expect.stringContaining('CSE 1321'));
    await button('Set weekly goal for CSE 1321').click();
    await setField(await field('Minutes per week', 'input'), '5');
    await dialogButton('Save goal').click();
    await expect($('//ul[@aria-label="Weekly study goals"]')).toHaveText(expect.stringContaining('1 min of 5 min'));
  });

  it('keeps sessions, blocks and the goal after the application is restarted', async () => {
    await waitForPersisted('load_study', s => s.goals.length === 1 && s.blocks.length === 2, 'goal and blocks');
    await restartApp();
    await go('School');
    await studyTab().click();
    await expect($('//*[@aria-label="Weekly study totals"]')).toHaveText(expect.stringContaining('Studied 1 min in 1 session'));
    await expect($('//ul[@aria-label="Weekly study goals"]')).toHaveText(expect.stringContaining('1 min of 5 min'));
    await expect($(`//ul[@aria-label="Upcoming study blocks"]//strong[normalize-space(.)="${PLAN}"]`)).toBeDisplayed();
    const workspace = await invoke('load_workspace', {});
    expect(workspace.progression.xp).toBe(50); // no extra reward from restarting or viewing progress
  });

  it('cancels a block softly: it leaves the plan and the Calendar but stays in history', async () => {
    await button(`Cancel study block ${PLAN}`).click();
    await expect($(`//ul[@aria-label="Upcoming study blocks"]`)).not.toBeExisting();
    const { blocks } = await invoke('load_study', {});
    expect(blocks.find(b => b.title === PLAN)).toMatchObject({ status: 'cancelled' });
    expect(blocks).toHaveLength(2);
    await go('Calendar');
    await expect($('//span[contains(@class,"calendar-chip") and contains(@class,"study")]')).toBeDisplayed(); // today's studied block remains; the cancelled one is gone
    expect((await invoke('load_workspace', {})).progression.xp).toBe(50);
  });
});
