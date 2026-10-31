import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'verify-results.mjs');
const good = (spec = '01.e2e.mjs') => ({ spec, expectedVersion: 5, exists: true, userVersion: 5, integrity: 'ok', tables: ['tasks'], rows: { tasks: 1 } });
const junit = (tests, failures = 0) => `<?xml version="1.0"?><testsuites tests="${tests}" failures="${failures}" errors="0" skipped="0"></testsuites>`;

function run({ records, reports }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-verify-'));
  try {
    fs.writeFileSync(path.join(dir, 'db-checks.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
    reports.forEach((xml, i) => fs.writeFileSync(path.join(dir, `junit-results-0-${i}.xml`), xml));
    const result = spawnSync(process.execPath, [script], { env: { ...process.env, E2E_RESULTS_DIR: dir }, encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('verify-results gate (failures must reach CI as a non-zero exit)', () => {
  it('passes when every session is healthy and all reports are clean, summing every report', () => {
    const r = run({ records: [good('a'), good('b')], reports: [junit(4), junit(6)] });
    expect(r.status).toBe(0);
    expect(r.output).toContain('2 report(s), 10 tests, 0 failed');
  });
  it('fails when any test failed in any report', () => {
    expect(run({ records: [good('a'), good('b')], reports: [junit(4), junit(6, 2)] }).status).toBe(1);
  });
  it('fails when the application was still running after the shutdown timeout', () => {
    const r = run({ records: [{ spec: 'a', expectedVersion: 5, exists: true, appStillRunning: true, pids: [42] }], reports: [junit(1)] });
    expect(r.status).toBe(1);
    expect(r.output).toContain('still running');
  });
  it('fails with the real database error', () => {
    const r = run({ records: [{ spec: 'a', expectedVersion: 5, exists: true, error: 'Error: file is not a database' }], reports: [junit(1)] });
    expect(r.status).toBe(1);
    expect(r.output).toContain('file is not a database');
  });
  it('fails on a wrong schema version or integrity result', () => {
    expect(run({ records: [{ ...good(), userVersion: 4 }], reports: [junit(1)] }).status).toBe(1);
    expect(run({ records: [{ ...good(), integrity: 'row 1 missing from index' }], reports: [junit(1)] }).status).toBe(1);
  });
  it('fails when a session produced no JUnit report', () => {
    expect(run({ records: [good('a'), good('b')], reports: [junit(4)] }).status).toBe(1);
  });
});
