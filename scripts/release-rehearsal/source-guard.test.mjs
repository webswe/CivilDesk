import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/installer-rehearsal-once.yml'), 'utf8');
const fetchScript = fs.readFileSync(path.join(root, 'scripts/release-rehearsal/fetch-public-source.ps1'), 'utf8');
const guard = path.join(root, 'scripts/release-rehearsal/source-guard.ps1');
const invoke = (program, args) => spawnSync(program, args, { encoding: 'utf8' });

describe('one-time hosted installer rehearsal controls', () => {
  it('is branch-create-only and contains no manual, release, or upload path', () => {
    expect(workflow).toMatch(/on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+- verification\/installer-rehearsal-once-0\.1\.1/);
    expect(workflow).not.toMatch(/workflow_dispatch:|pull_request:|schedule:|workflow_run:|upload-artifact|tauri-action|gh release|secrets\./);
    expect(workflow).toMatch(/github\.event\.created == true && github\.run_attempt == '1'/);
    expect(workflow).toMatch(/GITHUB_RUN_ATTEMPT -cne '1'/);
    expect(workflow).toMatch(/RUNNER_ENVIRONMENT -cne 'github-hosted'/);
    expect(workflow).toMatch(/runs-on: windows-2022/);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toMatch(/persist-credentials: false/);
    const pins = [...workflow.matchAll(/uses:\s+([^\s@]+)@([^\s]+)/g)];
    expect(pins).toHaveLength(3);
    for (const [, , sha] of pins) expect(sha).toMatch(/^[a-f0-9]{40}$/);
  });

  it('binds the unchanged candidate parent and both exact build sources', () => {
    expect(workflow).toMatch(/parents\[1\] -cne '4cce3c6def9ceedbecae852dfd4b6860137910da'/);
    expect(workflow).toMatch(/Unexpected workflow-branch source changes/);
    expect(workflow).toMatch(/CandidateSha '4cce3c6def9ceedbecae852dfd4b6860137910da'/);
    expect(fetchScript).toMatch(/7d293bbc61dce674d796220e3241571a9f15aa6b/);
    expect(fetchScript).toMatch(/4cce3c6def9ceedbecae852dfd4b6860137910da/);
    expect(fetchScript).toMatch(/rev-parse FETCH_HEAD/);
    expect(fetchScript).toMatch(/Assert-ExactSource/);
    expect(fetchScript).toMatch(/credential\.helper=/);
    expect(fetchScript).toMatch(/http\.sslVerify=true/);
    expect(fetchScript).toMatch(/GIT_SSL_NO_VERIFY = \$null/);
    expect(fetchScript).toMatch(/HTTPS_PROXY = \$null/);
    expect(fetchScript).toMatch(/GIT_TERMINAL_PROMPT = '0'/);
    expect(fetchScript).not.toMatch(/token:|gh auth|credential-manager/i);
  });

  it('rejects wrong source SHA, configured remotes, and dirty trees', () => {
    if (process.platform !== 'win32') return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civildesk-source-guard-'));
    try {
      const git = (...args) => {
        const result = invoke('git', args);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git('init', '-q', dir);
      fs.writeFileSync(path.join(dir, 'synthetic.txt'), 'disposable');
      git('-C', dir, 'add', 'synthetic.txt');
      git('-C', dir, '-c', 'user.name=webswe', '-c', 'user.email=botaa109@gmail.com', 'commit', '-qm', 'Synthetic source');
      const sha = git('-C', dir, 'rev-parse', 'HEAD');
      const quotedGuard = guard.replaceAll("'", "''");
      const quotedDir = dir.replaceAll("'", "''");
      const check = expected => invoke('powershell', ['-NoProfile', '-Command', `. '${quotedGuard}'; Assert-ExactSource -Destination '${quotedDir}' -ExpectedSha '${expected}'`]);
      expect(check(sha).status).toBe(0);
      expect(check('b'.repeat(40)).status).not.toBe(0);
      git('-C', dir, 'remote', 'add', 'origin', 'https://example.invalid/synthetic.git');
      expect(check(sha).status).not.toBe(0);
      git('-C', dir, 'remote', 'remove', 'origin');
      fs.writeFileSync(path.join(dir, 'untracked.txt'), 'disposable');
      expect(check(sha).status).not.toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
