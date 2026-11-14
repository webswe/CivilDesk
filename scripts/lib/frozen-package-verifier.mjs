import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const safeName = name => typeof name === 'string' && name.length > 0
  && !/[\\:\0]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..');

function ancestors(location) {
  const result = [];
  for (let current = path.resolve(location); ; current = path.dirname(current)) {
    result.push(current);
    if (path.dirname(current) === current) return result;
  }
}

function linked(location) {
  const stat = fs.lstatSync(location);
  return stat.isSymbolicLink() || (process.platform === 'win32' && stat.isDirectory()
    && fs.realpathSync.native(location) !== path.resolve(location));
}

function scan(root, expected, problems) {
  const found = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const location = path.join(dir, entry.name);
      const relative = path.relative(root, location).split(path.sep).join('/');
      const stat = fs.lstatSync(location);
      if (linked(location)) { problems.push(`reparse:${relative}`); continue; }
      if (entry.isDirectory()) {
        if (![...expected.keys()].some(name => name.startsWith(`${relative}/`))) problems.push(`extra-directory:${relative}`);
        else walk(location);
      } else if (!entry.isFile()) problems.push(`special:${relative}`);
      else {
        found.add(relative);
        if (!expected.has(relative)) { problems.push(`extra:${relative}`); continue; }
        if (stat.nlink !== 1) problems.push(`hardlink:${relative}`);
        const record = expected.get(relative);
        if (stat.size !== record.size) problems.push(`size:${relative}`);
        if (sha256(fs.readFileSync(location)) !== record.sha256) problems.push(`hash:${relative}`);
      }
    }
  }
  walk(root);
  for (const name of expected.keys()) if (!found.has(name)) problems.push(`missing:${name}`);
}

export function verifyFrozenPackage({ root, manifestPath, canonicalRoot, manifestSha256,
  executableSha256, sourceCommit, fileCount, totalBytes }) {
  const problems = [];
  if (![manifestSha256, executableSha256].every(hex) || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    return ['invalid-expectation'];
  }
  if (!path.isAbsolute(root) || !path.isAbsolute(manifestPath) || !path.isAbsolute(canonicalRoot)) {
    return ['relative-path'];
  }
  try {
    if (path.resolve(root) !== root || fs.realpathSync.native(root) !== canonicalRoot || root !== canonicalRoot) {
      problems.push('canonical-root');
    }
    for (const part of ancestors(root)) if (linked(part)) problems.push(`reparse-ancestor:${part}`);
    for (const part of ancestors(manifestPath)) if (linked(part)) problems.push(`reparse-manifest:${part}`);
    const manifestRelative = path.relative(root, manifestPath);
    if (manifestRelative === '' || (!path.isAbsolute(manifestRelative) && !manifestRelative.startsWith('..'))) {
      problems.push('manifest-inside-package');
    }
    const bytes = fs.readFileSync(manifestPath);
    if (bytes.length > 1024 * 1024 || sha256(bytes) !== manifestSha256) problems.push('manifest-digest');
    if (problems.length) return problems;
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.schema !== 'civildesk-d2l-windows-onedir-v1') problems.push('manifest-schema');
    if (manifest.source_commit !== sourceCommit) problems.push('source-commit');
    if (manifest.executable_sha256 !== executableSha256) problems.push('executable-identity');
    if (!manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') return [...problems, 'manifest-files'];
    const entries = Object.entries(manifest.files);
    if (entries.length !== fileCount || entries.length > 10_000 || entries.length === 0) problems.push('file-count');
    const expected = new Map();
    const folded = new Set();
    let bytesExpected = 0;
    for (const [name, record] of entries) {
      if (!safeName(name) || folded.has(name.toLowerCase()) || !hex(record?.sha256)
        || !Number.isSafeInteger(record?.size) || record.size < 0) {
        problems.push(`invalid-record:${name}`); continue;
      }
      folded.add(name.toLowerCase());
      expected.set(name, record);
      bytesExpected += record.size;
    }
    if (bytesExpected !== totalBytes) problems.push('total-bytes');
    if (expected.get('d2l.exe')?.sha256 !== executableSha256) problems.push('executable-record');
    if (!problems.length) scan(root, expected, problems);
  } catch (error) {
    problems.push(`unavailable:${error.code ?? error.name}`);
  }
  return problems;
}
