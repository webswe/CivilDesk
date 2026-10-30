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

pub struct Database(Mutex<Connection>);

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

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("Could not read database schema version: {e}"))?;
    if version > 1 {
        return Err(format!(
            "Database schema version {version} is newer than supported version 1"
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
            assert_eq!(version, 1);
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
            connection.execute_batch("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_state VALUES ('marker', 'keep'); PRAGMA user_version = 2;").unwrap();
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
}
