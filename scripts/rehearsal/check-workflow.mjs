import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/protected-installation-rehearsal.yml', 'utf8');
const buildOnly = readFileSync('.github/workflows/protected-installer-build.yml', 'utf8');

function validate(source) {
  assert.match(source, /^on:\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+source_sha:/m);
  assert.doesNotMatch(source, /^\s*(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call):/m);
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.match(source, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /environment: scope-a-installation-rehearsal/);
  assert.match(source, /runs-on: windows-2025/);
  assert.match(source, /REVIEWED_SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(source, /APPROVED_SOURCE_SHA: \$\{\{ vars\.CIVILDESK_SCOPE_A_REHEARSAL_APPROVED_SHA \}\}/);
  assert.match(source, /REVIEWED_SOURCE_SHA -cne \$env:APPROVED_SOURCE_SHA/);
  assert.match(source, /RUNNER_ENVIRONMENT -cne 'github-hosted'/);
  assert.match(source, /RUNNER_ARCH -cne 'X64'/);
  assert.match(source, /GITHUB_WORKFLOW_SHA -cne \$env:GITHUB_SHA/);
  const firstStep = source.indexOf('      - name: Validate authorization and disposable runner');
  const firstAction = source.indexOf('      - uses:');
  assert.ok(firstStep > 0 && firstStep < firstAction, 'preflight must precede every external action');
  const refs = [...source.matchAll(/^\s+- uses: ([^\s#]+)/gm)].map(match => match[1]);
  assert.deepEqual(refs.map(ref => ref.split('@')[0]), [
    'actions/checkout', 'actions/setup-node', 'actions/setup-python',
  ]);
  for (const ref of refs) assert.match(ref, /@[0-9a-f]{40}$/, `Action must use a full commit SHA: ${ref}`);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(source, /npm ci --ignore-scripts/);
  const firstProvenance = source.indexOf('provenance.ps1 -ExpectedSha $env:APPROVED_SOURCE_SHA -Phase checkout');
  const install = source.indexOf('npm ci --ignore-scripts');
  const secondProvenance = source.indexOf('provenance.ps1 -ExpectedSha $env:APPROVED_SOURCE_SHA -Phase dependencies');
  const build = source.indexOf('npm run tauri build -- --bundles nsis --config src-tauri/tauri.protected.conf.json');
  const finalProvenance = source.indexOf('provenance.ps1 -ExpectedSha $env:APPROVED_SOURCE_SHA -Phase build');
  const runner = source.indexOf('scripts/rehearsal/run.ps1');
  assert.ok(firstAction < firstProvenance && firstProvenance < install && install < secondProvenance
    && secondProvenance < build && build < finalProvenance && finalProvenance < runner);
  assert.doesNotMatch(source, /upload-artifact|artifacts\/download|secrets\.|contents: write|curl\s|Invoke-WebRequest|\biex\b/i);
}

validate(workflow);
for (const [name, changed] of [
  ['unexpected push', workflow.replace('  workflow_dispatch:', '  push:')],
  ['missing protected environment', workflow.replace('environment: scope-a-installation-rehearsal', 'environment: none')],
  ['missing approval variable', workflow.replaceAll('vars.CIVILDESK_SCOPE_A_REHEARSAL_APPROVED_SHA', 'vars.MISSING')],
  ['missing SHA comparison', workflow.replace('REVIEWED_SOURCE_SHA -cne $env:APPROVED_SOURCE_SHA', 'REVIEWED_SOURCE_SHA -cne $env:REVIEWED_SOURCE_SHA')],
  ['mutable action', workflow.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v4')],
  ['late preflight', workflow.replace('      - name: Validate authorization and disposable runner', '      - uses: actions/checkout@v4\n      - name: Validate authorization and disposable runner')],
]) {
  assert.throws(() => validate(changed), undefined, `${name} must fail the workflow guard`);
}
assert.match(buildOnly, /name: Protected NSIS build \(Windows, no installation\)/);
assert.doesNotMatch(buildOnly, /rehearsal\/run\.ps1/);
console.log('Protected environment, exact-SHA gate, action pins, build order, and negative workflow fixtures passed.');
