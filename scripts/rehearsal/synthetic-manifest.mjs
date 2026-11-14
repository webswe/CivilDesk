import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyFrozenPackage } from '../lib/frozen-package-verifier.mjs';

const [root, runnerTemp] = process.argv.slice(2);
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
  || !root || !runnerTemp || !path.resolve(root).toLowerCase().startsWith(path.join(process.env.ProgramFiles, 'CivilDesk D2L-CLI Rehearsal').toLowerCase() + path.sep)
  || !path.resolve(runnerTemp).toLowerCase().startsWith(path.resolve(process.env.RUNNER_TEMP).toLowerCase())) {
  throw new Error('Synthetic manifest runner guard failed.');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exePath = path.join(root, 'd2l.exe');
const bytes = fs.readFileSync(exePath);
const manifestPath = path.join(runnerTemp, 'civildesk-rehearsal-synthetic-manifest.json');
if (fs.existsSync(manifestPath)) throw new Error('Synthetic manifest already exists.');
const sourceCommit = 'a'.repeat(40); // synthetic identity, never 3ce1648
const executableSha256 = hash(bytes);
const manifest = { schema: 'civildesk-d2l-windows-onedir-v1', source_commit: sourceCommit,
  executable_sha256: executableSha256, files: { 'd2l.exe': { sha256: executableSha256, size: bytes.length } } };
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
const expected = { root, manifestPath, canonicalRoot: fs.realpathSync.native(root),
  manifestSha256: hash(fs.readFileSync(manifestPath)), executableSha256, sourceCommit,
  fileCount: 1, totalBytes: bytes.length };
const verify = () => verifyFrozenPackage(expected);
try {
  assert.deepEqual(verify(), []);
  fs.writeFileSync(exePath, Buffer.concat([bytes, Buffer.from('altered')]));
  assert.ok(verify().some(issue => issue.startsWith('size:') || issue.startsWith('hash:')));
  fs.writeFileSync(exePath, bytes);
  fs.unlinkSync(exePath);
  assert.ok(verify().includes('missing:d2l.exe'));
  fs.writeFileSync(exePath, bytes);
  assert.ok(verifyFrozenPackage({ ...expected, canonicalRoot: path.join(runnerTemp, 'wrong') }).includes('canonical-root'));
  assert.ok(verifyFrozenPackage({ ...expected, manifestSha256: '0'.repeat(64) }).includes('manifest-digest'));
  assert.deepEqual(verify(), []);
  console.log('Synthetic manifest verified; modified, missing, wrong canonical path and wrong manifest digest rejected.');
} finally {
  fs.writeFileSync(exePath, bytes);
  fs.rmSync(manifestPath, { force: true });
}
