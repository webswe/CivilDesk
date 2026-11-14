// Read-only pre-staging and post-staging inventory check. No candidate is run or approved.
import { realpathSync } from 'node:fs';
import { verifyFrozenPackage } from './lib/frozen-package-verifier.mjs';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1]);
const required = ['--root', '--manifest', '--manifest-sha256', '--executable-sha256', '--source-commit', '--file-count', '--total-bytes'];
if (required.some(flag => !flags.get(flag)) || flags.size !== required.length) {
  console.error(`Usage: node scripts/verify-protected-package.mjs ${required.map(flag => `${flag} VALUE`).join(' ')}`);
  process.exit(2);
}
const root = flags.get('--root');
let canonicalRoot;
try { canonicalRoot = realpathSync.native(root); }
catch (error) { console.error(`Package unavailable: ${error.code ?? error.message}`); process.exit(1); }
const problems = verifyFrozenPackage({
  root,
  manifestPath: flags.get('--manifest'),
  canonicalRoot,
  manifestSha256: flags.get('--manifest-sha256'),
  executableSha256: flags.get('--executable-sha256'),
  sourceCommit: flags.get('--source-commit'),
  fileCount: Number(flags.get('--file-count')),
  totalBytes: Number(flags.get('--total-bytes')),
});
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Verified ${flags.get('--file-count')} files and ${flags.get('--total-bytes')} bytes at ${canonicalRoot}`);
