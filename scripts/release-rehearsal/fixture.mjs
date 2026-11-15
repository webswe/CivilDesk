// Synthetic data only. The CLI is confined to a disposable GitHub-hosted Windows runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ids = Object.freeze({ project: 'release-project', task: 'release-task', event: 'release-event', milestone: 'release-milestone', file: 'release-file' });
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const one = (db, sql, args = []) => db.prepare(sql).get(...args);

export function assertHostedTarget(database, attachment, env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.CI, 'true');
  assert.equal(env.RUNNER_OS, 'Windows');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.ok(env.APPDATA && env.RUNNER_TEMP);
  const expected = path.resolve(env.APPDATA, 'com.webswe.civildesk', 'civildesk.sqlite3');
  assert.equal(path.resolve(database).toLowerCase(), expected.toLowerCase(), 'Only the disposable runner production-identity database is permitted');
  const temp = path.resolve(env.RUNNER_TEMP).toLowerCase() + path.sep;
  assert.ok(path.resolve(attachment).toLowerCase().startsWith(temp), 'Synthetic attachments must stay in RUNNER_TEMP');
}

export function assertRunnerTempPath(file, env = process.env) {
  assert.ok(file && env.RUNNER_TEMP);
  const temp = path.resolve(env.RUNNER_TEMP).toLowerCase() + path.sep;
  assert.ok(path.resolve(file).toLowerCase().startsWith(temp), 'Rehearsal snapshots must stay in RUNNER_TEMP');
}

export function inspect(database, attachment, challengeId) {
  const db = new DatabaseSync(database);
  try {
    const schema = one(db, 'PRAGMA user_version').user_version;
    const integrity = one(db, 'PRAGMA quick_check').quick_check;
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(schema, 10);
    assert.equal(integrity, 'ok');
    assert.deepEqual(foreignKeys, []);
    assert.ok(fs.existsSync(attachment));
    const rows = {
      preferences: one(db, "SELECT value FROM app_state WHERE key='preferences'")?.value,
      project: one(db, 'SELECT * FROM engineering_projects WHERE id=?', [ids.project]),
      task: one(db, 'SELECT * FROM tasks WHERE id=?', [ids.task]),
      event: one(db, 'SELECT * FROM calendar_events WHERE id=?', [ids.event]),
      milestone: one(db, 'SELECT * FROM project_milestones WHERE id=?', [ids.milestone]),
      file: one(db, 'SELECT * FROM project_files WHERE id=?', [ids.file]),
      challenge: one(db, 'SELECT * FROM challenge_progress WHERE challenge_id=?', [challengeId]),
      link: one(db, 'SELECT * FROM challenge_projects WHERE challenge_id=? AND project_id=?', [challengeId, ids.project]),
      evidence: one(db, 'SELECT * FROM challenge_evidence WHERE challenge_id=?', [challengeId]),
      portfolio: one(db, 'SELECT * FROM portfolio_case_studies WHERE project_id=?', [ids.project]),
      gallery: one(db, 'SELECT * FROM portfolio_gallery WHERE project_id=?', [ids.project]),
    };
    assert.ok(Object.values(rows).every(Boolean), 'A synthetic record is missing');
    assert.equal(rows.task.project_id, ids.project);
    assert.equal(rows.file.path, attachment);
    assert.equal(rows.challenge.status, 'In Progress');
    assert.equal(rows.challenge.deadline_date, '2026-12-10');
    assert.equal(rows.gallery.file_id, ids.file);
    const counts = Object.fromEntries(Object.entries({ engineering_projects: ids.project, tasks: ids.task, calendar_events: ids.event, project_milestones: ids.milestone, project_files: ids.file, portfolio_case_studies: ids.project }).map(([table, id]) => [table, one(db, `SELECT COUNT(*) AS n FROM ${table} WHERE id=?`.replace('id=?', table === 'portfolio_case_studies' ? 'project_id=?' : 'id=?'), [id]).n]));
    assert.ok(Object.values(counts).every(n => n === 1), 'Duplicate synthetic records');
    return { schema, integrity, foreignKeyViolations: 0, rows, counts, attachmentSha256: sha256(attachment) };
  } finally { db.close(); }
}

