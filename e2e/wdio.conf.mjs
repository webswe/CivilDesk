import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { e2eDataPaths, resetE2eData } from './lib/guard.mjs';
import { seedUpgradeFixture } from './lib/fixture.mjs';
import { expectedSchemaVersion, inspectDatabase } from './lib/db.mjs';
import { waitForAppExit } from './lib/process.mjs';
import { deleteE2eCredential } from './lib/credentials.mjs';
import { MOCK_PORT } from './lib/notion-mock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const results = path.join(here, 'results');
const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, 'src-tauri', 'target');
const binary = process.env.CIVILDESK_E2E_BINARY || path.join(targetDir, 'debug', 'civildesk-e2e.exe');
const driverPort = 4444;
let driver;
// The WebdriverIO logger opens its file before any hook runs, so the folders must exist at load time.
fs.mkdirSync(path.join(results, 'wdio-logs'), { recursive: true });
fs.mkdirSync(path.join(results, 'screenshots'), { recursive: true });

// WebdriverIO only logs errors thrown by launcher hooks. A failed isolation or startup step must stop the run.
const fatal = fn => async (...args) => { try { return await fn(...args); } catch (error) { console.error('FATAL (harness):', error); process.exit(1); } };

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => { socket.destroy(); if (Date.now() > deadline) reject(new Error('tauri-driver did not open port ' + port)); else setTimeout(attempt, 250); });
    };
    attempt();
  });
}

export const config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: driverPort,
  specs: ['./specs/*.e2e.mjs'],
  maxInstances: 1,
  capabilities: [{
    maxInstances: 1,
    'wdio:enforceWebDriverClassic': true,
    'tauri:options': { application: binary },
  }],
  logLevel: 'warn',
  outputDir: path.join(results, 'wdio-logs'),
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 90000 },
  reporters: ['spec', ['junit', { outputDir: results, outputFileFormat: options => `junit-results-${options.cid}.xml` }]],

  onPrepare: fatal(async () => {
    // Clear only the previous run's own outputs (never the folder the logger already has open).
    for (const stale of fs.readdirSync(results)) if (/^(db-checks\.jsonl|junit-results.*\.xml|tauri-driver\.log|desktop-on-failure\.png)$/.test(stale)) fs.rmSync(path.join(results, stale), { force: true });
    fs.rmSync(path.join(results, 'screenshots'), { recursive: true, force: true });
    fs.mkdirSync(path.join(results, 'screenshots'), { recursive: true });
    if (!fs.existsSync(binary)) throw new Error('E2E binary not found: ' + binary + '. Build it with: npm run tauri build -- --debug --no-bundle --config src-tauri/tauri.e2e.conf.json');
    resetE2eData();
    // Only the E2E identity's own Notion credential is ever removed, so an interrupted earlier run cannot leak into this one.
    deleteE2eCredential();
    // The E2E binary (built with the notion-mock feature) may talk to this loopback address and nowhere else.
    // The mock itself is started by the Notion spec.
    process.env.CIVILDESK_NOTION_MOCK_URL = 'http://127.0.0.1:' + MOCK_PORT;
    const exe = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
    const log = fs.openSync(path.join(results, 'tauri-driver.log'), 'a');
    driver = spawn(exe, [], { stdio: ['ignore', log, log] });
    driver.on('error', err => { console.error('tauri-driver failed to start:', err); process.exit(1); });
    await waitForPort(driverPort, 20000);
  }),
  onComplete() { driver?.kill(); deleteE2eCredential(); },

  // Every spec file starts from an empty E2E profile (this only ever deletes the E2E identity folders).
  // A spec named *upgrade-v5* additionally gets a genuine schema-v5 database in that same disposable folder, written before the app starts.
  onWorkerStart: fatal((_cid, _caps, specs = []) => { resetE2eData(); if (specs.some(spec => /upgrade-v5/.test(String(spec)))) seedUpgradeFixture(); }),

  // After the session closes: confirm the application really stopped, then take a consistent SQLite snapshot.
  // A timeout or a database error is recorded as a failure; nothing is ever inspected while the app may still run.
  async afterSession(_config, _caps, specs) {
    const record = { spec: path.basename(specs[0] ?? ''), expectedVersion: expectedSchemaVersion() };
    const exit = await waitForAppExit({ binaryPath: binary, timeoutMs: 20000 });
    record.shutdownWaitedMs = exit.waitedMs;
    if (!exit.exited) {
      Object.assign(record, { exists: true, appStillRunning: true, pids: exit.remaining.map(p => p.pid) });
    } else {
      try { Object.assign(record, await inspectDatabase(e2eDataPaths().database)); }
      catch (error) { Object.assign(record, { exists: true, error: String(error) }); }
    }
    fs.appendFileSync(path.join(results, 'db-checks.jsonl'), JSON.stringify(record) + '\n');
  },

  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const stem = (test.parent + ' ' + test.title).replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
    await browser.saveScreenshot(path.join(results, 'screenshots', stem + '.png')).catch(() => {});
    const html = await browser.getPageSource().catch(() => '');
    fs.writeFileSync(path.join(results, 'screenshots', stem + '.html'), html);
  },
};
