// Build-time gate for the separately selected machine-wide installer variant.
// It does not grant package approval or change an installed application.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
const base = json('src-tauri/tauri.conf.json');
const protectedConfig = json('src-tauri/tauri.protected.conf.json');
const acceptance = json('src-tauri/tauri.acceptance.conf.json');
const packageSource = read('src-tauri/src/brightspace_package.rs');
const adapter = read('src-tauri/src/brightspace.rs');

assert.equal(base.identifier, 'com.webswe.civildesk');
assert.equal(base.bundle.windows.nsis.installMode, 'currentUser');
assert.equal(base.bundle.windows.webviewInstallMode.type, 'offlineInstaller');
assert.equal(protectedConfig.bundle.windows.nsis.installMode, 'perMachine');
assert.equal(protectedConfig.bundle.createUpdaterArtifacts, false);
assert.deepEqual(Object.keys(protectedConfig), ['bundle']);
assert.deepEqual(Object.keys(protectedConfig.bundle).sort(), ['createUpdaterArtifacts', 'windows']);
assert.deepEqual(Object.keys(protectedConfig.bundle.windows), ['nsis']);
assert.deepEqual(Object.keys(protectedConfig.bundle.windows.nsis), ['installMode']);
assert.equal(acceptance.identifier, 'com.webswe.civildesk.acceptance');
assert.equal(acceptance.bundle.windows.nsis.installMode, 'currentUser');
assert.ok(packageSource.includes('const APPROVED_FROZEN: Option<(&str, &str, &str)> = None;'));
assert.ok(adapter.includes('if args != CAPABILITY_ARGS'));
assert.ok(adapter.includes('const CAPABILITY_ARGS: [&str; 5] = ["auth", "capabilities", "--json", "--contract-version", "1"];'));
assert.ok(!JSON.stringify(protectedConfig).includes('D2L-CLI'));
console.log('Protected installer overlay: perMachine only; identity, data paths, and trust boundary remain unchanged.');
