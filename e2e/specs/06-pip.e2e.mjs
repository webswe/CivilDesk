// Pip: dock, companion page, wardrobe, achievements, persistence, and task XP.
import { $, expect } from '@wdio/globals';
import { addTask, button, go, onboard, restartApp, waitForPersisted } from '../lib/app.mjs';

const dock = () => $('//div[contains(@class,"pip-dock")]');
const level = () => $('//*[contains(@class,"pip-level")]');

describe('Pip (real application)', () => {
  before(async () => { await onboard(); });

  it('shows a quiet dock that reacts to a pet and opens the Pip page', async () => {
    await expect(dock()).toBeDisplayed();
    await dock().$('.//button[@aria-label="Pet Pip"]').click();
    await dock().$('.//button[@aria-label="Open Pip page"]').click();
    await expect($('//h1[normalize-space(.)="Pip"]')).toBeDisplayed();
    await expect($('//*[normalize-space(.)="Pip likes having you around."]')).toBeDisplayed();
    await expect(level()).toHaveText('Level 1 · 0 XP');
  });

  it('reaches Wardrobe and Achievements from the Pip tabs', async () => {
    await button('Wardrobe').click();
    await expect($('//h1[normalize-space(.)="Wardrobe"]')).toBeDisplayed();
    await button('Achievements').click();
    await expect($('//h1[normalize-space(.)="Achievements"]')).toBeDisplayed();
    await expect($('//*[normalize-space(.)="First step"]')).toBeExisting();
  });

  it('awards task XP once and persists it across a restart', async () => {
    await go('Personal');
    await addTask({ title: 'Pip XP task' });
    await button('Complete Pip XP task').click();
    await waitForPersisted('load_workspace', data => data.progression.xp === 25, 'task XP = 25');
    await restartApp();
    await go('Pip');
    await expect(level()).toHaveText('Level 1 · 25 XP');
  });

  it('hides Pip, removes the dock, and keeps that choice after a restart', async () => {
    await button('Hide Pip').click();
    await expect($('//h2[normalize-space(.)="Pip is taking a break"]')).toBeDisplayed();
    await expect(dock()).not.toBeExisting();
    await restartApp();
    await go('Pip');
    await expect($('//h2[normalize-space(.)="Pip is taking a break"]')).toBeDisplayed();
    await button('Show Pip').click();
    await expect(dock()).toBeDisplayed();
  });
});
