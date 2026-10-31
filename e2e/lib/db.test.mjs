import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { expectedSchemaVersion, inspectDatabase } from './db.mjs';
import { e2eDataPaths } from './guard.mjs';

let root;
let env;
let database;
const snapshotDirs = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('civildesk-e2e-snapshot-')).sort();
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-db-'));
  env = { APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: path.join(root, 'Local') };
  database = e2eDataPaths(env).database;
  fs.mkdirSync(path.dirname(database), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function create(version, sql = '') {
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT); ${sql} PRAGMA user_version = ${version};`);
  db.close();
}

describe('expected schema version', () => {
  it('is derived from the Rust migrations', () => { expect(expectedSchemaVersion()).toBeGreaterThanOrEqual(5); });
});

describe('database inspection (backup-API snapshot)', () => {
  it('reports version, integrity, tables and committed rows', async () => {
    create(5, "INSERT INTO tasks (title) VALUES ('a'), ('b'), ('c');");
    const before = snapshotDirs();
    expect(await inspectDatabase(database, env)).toEqual({ exists: true, userVersion: 5, integrity: 'ok', tables: ['tasks'], rows: { tasks: 3 } });
    expect(snapshotDirs()).toEqual(before); // its temporary snapshot folder is removed
  });
  it('detects the actual schema version rather than assuming one', async () => {
    create(3);
    expect((await inspectDatabase(database, env)).userVersion).toBe(3);
  });
  it('reports a missing database without creating one', async () => {
    expect(await inspectDatabase(database, env)).toEqual({ exists: false });
    expect(fs.existsSync(database)).toBe(false);
  });
  it('propagates the real SQLite error when the file is not a database', async () => {
    fs.writeFileSync(database, 'this is not a sqlite database, it is just text '.repeat(200));
    const before = snapshotDirs();
    await expect(inspectDatabase(database, env)).rejects.toThrow(/not a database|malformed|encrypted/i);
    expect(snapshotDirs()).toEqual(before);
  });
  it('recovers a hot rollback journal left by a killed process and snapshots the committed state', async () => {
    const db = new DatabaseSync(database);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); PRAGMA user_version = 5;");
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 3000; i++) insert.run('committed-row-'.padEnd(120, 'x'));
    db.exec('COMMIT');
    db.close();
    // A separate process starts a transaction large enough to spill dirty pages into the database file
    // (so a rollback journal is written), then is killed before COMMIT.
    const child = spawnSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA cache_size = 1');
      db.exec('BEGIN');
      db.exec("UPDATE t SET v = 'DIRTY-' || v");
      process.kill(process.pid, 'SIGKILL');
    `, database], { encoding: 'utf8' });
    expect(child.status === 0, 'child must have been killed, not exited cleanly').toBe(false);
    expect(fs.existsSync(database + '-journal'), 'precondition: a hot rollback journal exists').toBe(true);

    const result = await inspectDatabase(database, env);
    expect(result).toMatchObject({ exists: true, userVersion: 5, integrity: 'ok', rows: { t: 3000 } });
    // The uncommitted update must not be visible, in the snapshot or in the recovered original.
    for (const file of [database]) {
      const check = new DatabaseSync(file);
      expect(Number(check.prepare("SELECT COUNT(*) AS n FROM t WHERE v LIKE 'DIRTY-%'").get().n)).toBe(0);
      check.close();
    }
    expect(fs.existsSync(database + '-journal')).toBe(false);
  });
});

describe('database isolation', () => {
  it('refuses production, Acceptance and arbitrary databases without opening or modifying them', async () => {
    const others = ['com.webswe.civildesk', 'com.webswe.civildesk.acceptance'].map(n => path.join(env.APPDATA, n, 'civildesk.sqlite3'));
    others.push(path.join(root, 'elsewhere.sqlite3'), path.join(path.dirname(database), 'other-name.sqlite3'));
    const digests = new Map();
    for (const file of others) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file); db.exec('CREATE TABLE marker (x); PRAGMA user_version = 99;'); db.close();
      digests.set(file, sha(file));
    }
    for (const file of others) {
      await expect(inspectDatabase(file, env), file).rejects.toThrow(/Refusing to open/);
      expect(sha(file)).toBe(digests.get(file));
      expect(fs.existsSync(file + '-journal')).toBe(false);
    }
  });
});
