use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub display_name: String,
    pub onboarding_complete: bool,
    pub pip_visible: bool,
    pub engagement: String,
    pub reduced_motion: bool,
    pub focus_mode: bool,
    pub sidebar_collapsed: bool,
    pub dashboard_pip_enabled: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            display_name: String::new(),
            onboarding_complete: false,
            pip_visible: true,
            engagement: "balanced".into(),
            reduced_motion: false,
            focus_mode: false,
            sidebar_collapsed: false,
            dashboard_pip_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRecord {
    pub state: String,
    pub experience: u64,
    pub level: u32,
    pub coins: u64,
    pub updated_at: String,
}

impl Default for CompanionRecord {
    fn default() -> Self {
        Self {
            state: "awake".into(),
            experience: 0,
            level: 1,
            coins: 0,
            updated_at: "1970-01-01T00:00:00.000Z".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppSnapshot {
    pub preferences: Preferences,
    pub companion: CompanionRecord,
}

pub struct Database(pub(crate) Mutex<Connection>);

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|e| format!("SQLite integrity check could not run: {e}"))?;
        if integrity != "ok" {
            return Err(format!("SQLite integrity check failed: {integrity}"));
        }
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        migrate(&connection).map_err(|e| format!("Database migration failed: {e}"))?;
        crate::challenges::seed(&connection)
            .map_err(|e| format!("Challenge library could not load: {e}"))?;
        connection.execute("UPDATE focus_sessions SET status = 'paused', run_started_at_ms = NULL WHERE status = 'running'", [])
            .map_err(|e| format!("Could not recover interrupted focus sessions: {e}"))?;
        Ok(Self(Mutex::new(connection)))
    }

