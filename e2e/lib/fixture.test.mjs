import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SEEDED, migrationScripts, seedUpgradeFixture } from './fixture.mjs';
import { e2eDataPaths } from './guard.mjs';
import { expectedSchemaVersion, inspectDatabase } from './db.mjs';

let root;
let env;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-fixture-'));
  env = { APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: path.join(root, 'Local') };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('upgrade fixture', () => {
  it('extracts one migration script per schema version, matching the expected version', () => {
    expect(migrationScripts()).toHaveLength(expectedSchemaVersion());
  });
  it('builds a genuine schema-v5 database from the application migrations with representative data', async () => {
    const file = seedUpgradeFixture({ env });
    expect(file).toBe(e2eDataPaths(env).database);
    const info = await inspectDatabase(file, env);
    expect(info.userVersion).toBe(5);
    expect(info.integrity).toBe('ok');
    expect(info.tables).not.toContain('semesters'); // academic tables arrive only through the real upgrade
    expect(info.tables).not.toContain('study_blocks');
    expect(info.rows.tasks).toBe(SEEDED.tasks);
    expect(info.rows.engineering_projects).toBe(SEEDED.projects);
    expect(info.rows.calendar_events).toBe(SEEDED.events);
    expect(info.rows.focus_sessions).toBe(SEEDED.focusSessions);
    const db = new DatabaseSync(file);
    expect(Number(db.prepare('SELECT SUM(xp) AS xp FROM reward_events').get().xp)).toBe(SEEDED.xp);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    db.close();
  });
  it('can build older versions and refuses to overwrite an existing database', () => {
    expect(seedUpgradeFixture({ env, version: 5 })).toBeTruthy();
    expect(() => seedUpgradeFixture({ env })).toThrow(/overwrite/);
  });
  it('only ever writes inside the E2E identity folder', () => {
    seedUpgradeFixture({ env });
    const written = fs.readdirSync(root, { recursive: true }).map(String);
    expect(written.every(p => !p || p.startsWith('Roaming') )).toBe(true);
    expect(written.some(p => p.includes('com.webswe.civildesk.e2e'))).toBe(true);
    expect(written.some(p => /civildesk\.acceptance/.test(p))).toBe(false);
    expect(() => seedUpgradeFixture({ env: { APPDATA: '', LOCALAPPDATA: '' } })).toThrow();
  });
});
