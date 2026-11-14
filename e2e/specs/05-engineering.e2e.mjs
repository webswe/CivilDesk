// Engineering: library, pathways, skills, challenge progress, challenge-to-project, journal, no XP.
import { $, $$, expect } from '@wdio/globals';
import { button, go, navButton, onboard, waitForPersisted } from '../lib/app.mjs';

async function openEngineering(label) {
  const toggle = navButton('Engineering');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await go(label);
}
async function pipProgress() {
  await go('Pip');
  const text = await $('//*[contains(@class,"pip-level")]').getText();
  await go('My Day');
  return text;
}

describe('engineering (real application)', () => {
  let baseline;
  before(async () => { await onboard(); baseline = await pipProgress(); });

  it('lists all nine challenges in the library', async () => {
    await openEngineering('Challenges');
    await button('Library').click();
    expect((await $$('//button[contains(@class,"challenge-card")]')).length).toBe(9);
  });

  it('shows learning pathways', async () => {
    await button('Pathways').click();
    expect((await $$('//ol[contains(@class,"pathway-list")]')).length).toBeGreaterThan(0);
  });

  it('opens the Skills view', async () => {
    await openEngineering('Skills');
    await expect($('//*[contains(.,"do not certify professional competency")]')).toBeDisplayed();
  });

  it('starts a challenge, records checklist progress, and completes it', async () => {
    await openEngineering('Challenges');
    await button('Library').click();
    await $('(//button[contains(@class,"challenge-card")])[1]').click();
    await button('Start guided').click();
    const boxes = await $$('//label[contains(@class,"challenge-check")]//input');
    expect(boxes.length).toBeGreaterThan(0);
    await expect($('//button[normalize-space(.)="Mark completed"]')).toBeDisabled();
    for (let i = 0; i < boxes.length; i++) {
      await $(`(//label[contains(@class,"challenge-check")]//input)[${i + 1}]`).click();
      await waitForPersisted('load_challenges', data => data.progress.some(p => p.checks.includes(i)), `challenge criterion ${i + 1} checked`);
      await expect($(`(//label[contains(@class,"challenge-check")]//input)[${i + 1}]`)).toBeChecked();
      await expect($(`//small[contains(.,"${i + 1} of ${boxes.length} criteria checked")]`)).toBeDisplayed();
    }
    await expect($(`//small[contains(.,"${boxes.length} of ${boxes.length} criteria checked")]`)).toBeDisplayed();
    await expect($('//button[normalize-space(.)="Mark completed"]')).toBeEnabled();
    await button('Mark completed').click();
    await expect($('//*[contains(@class,"challenge-status") and normalize-space(.)="Completed"]')).toBeDisplayed();
  });

  it('converts the challenge into an engineering project', async () => {
    await button('Create project from challenge').click();
    await expect($('//h1[normalize-space(.)="Draft a small utility enclosure"]')).toBeDisplayed();
    await expect($('//span[normalize-space(.)="LINKED CHALLENGES"]')).toBeDisplayed();
    await openEngineering('Projects');
    await expect($('//button[contains(@class,"project-title")]')).toBeDisplayed();
  });

  it('opens the project journal', async () => {
    await $('//button[contains(@class,"project-title")]').click();
    // Scope to the project tabs: the sidebar also has a button named "Journal".
    await $('//div[contains(@class,"project-tabs")]//button[normalize-space(.)="Journal"]').click();
    await expect($('//h2[normalize-space(.)="Engineering journal"]')).toBeDisplayed();
    await openEngineering('Journal');
    await expect(navButton('Journal')).toHaveAttribute('aria-current', 'page');
  });

  it('awards no Pip XP for engineering activity', async () => {
    expect(await pipProgress()).toBe(baseline);
  });
});
