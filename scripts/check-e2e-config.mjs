// Verifies the native-test build is isolated: its own identity and data folders, no test code or
// plugins in the application, and no path from the E2E config into production or Acceptance artifacts.
import assert from 'node:assert/strict';
import console from 'node:console';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNotionMockIsolation } from './lib/notion-mock-guard.mjs';

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
for (const f of rustFiles) if (f !== 'brightspace.rs') assert.ok(!/E2E|webdriver|wdio/i.test(read('src-tauri/src/' + f)), f + ' contains test-only code.');
const brightspace = read('src-tauri/src/brightspace.rs');
const synthetic = read('src-tauri/src/bin/brightspace-synthetic.rs');
assert.ok(brightspace.includes('cfg!(feature = "notion-mock")') && brightspace.includes('com.webswe.civildesk.e2e') && brightspace.includes('civildesk-e2e-synthetic'));
assert.ok(brightspace.includes('brightspace-synthetic.exe') && brightspace.includes('SYNTHETIC_ORIGIN'));
assert.ok(brightspace.includes('.join("com.webswe.civildesk.e2e")') && brightspace.includes('brightspace-scenario.txt'), 'Synthetic scenario must be inside E2E application data.');
assert.ok(brightspace.includes('.env_clear()') && brightspace.includes('.env("D2L_CLI_PROFILE", self.profile)') && brightspace.includes('.env("D2L_CLI_BASE_URL", origin)'), 'Child environment must override inherited profile and portal.');
assert.ok(brightspace.includes('if self.course_mode() != "synthetic_cli"') && brightspace.includes('&["courses", "list", "--json"]'), 'Course execution must be limited to the synthetic build and fixed CLI arguments.');
assert.ok(brightspace.includes('pub fn assignments(') && brightspace.includes('let catalog = self.courses(db)?') && brightspace.includes('.take(12)') && brightspace.includes('"--include-completeness"'), 'Assignment reads must use bounded IDs obtained from the restricted course listing and request completeness metadata.');
assert.ok(brightspace.includes('if self.course_mode() != "synthetic_cli"') && brightspace.includes('.check_synthetic_boundary(&config.portal_origin, &canonical)'), 'Regular builds and non-synthetic executables must not read assignments.');
assert.ok(brightspace.includes('pub fn grades(') && brightspace.includes('pub fn announcements(') && brightspace.includes('self.class_pages(db, "grades"') && brightspace.includes('self.class_pages(db, "announcements"'), 'Class information must use only fixed grade and announcement operations.');
assert.ok(brightspace.includes('let catalog = self.courses(db)?') && brightspace.includes('.take(12)') && brightspace.includes('"--include-completeness"'), 'Class information must use bounded course IDs from synthetic discovery and request completeness evidence.');
assert.ok(brightspace.includes('if self.course_mode() != "synthetic_cli"') && brightspace.includes('fn parse_grades(') && brightspace.includes('fn parse_announcements('), 'Class information must retain the synthetic build gate and strict parsers.');
assert.ok(synthetic.includes('"grades" | "announcements"') && synthetic.includes('"--course"') && synthetic.includes('"--include-completeness"'), 'The E2E executable must accept only the fixed class-information command shape.');
assert.ok(brightspace.includes('.check_synthetic_boundary(&config.portal_origin, &canonical)') && brightspace.includes('file_sha256(&canonical)'), 'Synthetic course reads must retain path and fingerprint checks.');
assert.ok(!/KeyringCredentialStore|CredentialManagerStore|auth login|courses list/.test(brightspace + synthetic), 'Brightspace adapter and fixture must not access credentials or academic records directly.');
assert.ok(synthetic.includes('civildesk-e2e-synthetic') && synthetic.includes('synthetic.example.test'));
assert.ok(read('.github/workflows/e2e-windows.yml').includes('--bin brightspace-synthetic'));
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
// Notion mock isolation: no production/Acceptance/CI build path may enable the mock feature or supply a mock endpoint.
const mockProblems = checkNotionMockIsolation(root);
assert.deepEqual(mockProblems, [], 'Notion mock isolation violated:\n' + mockProblems.join('\n'));
console.log('Notion mock isolation checks passed.');
console.log('E2E isolation checks passed: ' + e2e.identifier + ' / ' + e2e.mainBinaryName);
