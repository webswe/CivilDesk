import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const production = read('../src-tauri/tauri.conf.json');
const dev = read('../src-tauri/tauri.dev.conf.json');
const others = { acceptance: read('../src-tauri/tauri.acceptance.conf.json'), e2e: read('../src-tauri/tauri.e2e.conf.json') };
function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
  return result;
}
const resolved = merge(production, dev);
assert.equal(production.identifier, 'com.webswe.civildesk');
assert.equal(others.acceptance.identifier, 'com.webswe.civildesk.acceptance');
assert.equal(others.e2e.identifier, 'com.webswe.civildesk.e2e');
assert.equal(resolved.identifier, 'com.webswe.civildesk.dev');
assert.equal(resolved.productName, 'CivilDesk Dev');
assert.equal(resolved.app.windows[0].title, 'CivilDesk Dev');
assert.equal(resolved.app.windows[0].dataDirectory, undefined);
assert.equal(resolved.app.appDirectoriesOverride.data, '$DATA/com.webswe.civildesk.dev');
assert.equal(resolved.app.appDirectoriesOverride.localData, '$LOCALDATA/com.webswe.civildesk.dev');
assert.equal(resolved.app.security.csp, production.app.security.csp);
assert.equal(resolved.build.devUrl, production.build.devUrl);

const roaming = process.env.APPDATA; const local = process.env.LOCALAPPDATA;
if (!roaming || !local) throw new Error('APPDATA and LOCALAPPDATA are required for Windows path checks');
const norm = v => path.win32.resolve(v).replace(/[\\/]+$/, '').toLowerCase();
const overlaps = (a, b) => a === b || a.startsWith(b + '\\') || b.startsWith(a + '\\');
const identities = { production: production.identifier, acceptance: others.acceptance.identifier, e2e: others.e2e.identifier };
const devData = norm(path.win32.join(roaming, resolved.identifier)); const devWebview = norm(path.win32.join(local, resolved.identifier));
console.log(`dev SQLite: ${path.win32.join(roaming, resolved.identifier, 'civildesk.sqlite3')}`);
console.log(`dev WebView profile: ${path.win32.join(local, resolved.identifier, 'EBWebView')}`);
for (const [name, id] of Object.entries(identities)) {
  assert.ok(!overlaps(devData, norm(path.win32.join(roaming, id))), `dev data overlaps ${name}`);
  assert.ok(!overlaps(devWebview, norm(path.win32.join(local, id))), `dev WebView overlaps ${name}`);
}
const wrapper = readFileSync(new URL('./tauri.mjs', import.meta.url), 'utf8');
assert.match(wrapper, /tauri\.dev\.conf\.json/);
assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.tauri, 'node scripts/tauri.mjs');
console.log('Development identity and data-path checks passed.');
