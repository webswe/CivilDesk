// Final gate, run after the WebdriverIO suite: every session must have left a healthy SQLite file at the
// schema version the Rust code migrates to (so no surprise or missing migration), and the run must have
// produced a JUnit report with no failures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const results = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
const failures = [];
const note = message => { failures.push(message); console.error('FAIL: ' + message); };

const checksFile = path.join(results, 'db-checks.jsonl');
assert.ok(fs.existsSync(checksFile), 'No SQLite checks were recorded; the application never started.');
const records = fs.readFileSync(checksFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.ok(records.length > 0, 'No SQLite checks were recorded.');
for (const r of records) {
  if (!r.exists) note(`${r.spec}: no database file was created`);
  else if (r.error) note(`${r.spec}: database could not be inspected: ${r.error}`);
  else {
    if (r.integrity !== 'ok') note(`${r.spec}: SQLite quick_check returned "${r.integrity}"`);
    if (r.userVersion !== r.expectedVersion) note(`${r.spec}: schema version ${r.userVersion}, expected ${r.expectedVersion}`);
    console.log(`ok  ${r.spec}: schema v${r.userVersion}, integrity ${r.integrity}, ${r.tables.length} tables`);
  }
}

const junit = path.join(results, 'junit-results.xml');
if (!fs.existsSync(junit)) note('JUnit report is missing');
else {
  const xml = fs.readFileSync(junit, 'utf8');
  const total = Number(/<testsuites[^>]*\btests="(\d+)"/.exec(xml)?.[1] ?? 0);
  const failed = Number(/<testsuites[^>]*\bfailures="(\d+)"/.exec(xml)?.[1] ?? 0) + Number(/<testsuites[^>]*\berrors="(\d+)"/.exec(xml)?.[1] ?? 0);
  console.log(`JUnit: ${total} tests, ${failed} failed`);
  if (total === 0) note('JUnit report contains no tests');
  if (failed > 0) note(`${failed} acceptance test(s) failed`);
}
if (failures.length) process.exit(1);
console.log('Acceptance results verified.');
