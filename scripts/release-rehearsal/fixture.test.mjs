import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrationScripts } from '../../e2e/lib/fixture.mjs';
import { assertHostedTarget, assertRunnerTempPath, inspect, restore, seed, snapshot } from './fixture.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civildesk-release-fixture-'));
  dirs.push(dir);
  const database = path.join(dir, 'civildesk.sqlite3');
  const attachment = path.join(dir, 'Drawing.txt');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA foreign_keys=ON');
  for (const script of migrationScripts()) db.exec(script);
  db.prepare('INSERT INTO challenge_definitions(id,track,discipline,difficulty) VALUES (?,?,?,?)').run('synthetic-challenge', 'Civil 3D', 'Civil', 'Beginner');
  db.prepare('INSERT INTO challenge_versions(challenge_id,version,content_json) VALUES (?,?,?)').run('synthetic-challenge', 1, '{}');
  db.close();
  return { dir, database, attachment };
}

describe('disposable installer rehearsal data', () => {
  it('seeds every required relationship and preserves it through a verified backup and restore', async () => {
    const { dir, database, attachment } = fixture();
    const challengeId = seed(database, attachment);
    const before = inspect(database, attachment, challengeId);
    expect(before.schema).toBe(10);
    expect(before.rows.task.project_id).toBe('release-project');
    expect(before.rows.link.project_id).toBe('release-project');
    expect(before.rows.gallery.file_id).toBe('release-file');
    const backupFile = path.join(dir, 'backup.sqlite3');
    const hash = await snapshot(database, backupFile);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const changed = new DatabaseSync(database);
    changed.prepare('UPDATE tasks SET title=? WHERE id=?').run('Changed for rollback test', 'release-task');
    changed.close();
    expect(inspect(database, attachment, challengeId)).not.toEqual(before);
    restore(backupFile, database);
    expect(inspect(database, attachment, challengeId)).toEqual(before);
  });

  it('refuses duplicate seeding, backup overwrite, and restore with a SQLite sidecar', async () => {
    const { dir, database, attachment } = fixture();
    seed(database, attachment);
    expect(() => seed(database, attachment)).toThrow();
    const backupFile = path.join(dir, 'backup.sqlite3');
    await snapshot(database, backupFile);
    await expect(snapshot(database, backupFile)).rejects.toThrow();
    fs.writeFileSync(database + '-wal', 'synthetic sidecar');
    expect(() => restore(backupFile, database)).toThrow(/sidecar/);
  });

  it('rejects local or wrong-identity CLI targets', () => {
    const { dir, database, attachment } = fixture();
    const env = { GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted', APPDATA: dir, RUNNER_TEMP: dir };
    expect(() => assertHostedTarget(database, attachment, env)).toThrow();
    const expected = path.join(dir, 'com.webswe.civildesk', 'civildesk.sqlite3');
    expect(() => assertHostedTarget(expected, attachment, env)).not.toThrow();
    expect(() => assertHostedTarget(expected, attachment, { ...env, RUNNER_ENVIRONMENT: 'self-hosted' })).toThrow();
    expect(() => assertRunnerTempPath(path.join(dir, 'rollback.sqlite3'), env)).not.toThrow();
    expect(() => assertRunnerTempPath(path.join(path.dirname(dir), 'owner.sqlite3'), env)).toThrow();
  });
});
