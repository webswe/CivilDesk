// Inspection of the disposable E2E SQLite database after the application has exited.
//
// The application uses SQLite's default rollback journal, so a process that is killed mid-transaction can leave a
// hot journal behind. Reading such a file correctly needs a connection that may roll it back. Therefore this module:
//   1. refuses any path that is not exactly the E2E database (never production or Acceptance),
//   2. opens that disposable file read-write so SQLite can recover it,
//   3. uses SQLite's Online Backup API to write a consistent snapshot into a private folder beside the disposable E2E database,
//   4. runs every check against the snapshot, and always removes only the folder it created.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { assertE2eDatabase } from './guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The schema version the Rust code migrates to: the highest `PRAGMA user_version = N` in persistence.rs. */
export function expectedSchemaVersion() {
  const source = fs.readFileSync(path.resolve(here, '../../src-tauri/src/persistence.rs'), 'utf8');
  const versions = [...source.matchAll(/PRAGMA user_version = (\d+);\s*COMMIT/g)].map(m => Number(m[1]));
  if (!versions.length) throw new Error('Could not determine the expected schema version.');
  return Math.max(...versions);
}

/**
 * @returns {Promise<{exists:false}|{exists:true,userVersion:number,integrity:string,foreignKeyViolations:number,tables:string[],rows:Record<string,number>}>}
 * Throws with the real SQLite error if the database cannot be opened, snapshotted or inspected.
 */
export async function inspectDatabase(file, env = process.env) {
  const database = assertE2eDatabase(file, env);
  if (!fs.existsSync(database)) return { exists: false };
  const dir = fs.mkdtempSync(path.join(path.dirname(database), 'civildesk-e2e-snapshot-'));
  const snapshotPath = path.join(dir, 'snapshot.sqlite3');
  let source;
  let snapshot;
  try {
    source = new DatabaseSync(database); // read-write on purpose: allows rollback-journal recovery of the disposable file
    source.exec('PRAGMA busy_timeout = 2000');
    await backup(source, snapshotPath);
    source.close();
    source = undefined;
    snapshot = new DatabaseSync(snapshotPath);
    const one = sql => Object.values(snapshot.prepare(sql).get() ?? {})[0];
    const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name));
    const rows = Object.fromEntries(tables.map(name => [name, Number(one(`SELECT COUNT(*) FROM "${name.replaceAll('"', '""')}"`))]));
    // Foreign keys are enforced by the application but SQLite only reports existing violations on request.
    const foreignKeyViolations = snapshot.prepare('PRAGMA foreign_key_check').all().length;
    return { exists: true, userVersion: Number(one('PRAGMA user_version')), integrity: String(one('PRAGMA quick_check')), foreignKeyViolations, tables, rows };
  } finally {
    try { source?.close(); } catch { /* already closed */ }
    try { snapshot?.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
