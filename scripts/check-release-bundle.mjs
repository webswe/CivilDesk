// Fail closed on test-only Cargo binaries and files inside an ordinary NSIS installer.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkTargets(manifest, targets) {
  const problems = [];
  if (!/^autobins\s*=\s*false\s*$/m.test(manifest)) problems.push('Cargo automatic binary discovery is enabled');
  const binaries = targets.filter(target => target.kind.includes('bin'));
  if (binaries.length !== 2 || !binaries.some(target => target.name === 'civildesk')) problems.push('Unexpected Cargo binary targets');
  const fixture = binaries.find(target => target.name === 'brightspace-synthetic');
  if (!fixture || JSON.stringify(fixture['required-features']) !== '["e2e-brightspace-fixture"]') problems.push('Synthetic executable is not gated by its E2E-only feature');
  if (/^default\s*=\s*\[[^\]]*e2e-brightspace-fixture/m.test(manifest)) problems.push('E2E fixture is enabled by default');
  return problems;
}

export function checkArchiveListing(listing) {
  const body = listing.split(/^-{5,}\s*$/m).slice(1).join('\n');
  if (!body) return ['Could not read NSIS archive entries'];
  const entries = [...body.matchAll(/^Path = (.+)$/gm)].map(match => match[1].replaceAll('\\', '/'));
  if (!entries.some(entry => path.posix.basename(entry).toLowerCase() === 'civildesk.exe')) return ['CivilDesk application executable is absent from NSIS archive'];
  const forbidden = entries.filter(entry => {
    const name = path.posix.basename(entry).toLowerCase();
    return name === 'brightspace-synthetic.exe' || name === 'civildesk-e2e.exe'
      || /(?:^|[-_.])e2e(?:[-_.]|$)/.test(name) && /\.(exe|json|conf|config|db|sqlite3?)$/.test(name)
      || /^(?:\.env(?:\..*)?|.*credentials?\.(?:json|txt)|.*\.sqlite3?)$/.test(name);
  });
  return forbidden.map(entry => `Test-only or private file in NSIS archive: ${entry}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--no-deps', '--format-version', '1'], { encoding: 'utf8' }));
    const targets = metadata.packages.find(pkg => pkg.name === 'civildesk')?.targets ?? [];
    const problems = checkTargets(manifest, targets);
    const installer = process.argv[2];
    if (installer !== '--manifest-only') {
      if (!installer || !existsSync(installer)) throw Error('An existing NSIS installer path is required');
      const listing = execFileSync('7z', ['l', '-slt', installer], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      problems.push(...checkArchiveListing(listing));
    }
    if (problems.length) throw Error(problems.join('\n'));
    console.log(installer === '--manifest-only' ? 'Release Cargo target isolation passed.' : 'Release Cargo target and NSIS payload isolation passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
