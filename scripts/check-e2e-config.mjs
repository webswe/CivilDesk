// Verifies the native-test build is isolated: its own identity and data folders, no test code or
// plugins in the application, and no path from the E2E config into production or Acceptance artifacts.
import assert from 'node:assert/strict';
import console from 'node:console';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));

const production = json('src-tauri/tauri.conf.json');
const acceptance = json('src-tauri/tauri.acceptance.conf.json');
const release = json('src-tauri/tauri.release.conf.json');
const e2e = json('src-tauri/tauri.e2e.conf.json');

// Distinct identity, binary name and data folders.
assert.equal(e2e.identifier, 'com.webswe.civildesk.e2e');
assert.equal(e2e.mainBinaryName, 'civildesk-e2e');
assert.notEqual(e2e.identifier, production.identifier);
assert.notEqual(e2e.identifier, acceptance.identifier);
assert.notEqual(e2e.mainBinaryName, acceptance.mainBinaryName);
assert.equal(e2e.app.appDirectoriesOverride.data, '$DATA/' + e2e.identifier);
assert.equal(e2e.app.appDirectoriesOverride.localData, '$LOCALDATA/' + e2e.identifier);
for (const other of [production.identifier, acceptance.identifier]) {
  const folder = other.toLowerCase();
  for (const mine of [e2e.app.appDirectoriesOverride.data, e2e.app.appDirectoriesOverride.localData]) {
    assert.ok(!mine.toLowerCase().endsWith('/' + folder) && !mine.toLowerCase().includes('/' + folder + '/'), 'E2E data path overlaps ' + other);
  }
}
assert.equal(e2e.bundle.createUpdaterArtifacts, false);

// The E2E config is a test-build input only. Nothing that ships may reference it.
for (const file of ['.github/workflows/release.yml', '.github/workflows/acceptance-build.yml', 'src-tauri/tauri.release.conf.json', 'src-tauri/tauri.acceptance.conf.json', 'src-tauri/tauri.conf.json', 'package.json']) {
  assert.ok(!/tauri\.e2e\.conf|civildesk-e2e/i.test(read(file)), file + ' must not reference the E2E build.');
}
assert.ok(!JSON.stringify(release).includes('e2e'));

// No test-only plugins, drivers or hooks inside the application.
const cargo = read('src-tauri/Cargo.toml');
assert.ok(!/wdio|webdriver|tauri-plugin-(?!dialog)/i.test(cargo), 'Cargo.toml must not depend on test plugins.');
assert.deepEqual(json('src-tauri/capabilities/default.json').permissions, ['core:default', 'dialog:allow-open']);
const rustFiles = readdirSync(path.join(root, 'src-tauri/src')).filter(f => f.endsWith('.rs'));
for (const f of rustFiles) assert.ok(!/E2E|webdriver|wdio/i.test(read('src-tauri/src/' + f)), f + ' contains test-only code.');
const srcFiles = readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
for (const f of srcFiles) assert.ok(!/civildesk\.e2e|webdriver|wdio/i.test(read('src/' + f)), f + ' contains test-only code.');

// The E2E workflow must be manual, build without bundling, and never use the release or Acceptance configs.
const workflow = '.github/workflows/e2e-windows.yml';
if (existsSync(path.join(root, workflow))) {
  const text = read(workflow);
  assert.ok(/workflow_dispatch/.test(text) && !/^\s*(push|pull_request|schedule):/m.test(text), 'E2E workflow must be manual only.');
  assert.ok(/--no-bundle/.test(text) && /tauri\.e2e\.conf\.json/.test(text));
  assert.ok(/--features notion-mock/.test(text), 'E2E workflow must build the Notion mock feature.');
  assert.ok(!/tauri\.release\.conf|tauri\.acceptance\.conf|upload-artifact[\s\S]{0,200}nsis/i.test(text), 'E2E workflow must not touch release or Acceptance artifacts.');
}
console.log('E2E isolation checks passed: ' + e2e.identifier + ' / ' + e2e.mainBinaryName);
