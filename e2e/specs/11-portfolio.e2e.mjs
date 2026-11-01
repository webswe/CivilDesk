// Portfolio Studio in the real application with the authoritative backend: author a case study for an existing engineering
// project, add evidence, preview it, export it as a static website folder, inspect the generated files independently of
// CivilDesk, restart, and confirm both the case study and the underlying project data survived. Nothing is faked: records are
// created through the UI or the app's own commands, and the export is read back from disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { button, go, navButton, onboard, restartApp, setField, waitForPersisted, invoke } from '../lib/app.mjs';

// A genuine 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TITLE = 'Parking lot grading study';
const SECRET_JOURNAL = 'SECRET-JOURNAL-TEXT';
const SECRET_NOTE = 'SECRET-MILESTONE-NOTE';
const SECRET_DESC = 'SECRET-PROJECT-DESCRIPTION';
const SUMMARY = 'Grading and drainage study for a small parking lot.';
const BACKGROUND = 'The lot ponded after rain <b>and</b> needed positive drainage.';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'civildesk-portfolio-e2e-'));
const imagePath = path.join(work, 'Site Plan (final).png');
const exportRoot = path.join(work, 'exports');
const exportFolder = path.join(exportRoot, 'Parking-lot-grading-study');

const studioTab = name => $(`//div[@aria-label="Portfolio section"]//button[normalize-space(.)="${name}"]`);
const area = label => $(`//label[contains(normalize-space(.),"${label}")]//textarea`);
const projectId = crypto.randomUUID();

async function openProjectPortfolio() {
  const toggle = navButton('Engineering');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await go('Projects');
  await $('//button[contains(@class,"project-title")]').click();
  await $('//div[@role="tablist"]//button[normalize-space(.)="Portfolio"]').click();
  await $('//h2[normalize-space(.)="Portfolio Studio"]').waitForDisplayed();
}

