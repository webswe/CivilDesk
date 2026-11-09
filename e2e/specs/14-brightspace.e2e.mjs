// Native Brightspace foundation: dedicated fixture executable, synthetic portal, no vault or network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';
import { dialogButton, field, go, localDate, onboard, restartApp, setField } from '../lib/app.mjs';
import { e2eDataPaths } from '../lib/guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.env.CARGO_TARGET_DIR || path.join(root, 'src-tauri', 'target');
const executable = path.join(target, 'debug', 'brightspace-synthetic.exe');
const scenarioFile = path.join(e2eDataPaths().data, 'brightspace-scenario.txt');
const origin = 'https://synthetic.example.test';
const badge = () => $('.brightspace-badge');
const openSettings = async () => { await $('//button[@title="Settings"]').click(); await $('.brightspace-panel').waitForDisplayed(); };
const scenario = value => fs.writeFileSync(scenarioFile, value);
const invoke = async (command, args = {}) => {
  const json = await browser.executeAsync((name, params, done) => {
    const fail = error => done(JSON.stringify({ ok: false, error: String(error) }));
    try { window.__TAURI_INTERNALS__.invoke(name, params).then(value => done(JSON.stringify({ ok: true, value })), fail); }
    catch (error) { fail(error); }
  }, command, args);
  return JSON.parse(json);
};
const inspect = async () => (await invoke('brightspace_inspect')).value;

