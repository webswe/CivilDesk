// Windows Credential Manager checks for the E2E identity ONLY. The target names are fixed constants for
// com.webswe.civildesk.e2e; this module cannot address the production, Acceptance or development credentials.
import { spawnSync } from 'node:child_process';

// The application stores the secret as service "<identifier>.notion", account "notion-connection"; the Windows
// backend names the entry "<account>.<service>".
export const E2E_CREDENTIAL_TARGET = 'notion-connection.com.webswe.civildesk.e2e.notion';
const cmdkey = args => spawnSync('cmdkey', args, { encoding: 'utf8', windowsHide: true });

export function e2eCredentialExists() {
  if (process.platform !== 'win32') return false;
  const out = cmdkey([`/list:${E2E_CREDENTIAL_TARGET}`]);
  // cmdkey /list:<missing> still exits 0 and echoes the name, so look for an actual entry record.
  return out.status === 0 && /^\s*Target:/im.test(out.stdout);
}
export function deleteE2eCredential() {
  if (process.platform !== 'win32') return;
  cmdkey([`/delete:${E2E_CREDENTIAL_TARGET}`]); // exit status is non-zero when nothing exists; that is fine
}
