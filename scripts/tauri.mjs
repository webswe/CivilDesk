// Wrapper for `npm run tauri ...`. Only `tauri dev` is changed: unless the caller passes --config/-c, it is pointed at the
// isolated development identity (com.webswe.civildesk.dev) so a dev run can never open the production database.
// Every other subcommand (build, info, ...) is passed through untouched.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const hasConfig = args.some(a => a === '-c' || a === '--config' || a.startsWith('--config='));
if (args[0] === 'dev' && !hasConfig) {
  const dev = fileURLToPath(new URL('../src-tauri/tauri.dev.conf.json', import.meta.url));
  const at = args.indexOf('--');
  args.splice(at === -1 ? args.length : at, 0, '--config', dev);
  console.log(`[civildesk] tauri dev uses the isolated development identity (${dev})`);
}
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
