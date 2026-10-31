// Proof of concept: launch the real binary, create a task, restart the app, confirm persistence.
import { $, browser, expect } from '@wdio/globals';
import { addTask, go, navButton, onboard, restartApp, taskRow, waitReady } from '../lib/app.mjs';

const TITLE = 'E2E smoke task';

describe('smoke and persistence (real application)', () => {
  it('launches the E2E build and shows onboarding on an empty profile', async () => {
    await waitReady();
    expect((await browser.getWindowSize()).width).toBeGreaterThan(600);
    await expect($('#display-name')).toBeDisplayed();
  });

  it('completes onboarding and lands on My Day', async () => {
    await onboard('E2E Tester');
    await expect($('//h1')).toHaveText(expect.stringContaining('E2E'));
    await expect(navButton('My Day')).toHaveAttribute('aria-current', 'page');
    await expect($('//section[@aria-label="What to focus on next"]')).toBeDisplayed();
  });

  it('creates a disposable task and shows it in the Personal list', async () => {
    await go('Personal');
    await addTask({ title: TITLE });
    await expect(taskRow(TITLE)).toBeDisplayed();
  });

  it('keeps the task after the application is closed and started again', async () => {
    await restartApp();
    // Onboarding must not return: preferences were persisted by SQLite.
    await expect($('#display-name')).not.toBeExisting();
    await go('Personal');
    await expect(taskRow(TITLE)).toBeDisplayed();
    await go('My Day');
    await expect($(`//section[@aria-label="What to focus on next"]//strong[normalize-space(.)="${TITLE}"]`)).toBeDisplayed();
  });
});
