// Final gate, run after the WebdriverIO suite: every session must have left a healthy SQLite file at the
// schema version the Rust code migrates to (so no surprise or missing migration), and the run must have
// produced a JUnit report with no failures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const results = process.env.E2E_RESULTS_DIR ? path.resolve(process.env.E2E_RESULTS_DIR) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
const failures = [];
const note = message => { failures.push(message); console.error('FAIL: ' + message); };

const checksFile = path.join(results, 'db-checks.jsonl');
assert.ok(fs.existsSync(checksFile), 'No SQLite checks were recorded; the application never started.');
const records = fs.readFileSync(checksFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.ok(records.length > 0, 'No SQLite checks were recorded.');
for (const r of records) {
  if (r.appStillRunning) note(`${r.spec}: the application was still running after the shutdown timeout (pid ${r.pids?.join(', ')}); the database was not inspected`);
  else if (!r.exists) note(`${r.spec}: no database file was created`);
  else if (r.error) note(`${r.spec}: database could not be inspected: ${r.error}`);
  else {
    if (r.integrity !== 'ok') note(`${r.spec}: SQLite quick_check returned "${r.integrity}"`);
    if (r.userVersion !== r.expectedVersion) note(`${r.spec}: schema version ${r.userVersion}, expected ${r.expectedVersion}`);
    console.log(`ok  ${r.spec}: schema v${r.userVersion}, integrity ${r.integrity}, ${r.tables.length} tables`);
  }
}

const junitFiles = fs.readdirSync(results).filter(f => /^junit-results.*\.xml$/.test(f));
if (!junitFiles.length) note('JUnit report is missing');
let total = 0, failed = 0;
for (const f of junitFiles) {
  const xml = fs.readFileSync(path.join(results, f), 'utf8');
  total += Number(/<testsuites[^>]*tests="(\d+)"/.exec(xml)?.[1] ?? 0);
  failed += Number(/<testsuites[^>]*failures="(\d+)"/.exec(xml)?.[1] ?? 0) + Number(/<testsuites[^>]*errors="(\d+)"/.exec(xml)?.[1] ?? 0);
}
console.log(`JUnit: ${junitFiles.length} report(s), ${total} tests, ${failed} failed`);
if (junitFiles.length && total === 0) note('JUnit reports contain no tests');
if (failed > 0) note(`${failed} acceptance test(s) failed`);
// Each spec file must have produced a SQLite record and a JUnit report.
if (junitFiles.length !== records.length) note(`${junitFiles.length} JUnit report(s) but ${records.length} session record(s)`);
if (failures.length) process.exit(1);
console.log('Acceptance results verified.');