describe('portfolio studio (real application)', () => {
  before(async () => {
    fs.mkdirSync(exportRoot, { recursive: true });
    fs.writeFileSync(imagePath, PNG);
    await onboard();
    const now = Date.now();
    await invoke('save_project', { project: {
      id: projectId, title: TITLE, description: SECRET_DESC, discipline: 'Land Development', category: '', projectType: 'Academic exercise', software: ['Civil 3D'],
      startDate: '2026-09-01', targetDate: '2026-10-15', status: 'In Progress', priority: null, createdAtMs: now, updatedAtMs: now, completedAtMs: null,
      portfolioCandidate: false, portfolioSummary: '', objectives: '', contributions: '', skills: '', decisions: '', lessons: '',
    } });
    await invoke('save_milestone', { milestone: { id: 'ms-survey', projectId, title: 'Survey complete', description: SECRET_NOTE, targetDate: '2026-09-10', completedAtMs: null, createdAtMs: now, updatedAtMs: now } });
    await invoke('save_milestone', { milestone: { id: 'ms-private', projectId, title: 'Unselected milestone', description: '', targetDate: '2026-09-20', completedAtMs: null, createdAtMs: now, updatedAtMs: now } });
    await invoke('save_journal_entry', { entry: { id: 'j1', projectId, title: SECRET_JOURNAL, entryDate: '2026-09-02', description: SECRET_JOURNAL, workCompleted: '', problems: '', solutions: '', skills: '', fileIds: [], createdAtMs: now, updatedAtMs: now } });
  });
  after(() => fs.rmSync(work, { recursive: true, force: true }));

  it('opens an existing project and starts with an empty private case study', async () => {
    await openProjectPortfolio();
    await expect($('//*[contains(.,"0 of 7 parts started")]')).toBeDisplayed();
    await expect($('//*[contains(.,"Nothing leaves this computer unless you export it")]')).toBeDisplayed();
    await expect(button('Save draft')).toBeDisabled();
  });

  it('saves technical details as a draft', async () => {
    await setField(await area('Professional summary'), SUMMARY);
    await setField(await area('Project background'), BACKGROUND);
    await setField(await area('Technical approach'), 'Surface grading with a 1.5% minimum slope.');
    await button('Save draft').click();
    await $('//*[normalize-space(.)="Draft saved"]').waitForDisplayed();
    await waitForPersisted('load_portfolio', d => d.studies.length === 1 && d.studies[0].background === BACKGROUND, 'the saved case study');
  });

  it('lists software and skills only after they are added', async () => {
    await studioTab('Software & skills').click();
    await expect($('//*[normalize-space(.)="No software listed yet."]')).toBeDisplayed();
    await setField(await $('#add-software'), 'Civil 3D');
    await button('Add software').click();
    await $('//button[@aria-label="Remove Civil 3D"]').waitForDisplayed();
    await setField(await $('#add-skill'), 'Grading');
    await button('Add skill').click();
    await $('//button[@aria-label="Remove Grading"]').waitForDisplayed();
    await waitForPersisted('load_portfolio', d => d.tools.length === 2, 'the software and skill');
  });

  it('adds a gallery image with caption and alternative text, and chooses a milestone', async () => {
    await studioTab('Gallery').click();
    await setField(await $('#gallery-path'), imagePath);
    await button('Add image').click();
    await $('//ul[@aria-label="Gallery images"]//strong[contains(.,"Site Plan (final).png")]').waitForDisplayed();
    await setField(await $('//ul[@aria-label="Gallery images"]//label[normalize-space(.)="Caption"]//input'), 'Final site plan');
    await setField(await $('//ul[@aria-label="Gallery images"]//label[starts-with(normalize-space(.),"Alternative text")]//input'), 'Plan view of the parking lot');
    await button('Save text for Site Plan (final).png').click();
    await waitForPersisted('load_portfolio', d => d.gallery.length === 1 && d.gallery[0].caption === 'Final site plan' && !d.gallery[0].missing, 'the gallery image and its caption');
    await studioTab('Timeline').click();
    await $('//label[contains(.,"Survey complete")]//input').click();
    await waitForPersisted('load_portfolio', d => d.milestones.length === 1 && d.milestones[0].milestoneId === 'ms-survey', 'the selected milestone');
  });

  it('previews exactly what will be exported', async () => {
    await studioTab('Preview & export').click();
    const frame = await $('//iframe[contains(@class,"preview-frame")]');
    await frame.waitForDisplayed();
    const doc = await browser.execute(el => el.getAttribute('srcdoc'), frame);
    expect(doc).toContain(TITLE);
    expect(doc).toContain('&lt;b&gt;and&lt;/b&gt;');
    expect(doc).not.toContain('<b>and</b>');
    expect(doc).toContain('data:image/png;base64,');
    expect(doc).toContain('Survey complete');
    for (const secret of [SECRET_JOURNAL, SECRET_NOTE, SECRET_DESC, 'Unselected milestone']) expect(doc).not.toContain(secret);
    expect(await frame.getAttribute('sandbox')).toBe('');
    await expect($('//li[normalize-space(.)="Gallery images (1)"]')).toBeDisplayed();
  });

  it('exports a portable static website folder and refuses to overwrite without approval', async () => {
    await setField(await $('#export-folder'), exportRoot);
    await button('Export case study').click();
    await $('//*[@role="status"]//strong[normalize-space(.)="Exported."]').waitForDisplayed();
    const html = fs.readFileSync(path.join(exportFolder, 'index.html'), 'utf8');
    expect(fs.readdirSync(exportFolder).sort()).toEqual(['.civildesk-export', 'assets', 'index.html']);
    expect(fs.readdirSync(path.join(exportFolder, 'assets'))).toEqual(['image-01.png']);
    expect(fs.readFileSync(path.join(exportFolder, 'assets', 'image-01.png')).equals(PNG)).toBe(true);
    expect(html).toContain('src="assets/image-01.png"');
    expect(html).toContain('Plan view of the parking lot');
    expect(html).toContain('&lt;b&gt;and&lt;/b&gt;');
    expect(html).not.toMatch(/<script/i);
    for (const leak of [SECRET_JOURNAL, SECRET_NOTE, SECRET_DESC, 'Unselected milestone', work, imagePath, 'Site Plan (final)', 'civildesk.sqlite3', projectId]) expect(html).not.toContain(leak);
    // The package is portable: moved elsewhere, the relative image reference still resolves.
    const moved = path.join(work, 'moved-site');
    fs.cpSync(exportFolder, moved, { recursive: true });
    expect(fs.existsSync(path.join(moved, 'assets', 'image-01.png'))).toBe(true);
    // A second export to the same place asks first and changes nothing until approved.
    await button('Export case study').click();
    await button('Replace existing export').waitForDisplayed();
    await button('Cancel').click();
    await button('Export case study').click();
    await button('Replace existing export').click();
    await $('//*[@role="status"]//strong[normalize-space(.)="Exported."]').waitForDisplayed();
    expect(fs.existsSync(path.join(exportFolder, 'index.html'))).toBe(true);
  });

  it('keeps the case study and the original project data after a restart', async () => {
    await restartApp();
    await openProjectPortfolio();
    expect(await (await area('Professional summary')).getValue()).toBe(SUMMARY);
    expect(await (await area('Project background')).getValue()).toBe(BACKGROUND);
    await expect($('//*[contains(.,"parts started")]')).toBeDisplayed();
    const projects = await invoke('load_projects', {});
    const project = projects.projects.find(p => p.id === projectId);
    expect(project.title).toBe(TITLE);
    expect(project.description).toBe(SECRET_DESC);
    expect(project.portfolioSummary).toBe(SUMMARY);
    expect(projects.projects.filter(p => p.title === TITLE)).toHaveLength(1);
    expect(projects.milestones.filter(m => m.projectId === projectId)).toHaveLength(2);
    expect(projects.journal.some(j => j.title === SECRET_JOURNAL)).toBe(true);
  });

  it('removing a gallery image keeps the original file', async () => {
    await studioTab('Gallery').click();
    await button('Remove Site Plan (final).png from gallery').click();
    await $('//*[contains(.,"No gallery images yet")]').waitForDisplayed();
    expect(fs.existsSync(imagePath)).toBe(true);
    expect((await $$('//ul[@aria-label="Gallery images"]')).length).toBe(0);
    await waitForPersisted('load_portfolio', d => d.gallery.length === 0, 'the removed gallery entry');
  });
});
