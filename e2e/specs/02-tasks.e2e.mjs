// School/Personal classification, custom categories, edit, complete, and view consistency.
import { $, expect } from '@wdio/globals';
import { addTask, button, dialogButton, field, go, localDate, onboard, reloadView, seedTask, setField, taskRow, taskTitles } from '../lib/app.mjs';

const rowChip = (title, chip) => $(`//article[.//strong[normalize-space(.)="${title}"]]//span[normalize-space(.)="${chip}"]`);

describe('tasks by area (real application)', () => {
  before(async () => { await onboard(); });

  it('files a School task under School only', async () => {
    await go('School');
    await addTask({ title: 'Statics homework', due: localDate(0) });
    expect(await taskTitles()).toEqual(['Statics homework']);
    await go('Personal');
    await expect(taskRow('Statics homework')).not.toBeExisting();
  });

  it('files a Personal task under Personal and defaults the Area from the page', async () => {
    await go('Personal');
    await button('New task').click();
    await expect(field('Area', 'select')).toHaveValue('Personal');
    await dialogButton('Cancel').click();
    await addTask({ title: 'Book dentist' });
    expect(await taskTitles()).toContain('Book dentist');
  });

  it('shows both areas in All tasks with an area chip', async () => {
    await go('My Day');
    await button('All tasks').click();
    expect(await taskTitles()).toEqual(expect.arrayContaining(['Statics homework', 'Book dentist']));
    await expect(rowChip('Statics homework', 'School')).toBeDisplayed();
  });

  it('preserves legacy custom categories and classifies them without rewriting them', async () => {
    await seedTask({ title: 'Legacy math task', category: 'Math homework' });
    await seedTask({ title: 'Legacy errand', category: 'Errands' });
    await reloadView();
    await go('School');
    await expect(taskRow('Legacy math task')).toBeDisplayed();
    await expect(rowChip('Legacy math task', 'Math homework')).toBeDisplayed();
    await go('Personal');
    await expect(taskRow('Legacy errand')).toBeDisplayed();
    await button('Edit Legacy errand').click();
    await expect(field('Area', 'select')).toHaveValue('Errands'); // the existing label stays selectable
    await dialogButton('Cancel').click();
  });

  it('edits a task', async () => {
    await go('Personal');
    await button('Edit Book dentist').click();
    await field('Title').setValue('Book dentist appointment');
    await setField(await field('Area', 'select'), 'School');
    await dialogButton('Save task').click();
    await go('School');
    await expect(taskRow('Book dentist appointment')).toBeDisplayed();
  });

  it('completes and reopens a task, keeping the lists consistent', async () => {
    await go('School');
    await button('Complete Statics homework').click();
    await expect(taskRow('Statics homework')).not.toBeExisting(); // the Open filter hides it
    await go('My Day');
    await expect($('//*[@aria-label="Tasks for today"]')).not.toBeExisting();
    await go('School');
    await setField(await $('//select[@aria-label="Filter tasks"]'), 'done');
    await expect(taskRow('Statics homework')).toBeDisplayed();
    await button('Reopen Statics homework').click();
    await setField(await $('//select[@aria-label="Filter tasks"]'), 'open');
    await expect(taskRow('Statics homework')).toBeDisplayed();
  });
});
