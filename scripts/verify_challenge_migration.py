"""Exercise the shipped Rust migration SQL in a disposable in-memory SQLite database."""
import json
import re
import sqlite3
from pathlib import Path

source = Path('src-tauri/src/persistence.rs').read_text(encoding='utf-8-sig')
blocks = re.findall(r'conn\.execute_batch\("((?:\\.|[^"\\])*)"\)', source)
assert len(blocks) >= 5, f'Expected version 0-5 migration blocks, got {len(blocks)}'
sql = [block.replace('\\"','"') for block in blocks[:5]]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sql[:4]:
    db.executescript(migration)
assert db.execute('PRAGMA user_version').fetchone()[0] == 4
db.execute("INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,software_json,status,created_at_ms,updated_at_ms) VALUES ('old','Keep me','','Civil','','Academic','[]','Planning',1,1)")
db.execute("INSERT INTO tasks(id,title,description,category,priority,subtasks_json,created_at_ms,updated_at_ms) VALUES ('old-task','Keep task','','','normal','[]',1,1)")
db.commit()
db.executescript(sql[4])
assert db.execute('PRAGMA user_version').fetchone()[0] == 5
assert db.execute("SELECT title FROM engineering_projects WHERE id='old'").fetchone()[0] == 'Keep me'
assert db.execute("SELECT title FROM tasks WHERE id='old-task'").fetchone()[0] == 'Keep task'
assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
library=json.loads(Path('src-tauri/src/challenge_library.json').read_text(encoding='utf-8'))
assert len(library) == 9 and len({c['id'] for c in library}) == 9
for item in library:
    db.execute('INSERT INTO challenge_definitions VALUES (?,?,?,?,1)',(item['id'],item['track'],item['discipline'],item['difficulty']))
    db.execute('INSERT INTO challenge_versions VALUES (?,?,?)',(item['id'],item['version'],json.dumps(item)))
db.execute("INSERT INTO weekly_challenges VALUES ('week:acad-drafting','2026-11-02','acad-drafting',1,'manual','Not Started',1)")
db.execute("INSERT INTO challenge_progress VALUES ('acad-drafting',1,'guided','Completed','',NULL,1,2,2)")
revised=dict(library[0],version=2,title='Revised educational brief')
db.execute('INSERT INTO challenge_versions VALUES (?,?,?)',(revised['id'],2,json.dumps(revised)))
assert json.loads(db.execute("SELECT content_json FROM challenge_versions WHERE challenge_id='acad-drafting' AND version=1").fetchone()[0])['title'] == library[0]['title']
assert db.execute("SELECT content_version FROM challenge_progress WHERE challenge_id='acad-drafting'").fetchone()[0] == 1
try:
    db.execute("INSERT INTO weekly_challenges VALUES ('duplicate','2026-11-02','acad-drafting',1,'manual','Not Started',1)")
    raise AssertionError('Duplicate assignment accepted')
except sqlite3.IntegrityError:
    pass
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
print('schema v4 to v5, retained rows, challenge records, uniqueness, quick_check, and foreign keys: pass')

# Run the SQL literals that challenges.rs executes at runtime against a fresh v0-v5 schema.
rust = Path('src-tauri/src/challenges.rs').read_text(encoding='utf-8-sig')
def statement(prefix):
    match = re.search(r'"(' + re.escape(prefix) + r'(?:\\.|[^"\\])*)"', rust)
    assert match, f'SQL not found in challenges.rs: {prefix}'
    return match.group(1).replace('\\"', '"')
rt = sqlite3.connect(':memory:')
rt.execute('PRAGMA foreign_keys=ON')
for migration in sql:
    rt.executescript(migration)
assert rt.execute('PRAGMA user_version').fetchone()[0] == 5
assert rt.execute('SELECT automatic,weekly_count FROM challenge_settings WHERE id=1').fetchone() == (0, 2)
for _ in range(2):  # seeding is repeated at every launch and must be idempotent
    for item in library:
        rt.execute(statement('INSERT OR IGNORE INTO challenge_definitions'), (item['id'], item['track'], item['discipline'], item['difficulty']))
        rt.execute(statement('INSERT OR IGNORE INTO challenge_versions'), (item['id'], item['version'], json.dumps(item)))
    for item in library:
        for prerequisite in item['prerequisites']:
            rt.execute(statement('INSERT OR IGNORE INTO challenge_prerequisites'), (item['id'], prerequisite))
        for skill in item['skills']:
            rt.execute(statement('INSERT OR IGNORE INTO engineering_skills'), (skill, skill.title(), item['track']))
            rt.execute(statement('INSERT OR IGNORE INTO challenge_skills'), (item['id'], skill))
    for pathway, title, track, ids in [('cad-foundations', 'AutoCAD', 'AutoCAD', ['acad-drafting', 'acad-site-plan', 'acad-layout']), ('roadway-concepts', 'Civil 3D', 'Civil 3D', ['c3d-survey', 'c3d-alignment', 'c3d-roadway']), ('bim-documentation', 'Revit', 'Revit', ['revit-bim', 'revit-foundation', 'revit-docs'])]:
        rt.execute(statement('INSERT OR IGNORE INTO learning_pathways'), (pathway, title, 'Optional sequence', track))
        for position, challenge_id in enumerate(ids):
            rt.execute(statement('INSERT OR IGNORE INTO pathway_challenges'), (pathway, challenge_id, position))
