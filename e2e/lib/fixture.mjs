// Disposable upgrade fixture: a genuine schema-v5 database, written into the E2E identity's data folder before the
// application starts, so the real binary performs the upgrade on a file (v5 -> current) exactly as an existing
// user's would. The schema is built by running the application's own migration SQL (extracted from persistence.rs),
// never a hand-copied approximation. Every path goes through the E2E guard, so production and Acceptance
// databases cannot be targeted.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { assertDisposable, assertE2eDatabase, e2eDataPaths } from './guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The `execute_batch("...")` migration scripts in persistence.rs, in order (index 0 is schema v1). */
export function migrationScripts() {
  const source = fs.readFileSync(path.resolve(here, '../../src-tauri/src/persistence.rs'), 'utf8');
  const body = source.slice(source.indexOf('pub(crate) fn migrate'), source.indexOf('#[cfg(test)]'));
  return [...body.matchAll(/execute_batch\("([\s\S]*?)"\)/g)].map(m => m[1].replaceAll('\\"', '"'));
}

const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/** Representative pre-existing user data: tasks in every area, a project, a calendar event, Pip history, a finished focus session. */
export function seedRows(db) {
  const prefs = { displayName: 'Upgrade Tester', onboardingComplete: true, pipVisible: true, engagement: 'balanced', reducedMotion: false, focusMode: false, sidebarCollapsed: false, dashboardPipEnabled: true };
  db.prepare('INSERT INTO app_state(key,value) VALUES (?,?)').run('preferences', JSON.stringify(prefs));
  db.prepare('INSERT INTO app_state(key,value) VALUES (?,?)').run('companion', JSON.stringify({ state: 'awake', experience: 0, level: 1, coins: 0, updatedAt: '2026-01-01T00:00:00.000Z' }));
  db.exec(`INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms)
    VALUES ('proj-1','Footbridge Study','','Civil','Structural','Design','In Progress',1,1);
    INSERT INTO project_milestones(id,project_id,title,description,target_date,created_at_ms,updated_at_ms) VALUES ('ms-1','proj-1','Load check','','${day(14)}',1,1);`);
  const task = db.prepare('INSERT INTO tasks(id,title,category,priority,due_date,project_id,created_at_ms,updated_at_ms,completed_at_ms,first_completed_at_ms) VALUES (?,?,?,?,?,?,1,1,?,?)');
  task.run('t-school', 'Statics homework', 'School', 'normal', day(-1), null, null, null);
  task.run('t-math', 'Legacy math task', 'Math homework', 'normal', null, null, null, null);
  task.run('t-personal', 'Book dentist', 'Personal', 'normal', day(2), null, null, null);
  task.run('t-project', 'Draft beam schedule', 'Engineering', 'normal', null, 'proj-1', null, null);
  task.run('t-done', 'Finished reading', 'School', 'normal', day(-3), null, 1700000000000, 1700000000000);
  db.exec(`INSERT INTO calendar_events(id,title,description,start_date,start_time,end_date,end_time,all_day,time_zone,created_at_ms,updated_at_ms)
    VALUES ('ev-1','Site visit','','${day(3)}',NULL,'${day(3)}',NULL,1,'UTC',1,1);
    INSERT INTO focus_sessions(id,task_id,status,duration_minutes,break_minutes,started_at_ms,elapsed_ms,finished_at_ms) VALUES ('old-session','t-school','completed',25,5,1700000100000,1500000,1700001600000);
    INSERT INTO reward_events(id,kind,source_id,occurred_at,xp) VALUES ('task_completed:t-done','task_completed','t-done','1700000000000',25),('focus_completed:old-session','focus_completed','old-session','1700001600000',50);
    INSERT INTO earned_achievements(definition_id,rule_version,event_id,earned_at) VALUES ('first_task',1,'task_completed:t-done','1700000000000'),('first_focus',1,'focus_completed:old-session','1700001600000');
    INSERT INTO cosmetic_unlocks(cosmetic_id,source_event_id,unlocked_at) VALUES ('scarf','task_completed:t-done','1700000000000');`);
}
export const SEEDED = { tasks: 5, events: 1, projects: 1, milestones: 1, xp: 75, focusSessions: 1 };

/** Creates the E2E database at `version` (default 5) with representative rows. Refuses anything but the E2E database path. */
export function seedUpgradeFixture({ version = 5, env = process.env } = {}) {
  const { data, database } = e2eDataPaths(env);
  assertDisposable(data, env);
  assertE2eDatabase(database, env);
  fs.mkdirSync(data, { recursive: true });
  if (fs.existsSync(database)) throw new Error('Refusing to overwrite an existing database; the E2E data folder must be reset first.');
  const scripts = migrationScripts();
  if (scripts.length < version) throw new Error(`persistence.rs defines only ${scripts.length} migrations.`);
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const script of scripts.slice(0, version)) db.exec(script);
    if (Number(db.prepare('PRAGMA user_version').get().user_version) !== version) throw new Error('Fixture is not at schema v' + version);
    seedRows(db);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('Fixture violates foreign keys: ' + JSON.stringify(violations[0]));
  } finally { db.close(); }
  return database;
}
