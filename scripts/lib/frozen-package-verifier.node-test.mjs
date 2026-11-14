import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { verifyFrozenPackage } from './frozen-package-verifier.mjs';

const folders = [];
afterEach(() => {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  for (const dir of folders.splice(0)) {
    if (path.dirname(dir) !== tempRoot || !path.basename(dir).startsWith('civildesk-package-check-')) {
      throw new Error(`Refusing fixture cleanup outside the named temp root: ${dir}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'civildesk-package-check-')));
  folders.push(home);
  const createdRoot = path.join(home, 'package');
  fs.mkdirSync(path.join(createdRoot, '_internal'), { recursive: true });
  const root = fs.realpathSync.native(createdRoot);
  const exe = Buffer.from('test executable');
  const dll = Buffer.from('test dependency');
  fs.writeFileSync(path.join(root, 'd2l.exe'), exe);
  fs.writeFileSync(path.join(root, '_internal', 'python.dll'), dll);
  const manifestPath = path.join(home, 'manifest.json');
  const sourceCommit = 'a'.repeat(40);
  const executableSha256 = hash(exe);
  const manifest = {
    schema: 'civildesk-d2l-windows-onedir-v1', source_commit: sourceCommit,
    executable_sha256: executableSha256,
    files: { 'd2l.exe': { sha256: executableSha256, size: exe.length },
      '_internal/python.dll': { sha256: hash(dll), size: dll.length } },
  };
  const writeManifest = () => { fs.writeFileSync(manifestPath, JSON.stringify(manifest)); return hash(fs.readFileSync(manifestPath)); };
  const expected = { root, manifestPath, canonicalRoot: fs.realpathSync.native(root),
    manifestSha256: writeManifest(), executableSha256, sourceCommit,
    fileCount: 2, totalBytes: exe.length + dll.length };
  return { home, root, exe, dll, manifest, expected, writeManifest };
}

test('accepts only the exact independent manifest and complete inventory', () => {
  const f = fixture();
  assert.deepEqual(verifyFrozenPackage(f.expected), []);
  assert.ok(verifyFrozenPackage({ ...f.expected, manifestSha256: '0'.repeat(64) }).includes('manifest-digest'));
  assert.ok(verifyFrozenPackage({ ...f.expected, canonicalRoot: path.join(f.home, 'elsewhere') }).includes('canonical-root'));
  assert.ok(verifyFrozenPackage({ ...f.expected, root: path.join(f.home, 'elsewhere') }).length);
  assert.ok(verifyFrozenPackage({ ...f.expected, totalBytes: 1 }).includes('total-bytes'));
});

test('rejects modified, missing, and unlisted files', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, '_internal', 'python.dll'), 'changed dependency');
  assert.ok(verifyFrozenPackage(f.expected).some(p => p.includes('_internal/python.dll')));
  fs.writeFileSync(path.join(f.root, '_internal', 'python.dll'), f.dll);
  fs.writeFileSync(path.join(f.root, 'extra.dll'), 'extra');
  assert.ok(verifyFrozenPackage(f.expected).includes('extra:extra.dll'));
  fs.rmSync(path.join(f.root, 'extra.dll'));
  fs.rmSync(path.join(f.root, 'd2l.exe'));
  assert.ok(verifyFrozenPackage(f.expected).includes('missing:d2l.exe'));
});

test('rejects unsafe manifest entries and a hard-linked executable', () => {
  const f = fixture();
  f.manifest.files['../escape'] = { sha256: f.expected.executableSha256, size: f.exe.length };
  f.expected.fileCount = 3;
  f.expected.totalBytes += f.exe.length;
  f.expected.manifestSha256 = f.writeManifest();
  assert.ok(verifyFrozenPackage(f.expected).includes('invalid-record:../escape'));
  delete f.manifest.files['../escape'];
  f.expected.fileCount = 2;
  f.expected.totalBytes -= f.exe.length;
  f.expected.manifestSha256 = f.writeManifest();
  fs.linkSync(path.join(f.root, 'd2l.exe'), path.join(f.home, 'alternate.exe'));
  assert.ok(verifyFrozenPackage(f.expected).includes('hardlink:d2l.exe'));
});

test('rejects a linked package path where link creation is permitted', t => {
  const f = fixture();
  const alias = path.join(f.home, 'alias');
  try { fs.symlinkSync(f.root, alias, 'junction'); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Windows link privilege unavailable');
    throw error;
  }
  assert.ok(verifyFrozenPackage({ ...f.expected, root: alias }).includes('canonical-root'));
});