assert rt.execute('SELECT COUNT(*) FROM challenge_definitions').fetchone()[0] == 9
assert rt.execute('SELECT COUNT(*) FROM pathway_challenges').fetchone()[0] == 9
rt.execute(statement('UPDATE challenge_settings SET'), (1, json.dumps(['AutoCAD']), json.dumps(['Beginner']), 2))
for _ in range(2):  # an assignment for a week is never duplicated
    rt.execute(statement('INSERT OR IGNORE INTO weekly_challenges'), ('2026-11-02:acad-drafting', '2026-11-02', 'acad-drafting', 1, 'automatic', 'Not Started', 5))
assert rt.execute('SELECT COUNT(*) FROM weekly_challenges').fetchone()[0] == 1
for _ in range(2):  # start twice, mode switch keeps one row and the pinned version
    rt.execute(statement("INSERT INTO challenge_progress VALUES (?1,?2,?3,'In Progress'"), ('acad-drafting', 1, 'brief', 10))
assert rt.execute("SELECT COUNT(*), mode FROM challenge_progress").fetchone() == (1, 'brief')
for index in range(3):
    rt.execute(statement('INSERT INTO challenge_checks VALUES'), ('acad-drafting', 1, index, True))
rt.execute(statement('INSERT INTO challenge_checks VALUES'), ('acad-drafting', 1, 1, False))
assert rt.execute('SELECT COUNT(*) FROM challenge_checks WHERE checked=1').fetchone()[0] == 2
rt.execute(statement('INSERT INTO challenge_checks VALUES'), ('acad-drafting', 1, 1, True))
rt.execute(statement("UPDATE challenge_progress SET status='Completed'"), ('acad-drafting', 20))
rt.execute(statement('UPDATE weekly_challenges SET status=?2 WHERE challenge_id=?1 AND week_start=?3'), ('acad-drafting', 'Completed', '2026-11-02'))
for _ in range(2):  # completion and pathway events are unique
    rt.execute(statement('INSERT OR IGNORE INTO engineering_events'), ('challenge_completed', 'acad-drafting', 20))
assert rt.execute("SELECT COUNT(*) FROM engineering_events").fetchone()[0] == 1
rt.execute(statement('INSERT OR IGNORE INTO challenge_evidence'), ('ev1', 'acad-drafting', 'plan.dwg', 'C:\\Work\\Plan Ünï.dwg', 'dwg', 30))
rt.execute(statement('INSERT OR IGNORE INTO challenge_evidence'), ('ev2', 'acad-drafting', 'plan.dwg', 'C:\\Work\\Plan Ünï.dwg', 'dwg', 31))
assert rt.execute('SELECT COUNT(*) FROM challenge_evidence').fetchone()[0] == 1
item = library[0]
rt.execute(statement('INSERT INTO engineering_projects (id,title'), ('challenge-acad-drafting', item['title'], item['description'], item['discipline'], json.dumps([item['track']]), 40, '\n'.join(item['objectives']), ', '.join(item['skills'])))
rt.execute(statement('INSERT INTO challenge_projects VALUES (?1,?2,?3,1)'), ('acad-drafting', 'challenge-acad-drafting', 40))
rt.execute(statement('INSERT INTO project_files VALUES'), ('challenge-acad-drafting:ev1', 'challenge-acad-drafting', 'plan.dwg', 'C:\\Work\\Plan Ünï.dwg', 'dwg', 30))
try:
    rt.execute("INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,software_json,status,created_at_ms,updated_at_ms) VALUES ('second','Second','','Civil','','Educational','[]','Planning',1,1)")
    rt.execute(statement('INSERT INTO challenge_projects VALUES (?1,?2,?3,1)'), ('acad-drafting', 'second', 42))
    raise AssertionError('A second created project was accepted')
except sqlite3.IntegrityError:
    pass
for query, args in [
    ('SELECT v.content_json FROM', ()), ('SELECT content_json FROM challenge_versions ORDER BY', ()),
    ('SELECT automatic,tracks_json', ()), ('SELECT id,week_start,challenge_id', ()),
    ('SELECT challenge_id,content_version,mode,status', ()), ('SELECT item_index FROM challenge_checks', ('acad-drafting', 1)),
    ('SELECT id,challenge_id,display_name,path', ()), ('SELECT id,title,description,track FROM learning_pathways', ()),
    ('SELECT challenge_id FROM pathway_challenges WHERE pathway_id', ('cad-foundations',)), ('SELECT challenge_id,project_id,created_from_challenge', ()),
    ('SELECT d.id,MAX(v.version)', ()),
]:
    rows = rt.execute(statement(query), args).fetchall()
    assert rows is not None
assert len(rt.execute(statement('SELECT v.content_json FROM'), ()).fetchall()) == 9
assert rt.execute(statement('SELECT automatic,tracks_json'), ()).fetchone() == (1, '["AutoCAD"]', '["Beginner"]', 2)
assert rt.execute(statement('SELECT item_index FROM challenge_checks'), ('acad-drafting', 1)).fetchall() == [(0,), (1,), (2,)]
assert rt.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
assert rt.execute('PRAGMA foreign_key_check').fetchall() == []
print('challenges.rs runtime SQL on a fresh v5 schema (seed idempotence, weekly uniqueness, upsert, checks, events, evidence, project conversion, reads): pass')
