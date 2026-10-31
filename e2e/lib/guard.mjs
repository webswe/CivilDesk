// Data-isolation guard. The E2E binary has its own application identity, so its data lives in
// folders no other CivilDesk build uses. This module is the ONLY place that deletes anything,
// and it refuses to touch any path except those two exact, identity-named folders.
import fs from 'node:fs';
import path from 'node:path';

export const E2E_IDENTIFIER = 'com.webswe.civildesk.e2e';
export const PROTECTED_IDENTIFIERS = ['com.webswe.civildesk', 'com.webswe.civildesk.acceptance'];

export function e2eDataPaths(env = process.env) {
  const roaming = env.APPDATA;
  const local = env.LOCALAPPDATA;
  if (!roaming || !local) throw new Error('APPDATA and LOCALAPPDATA are required.');
  return {
    data: path.win32.join(roaming, E2E_IDENTIFIER),
    webview: path.win32.join(local, E2E_IDENTIFIER),
    database: path.win32.join(roaming, E2E_IDENTIFIER, 'civildesk.sqlite3'),
  };
}

export function assertDisposable(target, env = process.env) {
  const resolved = path.win32.resolve(target).replace(/[\\/]+$/, '');
  const name = path.win32.basename(resolved);
  if (name !== E2E_IDENTIFIER) throw new Error(`Refusing to delete "${resolved}": not the E2E data folder.`);
  if (PROTECTED_IDENTIFIERS.includes(name.toLowerCase())) throw new Error(`Refusing to delete protected folder "${resolved}".`);
  const parent = path.win32.dirname(resolved).toLowerCase();
  const allowed = [env.APPDATA, env.LOCALAPPDATA].filter(Boolean).map(p => path.win32.resolve(p).toLowerCase());
  if (!allowed.includes(parent)) throw new Error(`Refusing to delete "${resolved}": parent is not APPDATA or LOCALAPPDATA.`);
  return resolved;
}

/** Wipes only the E2E identity's folders. Allowed on CI runners, or locally with an explicit opt-in. */
export function resetE2eData(env = process.env) {
  if (env.CI !== 'true' && env.CIVILDESK_E2E_ALLOW_RESET !== '1') {
    throw new Error('Set CIVILDESK_E2E_ALLOW_RESET=1 to let the E2E harness reset its own "' + E2E_IDENTIFIER + '" data folders.');
  }
  const { data, webview } = e2eDataPaths(env);
  for (const target of [data, webview]) fs.rmSync(assertDisposable(target, env), { recursive: true, force: true });
}
