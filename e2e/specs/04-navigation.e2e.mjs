// Sidebar grouping, Engineering expansion, breadcrumbs, keyboard use, icon rail, persisted collapse.
import { $, browser, expect } from '@wdio/globals';
import { NAV, button, go, navButton, onboard, restartApp, waitReady } from '../lib/app.mjs';

const crumbs = () => $('//nav[@aria-label="Breadcrumb"]');

describe('navigation (real application)', () => {
  before(async () => { await onboard(); });
  afterEach(async () => { await browser.setWindowSize(1280, 820); });

  it('offers the intent-based entries and no placeholder destinations', async () => {
    for (const label of ['My Day', 'School', 'Personal', 'Engineering', 'Calendar', 'Focus', 'Pip']) await expect(navButton(label)).toBeDisplayed();
    for (const gone of ['Courses', 'Grades', 'Goals', 'Habits', 'Analytics', 'Portfolio Manager']) await expect(navButton(gone)).not.toBeExisting();
  });

  it('expands the Engineering group to reach every engineering page', async () => {
    const toggle = navButton('Engineering');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Projects', 'Challenges', 'Skills', 'Journal']) await expect(navButton(label)).toBeDisplayed();
    await go('Challenges');
    await expect($('//h1[normalize-space(.)="Engineering Challenges"]')).toBeDisplayed();
    await expect(navButton('Challenges')).toHaveAttribute('aria-current', 'page');
    await expect(crumbs()).toHaveText(expect.stringContaining('Engineering'));
  });

  it('uses clickable breadcrumbs to return to a parent page', async () => {
    await go('Pip');
    await button('Wardrobe').click();
    await expect($('//h1[normalize-space(.)="Wardrobe"]')).toBeDisplayed();
    await expect(navButton('Pip')).toHaveAttribute('aria-current', 'page');
    await crumbs().$('.//button[normalize-space(.)="Pip"]').click();
    await expect($('//h1[normalize-space(.)="Pip"]')).toBeDisplayed();
  });

  it('can be driven with the keyboard', async () => {
    await go('My Day');
    await browser.keys(['Tab']);
    await expect(navButton('School')).toBeFocused();
    await browser.keys(['Enter']);
    await expect($('//h1[normalize-space(.)="School"]')).toBeDisplayed();
    await expect(navButton('School')).toHaveAttribute('aria-current', 'page');
  });

  it('collapses to an icon rail in a narrow window and keeps every page reachable', async () => {
    await browser.setWindowSize(700, 700);
    await browser.waitUntil(async () => (await $('//aside[contains(@class,"narrow")]').isExisting()), { timeoutMsg: 'Sidebar did not switch to the icon rail.' });
    await expect($(`${NAV}//button[@title="My Day"]/span`)).not.toBeDisplayed(); // label hidden, icon only
    const projects = $(`${NAV}//button[@title="Projects"]`);
    await expect(projects).toBeDisplayed();
    await projects.click();
    await expect($('//h1[normalize-space(.)="Projects"]')).toBeDisplayed();
  });

  it('remembers a collapsed sidebar after the application restarts', async () => {
    await button('Collapse sidebar').click();
    await expect($('//aside[contains(@class,"collapsed")]')).toBeExisting();
    await restartApp();
    await expect($('//aside[contains(@class,"collapsed")]')).toBeExisting();
    await button('Expand sidebar').click();
    await expect($('//aside[contains(@class,"collapsed")]')).not.toBeExisting();
    await waitReady();
  });
});
