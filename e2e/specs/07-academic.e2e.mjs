// Academic foundation: semester -> course -> coursework, projected into School, My Day, Calendar and Focus,
// completed from My Day, and still there after the application is restarted. Coursework is one ordinary task.
import { $, browser, expect } from '@wdio/globals';
import { button, dialogButton, field, go, invoke, localDate, onboard, restartApp, setField, waitForPersisted } from '../lib/app.mjs';

const TITLE = 'Midterm exam';
const LATER = 'Lab report 2';
const DIALOG = '//dialog[@open]';
const todayList = () => $('//*[@aria-label="Tasks for today"]');
const attentionRow = title => $(`//ul[@aria-label="Upcoming coursework"]//li[.//strong[normalize-space(.)="${title}"]]`);
const courseRow = title => $(`//ul[@aria-label="Coursework"]//li[.//strong[normalize-space(.)="${title}"]]`);

async function addCoursework({ title, type, due }) {
  await button('Add coursework').click();
  await $(DIALOG).waitForDisplayed();
  await field('Title').setValue(title);
  await setField(await field('Type', 'select'), type);
  await setField(await field('Due date'), due);
  await dialogButton('Save coursework').click();
  await $(DIALOG).waitForDisplayed({ reverse: true });
}

describe('academic foundation (real application)', () => {
  before(async () => { await onboard(); });

  it('shows an honest empty state before any semester exists', async () => {
    await go('School');
    await expect($('//h2[normalize-space(.)="No semesters yet"]')).toBeDisplayed();
  });

  it('creates a semester and a course', async () => {
    await button('Create your first semester').click();
    await field('Name').setValue('Fall 2026');
    await setField(await field('Start date'), localDate(-30));
    await setField(await field('End date'), localDate(90));
    await dialogButton('Save semester').click();
    await expect($('//*[contains(@class,"active-tag")]')).toHaveText('Active semester');
    await button('Add a course').click();
    await field('Course code').setValue('CSE 1321');
    await field('Course name').setValue('Programming and Problem Solving');
    await dialogButton('Save course').click();
    await expect($('//button[contains(@class,"course-card")][.//strong[normalize-space(.)="CSE 1321"]]')).toBeDisplayed();
  });

  it('creates coursework and lists it in School with its course context', async () => {
    await addCoursework({ title: TITLE, type: 'exam', due: localDate(0) });
    await addCoursework({ title: LATER, type: 'assignment', due: localDate(3) });
    await expect(attentionRow(TITLE)).toBeDisplayed();
    await expect(attentionRow(TITLE).$('.//small')).toHaveText(expect.stringContaining('Exam · CSE 1321'));
    await expect(attentionRow(LATER)).toBeDisplayed();
  });

  it('shows due-today coursework in My Day with a subtle course label', async () => {
    await go('My Day');
    await expect(todayList().$(`.//strong[normalize-space(.)="${TITLE}"]`)).toBeDisplayed();
    await expect(todayList().$('.//button[contains(@class,"context-link")]')).toHaveText('Exam · CSE 1321');
    await expect($(`//section[@aria-labelledby="upcoming-heading"]//strong[normalize-space(.)="${LATER}"]`)).toBeDisplayed();
  });

  it('shows the deadline in the Calendar as an exam', async () => {
    await go('Calendar');
    await expect($(`//span[contains(@class,"calendar-chip") and contains(@class,"exam") and normalize-space(.)="Exam · ${TITLE}"]`)).toBeDisplayed();
  });

  it('starts Focus from the coursework with the task preselected', async () => {
    await go('School');
    await button(`Start focus for ${LATER}`).click();
    await expect($('//h1[normalize-space(.)="Focus"]')).toBeDisplayed();
    const select = await $('//label[starts-with(normalize-space(.),"Working on")]//select');
    expect(await browser.execute(el => el.selectedOptions[0].textContent, select)).toBe(`${LATER} (Assignment · CSE 1321)`);
  });

  it('completes the exam from My Day and every view agrees', async () => {
    await go('My Day');
    await button(`Complete ${TITLE}`).click();
    await expect(todayList()).not.toBeExisting();
    await go('School');
    await expect(attentionRow(TITLE)).not.toBeExisting();
    await expect($('//*[@aria-label="Semester progress"]')).toHaveText(expect.stringContaining('1 of 2 coursework items done'));
    await go('Calendar');
    await expect($(`//span[contains(@class,"calendar-chip") and normalize-space(.)="Exam · ${TITLE}"]`)).not.toBeExisting();
    await go('School');
    await $('//button[contains(@class,"course-card")]').click();
    await $('//button[starts-with(normalize-space(.),"Completed")]').click();
    await expect(courseRow(TITLE)).toBeDisplayed();
  });

  it('records exactly one task and one academic link, with no duplicate tasks', async () => {
    const academic = await invoke('load_academic', {});
    expect(academic.semesters).toHaveLength(1);
    expect(academic.courses).toHaveLength(1);
    expect(academic.work.map(w => w.workType).sort()).toEqual(['assignment', 'exam']);
    const workspace = await invoke('load_workspace', {});
    expect(workspace.tasks.filter(t => t.title === TITLE)).toHaveLength(1);
    expect(workspace.tasks.find(t => t.title === TITLE).completedAtMs).not.toBeNull();
    expect(workspace.progression.history.filter(e => e.kind === 'task_completed')).toHaveLength(1);
  });

  it('keeps the academic data after the application is restarted', async () => {
    await waitForPersisted('load_academic', a => a.work.length === 2 && a.courses.length === 1, 'semester, course and coursework');
    await restartApp();
    await go('School');
    await expect($('//*[contains(@class,"active-tag")]')).toHaveText('Active semester');
    await expect(attentionRow(LATER)).toBeDisplayed();
    await expect(attentionRow(TITLE)).not.toBeExisting();
    await $('//button[contains(@class,"course-card")]').click();
    await $('//button[starts-with(normalize-space(.),"Completed")]').click();
    await expect(courseRow(TITLE)).toBeDisplayed();
    await go('My Day');
    await expect(todayList()).not.toBeExisting();
  });
});
