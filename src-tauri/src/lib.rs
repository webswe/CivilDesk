mod persistence;
mod productivity;

use persistence::{AppSnapshot, Database};
use productivity::{TaskInput, WorkspaceData};
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

#[tauri::command]
fn load_workspace(state: tauri::State<'_, RuntimeState>) -> Result<WorkspaceData, String> {
    state.database()?.workspace()
}

#[tauri::command]
fn save_task(state: tauri::State<'_, RuntimeState>, task: TaskInput) -> Result<(), String> {
    state.database()?.save_task(task)
}

#[tauri::command]
fn delete_task(state: tauri::State<'_, RuntimeState>, id: String) -> Result<(), String> {
    state.database()?.delete_task(&id)
}

#[tauri::command]
fn set_task_completed(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    completed: bool,
) -> Result<(), String> {
    state.database()?.set_task_completed(&id, completed)
}

#[tauri::command]
fn set_focus_defaults(
    state: tauri::State<'_, RuntimeState>,
    duration: i64,
    break_minutes: i64,
) -> Result<(), String> {
    state
        .database()?
        .set_focus_defaults(duration, break_minutes)
}

#[tauri::command]
fn focus_action(
    state: tauri::State<'_, RuntimeState>,
    action: String,
    id: String,
    task_id: Option<String>,
    duration: i64,
    break_minutes: i64,
) -> Result<(), String> {
    state
        .database()?
        .focus_action(&action, &id, task_id.as_deref(), duration, break_minutes)
}

#[tauri::command]
fn equip_cosmetic(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    equipped: bool,
) -> Result<(), String> {
    state.database()?.equip_cosmetic(&id, equipped)
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
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            save_snapshot,
            load_workspace,
            save_task,
            delete_task,
            set_task_completed,
            set_focus_defaults,
            focus_action,
            equip_cosmetic
        ])
        .run(tauri::generate_context!())
        .expect("CivilDesk could not start");
}
