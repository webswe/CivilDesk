// Phase 5A Notion foundation in the real application. The Notion API is replaced by an in-process loopback mock that
// can only be reached because the E2E binary is built with the `notion-mock` feature. The credential is a fake token,
// entered through the real password field, stored in the real Windows Credential Manager under the E2E identity,
// and removed again. Nothing here contacts a live Notion workspace; this proves the Tauri + Rust boundary, not live Notion.
import fs from 'node:fs';
import path from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { addTask, button, DIALOG, go, onboard, restartApp, taskRow } from '../lib/app.mjs';
import { e2eDataPaths } from '../lib/guard.mjs';
import { deleteE2eCredential, e2eCredentialExists } from '../lib/credentials.mjs';
import { createNotionMock, FAKE_TOKEN_PREFIX, IDS } from '../lib/notion-mock.mjs';

const TOKEN = FAKE_TOKEN_PREFIX + 'DoNotUseElsewhere_0123456789';
const mock = createNotionMock();
const settings = () => $('//button[@title="Settings"]');
const stateText = () => $('//*[contains(@class,"notion-state")]');
const item = name => $(`${DIALOG}//button[contains(@class,"notion-item")][.//strong[contains(normalize-space(.),"${name}")]]`);
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

  it('discovers accessible pages and data sources, with pagination and no duplicates', async () => {
    await button('Browse content').click();
    await item('E2E Assignments').waitForDisplayed();
    await expect(item('E2E Notes')).toBeDisplayed();
    expect(await item('E2E Assignments').getText()).toContain('Data source');
    expect(await item('E2E Notes').getText()).toContain('Page');
    await $(`${DIALOG}//button[normalize-space(.)="Load more"]`).click();
    await item('E2E Filler 25').waitForDisplayed();
    const names = [];
    for (const el of await $$(`${DIALOG}//button[contains(@class,"notion-item")]//strong`)) names.push(await el.getText());
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(28);
    await shot('03-browse');
  });

  it('shows data-source schema and a read-only entry preview, and remembers a source', async () => {
    await item('E2E Assignments').click();
    await $(`${DIALOG}//h2[normalize-space(.)="E2E Assignments"]`).waitForDisplayed();
    const table = $(`${DIALOG}//table`);
    await table.waitForDisplayed();
    const text = await table.getText();
    expect(text).toContain('E2E Entry One');
    expect(text).toContain('Done');
    expect(text).toContain('Unsupported property type (rollup)');
    await shot('04-data-source');
    await $(`${DIALOG}//button[normalize-space(.)="View its database"]`).click();
    await $(`${DIALOG}//h2[normalize-space(.)="E2E Coursework"]`).waitForDisplayed();
    await expect(item('E2E Archive')).toBeDisplayed();
    await $(`${DIALOG}//button[normalize-space(.)="Back"]`).click();
    await $(`${DIALOG}//button[normalize-space(.)="Remember this source"]`).click();
    await $(`${DIALOG}//button[contains(normalize-space(.),"Remembered")]`).waitForDisplayed();
    const sources = (await rawInvoke('notion_selected_sources')).value;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ resourceId: IDS.dataSource, resourceType: 'data_source', displayName: 'E2E Assignments' });
  });

  it('shows page content as inert text, never as HTML', async () => {
    await $(`${DIALOG}//button[normalize-space(.)="Back"]`).click();
    await item('E2E Notes').click();
    await $(`${DIALOG}//*[contains(@class,"notion-blocks")]`).waitForDisplayed();
    const text = await $(`${DIALOG}//*[contains(@class,"notion-blocks")]`).getText();
    expect(text).toContain('E2E Heading');
    expect(text).toContain('Attachment not downloaded: Site photo');
    expect(text).toContain('Unsupported block (table)');
    expect(text).not.toContain('SECRET');
    await shot('05-page-preview');
    await $(`${DIALOG}//button[normalize-space(.)="Back"]`).click();
    await $(`${DIALOG}//input[@type="search"]`).setValue('Hostile');
    await $(`${DIALOG}//button[normalize-space(.)="Search"]`).click();
    await item('Hostile').waitForDisplayed();
    await item('Hostile').click();
    await $(`${DIALOG}//*[contains(@class,"notion-blocks")]`).waitForDisplayed();
    expect(await $(`${DIALOG}//*[contains(@class,"notion-blocks")]`).getText()).toContain('<img src=x');
    expect(await $$(`${DIALOG}//img | ${DIALOG}//script | ${DIALOG}//iframe | ${DIALOG}//a`)).toHaveLength(0);
    expect(await browser.execute(() => typeof window.__e2ePwned)).toBe('undefined');
    await $(`${DIALOG}//button[normalize-space(.)="Close"]`).click();
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

  it('stays usable at narrower window widths (evidence capture only when requested)', async function () {
    if (!evidenceDir) return this.skip();
    for (const width of [1600, 1280, 900, 760, 700]) {
      await browser.setWindowSize(width, 900);
      await panel().scrollIntoView();
      await shot(`07-settings-${width}`);
    }
    await button('Browse content').click();
    await item('E2E Assignments').waitForDisplayed();
    await shot('08-browse-700');
    await item('E2E Assignments').click();
    await $(`${DIALOG}//table`).waitForDisplayed();
    await shot('09-data-source-700');
    await $(`${DIALOG}//button[normalize-space(.)="Close"]`).click();
    await browser.setWindowSize(1280, 820);
  });
  it('shows rate-limited, authentication-failed and recovered states from a user-initiated check', async () => {
    mock.state.mode = 'ratelimit';
    await button('Check connection').click();
    await waitState('Rate limited');
    expect(await $('//section[contains(@class,"notion-panel")]//*[@role="alert"]').getText()).toContain('limiting requests');
    await expect(button('Browse content')).toBeEnabled();

    mock.state.mode = 'unauthorized';
    await button('Check connection').click();
    await waitState('Authentication failed');
    await expect(button('Browse content')).toBeDisabled();
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
    await expect(button('Browse content')).toBeEnabled();
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
