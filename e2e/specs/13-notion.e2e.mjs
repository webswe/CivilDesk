// Phase 5A Notion foundation in the real application. The Notion API is replaced by an in-process loopback mock that
// can only be reached because the E2E binary is built with the `notion-mock` feature. The credential is a fake token,
// entered through the real password field, stored in the real Windows Credential Manager under the E2E identity,
// and removed again. Nothing here contacts a live Notion workspace; this proves the Tauri + Rust boundary, not live Notion.
import fs from 'node:fs';
import path from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { addTask, button, go, onboard, restartApp, taskRow } from '../lib/app.mjs';
import { e2eDataPaths } from '../lib/guard.mjs';
import { deleteE2eCredential, e2eCredentialExists } from '../lib/credentials.mjs';
import { createNotionMock, FAKE_TOKEN_PREFIX, IDS } from '../lib/notion-mock.mjs';

const TOKEN = FAKE_TOKEN_PREFIX + 'DoNotUseElsewhere_0123456789';
const mock = createNotionMock();
const settings = () => $('//button[@title="Settings"]');
const stateText = () => $('//*[contains(@class,"notion-state")]');
const SIDEBAR = '//aside[@aria-label="Notion navigation"]';
const MAIN = '//main[@aria-label="Notion content"]';
const item = name => $(`${SIDEBAR}//button[contains(@class,"nw-nav-item")][.//span[contains(@class,"nw-nav-name")][normalize-space(.)="${name}"]]`);
const heading = name => $(`${MAIN}//h1[normalize-space(.)="${name}"]`);
const toolbar = label => $(`//*[@role="toolbar"]//button[@aria-label="${label}"]`);
const crumb = name => $(`${MAIN}//nav[@aria-label="Notion breadcrumb"]//button[contains(normalize-space(.),"${name}")]`);
const searchRequests = () => mock.state.requests.filter(r => r.path === '/v1/search').length;
const noOverflow = () => browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const panel = () => $('//section[contains(@class,"notion-panel")]');
const waitState = label => browser.waitUntil(async () => (await stateText().getText()) === label, { timeout: 20000, timeoutMsg: `Notion status never became "${label}"` });
const openSettings = async () => { await settings().click(); await panel().waitForDisplayed(); };
/** Calls a command and returns the structured error instead of throwing, so the error kind can be asserted. */
const rawInvoke = async (command, args = {}) => {
  // Results cross the WebDriver boundary as a JSON string: an unknown command can throw synchronously and Rust errors are objects.
  const json = await browser.executeAsync((cmd, a, done) => {
    const fail = error => done(JSON.stringify({ ok: false, error: { kind: error && typeof error === 'object' ? error.kind ?? null : null, message: String(error && typeof error === 'object' ? error.message : error) } }));
    try { window.__TAURI_INTERNALS__.invoke(cmd, a).then(value => done(JSON.stringify({ ok: true, value })), fail); } catch (error) { fail(error); }
  }, command, args);
  return JSON.parse(json);
};const requestsAfter = n => mock.state.requests.slice(n);
// Opt-in evidence: set CIVILDESK_E2E_EVIDENCE_DIR to save screenshots of the real window (never set in CI).
const evidenceDir = process.env.CIVILDESK_E2E_EVIDENCE_DIR;
const shot = async name => { if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); await browser.saveScreenshot(path.join(evidenceDir, name + '.png')); } };

