mod calendar;
mod challenges;
mod persistence;
mod productivity;
mod projects;

use calendar::CalendarInput;
use challenges::ChallengeSettings;
use persistence::{AppSnapshot, Database};
use productivity::{TaskInput, WorkspaceData};
use projects::{FileReference, JournalEntry, Milestone, Project, ProjectsData};
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

#[tauri::command]
fn save_event(state: tauri::State<'_, RuntimeState>, event: CalendarInput) -> Result<(), String> {
    state.database()?.save_event(event)
}

#[tauri::command]
fn delete_event(state: tauri::State<'_, RuntimeState>, id: String) -> Result<(), String> {
    state.database()?.delete_event(&id)
}

#[tauri::command]
fn save_reminder_preferences(
    state: tauri::State<'_, RuntimeState>,
    enabled: bool,
    quiet_start: String,
    quiet_end: String,
) -> Result<(), String> {
    state
        .database()?
        .save_reminder_preferences(enabled, &quiet_start, &quiet_end)
}

#[tauri::command]
fn claim_reminder(
    state: tauri::State<'_, RuntimeState>,
    kind: String,
    id: String,
    scheduled_at_ms: i64,
) -> Result<bool, String> {
    state
        .database()?
        .claim_reminder(&kind, &id, scheduled_at_ms)
}

#[tauri::command]
fn load_projects(state: tauri::State<'_, RuntimeState>) -> Result<ProjectsData, String> {
    state.database()?.projects()
}
#[tauri::command]
fn save_project(state: tauri::State<'_, RuntimeState>, project: Project) -> Result<(), String> {
    state.database()?.save_project(project)
}
#[tauri::command]
fn save_milestone(
    state: tauri::State<'_, RuntimeState>,
    milestone: Milestone,
) -> Result<(), String> {
    state.database()?.save_milestone(milestone)
}
#[tauri::command]
fn set_milestone_completed(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    completed: bool,
) -> Result<(), String> {
    state.database()?.set_milestone_completed(&id, completed)
}
#[tauri::command]
fn delete_project_item(
    state: tauri::State<'_, RuntimeState>,
    kind: String,
    id: String,
) -> Result<(), String> {
    state.database()?.delete_project_item(&kind, &id)
}
#[tauri::command]
fn associate_task(
    state: tauri::State<'_, RuntimeState>,
    task_id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    state
        .database()?
        .associate_task(&task_id, project_id.as_deref())
}
#[tauri::command]
fn save_project_file(
    state: tauri::State<'_, RuntimeState>,
    file: FileReference,
) -> Result<(), String> {
    state.database()?.save_file(file)
}
#[tauri::command]
fn open_project_file(state: tauri::State<'_, RuntimeState>, id: String) -> Result<(), String> {
    state.database()?.open_file(&id)
}
#[tauri::command]
fn save_journal_entry(
    state: tauri::State<'_, RuntimeState>,
    entry: JournalEntry,
) -> Result<(), String> {
    state.database()?.save_journal(entry)
}

#[tauri::command]
fn load_challenges(
    state: tauri::State<'_, RuntimeState>,
) -> Result<challenges::ChallengeData, String> {
    state.database()?.challenges()
}
#[tauri::command]
fn save_challenge_settings(
    state: tauri::State<'_, RuntimeState>,
    settings: ChallengeSettings,
) -> Result<(), String> {
    state.database()?.challenge_settings(settings)
}
#[tauri::command]
fn assign_week(
    state: tauri::State<'_, RuntimeState>,
    week: String,
    manual: Option<String>,
) -> Result<(), String> {
    state.database()?.assign_week(&week, manual.as_deref())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn challenge_action(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    action: String,
    week: String,
    mode: Option<String>,
    notes: Option<String>,
    deadline: Option<String>,
    check: Option<i64>,
) -> Result<(), String> {
    state.database()?.challenge_action(
        &id,
        &action,
        &week,
        mode.as_deref(),
        notes.as_deref(),
        deadline.as_deref(),
        check,
    )
}
#[tauri::command]
fn add_challenge_evidence(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    challenge_id: String,
    path: String,
) -> Result<(), String> {
    state.database()?.add_evidence(&id, &challenge_id, &path)
}
#[tauri::command]
fn remove_challenge_evidence(
    state: tauri::State<'_, RuntimeState>,
    id: String,
) -> Result<(), String> {
    state.database()?.remove_evidence(&id)
}
#[tauri::command]
fn link_challenge_project(
    state: tauri::State<'_, RuntimeState>,
    challenge_id: String,
    project_id: String,
) -> Result<(), String> {
    state
        .database()?
        .link_challenge_project(&challenge_id, &project_id)
}
#[tauri::command]
fn create_challenge_project(
    state: tauri::State<'_, RuntimeState>,
    challenge_id: String,
) -> Result<String, String> {
    state.database()?.create_challenge_project(&challenge_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            equip_cosmetic,
            save_event,
            delete_event,
            save_reminder_preferences,
            claim_reminder,
            load_projects,
            save_project,
            save_milestone,
            set_milestone_completed,
            delete_project_item,
            associate_task,
            save_project_file,
            open_project_file,
            save_journal_entry,
            load_challenges,
            save_challenge_settings,
            assign_week,
            challenge_action,
            add_challenge_evidence,
            remove_challenge_evidence,
            link_challenge_project,
            create_challenge_project
        ])
        .run(tauri::generate_context!())
        .expect("CivilDesk could not start");
}
