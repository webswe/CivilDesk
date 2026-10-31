// Read-only inspection of the E2E SQLite file after the application has exited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The schema version the Rust code migrates to: the highest `PRAGMA user_version = N` in persistence.rs. */
export function expectedSchemaVersion() {
  const source = fs.readFileSync(path.resolve(here, '../../src-tauri/src/persistence.rs'), 'utf8');
  const versions = [...source.matchAll(/PRAGMA user_version = (\d+);\s*COMMIT/g)].map(m => Number(m[1]));
  if (!versions.length) throw new Error('Could not determine the expected schema version.');
  return Math.max(...versions);
}
export function inspectDatabase(file) {
  if (!fs.existsSync(file)) return { exists: false };
  // Inspect a private copy (with any -wal/-shm sidecars) so SQLite can recover the log without ever writing
  // to the application's own files; opening a WAL database read-only in place fails if the app was killed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civildesk-e2e-db-'));
  const copy = path.join(dir, 'copy.sqlite3');
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix);
  const db = new DatabaseSync(copy);
  try {
    const one = sql => Object.values(db.prepare(sql).get() ?? {})[0];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    return { exists: true, userVersion: Number(one('PRAGMA user_version')), integrity: String(one('PRAGMA quick_check')), tables };
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
