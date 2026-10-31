import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const production = read('../src-tauri/tauri.conf.json');
const acceptance = read('../src-tauri/tauri.acceptance.conf.json');

// Tauri applies JSON Merge Patch for --config; arrays replace their base value.
function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = merge(result[key], value);
  }
  return result;
}
const resolved = merge(production, acceptance);
assert.equal(production.productName, 'CivilDesk');
assert.equal(production.identifier, 'com.webswe.civildesk');
assert.equal(resolved.productName, 'CivilDesk Acceptance');
assert.equal(resolved.identifier, 'com.webswe.civildesk.acceptance');
assert.equal(resolved.mainBinaryName, 'civildesk-acceptance');
assert.equal(resolved.bundle.windows.nsis.installMode, 'currentUser');
assert.equal(resolved.bundle.windows.nsis.startMenuFolder, 'CivilDesk Acceptance');
assert.equal(resolved.bundle.createUpdaterArtifacts, false);
assert.equal(production.app.appDirectoriesOverride, undefined);
assert.equal(production.app.windows[0].dataDirectory, undefined);
assert.equal(resolved.app.windows[0].dataDirectory, undefined);
assert.equal(resolved.app.windows[0].title, 'CivilDesk Acceptance');
assert.equal(resolved.app.security.csp, production.app.security.csp);

const dataOverride = resolved.app.appDirectoriesOverride;
assert.equal(dataOverride.data, '$DATA/com.webswe.civildesk.acceptance');
assert.equal(dataOverride.localData, '$LOCALDATA/com.webswe.civildesk.acceptance');
const roaming = process.env.APPDATA;
const local = process.env.LOCALAPPDATA;
if (!roaming || !local) throw new Error('APPDATA and LOCALAPPDATA are required for Windows path checks');

const normalize = value => path.win32.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
const overlaps = (a, b) => a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
const productionData = normalize(path.win32.join(roaming, production.identifier));
const acceptanceData = normalize(path.win32.join(roaming, resolved.identifier));
const productionWebview = normalize(path.win32.join(local, production.identifier));
const acceptanceWebview = normalize(path.win32.join(local, resolved.identifier));
const productionInstall = normalize(path.win32.join(local, production.productName));
const acceptanceInstall = normalize(path.win32.join(local, resolved.productName));
for (const [label, original, isolated] of [
  ['SQLite and settings', productionData, acceptanceData],
  ['WebView', productionWebview, acceptanceWebview],
  ['NSIS installation', productionInstall, acceptanceInstall],
]) {
  assert.ok(!overlaps(original, isolated), `${label} paths overlap: ${original} / ${isolated}`);
  console.log(`${label}: ${original} | ${isolated}`);
}

const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
assert.match(native, /\.path\(\)\s*\.app_data_dir\(\)/);
assert.match(native, /path\.join\("civildesk\.sqlite3"\)/);
assert.ok(!native.includes(production.identifier), 'Native source hardcodes the production identifier');
assert.ok(!native.includes(productionInstall), 'Native source hardcodes the production install path');
console.log('Acceptance identity and data-path checks passed.');
