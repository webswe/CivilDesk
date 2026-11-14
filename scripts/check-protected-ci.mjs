// Keep the protected build on a dedicated branch and out of release/installation paths.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const workflow = read('.github/workflows/protected-installer-build.yml');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const acceptance = read('.github/workflows/acceptance-build.yml');
const protectedConfig = JSON.parse(read('src-tauri/tauri.protected.conf.json'));
const defaultConfig = JSON.parse(read('src-tauri/tauri.conf.json'));

assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- verification\/scope-a-protected-installation-foundation/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /CARGO_TARGET_DIR:.*target\\protected/);
assert.match(workflow, /--bundles nsis --config src-tauri\/tauri\.protected\.conf\.json/);
assert.match(workflow, /verify-protected-installer\.ps1/);
assert.doesNotMatch(workflow, /workflow_dispatch:|pull_request_target:|upload-artifact|tauri-action|secrets\.|contents: write/);
assert.doesNotMatch(workflow, /^\s*-\s+run:\s*.*(?:Start-Process|\.\\.*setup\.exe|msiexec)/im);
for (const [name, content] of [['ci', ci], ['release', release], ['acceptance', acceptance]]) {
  assert.ok(!content.includes('tauri.protected.conf.json'), `${name} must not select the protected variant`);
}
assert.equal(defaultConfig.bundle.windows.nsis.installMode, 'currentUser');
assert.equal(protectedConfig.bundle.windows.nsis.installMode, 'perMachine');
assert.equal(defaultConfig.identifier, 'com.webswe.civildesk');
console.log('Protected CI remains a branch-push-only, read-only-token, build-only path.');