describe('Brightspace connection foundation (synthetic executable only)', () => {
  before(async () => { await onboard(); await openSettings(); scenario('missing'); });
  after(() => scenario('missing'));

  it('rejects real-profile portal and executable paths before any process launch', async () => {
    await expect(badge()).toHaveText('Not configured');
    const wrongPortal = await invoke('brightspace_save_configuration', { portalOrigin: 'https://learn.example.edu', executablePath: executable });
    expect(wrongPortal.ok).toBe(false);
    const wrongExe = await invoke('brightspace_save_configuration', { portalOrigin: origin, executablePath: path.join(target, 'debug', 'civildesk-e2e.exe') });
    expect(wrongExe.ok).toBe(false);
    expect((await inspect()).state).toBe('not_configured');
  });

  it('configures the isolated fixture and reports missing credentials without a legacy fallback', async () => {
    const saved = await invoke('brightspace_save_configuration', { portalOrigin: origin, executablePath: executable });
    expect(saved.ok).toBe(true);
    expect(saved.value.portalOrigin).toBe(origin);
    const state = await inspect();
    expect(state).toMatchObject({ state: 'authentication_required', profileId: 'civildesk-e2e-synthetic', cliAvailable: true, cliCompatible: true, liveVerified: false });
    await $('#brightspace-portal').setValue(origin);
    await $('#brightspace-executable').setValue(executable);
    await $('button=Inspect status').click();
    await expect(badge()).toHaveText('Authentication required');
  });

  it('shows a stored synthetic credential as unverified, including after restart', async () => {
    scenario('present');
    expect((await inspect()).state).toBe('credential_present_unverified');
    await $('button=Inspect status').click();
    await expect(badge()).toHaveText('Credential stored, unverified');
    expect(await $('.brightspace-panel').getText()).not.toContain('Connected');
    await restartApp(); await openSettings();
    expect((await inspect()).state).toBe('credential_present_unverified');
    expect((await invoke('brightspace_configuration')).value.portalOrigin).toBe(origin);
  });

  it('separates portal mismatch and credential error without exposing fixture data', async () => {
    scenario('mismatch'); expect((await inspect()).state).toBe('portal_mismatch');
    scenario('credential_error'); expect((await inspect()).state).toBe('credential_error');
    scenario('invalid_config'); expect((await inspect()).state).toBe('cli_incompatible');
  });

  it('rejects unsupported, malformed, and unexpected capability contracts', async () => {
    for (const value of ['unsupported', 'malformed', 'unexpected']) {
      scenario(value);
      expect((await inspect()).state).toBe('cli_incompatible');
    }
  });

  it('bounds output, enforces timeout, and handles failed or terminated children', async () => {
    for (const [value, state] of [['oversized', 'output_too_large'], ['oversized_stderr', 'output_too_large'], ['timeout', 'cli_timeout'], ['nonzero', 'process_error'], ['terminated', 'process_error']]) {
      scenario(value);
      expect((await inspect()).state).toBe(state);
    }
  });

  it('cancels a running status check and cleans up its synthetic child', async () => {
    scenario('timeout');
    const result = await browser.executeAsync(done => {
      const pending = window.__TAURI_INTERNALS__.invoke('brightspace_inspect');
      setTimeout(() => { void window.__TAURI_INTERNALS__.invoke('brightspace_cancel'); }, 300);
      pending.then(value => done(value), error => done({ state: 'error', message: String(error) }));
    });
    expect(result.state).toBe('cancelled');
    scenario('missing');
    expect((await inspect()).state).toBe('authentication_required');
  });

  it('lists distinct synthetic courses without importing local School records', async () => {
    scenario('courses_duplicate_names');
    const before = (await invoke('load_academic')).value;
    const result = await invoke('brightspace_courses');
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ portalOrigin: origin, mode: 'synthetic_cli', complete: true, warnings: [] });
    expect(result.value.courses.map(c => c.id)).toEqual(['610101', '610102']);
    expect(result.value.courses.map(c => c.name)).toEqual(['Shared Title', 'Shared Title']);
    expect((await invoke('load_academic')).value).toEqual(before);
  });

  it('keeps empty and missing metadata distinct from failed retrieval', async () => {
    scenario('courses_empty'); expect((await invoke('brightspace_courses')).value.courses).toEqual([]);
    scenario('courses_missing_optional');
    const result = (await invoke('brightspace_courses')).value;
    expect(result.courses[0]).toMatchObject({ id: '610303', code: '', semester_name: '', start_date: null, end_date: null });
    for (const value of ['courses_malformed', 'courses_invalid_json', 'courses_failure']) {
      scenario(value); const response = await invoke('brightspace_courses');
      expect(response.ok).toBe(false); expect(response.error).not.toContain('Synthetic failure');
    }
  });

  it('bounds and cancels synthetic course reads', async () => {
    scenario('courses_oversized'); expect((await invoke('brightspace_courses')).ok).toBe(false);
    scenario('courses_timeout'); expect((await invoke('brightspace_courses')).error).toContain('time');
    const result = await browser.executeAsync(done => {
      const pending = window.__TAURI_INTERNALS__.invoke('brightspace_courses');
      setTimeout(() => { void window.__TAURI_INTERNALS__.invoke('brightspace_cancel'); }, 300);
      pending.then(value => done({ value }), error => done({ message: String(error) }));
    });
    expect(result.message).toContain('cancelled');
  });

  it('opens Classes, searches, selects a source identity, and retains stale data after a failed refresh', async () => {
    scenario('courses_duplicate_names'); await go('School'); await $('button=Classes').click();
    await expect($('.classes-workspace')).toBeDisplayed();
    await expect($('.classes-status')).toHaveText(expect.stringContaining('not loaded'));
    await $('button=Refresh sample').waitForEnabled(); await $('button=Refresh sample').click();
    await expect($$('.classes-card')).toBeElementsArrayOfSize(2);
    await $('.classes-card').click();
    await expect($('.classes-detail')).toHaveText(expect.stringContaining('Course ID'));
    await expect($('.classes-detail')).toHaveText(expect.stringContaining('610101'));
    await $('button=Back to Classes').click();
    await $('input[aria-label="Search classes"]').setValue('CIV 202');
    await expect($$('.classes-card')).toBeElementsArrayOfSize(1);
    await $('input[aria-label="Search classes"]').setValue('Shared title');
    await expect($$('.classes-card')).toBeElementsArrayOfSize(2);
    scenario('courses_invalid_json'); await $('button=Refresh sample').click();
    await expect($('.classes-status')).toHaveText(expect.stringContaining('last successful sample'));
    await expect($$('.classes-card')).toBeElementsArrayOfSize(2);
  });

  it('shows an honest empty state and clears transient cache after restart', async () => {
    scenario('courses_empty'); await $('button=Refresh sample').click();
    await expect($('section[aria-labelledby="sample-classes-heading"] .classes-empty')).toHaveText(expect.stringContaining('sample course list is empty'));
    await restartApp(); await go('School'); await $('button=Classes').click();
    await expect($('.classes-status')).toHaveText(expect.stringContaining('not loaded'));
    expect((await invoke('load_academic')).value.courses).toEqual([]);
    scenario('courses_missing_optional'); await $('button=Refresh sample').click();
    await expect($$('.classes-card')).toBeElementsArrayOfSize(1);
    await $('.classes-card').click();
    await expect($('.classes-detail')).toHaveText(expect.stringContaining('Term unavailable'));
  });

  it('reads only synthetic assignments with source identity and completeness evidence', async () => {
    scenario('assignments_partial');
    const before = (await invoke('load_academic')).value;
    const result = await invoke('brightspace_assignments');
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ portalOrigin: origin, mode: 'synthetic_cli', limitedCourseCount: false });
    expect(result.value.results.map(r => r.courseId)).toEqual(['610101', '610202']);
    expect(result.value.results[0].completeness.status).toBe('potentially_truncated');
    expect(result.value.results[0].assignments.map(a => a.id)).toEqual(['801', '802', '803']);
    expect(result.value.results[0].assignments[0].due_date).toBe('2026-11-18T17:00:00');
    expect(result.value.results[1].assignments[0].id).toBe('801');
    expect((await invoke('load_academic')).value).toEqual(before);
  });

  it('keeps individual course failures visible and bounds assignment subprocesses', async () => {
    scenario('assignments_many_courses');
    const bounded = (await invoke('brightspace_assignments')).value;
    expect(bounded.limitedCourseCount).toBe(true);
    expect(bounded.courses).toHaveLength(12);
    expect(bounded.results).toHaveLength(12);
    scenario('assignments_partial_failure');
    const partial = (await invoke('brightspace_assignments')).value;
    expect(partial.results[0].assignments).toHaveLength(3);
    expect(partial.results[1].error).toBeTruthy();
    for (const value of ['assignments_invalid_json', 'assignments_malformed', 'assignments_oversized', 'assignments_timeout']) {
      scenario(value);
      const result = (await invoke('brightspace_assignments')).value;
      expect(result.results.every(r => r.error && r.assignments.length === 0)).toBe(true);
    }
    scenario('assignments_timeout');
    const cancelled = await browser.executeAsync(done => {
      const pending = window.__TAURI_INTERNALS__.invoke('brightspace_assignments');
      setTimeout(() => { void window.__TAURI_INTERNALS__.invoke('brightspace_cancel'); }, 300);
      pending.then(value => done({ value }), reason => done({ message: String(reason) }));
    });
    expect(cancelled.message).toContain('cancelled');
  });

  it('navigates the Assignment Calendar with filters, details, and unscheduled work', async () => {
    scenario('assignments_partial'); await go('School'); await $('button=Assignment Calendar').click();
    await expect($('.assignment-calendar')).toBeDisplayed();
    await $('.assignment-calendar').$('button=Refresh sample').waitForEnabled();
    await $('.assignment-calendar').$('button=Refresh sample').click();
    await expect($('.assignment-warning')).toHaveText(expect.stringContaining('may be truncated'));
    await $('button=Upcoming').click();
    await expect($$('.assignment-card.synthetic')).toBeElementsArrayOfSize(4);
    await $('button=Month').click();
    await expect($('.assignment-day[aria-label^="2026-11-18"]')).toHaveAttribute('aria-label', expect.stringContaining('3 assignments'));
    await $('.assignment-day[aria-label^="2026-11-18"]').click();
    await expect($$('.assignment-main section:first-of-type .assignment-card.synthetic')).toBeElementsArrayOfSize(3);
    await $('button=Week').click();
    await expect($('.assignment-days.week')).toBeDisplayed();
    await $('button=Upcoming').click();
    await $('.assignment-filters label:nth-of-type(1) input').click();
    await expect($$('.assignment-card.synthetic')).toBeElementsArrayOfSize(3);
    await $('.assignment-main section:last-child .assignment-card').click();
    await expect($('.assignment-detail')).toHaveText(expect.stringContaining('No recognized due date'));
    await expect($('.assignment-detail')).toHaveText(expect.stringContaining('Synthetic Brightspace'));
    await $('button=Back to calendar').click();
    await restartApp(); await go('School'); await $('button=Assignment Calendar').click();
    await expect($('.assignment-status')).toHaveText(expect.stringContaining('Refresh to load synthetic'));
  });

  it('shows local coursework beside synthetic work without importing or merging it', async () => {
    await $('button=New semester').click();
    await field('Name').setValue('Fictional local term');
    await setField(await field('Start date'), localDate(-30));
    await setField(await field('End date'), localDate(90));
    await dialogButton('Save semester').click();
    await $('button=Add course').click();
    await field('Course code').setValue('CIV 201');
    await field('Course name').setValue('Structures and the Built Environment');
    await dialogButton('Save course').click();
    await $('button=Add coursework').click();
    await field('Title').setValue('Design brief');
    await setField(await field('Type', 'select'), 'assignment');
    await setField(await field('Due date'), localDate(3));
    await dialogButton('Save coursework').click();
    await go('School'); await $('button=Assignment Calendar').click();
    scenario('missing'); await $('.assignment-calendar').$('button=Refresh sample').click();
    await expect($('.assignment-status')).toHaveText(expect.stringContaining('Sample retrieved'));
    await $('button=Upcoming').click();
    await expect($('.assignment-card.local')).toHaveText(expect.stringContaining('Design brief'));
    await expect($$('.assignment-main section:first-of-type .assignment-card.synthetic')).toBeElementsArrayOfSize(3);
    expect((await invoke('load_academic')).value.work).toHaveLength(1);
    await restartApp(); await go('School'); await $('button=Assignment Calendar').click(); await $('button=Upcoming').click();
    await expect($('.assignment-card.local')).toHaveText(expect.stringContaining('Design brief'));
    await expect($$('.assignment-card.synthetic')).toBeElementsArrayOfSize(0);
  });

  it('plans local assignment study only after confirmation and opens Focus from the saved block', async () => {
    await $('.assignment-card.local').click();
    const before = (await invoke('load_study')).value.blocks.length;
    await $('button=Plan Study Session').click();
    await $('//dialog[@open]').waitForDisplayed();
    await expect(field('For coursework', 'select')).toHaveText(expect.stringContaining('Design brief'));
    await expect($('//dialog[@open]')).toHaveText(expect.stringContaining('CivilDesk local assignment'));
    await expect($('//dialog[@open]')).toHaveText(expect.stringContaining('Due ' + localDate(3)));
    await browser.setWindowSize(700, 760);
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/assignment-study-local-narrow.png'));
    await browser.setWindowSize(1280, 820);
    expect(await field('Date').getValue()).toBe('');
    expect(await field('Start time').getValue()).toBe('');
    await dialogButton('Cancel').click();
    expect((await invoke('load_study')).value.blocks).toHaveLength(before);
    await $('button=Back to assignment').click();
    await $('button=Plan Study Session').click();
    await setField(await field('Date'), localDate(1));
    await setField(await field('Start time'), '18:30');
    await setField(await field('Minutes'), '30');
    await dialogButton('Save study block').click();
    await expect($('//ul[@aria-label="Upcoming study blocks"]')).toHaveText(expect.stringContaining('Design brief'));
    await $('button=Back to assignment').click();
    await expect($('.assignment-detail')).toHaveText(expect.stringContaining('Design brief'));
    const blocks = (await invoke('load_study')).value.blocks;
    expect(blocks).toHaveLength(before + 1);
    expect(blocks.at(-1)).toMatchObject({ taskId: (await invoke('load_academic')).value.work[0].taskId, startTime: '18:30', durationMinutes: 30 });
    expect((await invoke('load_academic')).value.work).toHaveLength(1);
    await $('//div[@aria-label="School view"]//button[normalize-space(.)="Study"]').click();
    await $('button[aria-label="Start studying Design brief"]').click();
    await expect($('//h1[normalize-space(.)="Focus"]')).toBeDisplayed();
    expect((await invoke('load_study')).value.sessions).toHaveLength(0);
    await restartApp(); await go('School'); await $('//div[@aria-label="School view"]//button[normalize-space(.)="Study"]').click();
    await expect($('//ul[@aria-label="Upcoming study blocks"]')).toHaveText(expect.stringContaining('Design brief'));
  });

  it('keeps synthetic assignment planning as an in-memory preview without academic imports', async () => {
    await $('button=Assignment Calendar').click();
    scenario('missing'); await $('.assignment-calendar').$('button=Refresh sample').click();
    await expect($('.assignment-status')).toHaveText(expect.stringContaining('Sample retrieved'));
    await $('.assignment-main section:last-child .assignment-card.synthetic').click();
    const academicBefore = (await invoke('load_academic')).value;
    const blocksBefore = (await invoke('load_study')).value.blocks.length;
    await $('button=Plan Study Session').click();
    await expect($('.assignment-plan-preview')).toHaveText(expect.stringContaining('No study block or coursework is saved'));
    await setField(await $('.assignment-plan-preview input[type="date"]'), localDate(2));
    await setField(await $('.assignment-plan-preview input[type="time"]'), '16:15');
    await expect($('.assignment-plan-preview')).toHaveText(expect.stringContaining('Preview:'));
    await browser.setWindowSize(700, 760);
    await $('.assignment-plan-preview').scrollIntoView();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/assignment-study-preview-narrow.png'));
    await browser.setWindowSize(1280, 820);
    expect((await invoke('load_study')).value.blocks).toHaveLength(blocksBefore);
    expect((await invoke('load_academic')).value).toEqual(academicBefore);
    await restartApp(); await go('School'); await $('button=Assignment Calendar').click();
    await expect($$('.assignment-plan-preview')).toBeElementsArrayOfSize(0);
    await expect($$('.assignment-card.synthetic')).toBeElementsArrayOfSize(0);
  });

  it('shows grade display values without inventing grades or stable item IDs', async () => {
    scenario('missing'); await go('School'); await $('button=Classes').click();
    await $('button=Refresh sample').click();
    await $('.classes-card').click();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-overview.png'));
    await $('button=Grades').click();
    await expect($('.classes-status')).toHaveText(expect.stringContaining('Refresh to load'));
    await $('.classes-feed').$('button=Refresh sample').click();
    await expect($$('.classes-feed-card')).toBeElementsArrayOfSize(3);
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Source page completeness is unknown'));
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Not shown by source; not zero'));
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Displayed points'));
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('0'));
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('no stable grade-item ID'));
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-grades-wide.png'));
    await $('.classes-feed-card:nth-child(3)').scrollIntoView();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-grades-content-wide.png'));
    await browser.setWindowSize(700, 760);
    await $('.classes-feed-card:nth-child(3)').scrollIntoView();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-grades-narrow.png'));
    await browser.setWindowSize(1280, 820);
    await $('button=Back to Classes').click();
    await $('.classes-card:nth-child(2)').click(); await $('button=Grades').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Fictional studio exercise'));
  });

  it('shows announcements as inert text and reports unknown metadata', async () => {
    await $('button=Back to Classes').click(); await $('.classes-card').click();
    await $('button=Announcements').click();
    await $('.classes-feed').$('button=Refresh sample').click();
    await expect($$('.classes-feed-card')).toBeElementsArrayOfSize(3);
    await expect($('.classes-feed')).toHaveText(expect.stringContaining("<script>alert('sample')</script>"));
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Publication date and author unavailable'));
    expect(await $$('.classes-feed script, .classes-feed iframe, .classes-feed img, .classes-feed a')).toHaveLength(0);
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-announcements-wide.png'));
    await $('.classes-feed-card:nth-child(2)').scrollIntoView();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-announcements-content-wide.png'));
    await browser.setWindowSize(700, 760);
    await $('.classes-feed-card:nth-child(3)').scrollIntoView();
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-announcements-narrow.png'));
    await browser.setWindowSize(1280, 820);
    await $('button=Back to Classes').click(); await $('.classes-card:nth-child(2)').click(); await $('button=Announcements').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Fictional schedule note'));
  });

  it('keeps an empty announcement page distinct from failed and stale reads', async () => {
    scenario('announcements_empty'); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('No announcements were returned in the available page'));
    scenario('announcements_partial_failure'); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('This course could not be read'));
    await expect($('.classes-feed')).not.toHaveText(expect.stringContaining('No announcements were returned'));
    scenario('announcements_invalid_json'); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('This course returned invalid academic data'));
  });

  it('bounds and cancels new synthetic class-information reads', async () => {
    scenario('grades_oversized');
    const bounded = (await invoke('brightspace_grades')).value;
    expect(bounded.results.every(r => r.error && r.items.length === 0)).toBe(true);
    scenario('announcements_timeout');
    const cancelled = await browser.executeAsync(done => {
      const pending = window.__TAURI_INTERNALS__.invoke('brightspace_announcements');
      setTimeout(() => { void window.__TAURI_INTERNALS__.invoke('brightspace_cancel'); }, 300);
      pending.then(value => done({ value }), reason => done({ message: String(reason) }));
    });
    expect(cancelled.message).toContain('cancelled');
  });

  it('distinguishes partial, empty, and failed class information and clears it on restart', async () => {
    scenario('grades_partial_failure');
    await $('button=Grades').click(); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('This course could not be read'));
    await expect($('.classes-feed')).not.toHaveText(expect.stringContaining('No grade items were returned'));
    await $('button=Back to Classes').click(); await $('.classes-card').click(); await $('button=Grades').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('Fictional design brief'));
    scenario('grades_empty'); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('No grade items were returned in the available page'));
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-grades-empty.png'));
    scenario('grades_invalid_json'); await $('.classes-feed').$('button=Refresh sample').click();
    await expect($('.classes-feed')).toHaveText(expect.stringContaining('This course returned invalid academic data'));
    await browser.saveScreenshot(path.join(root, 'e2e/results/screenshots/classes-grades-error.png'));
    await restartApp(); await go('School'); await $('button=Classes').click();
    await expect($('.classes-status')).toHaveText(expect.stringContaining('not loaded'));
  });
});
