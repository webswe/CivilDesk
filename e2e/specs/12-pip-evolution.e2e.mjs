// Pip Evolution in the real application: brief reactions to clicks and to verified rewards, quiet focus behaviour, the
// wardrobe, persistence across a restart, and reduced motion. Records are created through the UI or the app's own commands;
// XP and unlock state are read back from the authoritative backend, never inferred from the screen. Animation timing is
// not asserted: the semantic pose in the accessible label is.
import { $, browser, expect } from '@wdio/globals';
import { addTask, button, go, onboard, reloadView, restartApp, waitForPersisted, invoke } from '../lib/app.mjs';

const DOCK = '//div[contains(@class,"pip-dock")]';
const dockArt = () => $(`${DOCK}//*[local-name()="svg"][@role="img"]`);
const dockNote = () => $(`${DOCK}//small[@aria-live="polite"]`);
const poseLabel = async () => (await dockArt().getAttribute('aria-label')) ?? '';
const card = title => $(`//article[contains(@class,"cosmetic-card")][.//strong[normalize-space(.)="${title}"]]`);
const waitForPose = (needle, timeout = 6000) => browser.waitUntil(async () => (await poseLabel()).includes(needle), { timeout, interval: 100, timeoutMsg: `Pip never showed "${needle}"` });
const waitForPoseGone = (needle, timeout = 12000) => browser.waitUntil(async () => !(await poseLabel()).includes(needle), { timeout, interval: 200, timeoutMsg: `Pip stayed "${needle}"` });
const workspace = () => invoke('load_workspace', {});

describe('pip evolution (real application)', () => {
  before(async () => { await onboard(); });

  it('starts calm, reacts briefly to clicks, and a click never changes XP or the saved companion state', async () => {
    await expect(dockArt()).toBeDisplayed();
    expect(await poseLabel()).toContain('awake');
    await button('Pet Pip').click();
    await waitForPose('affectionate');
    for (let i = 0; i < 5; i++) await button('Pet Pip').click(); // rapid clicking must stay harmless
    const snapshot = await invoke('load_snapshot', {});
    expect(['affectionate', 'curious', 'happy', 'celebrating']).not.toContain(snapshot.companion.state);
    expect((await workspace()).progression.xp).toBe(0);
    await waitForPoseGone('affectionate');
    await waitForPoseGone('curious');
    await waitForPoseGone('happy');
    expect(await poseLabel()).toContain('awake');
  });

  it('shows locked wardrobe items, previews without equipping, and refuses to equip a locked item', async () => {
    await go('Pip');
    await button('Wardrobe').click();
    await $('//h1[normalize-space(.)="Wardrobe"]').waitForDisplayed();
    const dusk = card('Dusk Pip');
    await expect(dusk).toHaveText(expect.stringContaining('Locked · Complete ten different tasks'));
    await expect(dusk.$('.//button[normalize-space(.)="Locked"]')).toBeDisabled();
    await dusk.$('.//button[normalize-space(.)="Preview"]').click();
    await expect($('//*[normalize-space(.)="Previewing Dusk Pip"]')).toBeDisplayed();
    expect((await workspace()).progression.styleId).toBe('classic');
    await expect(invoke('equip_cosmetic', { id: 'dusk', equipped: true })).rejects.toThrow(/still locked/);
    await expect(invoke('equip_cosmetic', { id: 'sage', equipped: true })).rejects.toThrow(/still locked/);
    expect((await workspace()).progression.styleId).toBe('classic');
  });

  it('pays task XP once, celebrates the verified achievement briefly, and never replays it after a reload', async () => {
    await go('Personal');
    await addTask({ title: 'Pip evolution task' });
    await button('Complete Pip evolution task').click();
    await waitForPersisted('load_workspace', d => d.progression.xp === 25, 'task XP = 25');
    await waitForPose('celebrating');
    await expect(dockNote()).toHaveText(expect.stringContaining('Achievement unlocked!'));
    await waitForPoseGone('celebrating');
    const data = await workspace();
    expect(data.progression.history).toHaveLength(1);
    expect(data.progression.earned).toContain('first_task');
    await reloadView();
    expect(await poseLabel()).not.toContain('celebrating');
    expect(await dockNote().getText()).not.toContain('Achievement');
    expect((await workspace()).progression.xp).toBe(25);
  });

  it('equips an earned cosmetic and keeps it, with the original rewards, after a restart', async () => {
    await go('Pip');
    await button('Wardrobe').click();
    await card('Rosewood scarf').$('.//button[normalize-space(.)="Equip"]').click();
    await waitForPersisted('load_workspace', d => d.progression.scarf === true, 'the equipped scarf');
    await restartApp();
    expect(await poseLabel()).toContain('wearing a scarf');
    const data = await workspace();
    expect(data.progression.xp).toBe(25);
    expect(data.progression.unlocked).toContain('scarf');
    expect(data.progression.unlocked).not.toContain('dusk');
    await go('Pip');
    await button('Wardrobe').click();
    await button('Restore default look').click();
    await waitForPersisted('load_workspace', d => d.progression.scarf === false && d.progression.styleId === 'classic', 'the default look');
    expect(await poseLabel()).not.toContain('scarf');
  });

  it('keeps Pip quiet during a focus session while the earned reward is still paid, then settles afterwards', async () => {
    await go('Personal');
    await addTask({ title: 'Pip quiet task' });
    await go('Focus');
    await button('Start focus').click();
    await $('//button[normalize-space(.)="Pause"]').waitForDisplayed();
    await go('Personal');
    await button('Complete Pip quiet task').click();
    await waitForPersisted('load_workspace', d => d.progression.xp === 50 && d.progression.history.length === 2, 'the second task reward');
    expect(await poseLabel()).toContain('focused');
    await expect(dockNote()).not.toHaveText(expect.stringContaining('Another task finished.'));
    await button('Pet Pip').click(); // an explicit click must not break focus suppression
    expect(await poseLabel()).toContain('focused');
    const running = (await workspace()).sessions.find(s => s.status === 'running');
    await invoke('focus_action', { action: 'stop', id: running.id, taskId: null, duration: 0, breakMinutes: 0, courseId: null, studyBlockId: null });
    await reloadView();
    expect(await poseLabel()).not.toContain('focused'); // a leftover saved focus state does not stick
    expect(await poseLabel()).not.toContain('celebrating'); // and the reward earned during focus is not replayed
    expect((await workspace()).progression.xp).toBe(50);
  });

  it('keeps Pip visible, readable and clickable under reduced motion, and remembers the choice', async () => {
    await go('Settings');
    await $('//label[contains(normalize-space(.),"Reduced motion")]//input').click();
    await browser.waitUntil(async () => browser.execute(() => document.documentElement.classList.contains('reduced-motion')), { timeout: 5000, timeoutMsg: 'Reduced motion was not applied.' });
    await expect(dockArt()).toBeDisplayed();
    expect(await dockArt().getAttribute('class')).toContain('still');
    await button('Pet Pip').click();
    expect(await poseLabel()).toMatch(/Pip is (affectionate|curious|happy)/); // still communicates its state without movement
    await waitForPersisted('load_snapshot', s => s.preferences.reducedMotion === true, 'the reduced motion preference');
    await restartApp();
    await expect(dockArt()).toBeDisplayed();
    expect(await dockArt().getAttribute('class')).toContain('still');
  });
});