    pub fn load(&self) -> Result<AppSnapshot, String> {
        let conn = self.0.lock().map_err(|_| "database lock failed")?;
        let read = |key: &str| -> Result<Option<String>, String> {
            conn.query_row("SELECT value FROM app_state WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())
        };
        let preferences = match read("preferences")? {
            Some(value) => {
                serde_json::from_str(&value).map_err(|e| format!("Invalid preferences: {e}"))?
            }
            None => Preferences::default(),
        };
        let companion = match read("companion")? {
            Some(value) => serde_json::from_str(&value)
                .map_err(|e| format!("Invalid companion record: {e}"))?,
            None => CompanionRecord::default(),
        };
        Ok(AppSnapshot {
            preferences,
            companion,
        })
    }

    pub fn save(&self, snapshot: &AppSnapshot) -> Result<(), String> {
        if snapshot.preferences.display_name.chars().count() > 60 {
            return Err("Display name is too long".into());
        }
        if !["quiet", "balanced", "playful"].contains(&snapshot.preferences.engagement.as_str()) {
            return Err("Invalid engagement preference".into());
        }
        if ![
            "awake",
            "happy",
            "curious",
            "relaxed",
            "bored",
            "sleepy",
            "sleeping",
            "startled",
            "affectionate",
            "focused",
            "celebrating",
        ]
        .contains(&snapshot.companion.state.as_str())
        {
            return Err("Invalid companion state".into());
        }
        let mut conn = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (key, value) in [
            (
                "preferences",
                serde_json::to_string(&snapshot.preferences).map_err(|e| e.to_string())?,
            ),
            (
                "companion",
                serde_json::to_string(&snapshot.companion).map_err(|e| e.to_string())?,
            ),
        ] {
            tx.execute("INSERT INTO app_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}

pub(crate) fn migrate(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("Could not read database schema version: {e}"))?;
    if version > 6 {
        return Err(format!(
            "Database schema version {version} is newer than supported version 6"
        ));
    }
    if version == 0 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
            CREATE TABLE reward_events (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL, UNIQUE(kind, source_id));
            CREATE TABLE earned_achievements (definition_id TEXT NOT NULL, rule_version INTEGER NOT NULL, event_id TEXT NOT NULL REFERENCES reward_events(id), earned_at TEXT NOT NULL, PRIMARY KEY(definition_id, rule_version));
            CREATE TABLE cosmetic_unlocks (cosmetic_id TEXT PRIMARY KEY NOT NULL, source_event_id TEXT NOT NULL REFERENCES reward_events(id), unlocked_at TEXT NOT NULL);
            PRAGMA user_version = 1; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    if version < 2 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal',
                due_date TEXT, due_time TEXT, subtasks_json TEXT NOT NULL DEFAULT '[]',
                reminder_offset_minutes INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
                completed_at_ms INTEGER, first_completed_at_ms INTEGER
            );
            CREATE INDEX tasks_due ON tasks(due_date, due_time);
            CREATE TABLE focus_sessions (
                id TEXT PRIMARY KEY NOT NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                status TEXT NOT NULL, duration_minutes INTEGER NOT NULL, break_minutes INTEGER NOT NULL,
                started_at_ms INTEGER NOT NULL, run_started_at_ms INTEGER, elapsed_ms INTEGER NOT NULL DEFAULT 0,
                finished_at_ms INTEGER
            );
            CREATE UNIQUE INDEX one_active_focus ON focus_sessions((1)) WHERE status IN ('running', 'paused');
            CREATE TABLE focus_defaults (id INTEGER PRIMARY KEY CHECK(id = 1), duration_minutes INTEGER NOT NULL, break_minutes INTEGER NOT NULL);
            INSERT INTO focus_defaults VALUES (1, 25, 5);
            CREATE TABLE pip_customization (id INTEGER PRIMARY KEY CHECK(id = 1), style_id TEXT NOT NULL, scarf INTEGER NOT NULL, headphones INTEGER NOT NULL);
            INSERT INTO pip_customization VALUES (1, 'classic', 0, 0);
            ALTER TABLE reward_events ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
            PRAGMA user_version = 2; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    if version < 3 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE calendar_events (
                id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
                start_date TEXT NOT NULL, start_time TEXT, end_date TEXT NOT NULL, end_time TEXT,
                all_day INTEGER NOT NULL, time_zone TEXT NOT NULL,
                start_at_ms INTEGER, end_at_ms INTEGER, reminder_offset_minutes INTEGER,
                created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX calendar_events_start ON calendar_events(start_date, start_time);
            CREATE TABLE reminder_preferences (
                id INTEGER PRIMARY KEY CHECK(id = 1), enabled INTEGER NOT NULL,
                quiet_start TEXT NOT NULL, quiet_end TEXT NOT NULL
            );
            INSERT INTO reminder_preferences VALUES (1, 1, '22:00', '08:00');
            CREATE TABLE reminder_deliveries (
                source_kind TEXT NOT NULL, source_id TEXT NOT NULL, scheduled_at_ms INTEGER NOT NULL,
                delivered_at_ms INTEGER NOT NULL, PRIMARY KEY(source_kind,source_id,scheduled_at_ms)
            );
            PRAGMA user_version = 3; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    if version < 4 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE engineering_projects (
                id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
                discipline TEXT NOT NULL, category TEXT NOT NULL, project_type TEXT NOT NULL,
                software_json TEXT NOT NULL DEFAULT '[]', start_date TEXT, target_date TEXT,
                status TEXT NOT NULL CHECK(status IN ('Planning','In Progress','On Hold','Completed','Archived')),
                priority TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
                completed_at_ms INTEGER, portfolio_candidate INTEGER NOT NULL DEFAULT 0,
                portfolio_summary TEXT NOT NULL DEFAULT '', objectives TEXT NOT NULL DEFAULT '',
                contributions TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '',
                decisions TEXT NOT NULL DEFAULT '', lessons TEXT NOT NULL DEFAULT ''
            );
            ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES engineering_projects(id) ON DELETE SET NULL;
            CREATE INDEX tasks_project ON tasks(project_id);
            CREATE TABLE project_milestones (
                id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES engineering_projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL, description TEXT NOT NULL, target_date TEXT NOT NULL,
                completed_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
            );
            CREATE INDEX milestones_date ON project_milestones(target_date);
            CREATE TABLE project_files (
                id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES engineering_projects(id) ON DELETE CASCADE,
                display_name TEXT NOT NULL, path TEXT NOT NULL, category TEXT NOT NULL,
                description TEXT NOT NULL, added_at_ms INTEGER NOT NULL
            );
            CREATE TABLE project_journal (
                id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES engineering_projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL, entry_date TEXT NOT NULL, description TEXT NOT NULL,
                work_completed TEXT NOT NULL, problems TEXT NOT NULL, solutions TEXT NOT NULL,
                skills TEXT NOT NULL, file_ids_json TEXT NOT NULL DEFAULT '[]',
                created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
            );
            PRAGMA user_version = 4; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    if version < 5 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE challenge_definitions (id TEXT PRIMARY KEY, track TEXT NOT NULL, discipline TEXT NOT NULL, difficulty TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE challenge_versions (challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), version INTEGER NOT NULL, content_json TEXT NOT NULL, PRIMARY KEY(challenge_id,version));
            CREATE TABLE learning_pathways (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, track TEXT NOT NULL);
            CREATE TABLE pathway_challenges (pathway_id TEXT NOT NULL REFERENCES learning_pathways(id), challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), position INTEGER NOT NULL, PRIMARY KEY(pathway_id,challenge_id), UNIQUE(pathway_id,position));
            CREATE TABLE challenge_prerequisites (challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), prerequisite_id TEXT NOT NULL REFERENCES challenge_definitions(id), PRIMARY KEY(challenge_id,prerequisite_id), CHECK(challenge_id<>prerequisite_id));
            CREATE TABLE challenge_settings (id INTEGER PRIMARY KEY CHECK(id=1), automatic INTEGER NOT NULL DEFAULT 0, tracks_json TEXT NOT NULL DEFAULT '[\"AutoCAD\",\"Civil 3D\",\"Revit\"]', difficulties_json TEXT NOT NULL DEFAULT '[\"Beginner\",\"Intermediate\",\"Advanced\"]', weekly_count INTEGER NOT NULL DEFAULT 2 CHECK(weekly_count BETWEEN 1 AND 9));
            INSERT INTO challenge_settings(id) VALUES (1);
            CREATE TABLE weekly_challenges (id TEXT PRIMARY KEY, week_start TEXT NOT NULL, challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), content_version INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('automatic','manual')), status TEXT NOT NULL CHECK(status IN ('Not Started','In Progress','Completed','Skipped')), created_at_ms INTEGER NOT NULL, UNIQUE(week_start,challenge_id), FOREIGN KEY(challenge_id,content_version) REFERENCES challenge_versions(challenge_id,version));
            CREATE INDEX weekly_challenges_week ON weekly_challenges(week_start);
            CREATE TABLE challenge_progress (challenge_id TEXT PRIMARY KEY REFERENCES challenge_definitions(id), content_version INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('guided','brief')), status TEXT NOT NULL CHECK(status IN ('In Progress','Completed','Skipped')), notes TEXT NOT NULL DEFAULT '', deadline_date TEXT, started_at_ms INTEGER NOT NULL, completed_at_ms INTEGER, updated_at_ms INTEGER NOT NULL, FOREIGN KEY(challenge_id,content_version) REFERENCES challenge_versions(challenge_id,version));
            CREATE TABLE challenge_checks (challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), content_version INTEGER NOT NULL, item_index INTEGER NOT NULL, checked INTEGER NOT NULL, PRIMARY KEY(challenge_id,content_version,item_index), FOREIGN KEY(challenge_id,content_version) REFERENCES challenge_versions(challenge_id,version));
            CREATE TABLE challenge_evidence (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), display_name TEXT NOT NULL, path TEXT NOT NULL, category TEXT NOT NULL, added_at_ms INTEGER NOT NULL, UNIQUE(challenge_id,path));
            CREATE TABLE engineering_skills (id TEXT PRIMARY KEY, title TEXT NOT NULL, track TEXT NOT NULL);
            CREATE TABLE challenge_skills (challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), skill_id TEXT NOT NULL REFERENCES engineering_skills(id), PRIMARY KEY(challenge_id,skill_id));
            CREATE TABLE challenge_projects (challenge_id TEXT NOT NULL REFERENCES challenge_definitions(id), project_id TEXT NOT NULL REFERENCES engineering_projects(id) ON DELETE CASCADE, created_at_ms INTEGER NOT NULL, created_from_challenge INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(challenge_id,project_id));
            CREATE UNIQUE INDEX challenge_one_created_project ON challenge_projects(challenge_id) WHERE created_from_challenge=1;
            CREATE TABLE engineering_events (kind TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL, PRIMARY KEY(kind,source_id));
            PRAGMA user_version = 5; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    if version < 6 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE semesters (
                id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, institution TEXT NOT NULL DEFAULT '',
                start_date TEXT NOT NULL, end_date TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
                archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
                created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
                CHECK(end_date >= start_date), CHECK(NOT (is_active = 1 AND archived = 1))
            );
            CREATE UNIQUE INDEX one_active_semester ON semesters((1)) WHERE is_active = 1;
            CREATE TABLE courses (
                id TEXT PRIMARY KEY NOT NULL, semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
                code TEXT NOT NULL, name TEXT NOT NULL, instructor TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '', meeting_schedule TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
                archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
                created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX courses_semester_code ON courses(semester_id, code COLLATE NOCASE);
            CREATE TABLE task_academic (
                task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
                work_type TEXT NOT NULL CHECK(work_type IN ('assignment','quiz','exam','general')),
                reference_notes TEXT NOT NULL DEFAULT '', created_at_ms INTEGER NOT NULL
            );
            CREATE INDEX task_academic_course ON task_academic(course_id);
            PRAGMA user_version = 6; COMMIT;")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_path() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "civildesk-test-{}-{nanos}.sqlite3",
            std::process::id()
        ))
    }
    #[test]
    fn migration_and_round_trip() {
        let db = Database(Mutex::new(Connection::open_in_memory().unwrap()));
        migrate(&db.0.lock().unwrap()).unwrap();
        migrate(&db.0.lock().unwrap()).unwrap();
        let mut snapshot = db.load().unwrap();
        snapshot.preferences.display_name = "Alex".into();
        snapshot.companion.state = "sleeping".into();
        db.save(&snapshot).unwrap();
        let loaded = db.load().unwrap();
        assert_eq!(loaded.preferences.display_name, "Alex");
        assert_eq!(loaded.companion.state, "sleeping");
    }
    #[test]
    fn rejects_invalid_state() {
        let db = Database(Mutex::new(Connection::open_in_memory().unwrap()));
        migrate(&db.0.lock().unwrap()).unwrap();
        let mut snapshot = AppSnapshot::default();
        snapshot.companion.state = "unknown".into();
        assert!(db.save(&snapshot).is_err());
    }

    #[test]
    fn reopening_preserves_data_and_migration_version() {
        let path = unique_test_path();
        {
            let db = Database::open(&path).unwrap();
            let mut snapshot = AppSnapshot::default();
            snapshot.preferences.display_name = "Alex".into();
            snapshot.preferences.onboarding_complete = true;
            snapshot.preferences.pip_visible = false;
            db.save(&snapshot).unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            let snapshot = db.load().unwrap();
            assert_eq!(snapshot.preferences.display_name, "Alex");
            assert!(snapshot.preferences.onboarding_complete);
            assert!(!snapshot.preferences.pip_visible);
            let version: u32 =
                db.0.lock()
                    .unwrap()
                    .pragma_query_value(None, "user_version", |row| row.get(0))
                    .unwrap();
            assert_eq!(version, 6);
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn corrupt_database_is_rejected_without_replacement() {
        let path = unique_test_path();
        let bytes = b"not a SQLite database";
        std::fs::write(&path, bytes).unwrap();
        assert!(Database::open(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn newer_schema_is_rejected_without_changing_data() {
        let path = unique_test_path();
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_state VALUES ('marker', 'keep'); PRAGMA user_version = 7;").unwrap();
        }
        assert!(Database::open(&path).is_err());
        let connection = Connection::open(&path).unwrap();
        let marker: String = connection
            .query_row(
                "SELECT value FROM app_state WHERE key='marker'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker, "keep");
        drop(connection);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn phase_one_database_migrates_without_losing_preferences() {
        let path = unique_test_path();
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE reward_events (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL, UNIQUE(kind, source_id));
                CREATE TABLE earned_achievements (definition_id TEXT NOT NULL, rule_version INTEGER NOT NULL, event_id TEXT NOT NULL REFERENCES reward_events(id), earned_at TEXT NOT NULL, PRIMARY KEY(definition_id, rule_version));
                CREATE TABLE cosmetic_unlocks (cosmetic_id TEXT PRIMARY KEY NOT NULL, source_event_id TEXT NOT NULL REFERENCES reward_events(id), unlocked_at TEXT NOT NULL);
                INSERT INTO app_state VALUES ('preferences', '{\"displayName\":\"Alex\",\"onboardingComplete\":true,\"pipVisible\":true,\"engagement\":\"balanced\",\"reducedMotion\":false,\"focusMode\":false,\"sidebarCollapsed\":false,\"dashboardPipEnabled\":true}');
                PRAGMA user_version = 1;").unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.load().unwrap().preferences.display_name, "Alex");
        assert_eq!(db.workspace().unwrap().tasks.len(), 0);
        let version: i64 =
            db.0.lock()
                .unwrap()
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap();
        assert_eq!(version, 6);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn version_three_migration_preserves_tasks_and_adds_project_link() {
        let path = unique_test_path();
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,due_date TEXT,due_time TEXT,subtasks_json TEXT NOT NULL,reminder_offset_minutes INTEGER,created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL,completed_at_ms INTEGER,first_completed_at_ms INTEGER);
                INSERT INTO tasks VALUES ('existing','Original task','','','normal',NULL,NULL,'[]',NULL,1,1,NULL,NULL);
                CREATE TABLE focus_sessions (id TEXT PRIMARY KEY,status TEXT NOT NULL,run_started_at_ms INTEGER);
                PRAGMA user_version = 3;").unwrap();
        }
        let db = Database::open(&path).unwrap();
        let c = db.0.lock().unwrap();
        let (title, project_id): (String, Option<String>) = c
            .query_row(
                "SELECT title,project_id FROM tasks WHERE id='existing'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Original task");
        assert_eq!(project_id, None);
        let version: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 6);
        drop(c);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
