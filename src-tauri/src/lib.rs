mod persistence;

use persistence::{AppSnapshot, Database};
use tauri::Manager;

#[tauri::command]
fn load_snapshot(db: tauri::State<'_, Database>) -> Result<AppSnapshot, String> {
    db.load()
        .map_err(|e| format!("Could not load CivilDesk data: {e}"))
}

#[tauri::command]
fn save_snapshot(db: tauri::State<'_, Database>, snapshot: AppSnapshot) -> Result<(), String> {
    db.save(&snapshot)
        .map_err(|e| format!("Could not save CivilDesk data: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let db = Database::open(&app_data.join("civildesk.sqlite3"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_snapshot, save_snapshot])
        .run(tauri::generate_context!())
        .expect("CivilDesk could not start");
}
