"""Exercise shipped migration SQL using generated SQLite files only."""
import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import uuid
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migrations(repo):
    source = (repo / 'src-tauri/src/persistence.rs').read_text(encoding='utf-8-sig')
    blocks = re.findall(r'conn\.execute_batch\(\s*"((?:\\.|[^"\\])*)"', source)
    if len(blocks) < 10:
        raise AssertionError(f'Expected ten shipped migration blocks; found {len(blocks)}')
    return [block.replace('\\"', '"') for block in blocks[:10]]


def health(conn, version):
    assert conn.execute('PRAGMA user_version').fetchone()[0] == version
    assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []


def run(repo, temp_root):
    sql = migrations(repo)
    temp_root.mkdir(parents=True, exist_ok=True)
    prefix = 'civildesk-synthetic-' + uuid.uuid4().hex
    old, backup = temp_root / (prefix + '-v8.sqlite3'), temp_root / (prefix + '-backup.sqlite3')
    failed = temp_root / (prefix + '-failed.sqlite3')
    try:
        with sqlite3.connect(old) as db:
            db.execute('PRAGMA foreign_keys=ON')
            for block in sql[:8]:
                db.executescript(block)
            db.execute("INSERT INTO app_state(key,value) VALUES('rehearsal-marker','synthetic-only')")
            db.execute("INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms) VALUES('synthetic-project','Test','','Civil','Structural','Concept','Planning',1,1)")
            db.commit()
            health(db, 8)
            with sqlite3.connect(backup) as target:
                db.backup(target)
        before = digest(backup)
        with sqlite3.connect(backup) as db:
            health(db, 8)
            assert db.execute("SELECT value FROM app_state WHERE key='rehearsal-marker'").fetchone()[0] == 'synthetic-only'
        with sqlite3.connect(old) as db:
            db.execute('PRAGMA foreign_keys=ON')
            for block in sql[8:10]:
                db.executescript(block)
            health(db, 10)
            assert db.execute("SELECT value FROM app_state WHERE key='rehearsal-marker'").fetchone()[0] == 'synthetic-only'
            assert db.execute("SELECT title FROM engineering_projects WHERE id='synthetic-project'").fetchone()[0] == 'Test'
        assert digest(backup) == before
        shutil.copy2(backup, failed)
        with sqlite3.connect(failed) as db:
            db.execute('CREATE TABLE portfolio_case_studies(conflict TEXT)')
            db.commit()
            try:
                db.executescript(sql[8])
            except sqlite3.DatabaseError:
                pass
            else:
                raise AssertionError('Expected conflicting migration to fail')
            health(db, 8)
            assert db.execute("SELECT value FROM app_state WHERE key='rehearsal-marker'").fetchone()[0] == 'synthetic-only'
            assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='portfolio_gallery'").fetchone()[0] == 0
        # An old binary cannot safely open v10. Rollback restores a matched v8 file.
        with sqlite3.connect(old) as db:
            assert db.execute('PRAGMA user_version').fetchone()[0] == 10
        shutil.copy2(backup, old)
        assert digest(old) == before
        with sqlite3.connect(old) as db:
            health(db, 8)
        return {'status': 'PASS', 'source': 'shipped persistence.rs SQL',
                'v8_to_v10': True, 'backup_sha256': before,
                'failed_migration_rollback': True, 'matched_v8_rollback': True,
                'uninstall_preservation': 'NOT VERIFIED'}
    finally:
        for path in (old, backup, failed):
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                pass  # Windows scanners may briefly retain a handle in disposable temp.


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--temp-root', type=Path)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        temp_root = args.temp_root.resolve() if args.temp_root else repo / 'src-tauri/target/rehearsal-fixtures'
        print(json.dumps(run(repo, temp_root), sort_keys=True))
    except Exception as error:
        print(json.dumps({'status': 'FAIL', 'error': str(error)}))
        raise
