import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDisposable, e2eDataPaths, E2E_IDENTIFIER, resetE2eData } from './guard.mjs';

const env = root => ({ APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: path.join(root, 'Local') });
const fake = { APPDATA: 'C:\\u\\Roaming', LOCALAPPDATA: 'C:\\u\\Local' };

describe('E2E data guard', () => {
  it('only ever resolves the dedicated E2E identity folders', () => {
    const paths = e2eDataPaths(fake);
    expect(paths.data).toBe('C:\\u\\Roaming\\' + E2E_IDENTIFIER);
    expect(paths.webview).toBe('C:\\u\\Local\\' + E2E_IDENTIFIER);
  });
  it('accepts exactly its own folders', () => {
    expect(assertDisposable('C:\\u\\Roaming\\' + E2E_IDENTIFIER, fake)).toBe('C:\\u\\Roaming\\' + E2E_IDENTIFIER);
    expect(assertDisposable('C:\\u\\Local\\' + E2E_IDENTIFIER + '\\', fake)).toBe('C:\\u\\Local\\' + E2E_IDENTIFIER);
  });
  it('refuses production, Acceptance, and arbitrary folders', () => {
    for (const bad of ['C:\\u\\Roaming\\com.webswe.civildesk', 'C:\\u\\Roaming\\com.webswe.civildesk.acceptance', 'C:\\u\\Local\\CivilDesk', 'C:\\u\\Roaming', 'C:\\', 'C:\\u\\Documents\\' + E2E_IDENTIFIER]) {
      expect(() => assertDisposable(bad, fake), bad).toThrow();
    }
  });
  it('refuses to reset outside CI unless explicitly allowed', () => {
    expect(() => resetE2eData({ ...env('C:\\x') })).toThrow(/ALLOW_RESET/);
  });
  it('removes only its own folders and leaves neighbours alone', () => {
    if (process.platform !== 'win32') return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-guard-'));
    const e = { ...env(root), CIVILDESK_E2E_ALLOW_RESET: '1' };
    const mine = [path.join(root, 'Roaming', E2E_IDENTIFIER), path.join(root, 'Local', E2E_IDENTIFIER)];
    const others = ['com.webswe.civildesk', 'com.webswe.civildesk.acceptance'].map(n => path.join(root, 'Roaming', n));
    for (const d of [...mine, ...others]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'f.txt'), 'x'); }
    resetE2eData(e);
    for (const d of mine) expect(fs.existsSync(d)).toBe(false);
    for (const d of others) expect(fs.existsSync(path.join(d, 'f.txt'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
