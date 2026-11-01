mod academic;
mod calendar;
mod challenges;
mod dates;
mod persistence;
mod personal;
mod portfolio;
mod productivity;
mod projects;
mod study;

use academic::{AcademicData, CourseInput, CourseworkInput, SemesterInput};
use calendar::CalendarInput;
use challenges::ChallengeSettings;
use persistence::{AppSnapshot, Database};
use personal::{
    GoalEntryInput, GoalInput, HabitInput, PersonalData, RecurrenceInput, RoutineInput,
};
use portfolio::{CaseStudyInput, ExportResult, PortfolioData, PreviewResult, ToolInput};
use productivity::{TaskInput, WorkspaceData};
use projects::{FileReference, JournalEntry, Milestone, Project, ProjectsData};
use study::{StudyBlockInput, StudyData, StudyGoal};
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
#[allow(clippy::too_many_arguments)]
fn focus_action(
    state: tauri::State<'_, RuntimeState>,
    action: String,
    id: String,
    task_id: Option<String>,
    duration: i64,
    break_minutes: i64,
    course_id: Option<String>,
    study_block_id: Option<String>,
) -> Result<(), String> {
    state.database()?.focus_action(
        &action,
        &id,
        task_id.as_deref(),
        duration,
        break_minutes,
        course_id.as_deref(),
        study_block_id.as_deref(),
    )
}

