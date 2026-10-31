import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expectedSchemaVersion, inspectDatabase } from './db.mjs';

describe('database inspection', () => {
  it('derives the expected schema version from the Rust migrations', () => {
    expect(expectedSchemaVersion()).toBeGreaterThanOrEqual(5);
  });
  it('reports version, integrity and tables of a disposable database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-db-'));
    const file = path.join(dir, 'x.sqlite3');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE t (a); PRAGMA user_version = 5;');
    db.close();
    expect(inspectDatabase(file)).toEqual({ exists: true, userVersion: 5, integrity: 'ok', tables: ['t'] });
    expect(inspectDatabase(path.join(dir, 'missing.sqlite3'))).toEqual({ exists: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
