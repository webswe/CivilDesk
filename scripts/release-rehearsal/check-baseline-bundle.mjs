// The immutable 0.1.0 installer is known to contain exactly one synthetic CLI.
// Recognize that historical defect without accepting any other test or private payload.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkHistoricalListing(listing) {
  const body = listing.split(/^-{5,}\s*$/m).slice(1).join('\n');
  if (!body) return ['Could not read historical NSIS archive entries'];
  const entries = [...body.matchAll(/^Path = (.+)$/gm)].map(match => match[1].replaceAll('\\', '/'));
  const names = entries.map(entry => path.posix.basename(entry).toLowerCase());
  const problems = [];
  if (names.filter(name => name === 'civildesk.exe').length !== 1) problems.push('Historical installer must contain one CivilDesk executable');
  if (names.filter(name => name === 'brightspace-synthetic.exe').length !== 1) problems.push('Historical installer must contain exactly its one known synthetic executable');
  const allowedExecutables = new Set(['civildesk.exe', 'brightspace-synthetic.exe', 'uninstall.exe', 'microsoftedgewebview2runtimeinstaller.exe']);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.endsWith('.exe') && !allowedExecutables.has(name)
      || /(?:^|[-_.])e2e(?:[-_.]|$)/.test(name) && /\.(json|conf|config|db|sqlite3?)$/.test(name)
      || /^(?:\.env(?:\..*)?|.*credentials?\.(?:json|txt)|.*\.sqlite3?)$/.test(name)) {
      problems.push(`Unexpected test or private file in historical installer: ${entries[i]}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const installer = process.argv[2];
    if (!installer || !existsSync(installer)) throw Error('An existing historical NSIS installer is required');
    const listing = execFileSync('7z', ['l', '-slt', installer], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const problems = checkHistoricalListing(listing);
    if (problems.length) throw Error(problems.join('\n'));
    console.log('Historical 0.1.0 payload verified with its one known synthetic executable. It is not clean.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