#[tauri::command]
fn load_study(state: tauri::State<'_, RuntimeState>) -> Result<StudyData, String> {
    state.database()?.study()
}
#[tauri::command]
fn save_study_block(
    state: tauri::State<'_, RuntimeState>,
    block: StudyBlockInput,
) -> Result<(), String> {
    state.database()?.save_study_block(block)
}
#[tauri::command]
fn set_study_block_cancelled(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    cancelled: bool,
) -> Result<(), String> {
    state.database()?.set_study_block_cancelled(&id, cancelled)
}
#[tauri::command]
fn save_study_goal(state: tauri::State<'_, RuntimeState>, goal: StudyGoal) -> Result<(), String> {
    state.database()?.save_study_goal(goal)
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

#[tauri::command]
fn load_academic(state: tauri::State<'_, RuntimeState>) -> Result<AcademicData, String> {
    state.database()?.academic()
}
#[tauri::command]
fn save_semester(
    state: tauri::State<'_, RuntimeState>,
    semester: SemesterInput,
) -> Result<(), String> {
    state.database()?.save_semester(semester)
}
#[tauri::command]
fn set_active_semester(
    state: tauri::State<'_, RuntimeState>,
    id: Option<String>,
) -> Result<(), String> {
    state.database()?.set_active_semester(id.as_deref())
}
#[tauri::command]
fn set_semester_archived(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    state.database()?.set_semester_archived(&id, archived)
}
#[tauri::command]
fn save_course(state: tauri::State<'_, RuntimeState>, course: CourseInput) -> Result<(), String> {
    state.database()?.save_course(course)
}
#[tauri::command]
fn set_course_archived(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    state.database()?.set_course_archived(&id, archived)
}
#[tauri::command]
fn save_coursework(
    state: tauri::State<'_, RuntimeState>,
    coursework: CourseworkInput,
) -> Result<(), String> {
    state.database()?.save_coursework(coursework)
}
#[tauri::command]
fn unlink_coursework(state: tauri::State<'_, RuntimeState>, task_id: String) -> Result<(), String> {
    state.database()?.unlink_coursework(&task_id)
}

#[tauri::command]
fn load_personal(state: tauri::State<'_, RuntimeState>) -> Result<PersonalData, String> {
    state.database()?.personal()
}
#[tauri::command]
fn save_goal(
    state: tauri::State<'_, RuntimeState>,
    goal: GoalInput,
    today: String,
) -> Result<(), String> {
    state.database()?.save_goal(goal, &today)
}
#[tauri::command]
fn set_goal_status(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    status: String,
) -> Result<(), String> {
    state.database()?.set_goal_status(&id, &status)
}
#[tauri::command]
fn add_goal_entry(
    state: tauri::State<'_, RuntimeState>,
    entry: GoalEntryInput,
    today: String,
) -> Result<(), String> {
    state.database()?.add_goal_entry(entry, &today)
}
#[tauri::command]
fn void_goal_entry(state: tauri::State<'_, RuntimeState>, id: String) -> Result<(), String> {
    state.database()?.void_goal_entry(&id)
}
#[tauri::command]
fn save_habit(
    state: tauri::State<'_, RuntimeState>,
    habit: HabitInput,
    today: String,
) -> Result<(), String> {
    state.database()?.save_habit(habit, &today)
}
#[tauri::command]
fn set_habit_status(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    status: String,
) -> Result<(), String> {
    state.database()?.set_habit_status(&id, &status)
}
#[tauri::command]
fn set_habit_checkin(
    state: tauri::State<'_, RuntimeState>,
    habit_id: String,
    date: String,
    done: bool,
    today: String,
) -> Result<(), String> {
    state
        .database()?
        .set_habit_checkin(&habit_id, &date, done, &today)
}
#[tauri::command]
fn save_routine(
    state: tauri::State<'_, RuntimeState>,
    routine: RoutineInput,
) -> Result<(), String> {
    state.database()?.save_routine(routine)
}
#[tauri::command]
fn set_routine_status(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    status: String,
) -> Result<(), String> {
    state.database()?.set_routine_status(&id, &status)
}
#[tauri::command]
fn start_routine(
    state: tauri::State<'_, RuntimeState>,
    routine_id: String,
    execution_id: String,
    date: String,
    today: String,
) -> Result<(), String> {
    state
        .database()?
        .start_routine(&routine_id, &execution_id, &date, &today)
}
#[tauri::command]
fn set_routine_step(
    state: tauri::State<'_, RuntimeState>,
    execution_id: String,
    position: i64,
    done: bool,
) -> Result<(), String> {
    state
        .database()?
        .set_routine_step(&execution_id, position, done)
}
#[tauri::command]
fn complete_routine(
    state: tauri::State<'_, RuntimeState>,
    execution_id: String,
) -> Result<(), String> {
    state.database()?.complete_routine(&execution_id)
}
#[tauri::command]
fn save_recurrence(
    state: tauri::State<'_, RuntimeState>,
    rule: RecurrenceInput,
    today: String,
) -> Result<(), String> {
    state.database()?.save_recurrence(rule, &today)
}
#[tauri::command]
fn set_recurrence_status(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    status: String,
    today: String,
) -> Result<(), String> {
    state
        .database()?
        .set_recurrence_status(&id, &status, &today)
}
#[tauri::command]
fn skip_occurrence(state: tauri::State<'_, RuntimeState>, task_id: String) -> Result<(), String> {
    state.database()?.skip_occurrence(&task_id)
}
#[tauri::command]
fn restore_occurrence(
    state: tauri::State<'_, RuntimeState>,
    rule_id: String,
    date: String,
    today: String,
) -> Result<(), String> {
    state
        .database()?
        .restore_occurrence(&rule_id, &date, &today)
}
#[tauri::command]
fn generate_recurring(state: tauri::State<'_, RuntimeState>, today: String) -> Result<(), String> {
    state.database()?.generate_recurring(&today)
}
#[tauri::command]
fn set_daily_priorities(
    state: tauri::State<'_, RuntimeState>,
    date: String,
    task_ids: Vec<String>,
    today: String,
) -> Result<(), String> {
    state
        .database()?
        .set_daily_priorities(&date, &task_ids, &today)
}
#[tauri::command]
fn load_portfolio(state: tauri::State<'_, RuntimeState>) -> Result<PortfolioData, String> {
    state.database()?.portfolio()
}
#[tauri::command]
fn save_case_study(
    state: tauri::State<'_, RuntimeState>,
    input: CaseStudyInput,
) -> Result<(), String> {
    state.database()?.save_case_study(input)
}
#[tauri::command]
fn set_portfolio_tools(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
    tools: Vec<ToolInput>,
) -> Result<(), String> {
    state.database()?.set_portfolio_tools(&project_id, tools)
}
#[tauri::command]
fn set_portfolio_milestones(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
    milestone_ids: Vec<String>,
) -> Result<(), String> {
    state
        .database()?
        .set_portfolio_milestones(&project_id, milestone_ids)
}
#[tauri::command]
fn add_gallery_image(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
    path: String,
) -> Result<(), String> {
    state.database()?.add_gallery_image(&project_id, &path)
}
#[tauri::command]
fn save_gallery_item(
    state: tauri::State<'_, RuntimeState>,
    id: String,
    caption: String,
    alt_text: String,
) -> Result<(), String> {
    state
        .database()?
        .save_gallery_item(&id, &caption, &alt_text)
}
#[tauri::command]
fn reorder_gallery(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    state.database()?.reorder_gallery(&project_id, ids)
}
#[tauri::command]
fn remove_gallery_item(state: tauri::State<'_, RuntimeState>, id: String) -> Result<(), String> {
    state.database()?.remove_gallery_item(&id)
}
#[tauri::command]
fn gallery_image_data(state: tauri::State<'_, RuntimeState>, id: String) -> Result<String, String> {
    state.database()?.gallery_image_data(&id)
}
#[tauri::command]
fn preview_case_study(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
) -> Result<PreviewResult, String> {
    state.database()?.preview_case_study(&project_id)
}
#[tauri::command]
fn export_case_study(
    state: tauri::State<'_, RuntimeState>,
    project_id: String,
    destination: String,
    overwrite: bool,
) -> Result<ExportResult, String> {
    state
        .database()?
        .export_case_study(&project_id, &destination, overwrite)
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
            load_portfolio,
            save_case_study,
            set_portfolio_tools,
            set_portfolio_milestones,
            add_gallery_image,
            save_gallery_item,
            reorder_gallery,
            remove_gallery_item,
            gallery_image_data,
            preview_case_study,
            export_case_study,
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
            create_challenge_project,
            load_academic,
            save_semester,
            set_active_semester,
            set_semester_archived,
            save_course,
            set_course_archived,
            save_coursework,
            unlink_coursework,
            load_study,
            save_study_block,
            set_study_block_cancelled,
            save_study_goal,
            load_personal,
            save_goal,
            set_goal_status,
            add_goal_entry,
            void_goal_entry,
            save_habit,
            set_habit_status,
            set_habit_checkin,
            save_routine,
            set_routine_status,
            start_routine,
            set_routine_step,
            complete_routine,
            save_recurrence,
            set_recurrence_status,
            skip_occurrence,
            restore_occurrence,
            generate_recurring,
            set_daily_priorities
        ])
        .run(tauri::generate_context!())
        .expect("CivilDesk could not start");
}
