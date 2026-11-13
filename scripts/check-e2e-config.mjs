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
const brightspacePackage = read('src-tauri/src/brightspace_package.rs');
const nativeCommands = read('src-tauri/src/lib.rs');
const scopeA = brightspace.split('pub fn inspect_capabilities')[1]?.split('pub fn inspect_synthetic_status')[0];
assert.ok(scopeA?.includes('&CAPABILITY_ARGS') && !scopeA.includes('"status"') && !scopeA.includes('parse_status'), 'Scope A inspection must use only the fixed capability command.');
assert.ok(brightspace.includes('if args != CAPABILITY_ARGS') && brightspace.includes('self.identity == "com.webswe.civildesk.e2e"'), 'Normal builds must reject non-capability process launches.');
assert.ok(nativeCommands.includes('brightspace_inspect_capabilities') && nativeCommands.includes('#[cfg(not(feature = "notion-mock"))]') && !nativeCommands.includes('brightspace_inspect,'), 'Production inspection must not expose status or a generic command.');
assert.ok(brightspacePackage.includes('const APPROVED_FROZEN: Option<(&str, &str, &str)> = None;'), 'Frozen package approval must remain disabled.');
assert.ok(brightspacePackage.includes('verify_for_launch_with(executable, configured_frozen, approval.as_ref())') && brightspacePackage.includes('if !configured_frozen || !is_frozen_package(executable)'), 'Production launches must require approved frozen-package mode.');
assert.ok(brightspace.includes('self.verify_cli(origin, executable, configured_frozen)') && brightspace.includes('self.verify_cli(&origin, &canonical, frozen_package)'), 'Save and launch must share package trust enforcement.');
const synthetic = read('src-tauri/src/bin/brightspace-synthetic.rs');
const notionService = read('src-tauri/src/notion/mod.rs');
const secrets = read('src-tauri/src/notion/secrets.rs');
const credentialHarness = read('e2e/lib/credentials.mjs');
const wdio = read('e2e/wdio.conf.mjs');
const cargoTarget = read('e2e/lib/cargo-target.mjs');
const brightspaceSpec = read('e2e/specs/14-brightspace.e2e.mjs');
const notionSpec = read('e2e/specs/13-notion.e2e.mjs');
assert.ok(/assert_eq!\(\s*identifier, "com\.webswe\.civildesk\.e2e"/.test(notionService) && notionService.includes('Box::new(E2eMemoryStore)') && notionService.includes('Box::new(CredentialManagerStore::for_identity(identifier))'), 'Notion store must be selected by the isolated E2E build and identity.');
assert.ok(secrets.includes('#[cfg(feature = "notion-mock")]\npub struct E2eMemoryStore') && secrets.includes('http://127.0.0.1:4456/credential') && secrets.includes('#[ignore = "manual OS credential-store test; excluded from offline verification"]'), 'E2E memory store and manual OS test gate must remain in place.');
assert.ok(!/cmdkey|CredentialManagerStore|keyring|spawnSync/i.test(credentialHarness + wdio + notionSpec), 'Native E2E harness must not invoke the OS credential store.');
assert.ok(cargoTarget.includes("'metadata', '--no-deps'") && cargoTarget.includes('.target_directory') && wdio.includes("from './lib/cargo-target.mjs'") && brightspaceSpec.includes("from '../lib/cargo-target.mjs'"), 'Native E2E app and fixture must use Cargo’s configured target directory.');
assert.ok(!wdio.includes('CIVILDESK_E2E_BINARY'), 'Native E2E must not accept an arbitrary binary override.');
assert.ok(wdio.includes("'notion/secrets.rs', 'notion/mod.rs', 'notion/client.rs'") && wdio.includes('E2E binary is older than'), 'Native E2E must reject stale credential code.');
assert.ok(notionSpec.includes('credentials.exists()') && wdio.includes('await e2eCredentials.start()') && notionSpec.includes('await credentials.stop()'), 'Notion E2E must start memory credentials before app launch and assert their lifecycle.');
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
