import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const workflow = read('../../.github/workflows/installer-upgrade-rehearsal-v2.yml');
const fetchSource = read('./fetch-public-source.ps1');
const run = read('./run.ps1');

describe('one-time corrected installer rehearsal bindings', () => {
  it('runs only on the exact first branch creation on a hosted Windows runner', () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*- verification\/installer-upgrade-rehearsal-0\.1\.1-v2/);
    expect(workflow).not.toMatch(/workflow_dispatch:|pull_request:|schedule:|self-hosted|upload-artifact|releaseDraft:/);
    expect(workflow).toContain("github.event.created == true && github.run_attempt == '1'");
    expect(workflow).toContain("$env:RUNNER_ENVIRONMENT -cne 'github-hosted'");
    expect(workflow).toContain('runs-on: windows-2022');
    expect(workflow).toContain('contents: read');
  });
  it('binds exact source SHAs and rejects credential persistence', () => {
    expect(workflow).toContain("$parents[1] -cne '5d46e131093bc59205680ad19167319f9acfb71e'");
    expect(workflow).toContain('persist-credentials: false');
    for (const sha of ['7d293bbc61dce674d796220e3241571a9f15aa6b', '5d46e131093bc59205680ad19167319f9acfb71e']) {
      expect(fetchSource).toContain(sha);
      expect(workflow).toContain(sha);
    }
    expect(fetchSource).toContain("'-c','credential.helper='");
    expect(fetchSource).toContain("$env:GIT_TERMINAL_PROMPT = '0'");
    expect(workflow).toContain('check-baseline-bundle.mjs');
    expect(workflow).toContain('check-release-bundle.mjs');
  });
  it('allows the fixture only for historical 0.1.0 and fails if it survives upgrade', () => {
    expect(run).toContain("$Version -ceq '0.1.0'");
    expect(run).toContain('The legacy synthetic executable survived the 0.1.1 upgrade.');
    expect(run).toContain('Independent rollback snapshot SHA-256');
    expect(run).not.toMatch(/Remove-Item.*brightspace-synthetic|Delete.*brightspace-synthetic/i);
  });
});
