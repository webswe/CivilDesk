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
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&connection)?;
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

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 1 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if version == 0 {
        conn.execute_batch("BEGIN IMMEDIATE;
            CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
            CREATE TABLE reward_events (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL, UNIQUE(kind, source_id));
            CREATE TABLE earned_achievements (definition_id TEXT NOT NULL, rule_version INTEGER NOT NULL, event_id TEXT NOT NULL REFERENCES reward_events(id), earned_at TEXT NOT NULL, PRIMARY KEY(definition_id, rule_version));
            CREATE TABLE cosmetic_unlocks (cosmetic_id TEXT PRIMARY KEY NOT NULL, source_event_id TEXT NOT NULL REFERENCES reward_events(id), unlocked_at TEXT NOT NULL);
            PRAGMA user_version = 1; COMMIT;")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
