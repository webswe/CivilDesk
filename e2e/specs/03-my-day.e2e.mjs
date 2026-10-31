// My Day: empty day, today/overdue/upcoming/events, one-click completion, Start focus.
import { $, browser, expect } from '@wdio/globals';
import { button, go, localDate, onboard, reloadView, seedEvent, seedTask, setField } from '../lib/app.mjs';

const next = () => $('//section[@aria-label="What to focus on next"]');
const todayList = () => $('//*[@aria-label="Tasks for today"]');
const upcoming = title => $(`//section[@aria-labelledby="upcoming-heading"]//strong[normalize-space(.)="${title}"]`);

describe('My Day (real application)', () => {
  before(async () => { await onboard(); });

  it('shows a calm empty day with no engineering content', async () => {
    await go('My Day');
    await expect(next().$('.//strong')).toHaveText('Nothing queued');
    await expect($('//*[contains(.,"Nothing scheduled and nothing due")]')).toBeDisplayed();
    await expect($('//h2[normalize-space(.)="In progress"]')).not.toBeExisting();
    await expect($('//*[contains(.,"Engineering challenge")]')).not.toBeExisting();
  });

  it('lists overdue and due-today tasks, events, and upcoming deadlines', async () => {
    await seedTask({ title: 'Overdue lab report', category: 'School', dueDate: localDate(-2) });
    await seedTask({ title: 'Today reading', category: 'School', dueDate: localDate(0), priority: 'high' });
    await seedTask({ title: 'Soon errand', category: 'Personal', dueDate: localDate(3) });
    await seedTask({ title: 'Far future task', category: 'Personal', dueDate: localDate(30) });
    await seedEvent({ title: 'Structures lecture' });
    await reloadView();
    await go('My Day');
    await expect(todayList().$('.//strong[normalize-space(.)="Overdue lab report"]')).toBeDisplayed();
    await expect(todayList().$('.//strong[normalize-space(.)="Today reading"]')).toBeDisplayed();
    await expect($("//*[@aria-label=\"Today's schedule\"]//strong[normalize-space(.)=\"Structures lecture\"]")).toBeDisplayed();
    await expect(upcoming('Soon errand')).toBeDisplayed();
    await expect(upcoming('Far future task')).not.toBeExisting();
    await expect(todayList().$('.//*[contains(@class,"tag") and contains(@class,"overdue")]')).toBeDisplayed();
  });

  it('suggests the high-priority task and opens Focus with it selected', async () => {
    await expect(next().$('.//strong')).toHaveText('Today reading');
    await next().$('.//button[contains(.,"Start focus")]').click();
    await expect($('//h1[normalize-space(.)="Focus"]')).toBeDisplayed();
    const select = await $('//label[starts-with(normalize-space(.),"Working on")]//select');
    expect(await browser.execute(el => el.selectedOptions[0].textContent, select)).toBe('Today reading');
  });

  it('completes a task in one click and updates the progress line', async () => {
    await go('My Day');
    await button('Complete Today reading').click();
    await expect(todayList().$('.//strong[normalize-space(.)="Today reading"]')).not.toBeExisting();
    await expect($("//*[@aria-label=\"Today's progress\"]")).toHaveText(expect.stringContaining('1 of 2 done'));
  });

  it('matches the task lists', async () => {
    await go('School');
    await setField(await $('//select[@aria-label="Filter tasks"]'), 'open');
    await expect($('//article[.//strong[normalize-space(.)="Overdue lab report"]]')).toBeDisplayed();
    await expect($('//article[.//strong[normalize-space(.)="Today reading"]]')).not.toBeExisting();
  });
});