export function seed(database, attachment) {
  assert.ok(!fs.existsSync(attachment), 'Refusing to replace an existing attachment');
  fs.mkdirSync(path.dirname(attachment), { recursive: true });
  fs.writeFileSync(attachment, 'CivilDesk disposable engineering drawing fixture\n');
  const db = new DatabaseSync(database);
  let challengeId;
  try {
    assert.equal(one(db, 'PRAGMA user_version').user_version, 10, 'Baseline application must initialize schema v10 first');
    const challenge = one(db, 'SELECT d.id, MAX(v.version) AS version FROM challenge_definitions d JOIN challenge_versions v ON v.challenge_id=d.id GROUP BY d.id ORDER BY d.id LIMIT 1');
    assert.ok(challenge, 'Baseline application must seed its challenge library');
    challengeId = challenge.id;
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engineering_projects').n, 0, 'Expected a fresh disposable profile');
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    try {
      const prefs = { displayName: 'Release Rehearsal', onboardingComplete: true, pipVisible: true, engagement: 'balanced', reducedMotion: false, focusMode: false, sidebarCollapsed: false, dashboardPipEnabled: true };
      db.prepare('INSERT INTO app_state(key,value) VALUES (?,?)').run('preferences', JSON.stringify(prefs));
      db.prepare("INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?)").run(ids.project, 'Synthetic footbridge', 'Disposable design', 'Civil', 'Structural', 'Design', 'In Progress', 1, 1);
      db.prepare('INSERT INTO tasks(id,title,category,priority,due_date,project_id,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)').run(ids.task, 'Review synthetic beam', 'Engineering', 'normal', '2026-12-10', ids.project, 1, 1);
      db.prepare('INSERT INTO project_milestones(id,project_id,title,description,target_date,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?)').run(ids.milestone, ids.project, 'Load check', 'Synthetic only', '2026-12-10', 1, 1);
      db.prepare('INSERT INTO calendar_events(id,title,description,start_date,end_date,all_day,time_zone,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(ids.event, 'Synthetic site visit', 'Disposable', '2026-12-10', '2026-12-10', 1, 'UTC', 1, 1);
      db.prepare('INSERT INTO project_files(id,project_id,display_name,path,category,description,added_at_ms) VALUES (?,?,?,?,?,?,?)').run(ids.file, ids.project, 'Drawing.txt', attachment, 'Drawing', 'Disposable file', 1);
      db.prepare('INSERT INTO challenge_progress(challenge_id,content_version,mode,status,notes,deadline_date,started_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)').run(challengeId, challenge.version, 'guided', 'In Progress', 'Synthetic progress', '2026-12-10', 1, 1);
      db.prepare('INSERT INTO challenge_projects(challenge_id,project_id,created_at_ms,created_from_challenge) VALUES (?,?,?,?)').run(challengeId, ids.project, 1, 0);
      db.prepare('INSERT INTO challenge_evidence(id,challenge_id,display_name,path,category,added_at_ms) VALUES (?,?,?,?,?,?)').run('release-evidence', challengeId, 'Drawing.txt', attachment, 'Drawing', 1);
      db.prepare('INSERT INTO portfolio_case_studies(project_id,created_at_ms,updated_at_ms,background,deliverables) VALUES (?,?,?,?,?)').run(ids.project, 1, 1, 'Synthetic background', 'Synthetic drawing');
      db.prepare('INSERT INTO portfolio_gallery(id,project_id,file_id,caption,alt_text,position,created_at_ms) VALUES (?,?,?,?,?,?,?)').run('release-gallery', ids.project, ids.file, 'Synthetic drawing', 'Beam diagram', 0, 1);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  inspect(database, attachment, challengeId);
  return challengeId;
}

export async function snapshot(database, destination) {
  assert.ok(!fs.existsSync(destination), 'Refusing to overwrite a backup');
  const source = new DatabaseSync(database);
  try { await backup(source, destination); } finally { source.close(); }
  const copy = new DatabaseSync(destination);
  try {
    assert.equal(one(copy, 'PRAGMA quick_check').quick_check, 'ok');
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  return sha256(destination);
}

export function restore(backupFile, database) {
  assert.ok(fs.existsSync(backupFile));
  for (const suffix of ['-journal', '-wal', '-shm']) assert.ok(!fs.existsSync(database + suffix), 'Refusing to restore with an active SQLite sidecar');
  const copy = new DatabaseSync(backupFile);
  try { assert.equal(one(copy, 'PRAGMA quick_check').quick_check, 'ok'); assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []); }
  finally { copy.close(); }
  fs.copyFileSync(backupFile, database);
  assert.equal(sha256(database), sha256(backupFile));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, database, attachment, challengeId, output] = process.argv.slice(2);
  assertHostedTarget(database, attachment);
  if (command !== 'seed') assertRunnerTempPath(output);
  if (command === 'seed') console.log(seed(database, attachment));
  else if (command === 'inspect') fs.writeFileSync(output, JSON.stringify(inspect(database, attachment, challengeId), null, 2));
  else if (command === 'backup') console.log(await snapshot(database, output));
  else if (command === 'restore') restore(output, database);
  else throw new Error('Unknown release rehearsal fixture command');
}
