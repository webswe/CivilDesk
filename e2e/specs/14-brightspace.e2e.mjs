// Native Brightspace foundation: dedicated fixture executable, synthetic portal, no vault or network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { onboard, restartApp } from '../lib/app.mjs';
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
    scenario('invalid_config'); expect((await inspect()).state).toBe('not_configured');
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
});