describe('notion foundation (real application, mocked Notion)', () => {
  before(async () => { await mock.start(); await onboard(); });
  after(async () => { await mock.stop(); deleteE2eCredential(); });

  it('starts disconnected with no credential and no network traffic', async () => {
    await openSettings();
    await waitState('Not connected');
    await expect($('#notion-token')).toHaveAttribute('type', 'password');
    expect(await $('//*[contains(.,"Read-only.")]').isExisting()).toBe(true);
    expect((await rawInvoke('notion_status')).value.state).toBe('not_connected');
    expect(e2eCredentialExists()).toBe(false);
    expect(mock.state.requests).toHaveLength(0);
    await panel().scrollIntoView(); await shot('01-disconnected');
  });

  it('verifies a credential with a read-only request, then stores it only in Windows Credential Manager', async () => {
    await $('#notion-token').setValue(TOKEN);
    await button('Connect').click();
    await waitState('Connected');
    await expect($('#notion-token')).not.toBeExisting();
    expect(await panel().getText()).not.toContain(TOKEN);
    expect(await panel().getText()).toContain('E2E Mock Workspace');
    expect(await panel().getText()).toContain('2026-03-11');

    expect(mock.state.requests).toHaveLength(1);
    expect(mock.state.requests[0]).toMatchObject({ method: 'GET', path: '/v1/users/me', version: '2026-03-11', authorized: true });
    expect(e2eCredentialExists()).toBe(true);
    await panel().scrollIntoView(); await shot('02-connected');

    const status = await rawInvoke('notion_status');
    expect(JSON.stringify(status.value)).not.toContain(TOKEN);
    expect(status.value).toMatchObject({ state: 'connected', readOnly: true, workspaceName: 'E2E Mock Workspace' });
  });

  it('leaves the token out of every file in the E2E profile and out of the page', async () => {
    const { data, webview } = e2eDataPaths();
    const needles = [Buffer.from(TOKEN, 'utf8'), Buffer.from(TOKEN, 'utf16le'), Buffer.from(TOKEN.slice(6), 'utf8')];
    const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
    const hits = [];
    for (const file of [...walk(data), ...walk(webview)]) {
      let bytes; try { bytes = fs.readFileSync(file); } catch { continue; } // locked WebView2 files are skipped, never guessed at
      if (needles.some(n => bytes.includes(n))) hits.push(file);
    }
    expect(hits).toEqual([]);
    expect(await browser.execute(token => document.documentElement.outerHTML.includes(token) || JSON.stringify({ ...localStorage }).includes(token), TOKEN)).toBe(false);
  });

  it('opens a workspace page inside CivilDesk (no dialog) and discovers pages and databases with pagination and no duplicates', async () => {
    await button('Open workspace').click();
    await $(SIDEBAR).waitForDisplayed();
    expect(await $$('//*[@role="dialog"]')).toHaveLength(0);
    await item('E2E Assignments').waitForDisplayed();
    await expect(item('E2E Notes')).toBeDisplayed();
    await shot('03a-workspace-landing');
    expect(await $(`${SIDEBAR}//ul[@aria-label="Shared databases"]`).getText()).toContain('E2E Assignments');
    expect(await $(`${SIDEBAR}//ul[@aria-label="Shared pages"]`).getText()).toContain('E2E Notes');
    await $(`${SIDEBAR}//button[normalize-space(.)="Load more"]`).click();
    await item('E2E Filler 25').waitForDisplayed();
    const names = [];
    for (const el of await $$(`${SIDEBAR}//ul[@aria-label="Shared pages" or @aria-label="Shared databases"]//span[contains(@class,"nw-nav-name")]`)) names.push(await el.getText());
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(28);
    await shot('03b-all-shared-loaded');
  });

  it('shows a database as a readable table, with a Properties control instead of a schema dump, and remembers it', async () => {
    await item('E2E Assignments').click();
    await heading('E2E Assignments').waitForDisplayed();
    const table = $(`${MAIN}//table`);
    await table.waitForDisplayed();
    const text = await table.getText();
    expect(text).toContain('E2E Entry One');
    expect(text).toContain('Done');
    expect(text).toContain('Apr 1, 2026');
    expect(text).not.toContain('2026-04-01');
    expect(text).toContain('Not supported');
    expect(await $(`${MAIN}//details[contains(@class,"nw-details")]`).getAttribute('open')).toBeNull();
    await shot('04-data-source-table');
    await $(`${MAIN}//button[normalize-space(.)="Remember source"]`).click();
    await $(`${MAIN}//button[contains(normalize-space(.),"Remembered")]`).waitForDisplayed();
    const sources = (await rawInvoke('notion_selected_sources')).value;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ resourceId: IDS.dataSource, resourceType: 'data_source', displayName: 'E2E Assignments' });
    await $(`${SIDEBAR}//ul[@aria-label="Saved sources"]//span[normalize-space(.)="E2E Assignments"]`).waitForDisplayed();
    await crumb('E2E Coursework').click();
    await heading('E2E Coursework').waitForDisplayed();
    await expect($(`${MAIN}//button[contains(normalize-space(.),"E2E Archive")]`)).toBeDisplayed();
    await toolbar('Back').click();
    await $(`${MAIN}//table`).waitForDisplayed();
  });

  it('opens a database row as a page, with breadcrumbs, and returns to the table without searching again', async () => {
    const searches = searchRequests();
    await $(`${MAIN}//button[normalize-space(.)="E2E Entry One"]`).click();
    await heading('E2E Entry One').waitForDisplayed();
    const props = await $(`${MAIN}//dl[contains(@class,"nw-props")]`).getText();
    expect(props).toContain('Status'); expect(props).toContain('Apr 1, 2026');
    await $(`${MAIN}//*[contains(@class,"nw-blocks")]//*[contains(.,"E2E entry body")]`).waitForDisplayed();
    await expect(crumb('E2E Assignments')).toBeDisplayed();
    await shot('06-database-entry');
    await toolbar('Back').click();
    await $(`${MAIN}//table`).waitForDisplayed();
    expect(searchRequests()).toBe(searches);
  });

  it('renders a page as a document with nested content, sub-pages, breadcrumbs and honest unsupported blocks', async () => {
    await item('E2E Notes').click();
    await heading('E2E Notes').waitForDisplayed();
    await $(`${MAIN}//h2[normalize-space(.)="E2E Heading"]`).waitForDisplayed();
    const text = await $(`${MAIN}//*[contains(@class,"nw-blocks")]`).getText();
    expect(text).toContain('Attachment not downloaded: Site photo');
    expect(text).toContain('can\u2019t be shown in CivilDesk (table)');
    expect(text).toContain('1.'); expect(text).toContain('E2E first step');
    expect(text).not.toContain('SECRET');
    await expect($(`${MAIN}//button[@aria-label="Open link example.com"]`)).toBeDisplayed();
    expect(await $$(`${MAIN}//img | ${MAIN}//iframe | ${MAIN}//a | ${MAIN}//script`)).toHaveLength(0);
    await shot('05-page-document');
    await $(`${MAIN}//button[contains(@aria-label,"Show nested content of E2E nested bullet")]`).click();
    await $(`${MAIN}//*[contains(.,"E2E nested detail")]`).waitForDisplayed();
    await shot('07-nested-content');
    await $(`${MAIN}//button[contains(@class,"nw-card")][contains(normalize-space(.),"E2E Sub page")]`).click();
    await heading('E2E Sub page').waitForDisplayed();
    await crumb('E2E Notes').click();
    await heading('E2E Notes').waitForDisplayed();
    // The same page also appears under Recent, so expansion is checked in the shared list, where the tree really comes from the page's child blocks.
    const shared = `${SIDEBAR}//ul[@aria-label="Shared pages"]`;
    await $(`${shared}//button[@aria-label="Expand E2E Notes"]`).click();
    const subPage = $(`${shared}//ul[@aria-label="Inside E2E Notes"]//button[contains(@class,"nw-nav-item")][.//span[normalize-space(.)="E2E Sub page"]]`);
    await subPage.waitForDisplayed();
    await subPage.scrollIntoView({ block: 'center' });
    await shot('05b-expanded-navigation');
  });

  it('searches from the sidebar and shows hostile page content as inert text, never as HTML', async () => {
    await $(`${SIDEBAR}//input[@type="search"]`).setValue('Hostile');
    await browser.keys('Enter');
    await $(`${SIDEBAR}//section[@aria-label="Search results"]`).waitForDisplayed();
    await $(`${SIDEBAR}//section[@aria-label="Search results"]//button[contains(@class,"nw-nav-item")]`).click();
    await $(`${MAIN}//*[contains(@class,"nw-blocks")]//p[contains(.,"<img src=x")]`).waitForDisplayed();
    expect(await $$(`${MAIN}//img | ${MAIN}//script | ${MAIN}//iframe | ${MAIN}//a`)).toHaveLength(0);
    expect(await browser.execute(() => typeof window.__e2ePwned)).toBe('undefined');
    await shot('08-search');
    await $(`${SIDEBAR}//section[@aria-label="Search results"]//button[normalize-space(.)="Clear"]`).click();
  });

  it('keeps the connection and the remembered source after the app restarts, without contacting Notion', async () => {
    const before = mock.state.requests.length;
    await restartApp();
    await openSettings();
    await waitState('Connected');
    await expect($('//*[contains(@class,"notion-sources")]//li[contains(.,"E2E Assignments")]')).toBeDisplayed();
    expect(await panel().getText()).toContain('Remembered sources');
    expect(mock.state.requests.length).toBe(before);
    expect(e2eCredentialExists()).toBe(true);
  });

  it('keeps the saved source on the workspace landing screen after a restart', async () => {
    await $('//button[@title="Settings"]').click();
    await button('Open workspace').click();
    await $(`${MAIN}//section[@aria-label="Notion workspace"]//button[normalize-space(.)="E2E Assignments"]`).waitForDisplayed();
  });

  it('keeps the table inside the window and navigation reachable at narrow widths', async () => {
    for (const width of [1600, 1280, 900, 760, 700]) {
      await browser.setWindowSize(width, 900);
      await $(MAIN).waitForDisplayed();
      if (evidenceDir) await shot(`09-workspace-${width}`);
    }
    // 700px: the sidebar is a drawer, the table scrolls in its own container and the page never scrolls sideways.
    expect(await $$(SIDEBAR)).toHaveLength(0);
    await $('//button[@aria-label="Show navigation"]').click();
    await $(SIDEBAR).waitForDisplayed();
    await shot('10-narrow-drawer');
    await item('E2E Assignments').click();
    await $(`${MAIN}//table`).waitForDisplayed();
    expect(await $$(SIDEBAR)).toHaveLength(0);
    expect(await noOverflow()).toBe(true);
    await shot('11-narrow-table');
    await browser.setWindowSize(1280, 820);
    await openSettings(); // the following specs continue from the Settings page
  });
  it('shows rate-limited, authentication-failed and recovered states from a user-initiated check', async () => {
    mock.state.mode = 'ratelimit';
    await button('Check connection').click();
    await waitState('Rate limited');
    expect(await $('//section[contains(@class,"notion-panel")]//*[@role="alert"]').getText()).toContain('limiting requests');
    await expect(button('Open workspace')).toBeEnabled();

    mock.state.mode = 'unauthorized';
    await button('Check connection').click();
    await waitState('Authentication failed');
    await expect(button('Open workspace')).toBeDisabled();
    expect((await rawInvoke('notion_status')).value.state).toBe('auth_failed');
    const search = await rawInvoke('notion_search', { query: null, kind: null, cursor: null });
    expect(search.ok).toBe(false);
    expect(search.error.kind).toBe('auth_failed');

    mock.state.mode = 'forbidden';
    await button('Check connection').click();
    await waitState('Access restricted');

    mock.state.mode = 'ok';
    await button('Check connection').click();
    await waitState('Connected');
    await expect(button('Open workspace')).toBeEnabled();
  });

  it('reports offline calmly while every other CivilDesk feature keeps working', async () => {
    await mock.stop(); // a real connection-refused failure, not a canned response
    await button('Check connection').click();
    await waitState('Offline');
    const alert = await $('//section[contains(@class,"notion-panel")]//*[@role="alert"]').getText();
    expect(alert).toContain('Your CivilDesk data is unaffected');
    await panel().scrollIntoView(); await shot('06-offline');
    expect((await rawInvoke('notion_status')).value.state).toBe('connected'); // network trouble does not rewrite the last verified state

    await go('School');
    await addTask({ title: 'Offline statics homework' });
    await go('Personal');
    await go('School');
    await expect(taskRow('Offline statics homework')).toBeDisplayed();
    await mock.start();
  });

  it('issued only allowlisted read requests with the pinned API version', async () => {
    expect(mock.state.violations).toEqual([]);
    const allowed = [/^GET \/v1\/users\/me$/, /^POST \/v1\/search$/, /^GET \/v1\/databases\/[0-9a-f-]{36}$/, /^GET \/v1\/data_sources\/[0-9a-f-]{36}$/, /^POST \/v1\/data_sources\/[0-9a-f-]{36}\/query$/, /^GET \/v1\/pages\/[0-9a-f-]{36}$/, /^GET \/v1\/blocks\/[0-9a-f-]{36}\/children$/];
    for (const r of mock.state.requests) {
      expect(allowed.some(re => re.test(`${r.method} ${r.path}`))).toBe(true);
      expect(r.version).toBe('2026-03-11');
    }
    for (const command of ['notion_update_page', 'notion_create_page', 'notion_delete_block', 'notion_request', 'notion_sync']) {
      const result = await rawInvoke(command, {});
      expect(result.ok).toBe(false); // no such command exists to be called
    }
  });

  it('disconnects: removes the credential and sources, stops all requests, preserves CivilDesk data', async () => {
    await openSettings(); // the offline test left the app on the School page
    await waitState('Connected');
    await button('Disconnect').click();
    await $('//*[@role="alertdialog"]').waitForDisplayed();
    expect(await $('//*[@role="alertdialog"]').getText()).toContain('does not revoke the connection in Notion');
    await button('Disconnect and remove token').click();
    await waitState('Not connected');
    expect(e2eCredentialExists()).toBe(false);
    await expect($('#notion-token')).toBeDisplayed();
    const status = (await rawInvoke('notion_status')).value;
    expect(status).toMatchObject({ state: 'not_connected', selectedCount: 0 });
    expect((await rawInvoke('notion_selected_sources')).value).toEqual([]);
    const after = mock.state.requests.length;
    const search = await rawInvoke('notion_search', { query: null, kind: null, cursor: null });
    expect(search.ok).toBe(false);
    expect(search.error.kind).toBe('not_connected');
    expect(requestsAfter(after)).toHaveLength(0);

    await go('School');
    await expect(taskRow('Offline statics homework')).toBeDisplayed();
  });

  it('stays disconnected after a restart', async () => {
    await restartApp();
    await openSettings();
    await waitState('Not connected');
    expect(e2eCredentialExists()).toBe(false);
    expect((await rawInvoke('notion_selected_sources')).value).toEqual([]);
  });
});
