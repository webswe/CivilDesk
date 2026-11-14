import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/protected-installation-rehearsal.yml', 'utf8');
const buildOnly = readFileSync('.github/workflows/protected-installer-build.yml', 'utf8');
assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- verification\/scope-a-installation-rehearsal/);
assert.match(workflow, /permissions:\s*\n\s*contents: read/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /tauri build -- --bundles nsis --config src-tauri\/tauri\.protected\.conf\.json/);
assert.match(workflow, /scripts\/rehearsal\/run\.ps1/);
assert.doesNotMatch(workflow, /workflow_dispatch:|pull_request_target:|schedule:|upload-artifact|release|secrets\.|contents: write|artifacts\/download/i);
assert.doesNotMatch(workflow, /verification\/scope-a-protected-installation-foundation/);
assert.match(buildOnly, /name: Protected NSIS build \(Windows, no installation\)/);
assert.doesNotMatch(buildOnly, /rehearsal\/run\.ps1/);
console.log('Rehearsal workflow trigger, permissions, build order, and artifact restrictions passed.');
