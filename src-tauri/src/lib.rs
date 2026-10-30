mod persistence;

use persistence::{AppSnapshot, Database};
use tauri::Manager;

struct RuntimeState {
    database: Option<Database>,
    initialization_error: Option<String>,
}

impl RuntimeState {
    fn database(&self) -> Result<&Database, String> {
        self.database.as_ref().ok_or_else(|| {
            self.initialization_error
                .clone()
                .unwrap_or_else(|| "The CivilDesk database is unavailable.".into())
        })
    }
}

#[tauri::command]
fn load_snapshot(state: tauri::State<'_, RuntimeState>) -> Result<AppSnapshot, String> {
    state
        .database()?
        .load()
        .map_err(|e| format!("Could not load CivilDesk data: {e}"))
}

#[tauri::command]
fn save_snapshot(
    state: tauri::State<'_, RuntimeState>,
    snapshot: AppSnapshot,
) -> Result<(), String> {
    state
        .database()?
        .save(&snapshot)
        .map_err(|e| format!("Could not save CivilDesk data: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let result = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not locate the CivilDesk data directory: {e}"))
                .and_then(|path| {
                    std::fs::create_dir_all(&path).map_err(|e| {
                        format!("Could not create the CivilDesk data directory: {e}")
                    })?;
                    Database::open(&path.join("civildesk.sqlite3"))
                        .map_err(|e| format!("Could not initialize the CivilDesk database: {e}"))
                });
            let state = match result {
                Ok(database) => RuntimeState {
                    database: Some(database),
                    initialization_error: None,
                },
                Err(message) => RuntimeState {
                    database: None,
                    initialization_error: Some(message),
                },
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_snapshot, save_snapshot])
        .run(tauri::generate_context!())
        .expect("CivilDesk could not start");
}
