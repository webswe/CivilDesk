//! Personal productivity (schema v8): goals, habits, routines, recurring responsibilities and daily priorities.
//!
//! Design rules shared by every feature here:
//! * Tasks stay in the one `tasks` table. A recurring responsibility is a *rule* that creates ordinary tasks
//!   (one per date, with a unique `(rule, date)` identity); completing, reopening and rewarding them is the
//!   existing task path. Nothing here awards XP.
//! * "Today" is always passed in by the caller as a local `YYYY-MM-DD` date, so no rule depends on the
//!   machine clock, UTC or daylight saving, and every rule is testable with a fixed date.
//! * History is append-only or snapshotted: schedule and target edits add effective-dated rows, routine
//!   executions copy their steps, goal progress is a list of entries that are voided (never edited).

use crate::dates;
use crate::persistence::Database;
use crate::productivity::{now_ms, upsert_task, valid_date, valid_time, TaskInput};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

pub const MAX_PRIORITIES: usize = 5;
const MAX_ENTRY: i64 = 1_000_000_000;

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}
fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 60 {
        Err("Invalid identifier".into())
    } else {
        Ok(())
    }
}
fn check_date(s: &str, what: &str) -> Result<(), String> {
    if valid_date(s) {
        Ok(())
    } else {
        Err(format!("{what} is not a valid date"))
    }
}
fn check_text(s: &str, what: &str, max: usize) -> Result<String, String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > max {
        Err(format!("{what} must be 1–{max} characters"))
    } else {
        Ok(t.to_string())
    }
}
fn check_optional_text(s: &str, what: &str, max: usize) -> Result<(), String> {
    if s.chars().count() > max {
        Err(format!("{what} is too long"))
    } else {
        Ok(())
    }
}
/// Weekday numbers (0 = Monday) sorted and de-duplicated.
fn clean_days(days: &[u32]) -> Result<Vec<u32>, String> {
    if days.iter().any(|d| *d > 6) {
        return Err("Weekdays must be Monday to Sunday".into());
    }
    let mut out = days.to_vec();
    out.sort_unstable();
    out.dedup();
    Ok(out)
}
fn to_csv(days: &[u32]) -> String {
    days.iter()
        .map(|d| d.to_string())
        .collect::<Vec<_>>()
        .join(",")
}
fn from_csv(s: &str) -> Vec<u32> {
    s.split(',').filter_map(|p| p.trim().parse().ok()).collect()
}
fn period_start(period: &str, date: &str) -> String {
    match period {
        "weekly" => dates::week_start(date),
        "monthly" => dates::month_start(date),
        _ => date.to_string(),
    }
}
fn rows<T>(
    c: &Connection,
    query: &str,
    map: fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, String> {
    c.prepare(query)
        .map_err(err)?
        .query_map([], map)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)
}
fn exists(c: &Connection, query: &str, id: &str) -> Result<bool, String> {
    c.query_row(query, [id], |r| r.get(0)).map_err(err)
}

// ---------------------------------------------------------------- records

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub description: String,
    pub kind: String,
    pub target: Option<i64>,
    pub unit: String,
    pub period: Option<String>,
    pub start_date: String,
    pub target_date: Option<String>,
    pub status: String,
    pub completed_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTarget {
    pub goal_id: String,
    pub effective_from: String,
    pub target: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEntry {
    pub id: String,
    pub goal_id: String,
    pub entry_date: String,
    pub amount: i64,
    pub note: String,
    pub created_at_ms: i64,
    pub voided_at_ms: Option<i64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub start_date: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitSchedule {
    pub habit_id: String,
    pub effective_from: String,
    pub frequency: String,
    pub target_count: i64,
    pub preferred_days: Vec<u32>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitCheckin {
    pub habit_id: String,
    pub occurrence_date: String,
    pub created_at_ms: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineStep {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schedule_days: Vec<u32>,
    pub schedule_time: Option<String>,
    pub status: String,
    pub steps: Vec<RoutineStep>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStep {
    pub position: i64,
    pub step_id: String,
    pub title: String,
    pub done_at_ms: Option<i64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineExecution {
    pub id: String,
    pub routine_id: String,
    pub occurrence_date: String,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub steps: Vec<ExecutionStep>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub frequency: String,
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub due_time: Option<String>,
    pub reminder_offset_minutes: Option<i64>,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub rule_id: String,
    pub occurrence_date: String,
    pub task_id: Option<String>,
    pub status: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPriority {
    pub plan_date: String,
    pub task_id: String,
    pub position: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalData {
    pub goals: Vec<Goal>,
    pub goal_targets: Vec<GoalTarget>,
    pub goal_entries: Vec<GoalEntry>,
    pub habits: Vec<Habit>,
    pub habit_schedules: Vec<HabitSchedule>,
    pub habit_checkins: Vec<HabitCheckin>,
    pub routines: Vec<Routine>,
    pub executions: Vec<RoutineExecution>,
    pub rules: Vec<RecurrenceRule>,
    pub occurrences: Vec<Occurrence>,
    pub priorities: Vec<DailyPriority>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    pub id: String,
    pub title: String,
    pub description: String,
    pub kind: String,
    pub target: Option<i64>,
    pub unit: String,
    pub period: Option<String>,
    pub start_date: String,
    pub target_date: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEntryInput {
    pub id: String,
    pub goal_id: String,
    pub entry_date: String,
    pub amount: i64,
    pub note: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitInput {
    pub id: String,
    pub name: String,
    pub description: String,
    pub frequency: String,
    pub target_count: i64,
    pub preferred_days: Vec<u32>,
    pub start_date: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineStepInput {
    pub id: String,
    pub title: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInput {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schedule_days: Vec<u32>,
    pub schedule_time: Option<String>,
    pub steps: Vec<RoutineStepInput>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceInput {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub frequency: String,
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub due_time: Option<String>,
    pub reminder_offset_minutes: Option<i64>,
}

// ---------------------------------------------------------------- loading

fn goal_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        kind: r.get(3)?,
        target: r.get(4)?,
        unit: r.get(5)?,
        period: r.get(6)?,
        start_date: r.get(7)?,
        target_date: r.get(8)?,
        status: r.get(9)?,
        completed_at_ms: r.get(10)?,
        created_at_ms: r.get(11)?,
        updated_at_ms: r.get(12)?,
    })
}
fn habit_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        start_date: r.get(4)?,
        created_at_ms: r.get(5)?,
        updated_at_ms: r.get(6)?,
    })
}
fn rule_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<RecurrenceRule> {
    let weekdays: String = r.get(6)?;
    Ok(RecurrenceRule {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        priority: r.get(3)?,
        frequency: r.get(5)?,
        weekdays: from_csv(&weekdays),
        month_day: r.get(7)?,
        start_date: r.get(8)?,
        end_date: r.get(9)?,
        due_time: r.get(10)?,
        reminder_offset_minutes: r.get(11)?,
        status: r.get(12)?,
        created_at_ms: r.get(13)?,
        updated_at_ms: r.get(14)?,
    })
}
const RULE_COLUMNS: &str = "id,title,description,priority,category,frequency,weekdays,month_day,start_date,end_date,due_time,reminder_offset_minutes,status,created_at_ms,updated_at_ms";

fn load_rule(c: &Connection, id: &str) -> Result<Option<RecurrenceRule>, String> {
    c.query_row(
        &format!("SELECT {RULE_COLUMNS} FROM recurrence_rules WHERE id=?1"),
        [id],
        rule_row,
    )
    .optional()
    .map_err(err)
}
fn load_goal(c: &Connection, id: &str) -> Result<Option<Goal>, String> {
    c.query_row(
        "SELECT id,title,description,kind,target,unit,period,start_date,target_date,status,completed_at_ms,created_at_ms,updated_at_ms FROM goals WHERE id=?1",
        [id],
        goal_row,
    )
    .optional()
    .map_err(err)
}

fn routines(c: &Connection) -> Result<Vec<Routine>, String> {
    let mut out: Vec<Routine> = c
        .prepare("SELECT id,name,description,schedule_days,schedule_time,status,created_at_ms,updated_at_ms FROM routines ORDER BY created_at_ms,id")
        .map_err(err)?
        .query_map([], |r| {
            let days: String = r.get(3)?;
            Ok(Routine {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                schedule_days: from_csv(&days),
                schedule_time: r.get(4)?,
                status: r.get(5)?,
                steps: vec![],
                created_at_ms: r.get(6)?,
                updated_at_ms: r.get(7)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for routine in out.iter_mut() {
        routine.steps = c
            .prepare("SELECT id,title FROM routine_steps WHERE routine_id=?1 ORDER BY position,id")
            .map_err(err)?
            .query_map([&routine.id], |r| {
                Ok(RoutineStep {
                    id: r.get(0)?,
                    title: r.get(1)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
    }
    Ok(out)
}

fn executions(c: &Connection) -> Result<Vec<RoutineExecution>, String> {
    let mut out: Vec<RoutineExecution> = c
        .prepare("SELECT id,routine_id,occurrence_date,started_at_ms,completed_at_ms FROM routine_executions ORDER BY occurrence_date DESC,started_at_ms DESC LIMIT 400")
        .map_err(err)?
        .query_map([], |r| {
            Ok(RoutineExecution {
                id: r.get(0)?,
                routine_id: r.get(1)?,
                occurrence_date: r.get(2)?,
                started_at_ms: r.get(3)?,
                completed_at_ms: r.get(4)?,
                steps: vec![],
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for e in out.iter_mut() {
        e.steps = c
            .prepare("SELECT position,step_id,title,done_at_ms FROM routine_execution_steps WHERE execution_id=?1 ORDER BY position")
            .map_err(err)?
            .query_map([&e.id], |r| {
                Ok(ExecutionStep {
                    position: r.get(0)?,
                    step_id: r.get(1)?,
                    title: r.get(2)?,
                    done_at_ms: r.get(3)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
    }
    Ok(out)
}

fn read_personal(c: &Connection) -> Result<PersonalData, String> {
    Ok(PersonalData {
        goals: rows(c, "SELECT id,title,description,kind,target,unit,period,start_date,target_date,status,completed_at_ms,created_at_ms,updated_at_ms FROM goals ORDER BY created_at_ms,id", goal_row)?,
        goal_targets: rows(c, "SELECT goal_id,effective_from,target FROM goal_targets ORDER BY goal_id,effective_from", |r| {
            Ok(GoalTarget { goal_id: r.get(0)?, effective_from: r.get(1)?, target: r.get(2)? })
        })?,
        goal_entries: rows(c, "SELECT id,goal_id,entry_date,amount,note,created_at_ms,voided_at_ms FROM goal_entries ORDER BY entry_date,created_at_ms,id", |r| {
            Ok(GoalEntry { id: r.get(0)?, goal_id: r.get(1)?, entry_date: r.get(2)?, amount: r.get(3)?, note: r.get(4)?, created_at_ms: r.get(5)?, voided_at_ms: r.get(6)? })
        })?,
        habits: rows(c, "SELECT id,name,description,status,start_date,created_at_ms,updated_at_ms FROM habits ORDER BY created_at_ms,id", habit_row)?,
        habit_schedules: rows(c, "SELECT habit_id,effective_from,frequency,target_count,preferred_days FROM habit_schedules ORDER BY habit_id,effective_from", |r| {
            let days: String = r.get(4)?;
            Ok(HabitSchedule { habit_id: r.get(0)?, effective_from: r.get(1)?, frequency: r.get(2)?, target_count: r.get(3)?, preferred_days: from_csv(&days) })
        })?,
        habit_checkins: rows(c, "SELECT habit_id,occurrence_date,created_at_ms FROM habit_checkins ORDER BY habit_id,occurrence_date", |r| {
            Ok(HabitCheckin { habit_id: r.get(0)?, occurrence_date: r.get(1)?, created_at_ms: r.get(2)? })
        })?,
        routines: routines(c)?,
        executions: executions(c)?,
        rules: rows(c, &format!("SELECT {RULE_COLUMNS} FROM recurrence_rules ORDER BY created_at_ms,id"), rule_row)?,
        occurrences: rows(c, "SELECT rule_id,occurrence_date,task_id,status FROM recurrence_occurrences ORDER BY occurrence_date DESC LIMIT 600", |r| {
            Ok(Occurrence { rule_id: r.get(0)?, occurrence_date: r.get(1)?, task_id: r.get(2)?, status: r.get(3)? })
        })?,
        priorities: rows(c, "SELECT plan_date,task_id,position FROM daily_priorities ORDER BY plan_date DESC,position LIMIT 600", |r| {
            Ok(DailyPriority { plan_date: r.get(0)?, task_id: r.get(1)?, position: r.get(2)? })
        })?,
    })
}

// ---------------------------------------------------------------- recurrence engine

/// How far ahead occurrences are created. Bounded so an app left closed for months never creates a backlog
/// and a daily rule never fills the task list: only today and a few days ahead exist as tasks.
fn horizon_days(frequency: &str) -> i64 {
    match frequency {
        "daily" => 2,
        "weekly" => 14,
        _ => 35,
    }
}

/// Creates the missing occurrences of one rule for `[today, today + horizon]`. Never creates a date before
/// `today`, and never creates an occurrence twice: `(rule, date)` is the primary key.
fn generate_rule(tx: &Transaction<'_>, rule: &RecurrenceRule, today: &str) -> Result<(), String> {
    if rule.status != "active" {
        return Ok(());
    }
    let to = dates::add_days(today, horizon_days(&rule.frequency));
    let wanted = dates::rule_dates(
        &rule.frequency,
        &rule.weekdays,
        rule.month_day.unwrap_or(1),
        &rule.start_date,
        rule.end_date.as_deref(),
        today,
        &to,
    );
    let now = now_ms();
    for date in wanted {
        let known: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM recurrence_occurrences WHERE rule_id=?1 AND occurrence_date=?2)",
                params![rule.id, date],
                |r| r.get(0),
            )
            .map_err(err)?;
        if known {
            continue;
        }
        let task_id = format!("rec-{}-{}", rule.id, date);
        upsert_task(
            tx,
            &TaskInput {
                id: task_id.clone(),
                title: rule.title.clone(),
                description: rule.description.clone(),
                category: "Personal".into(),
                priority: rule.priority.clone(),
                due_date: Some(date.clone()),
                due_time: rule.due_time.clone(),
                subtasks: vec![],
                reminder_offset_minutes: rule.reminder_offset_minutes,
            },
        )?;
        tx.execute(
            "INSERT INTO recurrence_occurrences(rule_id,occurrence_date,task_id,status,created_at_ms) VALUES (?1,?2,?3,'open',?4)",
            params![rule.id, date, task_id, now],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Removes occurrences after `today` that are still open (never completed, never skipped), so a changed or
/// paused rule does not leave stale future tasks. Completed and skipped occurrences are history and stay.
fn remove_future_open(tx: &Transaction<'_>, rule_id: &str, today: &str) -> Result<(), String> {
    tx.execute(
        "DELETE FROM tasks WHERE completed_at_ms IS NULL AND id IN (SELECT task_id FROM recurrence_occurrences WHERE rule_id=?1 AND status='open' AND task_id IS NOT NULL AND occurrence_date > ?2)",
        params![rule_id, today],
    )
    .map_err(err)?;
    tx.execute(
        "DELETE FROM recurrence_occurrences WHERE rule_id=?1 AND status='open' AND task_id IS NULL AND occurrence_date > ?2",
        params![rule_id, today],
    )
    .map_err(err)?;
    Ok(())
}

fn validate_rule(i: &RecurrenceInput) -> Result<(Vec<u32>, Option<u32>), String> {
    check_id(&i.id)?;
    check_text(&i.title, "Title", 200)?;
    check_optional_text(&i.description, "Description", 10_000)?;
    if !["low", "normal", "high"].contains(&i.priority.as_str()) {
        return Err("Invalid priority".into());
    }
    check_date(&i.start_date, "Start date")?;
    if let Some(end) = &i.end_date {
        check_date(end, "End date")?;
        if end.as_str() < i.start_date.as_str() {
            return Err("The end date cannot be before the start date".into());
        }
    }
    if i.due_time.as_deref().is_some_and(|t| !valid_time(t)) {
        return Err("Invalid due time".into());
    }
    if i.reminder_offset_minutes
        .is_some_and(|v| !(0..=40320).contains(&v))
    {
        return Err("Invalid reminder offset".into());
    }
    match i.frequency.as_str() {
        "daily" => Ok((vec![], None)),
        "weekly" => {
            let days = clean_days(&i.weekdays)?;
            if days.is_empty() {
                return Err("Choose at least one weekday".into());
            }
            Ok((days, None))
        }
        "monthly" => match i.month_day {
            Some(d) if (1..=31).contains(&d) => Ok((vec![], Some(d))),
            _ => Err("Choose a day of the month from 1 to 31".into()),
        },
        _ => Err("Invalid recurrence".into()),
    }
}

// ---------------------------------------------------------------- commands

impl Database {
    pub fn personal(&self) -> Result<PersonalData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        read_personal(&c)
    }

    // ----- goals

    pub fn save_goal(&self, g: GoalInput, today: &str) -> Result<(), String> {
        check_id(&g.id)?;
        let title = check_text(&g.title, "Title", 200)?;
        check_optional_text(&g.description, "Description", 5_000)?;
        check_optional_text(&g.unit, "Unit", 40)?;
        check_date(today, "Today")?;
        check_date(&g.start_date, "Start date")?;
        if let Some(t) = &g.target_date {
            check_date(t, "Target date")?;
            if t.as_str() < g.start_date.as_str() {
                return Err("The target date cannot be before the start date".into());
            }
        }
        let valid_target = g.target.is_some_and(|t| (1..=MAX_ENTRY).contains(&t));
        match g.kind.as_str() {
            "binary" if g.target.is_none() && g.period.is_none() => {}
            "numeric" if valid_target && g.period.is_none() => {}
            "periodic"
                if valid_target
                    && g.period
                        .as_deref()
                        .is_some_and(|p| ["daily", "weekly", "monthly"].contains(&p)) => {}
            "binary" | "numeric" | "periodic" => {
                return Err("Check the goal type, target and period".into())
            }
            _ => return Err("Invalid goal type".into()),
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let now = now_ms();
        match load_goal(&tx, &g.id)? {
            None => {
                tx.execute(
                    "INSERT INTO goals(id,title,description,kind,target,unit,period,start_date,target_date,status,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'active',?10,?10)",
                    params![g.id, title, g.description, g.kind, g.target, g.unit.trim(), g.period, g.start_date, g.target_date, now],
                )
                .map_err(err)?;
                if let (Some(target), Some(period)) = (g.target, g.period.as_deref()) {
                    tx.execute(
                        "INSERT INTO goal_targets(goal_id,effective_from,target) VALUES (?1,?2,?3)",
                        params![g.id, period_start(period, &g.start_date), target],
                    )
                    .map_err(err)?;
                }
            }
            Some(old) => {
                if old.status == "archived" {
                    return Err("Restore this goal before editing it".into());
                }
                if old.kind != g.kind || old.period != g.period {
                    return Err(
                        "A goal's type and period cannot change; create a new goal instead".into(),
                    );
                }
                tx.execute(
                    "UPDATE goals SET title=?2,description=?3,unit=?4,target=?5,target_date=?6,updated_at_ms=?7 WHERE id=?1",
                    params![g.id, title, g.description, g.unit.trim(), g.target, g.target_date, now],
                )
                .map_err(err)?;
                // A periodic target applies from the start of the current period; earlier periods keep theirs.
                if let (Some(target), Some(period)) = (g.target, g.period.as_deref()) {
                    if old.target != Some(target) {
                        tx.execute(
                            "INSERT INTO goal_targets(goal_id,effective_from,target) VALUES (?1,?2,?3) ON CONFLICT(goal_id,effective_from) DO UPDATE SET target=excluded.target",
                            params![g.id, period_start(period, today), target],
                        )
                        .map_err(err)?;
                    }
                }
            }
        }
        tx.commit().map_err(err)
    }

    pub fn set_goal_status(&self, id: &str, status: &str) -> Result<(), String> {
        if !["active", "paused", "archived", "completed"].contains(&status) {
            return Err("Invalid goal status".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let goal = load_goal(&c, id)?.ok_or("Goal no longer exists")?;
        if goal.status == status {
            return Ok(());
        }
        if status == "completed" && goal.kind == "periodic" {
            return Err("A repeating goal has no end state; pause or archive it instead".into());
        }
        let now = now_ms();
        let completed_at: Option<i64> = match status {
            "completed" => Some(now),
            "active" => None,
            _ => goal.completed_at_ms,
        };
        c.execute(
            "UPDATE goals SET status=?2,completed_at_ms=?3,updated_at_ms=?4 WHERE id=?1",
            params![id, status, completed_at, now],
        )
        .map_err(err)?;
        Ok(())
    }

    /// Adds one progress entry. The entry id makes a repeated submission a no-op. Entries are never edited:
    /// a mistake is corrected by voiding it and adding the right one, so the history stays explainable.
    pub fn add_goal_entry(&self, e: GoalEntryInput, today: &str) -> Result<(), String> {
        check_id(&e.id)?;
        check_date(today, "Today")?;
        check_date(&e.entry_date, "Entry date")?;
        check_optional_text(&e.note, "Note", 500)?;
        if !(1..=MAX_ENTRY).contains(&e.amount) {
            return Err("Progress must be a positive whole number".into());
        }
        if e.entry_date.as_str() > today {
            return Err("Progress cannot be recorded for a future date".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let goal = load_goal(&c, &e.goal_id)?.ok_or("Goal no longer exists")?;
        if goal.kind == "binary" {
            return Err("A yes/no goal has no numeric progress".into());
        }
        if goal.status != "active" {
            return Err("Resume this goal before recording progress".into());
        }
        if e.entry_date < goal.start_date {
            return Err("Progress cannot be dated before the goal started".into());
        }
        c.execute(
            "INSERT OR IGNORE INTO goal_entries(id,goal_id,entry_date,amount,note,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6)",
            params![e.id, e.goal_id, e.entry_date, e.amount, e.note.trim(), now_ms()],
        )
        .map_err(err)?;
        Ok(())
    }

    pub fn void_goal_entry(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if !exists(
            &c,
            "SELECT EXISTS(SELECT 1 FROM goal_entries WHERE id=?1)",
            id,
        )? {
            return Err("Progress entry no longer exists".into());
        }
        c.execute(
            "UPDATE goal_entries SET voided_at_ms=?2 WHERE id=?1 AND voided_at_ms IS NULL",
            params![id, now_ms()],
        )
        .map_err(err)?;
        Ok(())
    }

    // ----- habits

    pub fn save_habit(&self, h: HabitInput, today: &str) -> Result<(), String> {
        check_id(&h.id)?;
        let name = check_text(&h.name, "Name", 120)?;
        check_optional_text(&h.description, "Description", 2_000)?;
        check_date(today, "Today")?;
        let (target, days) = match h.frequency.as_str() {
            "daily" if h.target_count == 1 => (1, vec![]),
            "weekly" if (1..=7).contains(&h.target_count) => {
                (h.target_count, clean_days(&h.preferred_days)?)
            }
            _ => return Err("Choose daily, or weekly with 1–7 days".into()),
        };
        let preferred = to_csv(&days);
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let now = now_ms();
        let status: Option<String> = tx
            .query_row("SELECT status FROM habits WHERE id=?1", [&h.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        match status {
            None => {
                let start = h.start_date.clone().unwrap_or_else(|| today.to_string());
                check_date(&start, "Start date")?;
                if start.as_str() > today || start.as_str() < dates::add_days(today, -365).as_str()
                {
                    return Err(
                        "Start date must be within the past year and not in the future".into(),
                    );
                }
                tx.execute(
                    "INSERT INTO habits(id,name,description,status,start_date,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,'active',?4,?5,?5)",
                    params![h.id, name, h.description, start, now],
                )
                .map_err(err)?;
                tx.execute(
                    "INSERT INTO habit_schedules(habit_id,effective_from,frequency,target_count,preferred_days) VALUES (?1,?2,?3,?4,?5)",
                    params![h.id, dates::week_start(&start), h.frequency, target, preferred],
                )
                .map_err(err)?;
            }
            Some(status) => {
                if status == "archived" {
                    return Err("Restore this habit before editing it".into());
                }
                tx.execute(
                    "UPDATE habits SET name=?2,description=?3,updated_at_ms=?4 WHERE id=?1",
                    params![h.id, name, h.description, now],
                )
                .map_err(err)?;
                let current: Option<(String, i64, String)> = tx
                    .query_row(
                        "SELECT frequency,target_count,preferred_days FROM habit_schedules WHERE habit_id=?1 AND effective_from<=?2 ORDER BY effective_from DESC LIMIT 1",
                        params![h.id, today],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .optional()
                    .map_err(err)?;
                if current != Some((h.frequency.clone(), target, preferred.clone())) {
                    // The new schedule starts with the current week, so earlier weeks keep what applied then.
                    tx.execute(
                        "INSERT INTO habit_schedules(habit_id,effective_from,frequency,target_count,preferred_days) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(habit_id,effective_from) DO UPDATE SET frequency=excluded.frequency,target_count=excluded.target_count,preferred_days=excluded.preferred_days",
                        params![h.id, dates::week_start(today), h.frequency, target, preferred],
                    )
                    .map_err(err)?;
                }
            }
        }
        tx.commit().map_err(err)
    }

    pub fn set_habit_status(&self, id: &str, status: &str) -> Result<(), String> {
        if !["active", "paused", "archived"].contains(&status) {
            return Err("Invalid habit status".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let changed = c
            .execute(
                "UPDATE habits SET status=?2,updated_at_ms=?3 WHERE id=?1 AND status<>?2",
                params![id, status, now_ms()],
            )
            .map_err(err)?;
        if changed == 0 && !exists(&c, "SELECT EXISTS(SELECT 1 FROM habits WHERE id=?1)", id)? {
            return Err("Habit no longer exists".into());
        }
        Ok(())
    }

    /// Idempotent: a habit has at most one check-in per day, so repeating a check-in changes nothing and
    /// undoing one that does not exist changes nothing.
    pub fn set_habit_checkin(
        &self,
        habit_id: &str,
        date: &str,
        done: bool,
        today: &str,
    ) -> Result<(), String> {
        check_date(date, "Date")?;
        check_date(today, "Today")?;
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let habit: (String, String) = c
            .query_row(
                "SELECT status,start_date FROM habits WHERE id=?1",
                [habit_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?
            .ok_or("Habit no longer exists")?;
        if done {
            if habit.0 != "active" {
                return Err("Resume this habit before checking in".into());
            }
            if date > today {
                return Err("A habit cannot be checked in for a future day".into());
            }
            if date < dates::add_days(today, -30).as_str() {
                return Err("Check-ins can be added for the last 30 days".into());
            }
            if date < habit.1.as_str() {
                return Err("That day is before the habit started".into());
            }
            c.execute(
                "INSERT OR IGNORE INTO habit_checkins(habit_id,occurrence_date,created_at_ms) VALUES (?1,?2,?3)",
                params![habit_id, date, now_ms()],
            )
            .map_err(err)?;
        } else {
            c.execute(
                "DELETE FROM habit_checkins WHERE habit_id=?1 AND occurrence_date=?2",
                params![habit_id, date],
            )
            .map_err(err)?;
        }
        Ok(())
    }

    // ----- routines

    pub fn save_routine(&self, r: RoutineInput) -> Result<(), String> {
        check_id(&r.id)?;
        let name = check_text(&r.name, "Name", 120)?;
        check_optional_text(&r.description, "Description", 2_000)?;
        let days = clean_days(&r.schedule_days)?;
        if r.schedule_time.as_deref().is_some_and(|t| !valid_time(t)) {
            return Err("Invalid time".into());
        }
        if r.schedule_time.is_some() && days.is_empty() {
            return Err("Choose the days for a scheduled time".into());
        }
        if r.steps.is_empty() || r.steps.len() > 40 {
            return Err("A routine needs 1–40 steps".into());
        }
        let mut seen = std::collections::HashSet::new();
        let mut steps: Vec<(String, String)> = Vec::new();
        for s in &r.steps {
            check_id(&s.id)?;
            if !seen.insert(s.id.clone()) {
                return Err("Duplicate step".into());
            }
            steps.push((s.id.clone(), check_text(&s.title, "Step", 200)?));
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let now = now_ms();
        let status: Option<String> = tx
            .query_row("SELECT status FROM routines WHERE id=?1", [&r.id], |x| {
                x.get(0)
            })
            .optional()
            .map_err(err)?;
        match status {
            None => {
                tx.execute(
                    "INSERT INTO routines(id,name,description,schedule_days,schedule_time,status,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,'active',?6,?6)",
                    params![r.id, name, r.description, to_csv(&days), r.schedule_time, now],
                )
                .map_err(err)?;
            }
            Some(s) if s == "archived" => {
                return Err("Restore this routine before editing it".into())
            }
            Some(_) => {
                tx.execute(
                    "UPDATE routines SET name=?2,description=?3,schedule_days=?4,schedule_time=?5,updated_at_ms=?6 WHERE id=?1",
                    params![r.id, name, r.description, to_csv(&days), r.schedule_time, now],
                )
                .map_err(err)?;
            }
        }
        // Past executions keep their own copy of the steps, so replacing the list cannot change history.
        tx.execute("DELETE FROM routine_steps WHERE routine_id=?1", [&r.id])
            .map_err(err)?;
        for (position, (id, title)) in steps.iter().enumerate() {
            tx.execute(
                "INSERT INTO routine_steps(id,routine_id,position,title) VALUES (?1,?2,?3,?4)",
                params![id, r.id, position as i64, title],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn set_routine_status(&self, id: &str, status: &str) -> Result<(), String> {
        if !["active", "paused", "archived"].contains(&status) {
            return Err("Invalid routine status".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let changed = c
            .execute(
                "UPDATE routines SET status=?2,updated_at_ms=?3 WHERE id=?1 AND status<>?2",
                params![id, status, now_ms()],
            )
            .map_err(err)?;
        if changed == 0 && !exists(&c, "SELECT EXISTS(SELECT 1 FROM routines WHERE id=?1)", id)? {
            return Err("Routine no longer exists".into());
        }
        Ok(())
    }

    /// Starts (or resumes) the routine's run for `date`. There is one run per routine per date, so starting
    /// again returns the same run with its progress, and yesterday's run is never touched.
    pub fn start_routine(
        &self,
        routine_id: &str,
        execution_id: &str,
        date: &str,
        today: &str,
    ) -> Result<(), String> {
        check_id(execution_id)?;
        check_date(date, "Date")?;
        check_date(today, "Today")?;
        if date > today || date < dates::add_days(today, -7).as_str() {
            return Err("A routine can be run for today or the last 7 days".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let status: String = tx
            .query_row(
                "SELECT status FROM routines WHERE id=?1",
                [routine_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .ok_or("Routine no longer exists")?;
        let known: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM routine_executions WHERE routine_id=?1 AND occurrence_date=?2)",
                params![routine_id, date],
                |r| r.get(0),
            )
            .map_err(err)?;
        if known {
            return Ok(());
        }
        if status != "active" {
            return Err("Resume this routine before starting it".into());
        }
        let steps: Vec<(String, String)> = tx
            .prepare("SELECT id,title FROM routine_steps WHERE routine_id=?1 ORDER BY position,id")
            .map_err(err)?
            .query_map([routine_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if steps.is_empty() {
            return Err("This routine has no steps".into());
        }
        tx.execute(
            "INSERT INTO routine_executions(id,routine_id,occurrence_date,started_at_ms) VALUES (?1,?2,?3,?4)",
            params![execution_id, routine_id, date, now_ms()],
        )
        .map_err(err)?;
        for (position, (step_id, title)) in steps.iter().enumerate() {
            tx.execute(
                "INSERT INTO routine_execution_steps(execution_id,position,step_id,title) VALUES (?1,?2,?3,?4)",
                params![execution_id, position as i64, step_id, title],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn set_routine_step(
        &self,
        execution_id: &str,
        position: i64,
        done: bool,
    ) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let completed: Option<Option<i64>> = c
            .query_row(
                "SELECT completed_at_ms FROM routine_executions WHERE id=?1",
                [execution_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match completed {
            None => return Err("This routine run no longer exists".into()),
            Some(Some(_)) => return Err("This routine run is already complete".into()),
            Some(None) => {}
        }
        let changed = c
            .execute(
                "UPDATE routine_execution_steps SET done_at_ms=CASE WHEN ?3 THEN COALESCE(done_at_ms,?4) ELSE NULL END WHERE execution_id=?1 AND position=?2",
                params![execution_id, position, done, now_ms()],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("That step is not part of this run".into());
        }
        Ok(())
    }

    /// Idempotent. A run is complete only when every step is checked; a partly done run stays in progress.
    pub fn complete_routine(&self, execution_id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let completed: Option<Option<i64>> = c
            .query_row(
                "SELECT completed_at_ms FROM routine_executions WHERE id=?1",
                [execution_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match completed {
            None => return Err("This routine run no longer exists".into()),
            Some(Some(_)) => return Ok(()),
            Some(None) => {}
        }
        let open: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM routine_execution_steps WHERE execution_id=?1 AND done_at_ms IS NULL",
                [execution_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if open > 0 {
            return Err(format!("{open} step(s) are still unchecked"));
        }
        c.execute(
            "UPDATE routine_executions SET completed_at_ms=?2 WHERE id=?1 AND completed_at_ms IS NULL",
            params![execution_id, now_ms()],
        )
        .map_err(err)?;
        Ok(())
    }

    // ----- recurring responsibilities

    pub fn save_recurrence(&self, input: RecurrenceInput, today: &str) -> Result<(), String> {
        check_date(today, "Today")?;
        let (weekdays, month_day) = validate_rule(&input)?;
        let title = input.title.trim().to_string();
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let now = now_ms();
        let old = load_rule(&tx, &input.id)?;
        let schedule_changed = match &old {
            None => true,
            Some(o) => {
                if o.status == "ended" {
                    return Err("This recurrence has ended".into());
                }
                o.frequency != input.frequency
                    || o.weekdays != weekdays
                    || o.month_day != month_day
                    || o.start_date != input.start_date
                    || o.end_date != input.end_date
                    || o.due_time != input.due_time
            }
        };
        tx.execute(
            "INSERT INTO recurrence_rules(id,title,description,priority,category,frequency,weekdays,month_day,start_date,end_date,due_time,reminder_offset_minutes,status,created_at_ms,updated_at_ms)
             VALUES (?1,?2,?3,?4,'Personal',?5,?6,?7,?8,?9,?10,?11,'active',?12,?12)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,priority=excluded.priority,frequency=excluded.frequency,weekdays=excluded.weekdays,month_day=excluded.month_day,start_date=excluded.start_date,end_date=excluded.end_date,due_time=excluded.due_time,reminder_offset_minutes=excluded.reminder_offset_minutes,updated_at_ms=excluded.updated_at_ms",
            params![input.id, title, input.description, input.priority, input.frequency, to_csv(&weekdays), month_day, input.start_date, input.end_date, input.due_time, input.reminder_offset_minutes, now],
        )
        .map_err(err)?;
        if schedule_changed {
            remove_future_open(&tx, &input.id, today)?;
        } else {
            tx.execute(
                "UPDATE tasks SET title=?2,description=?3,priority=?4,reminder_offset_minutes=?5,updated_at_ms=?6 WHERE completed_at_ms IS NULL AND id IN (SELECT task_id FROM recurrence_occurrences WHERE rule_id=?1 AND status='open' AND task_id IS NOT NULL AND occurrence_date >= ?7)",
                params![input.id, title, input.description, input.priority, input.reminder_offset_minutes, now, today],
            )
            .map_err(err)?;
        }
        let rule = load_rule(&tx, &input.id)?.ok_or("Recurrence could not be saved")?;
        generate_rule(&tx, &rule, today)?;
        tx.commit().map_err(err)
    }

    pub fn set_recurrence_status(&self, id: &str, status: &str, today: &str) -> Result<(), String> {
        if !["active", "paused", "ended"].contains(&status) {
            return Err("Invalid recurrence status".into());
        }
        check_date(today, "Today")?;
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let rule = load_rule(&tx, id)?.ok_or("Recurrence no longer exists")?;
        if rule.status == status {
            return Ok(());
        }
        if rule.status == "ended" {
            return Err("An ended recurrence cannot be restarted; create a new one".into());
        }
        tx.execute(
            "UPDATE recurrence_rules SET status=?2,updated_at_ms=?3 WHERE id=?1",
            params![id, status, now_ms()],
        )
        .map_err(err)?;
        if status == "active" {
            let rule = load_rule(&tx, id)?.ok_or("Recurrence no longer exists")?;
            generate_rule(&tx, &rule, today)?;
        } else {
            // Paused or ended: no phantom future tasks. Today's task, completed work and skips stay.
            remove_future_open(&tx, id, today)?;
        }
        tx.commit().map_err(err)
    }

    /// Skipping is not completing: the open task is removed (it never completes, so no reward) and the date
    /// is remembered as skipped so it is not generated again.
    pub fn skip_occurrence(&self, task_id: &str) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let found: Option<(String, Option<i64>)> = tx
            .query_row(
                "SELECT o.status,t.completed_at_ms FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.task_id=?1",
                [task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let (status, completed) = found.ok_or("That task is not a recurring occurrence")?;
        if completed.is_some() {
            return Err("A completed occurrence cannot be skipped; reopen it first".into());
        }
        if status != "open" {
            return Ok(());
        }
        tx.execute(
            "UPDATE recurrence_occurrences SET status='skipped' WHERE task_id=?1",
            [task_id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM tasks WHERE id=?1", [task_id])
            .map_err(err)?;
        tx.commit().map_err(err)
    }

    /// Undoes a skip for today or a future date: the occurrence is generated again when it is in range.
    pub fn restore_occurrence(&self, rule_id: &str, date: &str, today: &str) -> Result<(), String> {
        check_date(date, "Date")?;
        check_date(today, "Today")?;
        if date < today {
            return Err("A skipped occurrence from a past day stays in the history".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let removed = tx
            .execute(
                "DELETE FROM recurrence_occurrences WHERE rule_id=?1 AND occurrence_date=?2 AND status='skipped'",
                params![rule_id, date],
            )
            .map_err(err)?;
        if removed == 0 {
            return Ok(());
        }
        if let Some(rule) = load_rule(&tx, rule_id)? {
            generate_rule(&tx, &rule, today)?;
        }
        tx.commit().map_err(err)
    }

    /// Creates missing occurrences for every active rule. Safe to call at any time and as often as wanted.
    pub fn generate_recurring(&self, today: &str) -> Result<(), String> {
        check_date(today, "Today")?;
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let active: Vec<RecurrenceRule> = tx
            .prepare(&format!(
                "SELECT {RULE_COLUMNS} FROM recurrence_rules WHERE status='active'"
            ))
            .map_err(err)?
            .query_map([], rule_row)
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for rule in &active {
            generate_rule(&tx, rule, today)?;
        }
        tx.commit().map_err(err)
    }

    // ----- daily priorities

    /// Replaces the priority list for `date` (select, remove and reorder are all this one idempotent call).
    /// A priority is only a plan: it never changes the task, its due date or its completion.
    pub fn set_daily_priorities(
        &self,
        date: &str,
        task_ids: &[String],
        today: &str,
    ) -> Result<(), String> {
        check_date(date, "Date")?;
        check_date(today, "Today")?;
        if date < today || date > dates::add_days(today, 7).as_str() {
            return Err("Priorities can be planned for today and the next 7 days".into());
        }
        let mut seen = std::collections::HashSet::new();
        if task_ids.len() > MAX_PRIORITIES || !task_ids.iter().all(|t| seen.insert(t.clone())) {
            return Err(format!(
                "Choose up to {MAX_PRIORITIES} different priorities"
            ));
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(err)?;
        let current: Vec<String> = tx
            .prepare("SELECT task_id FROM daily_priorities WHERE plan_date=?1")
            .map_err(err)?
            .query_map([date], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for id in task_ids {
            let completed: Option<Option<i64>> = tx
                .query_row("SELECT completed_at_ms FROM tasks WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(err)?;
            match completed {
                None => return Err("A chosen task no longer exists".into()),
                Some(Some(_)) if !current.contains(id) => {
                    return Err("A completed task cannot be added as a priority".into())
                }
                _ => {}
            }
        }
        tx.execute("DELETE FROM daily_priorities WHERE plan_date=?1", [date])
            .map_err(err)?;
        let now = now_ms();
        for (position, id) in task_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO daily_priorities(plan_date,task_id,position,created_at_ms) VALUES (?1,?2,?3,?4)",
                params![date, id, position as i64, now],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const TODAY: &str = "2026-11-04"; // a Wednesday

    fn db() -> (Database, std::path::PathBuf) {
        let p = std::env::temp_dir().join(format!(
            "civildesk-personal-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        (Database::open(&p).unwrap(), p)
    }
    fn finish(d: Database, p: std::path::PathBuf) {
        drop(d);
        std::fs::remove_file(p).unwrap();
    }
    fn count(d: &Database, sql: &str) -> i64 {
        d.0.lock()
            .unwrap()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }
    fn goal(id: &str, kind: &str, target: Option<i64>, period: Option<&str>) -> GoalInput {
        GoalInput {
            id: id.into(),
            title: "Read".into(),
            description: String::new(),
            kind: kind.into(),
            target,
            unit: "pages".into(),
            period: period.map(str::to_string),
            start_date: "2026-11-01".into(),
            target_date: None,
        }
    }
    fn entry(id: &str, goal: &str, date: &str, amount: i64) -> GoalEntryInput {
        GoalEntryInput {
            id: id.into(),
            goal_id: goal.into(),
            entry_date: date.into(),
            amount,
            note: String::new(),
        }
    }
    fn habit(id: &str, frequency: &str, count: i64) -> HabitInput {
        HabitInput {
            id: id.into(),
            name: "Read".into(),
            description: String::new(),
            frequency: frequency.into(),
            target_count: count,
            preferred_days: vec![],
            start_date: Some("2026-11-02".into()),
        }
    }
    fn rule(id: &str, frequency: &str) -> RecurrenceInput {
        RecurrenceInput {
            id: id.into(),
            title: "Take out trash".into(),
            description: String::new(),
            priority: "normal".into(),
            frequency: frequency.into(),
            weekdays: if frequency == "weekly" {
                vec![1]
            } else {
                vec![]
            },
            month_day: if frequency == "monthly" {
                Some(31)
            } else {
                None
            },
            start_date: "2026-10-01".into(),
            end_date: None,
            due_time: None,
            reminder_offset_minutes: None,
        }
    }
    fn routine(id: &str) -> RoutineInput {
        RoutineInput {
            id: id.into(),
            name: "Morning".into(),
            description: String::new(),
            schedule_days: vec![],
            schedule_time: None,
            steps: vec![
                RoutineStepInput {
                    id: "s1".into(),
                    title: "Make bed".into(),
                },
                RoutineStepInput {
                    id: "s2".into(),
                    title: "Review tasks".into(),
                },
            ],
        }
    }

    #[test]
    fn goals_validate_types_and_keep_progress_auditable() {
        let (d, p) = db();
        assert!(d
            .save_goal(goal("bad", "numeric", None, None), TODAY)
            .is_err());
        assert!(d
            .save_goal(goal("bad", "binary", Some(5), None), TODAY)
            .is_err());
        assert!(d
            .save_goal(goal("bad", "periodic", Some(5), None), TODAY)
            .is_err());
        assert!(d
            .save_goal(goal("bad", "numeric", Some(0), None), TODAY)
            .is_err());
        d.save_goal(goal("g", "numeric", Some(300), None), TODAY)
            .unwrap();
        d.add_goal_entry(entry("e1", "g", "2026-11-02", 40), TODAY)
            .unwrap();
        d.add_goal_entry(entry("e1", "g", "2026-11-02", 40), TODAY)
            .unwrap(); // repeated submit
        d.add_goal_entry(entry("e2", "g", "2026-11-03", 25), TODAY)
            .unwrap();
        assert!(d
            .add_goal_entry(entry("e3", "g", "2026-11-03", 0), TODAY)
            .is_err());
        assert!(d
            .add_goal_entry(entry("e3", "g", "2026-11-03", -5), TODAY)
            .is_err());
        assert!(d
            .add_goal_entry(entry("e3", "g", "2026-11-05", 5), TODAY)
            .is_err()); // future
        assert!(d
            .add_goal_entry(entry("e3", "g", "2026-10-31", 5), TODAY)
            .is_err()); // before the goal started
        d.void_goal_entry("e2").unwrap();
        d.void_goal_entry("e2").unwrap();
        assert!(d.void_goal_entry("missing").is_err());
        let data = d.personal().unwrap();
        assert_eq!(data.goal_entries.len(), 2); // the voided entry is kept as history
        let live: i64 = data
            .goal_entries
            .iter()
            .filter(|e| e.voided_at_ms.is_none())
            .map(|e| e.amount)
            .sum();
        assert_eq!(live, 40);
        assert_eq!(count(&d, "SELECT COUNT(*) FROM reward_events"), 0); // progress never pays XP
        finish(d, p);
    }

    #[test]
    fn goal_status_rules_and_manual_completion() {
        let (d, p) = db();
        d.save_goal(goal("b", "binary", None, None), TODAY).unwrap();
        d.save_goal(goal("w", "periodic", Some(100), Some("weekly")), TODAY)
            .unwrap();
        d.set_goal_status("b", "completed").unwrap();
        d.set_goal_status("b", "completed").unwrap();
        assert!(d
            .personal()
            .unwrap()
            .goals
            .iter()
            .find(|g| g.id == "b")
            .unwrap()
            .completed_at_ms
            .is_some());
        d.set_goal_status("b", "active").unwrap();
        assert!(d
            .personal()
            .unwrap()
            .goals
            .iter()
            .find(|g| g.id == "b")
            .unwrap()
            .completed_at_ms
            .is_none());
        assert!(d.set_goal_status("w", "completed").is_err());
        d.set_goal_status("w", "paused").unwrap();
        assert!(d
            .add_goal_entry(entry("e", "w", "2026-11-03", 5), TODAY)
            .is_err()); // paused
        assert!(d
            .add_goal_entry(entry("e", "b", "2026-11-03", 5), TODAY)
            .is_err()); // yes/no goal
        d.set_goal_status("w", "archived").unwrap();
        assert!(d
            .save_goal(goal("w", "periodic", Some(120), Some("weekly")), TODAY)
            .is_err()); // archived
        assert!(d.set_goal_status("nope", "active").is_err());
        finish(d, p);
    }

    #[test]
    fn periodic_target_changes_apply_from_the_current_period_only() {
        let (d, p) = db();
        let monday_goal = |target: i64| GoalInput {
            start_date: "2026-11-02".into(),
            ..goal("w", "periodic", Some(target), Some("weekly"))
        };
        d.save_goal(monday_goal(100), "2026-11-02").unwrap();
        d.save_goal(monday_goal(150), TODAY).unwrap();
        d.save_goal(monday_goal(160), "2026-11-05").unwrap(); // same week: same row
        let targets = d.personal().unwrap().goal_targets;
        assert_eq!(targets.len(), 1); // the start date and today share the week of 2026-11-02
        assert_eq!(targets[0].target, 160);
        d.save_goal(monday_goal(200), "2026-11-10").unwrap();
        let targets = d.personal().unwrap().goal_targets;
        assert_eq!(targets.len(), 2);
        assert_eq!(
            (targets[0].effective_from.as_str(), targets[0].target),
            ("2026-11-02", 160)
        ); // earlier week untouched
        assert_eq!(
            (targets[1].effective_from.as_str(), targets[1].target),
            ("2026-11-09", 200)
        );
        assert!(d
            .save_goal(goal("w", "periodic", Some(200), Some("monthly")), TODAY)
            .is_err()); // period is fixed
        assert!(d
            .save_goal(goal("w", "numeric", Some(200), None), TODAY)
            .is_err()); // type is fixed
        finish(d, p);
    }

    #[test]
    fn habit_checkins_are_idempotent_and_undoable() {
        let (d, p) = db();
        d.save_habit(habit("h", "daily", 1), TODAY).unwrap();
        for _ in 0..3 {
            d.set_habit_checkin("h", TODAY, true, TODAY).unwrap();
        }
        assert_eq!(d.personal().unwrap().habit_checkins.len(), 1);
        d.set_habit_checkin("h", "2026-11-03", true, TODAY).unwrap();
        assert!(d.set_habit_checkin("h", "2026-11-05", true, TODAY).is_err()); // future
        assert!(d.set_habit_checkin("h", "2026-11-01", true, TODAY).is_err()); // before it started
        d.set_habit_checkin("h", TODAY, false, TODAY).unwrap();
        d.set_habit_checkin("h", TODAY, false, TODAY).unwrap();
        assert_eq!(d.personal().unwrap().habit_checkins.len(), 1);
        d.set_habit_status("h", "paused").unwrap();
        assert!(d.set_habit_checkin("h", TODAY, true, TODAY).is_err());
        d.set_habit_status("h", "archived").unwrap();
        assert_eq!(d.personal().unwrap().habit_checkins.len(), 1); // history is kept
        assert!(d.save_habit(habit("h", "daily", 1), TODAY).is_err());
        assert_eq!(count(&d, "SELECT COUNT(*) FROM reward_events"), 0);
        finish(d, p);
    }

    #[test]
    fn habit_schedule_edits_keep_earlier_weeks() {
        let (d, p) = db();
        assert!(d.save_habit(habit("h", "daily", 3), TODAY).is_err());
        assert!(d.save_habit(habit("h", "weekly", 0), TODAY).is_err());
        assert!(d.save_habit(habit("h", "weekly", 8), TODAY).is_err());
        d.save_habit(habit("h", "daily", 1), "2026-11-02").unwrap();
        d.save_habit(habit("h", "daily", 1), TODAY).unwrap(); // unchanged: no new row
        assert_eq!(d.personal().unwrap().habit_schedules.len(), 1);
        let mut weekly = habit("h", "weekly", 4);
        weekly.preferred_days = vec![4, 0, 0, 2];
        d.save_habit(weekly, "2026-11-10").unwrap();
        let schedules = d.personal().unwrap().habit_schedules;
        assert_eq!(schedules.len(), 2);
        assert_eq!(
            (
                schedules[0].frequency.as_str(),
                schedules[0].effective_from.as_str()
            ),
            ("daily", "2026-11-02")
        );
        assert_eq!(
            (
                schedules[1].frequency.as_str(),
                schedules[1].target_count,
                schedules[1].effective_from.as_str()
            ),
            ("weekly", 4, "2026-11-09")
        );
        assert_eq!(schedules[1].preferred_days, vec![0, 2, 4]);
        finish(d, p);
    }

    #[test]
    fn routine_runs_are_unique_per_day_partial_and_snapshotted() {
        let (d, p) = db();
        let mut empty = routine("r");
        empty.steps.clear();
        assert!(d.save_routine(empty).is_err());
        d.save_routine(routine("r")).unwrap();
        d.start_routine("r", "run-1", "2026-11-03", TODAY).unwrap();
        d.start_routine("r", "run-1b", "2026-11-03", TODAY).unwrap(); // same day: same run
        assert_eq!(d.personal().unwrap().executions.len(), 1);
        d.set_routine_step("run-1", 0, true).unwrap();
        d.set_routine_step("run-1", 0, true).unwrap();
        assert!(d.complete_routine("run-1").is_err()); // one step is still open: partial progress is kept
        assert!(d.personal().unwrap().executions[0]
            .completed_at_ms
            .is_none());
        // Editing the routine does not change the run that already started.
        let mut edited = routine("r");
        edited.steps = vec![
            RoutineStepInput {
                id: "s9".into(),
                title: "Stretch".into(),
            },
            RoutineStepInput {
                id: "s2".into(),
                title: "Review tasks".into(),
            },
        ];
        d.save_routine(edited).unwrap();
        let run = d.personal().unwrap().executions.remove(0);
        assert_eq!(
            run.steps
                .iter()
                .map(|s| s.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Make bed", "Review tasks"]
        );
        assert!(run.steps[0].done_at_ms.is_some());
        d.set_routine_step("run-1", 1, true).unwrap();
        d.complete_routine("run-1").unwrap();
        d.complete_routine("run-1").unwrap(); // second completion changes nothing
        assert!(d.set_routine_step("run-1", 1, false).is_err()); // completed runs are history
        let first_completion = d.personal().unwrap().executions[0].completed_at_ms;
        d.start_routine("r", "run-2", TODAY, TODAY).unwrap(); // a new day is a new run; yesterday's is untouched
        let data = d.personal().unwrap();
        assert_eq!(data.executions.len(), 2);
        assert_eq!(
            data.executions
                .iter()
                .find(|e| e.id == "run-1")
                .unwrap()
                .completed_at_ms,
            first_completion
        );
        assert_eq!(
            data.executions
                .iter()
                .find(|e| e.id == "run-2")
                .unwrap()
                .steps[0]
                .title,
            "Stretch"
        );
        assert_eq!(data.routines[0].steps.len(), 2);
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 0); // steps are not tasks
        assert_eq!(count(&d, "SELECT COUNT(*) FROM reward_events"), 0);
        d.set_routine_status("r", "paused").unwrap();
        assert!(d.start_routine("r", "run-3", "2026-11-02", TODAY).is_err());
        d.start_routine("r", "run-x", TODAY, TODAY).unwrap(); // existing run is still returned
        finish(d, p);
    }

    #[test]
    fn recurrence_generates_a_bounded_window_without_duplicates() {
        let (d, p) = db();
        d.save_recurrence(rule("daily", "daily"), TODAY).unwrap();
        d.generate_recurring(TODAY).unwrap();
        d.generate_recurring(TODAY).unwrap();
        // Start date is a month ago, but only today and the next two days exist.
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 3);
        assert_eq!(count(&d, "SELECT COUNT(*) FROM recurrence_occurrences"), 3);
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE due_date < '2026-11-04'"
            ),
            0
        );
        // Reopening the app months later creates today's window only, not three months of backlog.
        d.generate_recurring("2027-02-10").unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM recurrence_occurrences"), 6);
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE due_date >= '2027-02-10'"
            ),
            3
        );
        finish(d, p);
    }

    #[test]
    fn weekly_and_monthly_occurrences_use_the_documented_dates() {
        let (d, p) = db();
        d.save_recurrence(rule("weekly", "weekly"), TODAY).unwrap(); // Tuesdays
        let due: Vec<String> = d
            .0
            .lock()
            .unwrap()
            .prepare("SELECT due_date FROM tasks WHERE id LIKE 'rec-weekly-%' ORDER BY due_date")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(due, vec!["2026-11-10", "2026-11-17"]);
        d.save_recurrence(rule("monthly", "monthly"), "2027-02-28")
            .unwrap(); // the 31st
        let due: Vec<String> = d
            .0
            .lock()
            .unwrap()
            .prepare("SELECT due_date FROM tasks WHERE id LIKE 'rec-monthly-%' ORDER BY due_date")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(due, vec!["2027-02-28", "2027-03-31"]); // short months fall on their last day
        finish(d, p);
    }

    #[test]
    fn completing_and_skipping_occurrences_stay_independent() {
        let (d, p) = db();
        d.save_recurrence(rule("daily", "daily"), TODAY).unwrap();
        let today_task = format!("rec-daily-{TODAY}");
        let tomorrow_task = "rec-daily-2026-11-05".to_string();
        d.set_task_completed(&today_task, true).unwrap();
        d.set_task_completed(&today_task, true).unwrap();
        assert_eq!(d.workspace().unwrap().progression.xp, 25); // the ordinary task reward, once
        let tasks = d.workspace().unwrap().tasks;
        assert!(tasks
            .iter()
            .find(|t| t.id == today_task)
            .unwrap()
            .completed_at_ms
            .is_some());
        assert!(tasks
            .iter()
            .find(|t| t.id == tomorrow_task)
            .unwrap()
            .completed_at_ms
            .is_none());
        assert!(d.skip_occurrence(&today_task).is_err()); // completed work is not skipped
        d.skip_occurrence(&tomorrow_task).unwrap();
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE id='rec-daily-2026-11-05'"
            ),
            0
        );
        d.generate_recurring(TODAY).unwrap();
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE id='rec-daily-2026-11-05'"
            ),
            0
        ); // not regenerated
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM recurrence_occurrences WHERE status='skipped'"
            ),
            1
        );
        assert_eq!(d.workspace().unwrap().progression.xp, 25); // skipping paid nothing
        d.restore_occurrence("daily", "2026-11-05", TODAY).unwrap();
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE id='rec-daily-2026-11-05'"
            ),
            1
        );
        // A task the user deleted is treated as removed and is not recreated.
        d.delete_task("rec-daily-2026-11-06").unwrap();
        d.generate_recurring(TODAY).unwrap();
        assert_eq!(
            count(
                &d,
                "SELECT COUNT(*) FROM tasks WHERE id='rec-daily-2026-11-06'"
            ),
            0
        );
        finish(d, p);
    }

    #[test]
    fn editing_pausing_and_ending_replan_only_the_future() {
        let (d, p) = db();
        d.save_recurrence(rule("w", "weekly"), TODAY).unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 2);
        let mut thursdays = rule("w", "weekly");
        thursdays.weekdays = vec![3];
        d.save_recurrence(thursdays, TODAY).unwrap();
        let due: Vec<String> =
            d.0.lock()
                .unwrap()
                .prepare("SELECT due_date FROM tasks ORDER BY due_date")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
        assert_eq!(due, vec!["2026-11-05", "2026-11-12"]);
        let mut retitled = rule("w", "weekly");
        retitled.weekdays = vec![3];
        retitled.title = "Bins out".into();
        d.save_recurrence(retitled, TODAY).unwrap(); // text only: same tasks, new title
        assert_eq!(
            count(&d, "SELECT COUNT(*) FROM tasks WHERE title='Bins out'"),
            2
        );
        d.set_task_completed("rec-w-2026-11-05", true).unwrap();
        d.set_recurrence_status("w", "paused", "2026-11-06")
            .unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 1); // only the completed one remains
        d.generate_recurring("2026-11-06").unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 1); // paused rules generate nothing
        d.set_recurrence_status("w", "active", "2026-11-06")
            .unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 3);
        d.set_recurrence_status("w", "ended", "2026-11-06").unwrap();
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 1);
        assert!(d
            .set_recurrence_status("w", "active", "2026-11-06")
            .is_err());
        assert!(d
            .save_recurrence(rule("w", "weekly"), "2026-11-06")
            .is_err());
        assert!(d
            .save_recurrence(
                RecurrenceInput {
                    weekdays: vec![],
                    ..rule("x", "weekly")
                },
                TODAY
            )
            .is_err());
        assert!(d
            .save_recurrence(
                RecurrenceInput {
                    month_day: Some(32),
                    ..rule("x", "monthly")
                },
                TODAY
            )
            .is_err());
        assert!(d
            .save_recurrence(
                RecurrenceInput {
                    end_date: Some("2026-09-01".into()),
                    ..rule("x", "daily")
                },
                TODAY
            )
            .is_err());
        finish(d, p);
    }

    #[test]
    fn daily_priorities_do_not_touch_tasks() {
        let (d, p) = db();
        for id in ["a", "b", "c"] {
            d.save_task(TaskInput {
                id: id.into(),
                title: id.into(),
                description: String::new(),
                category: "Personal".into(),
                priority: "normal".into(),
                due_date: Some("2026-11-20".into()),
                due_time: None,
                subtasks: vec![],
                reminder_offset_minutes: None,
            })
            .unwrap();
        }
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        d.set_daily_priorities(TODAY, &ids(&["b", "a"]), TODAY)
            .unwrap();
        d.set_daily_priorities(TODAY, &ids(&["b", "a"]), TODAY)
            .unwrap();
        let data = d.personal().unwrap();
        assert_eq!(
            data.priorities
                .iter()
                .map(|p| p.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert_eq!(
            count(&d, "SELECT COUNT(*) FROM tasks WHERE due_date='2026-11-20'"),
            3
        ); // due dates unchanged
        d.set_daily_priorities(TODAY, &ids(&["a"]), TODAY).unwrap(); // remove without deleting
        assert_eq!(count(&d, "SELECT COUNT(*) FROM tasks"), 3);
        assert!(d
            .set_daily_priorities(TODAY, &ids(&["a", "a"]), TODAY)
            .is_err());
        assert!(d
            .set_daily_priorities(TODAY, &ids(&["a", "b", "c", "a", "b", "c"]), TODAY)
            .is_err());
        assert!(d
            .set_daily_priorities(TODAY, &ids(&["missing"]), TODAY)
            .is_err());
        assert!(d
            .set_daily_priorities("2026-11-03", &ids(&["a"]), TODAY)
            .is_err()); // the past is history
        d.set_task_completed("c", true).unwrap();
        assert!(d
            .set_daily_priorities(TODAY, &ids(&["a", "c"]), TODAY)
            .is_err());
        d.set_daily_priorities(TODAY, &ids(&["a"]), TODAY).unwrap();
        d.delete_task("a").unwrap(); // deleting the task drops it from the plan
        assert!(d.personal().unwrap().priorities.is_empty());
        finish(d, p);
    }

    #[test]
    fn version_seven_database_upgrades_without_losing_existing_data() {
        let (d, p) = db();
        d.save_task(TaskInput {
            id: "old-task".into(),
            title: "Existing".into(),
            description: String::new(),
            category: "Math homework".into(),
            priority: "normal".into(),
            due_date: None,
            due_time: None,
            subtasks: vec![],
            reminder_offset_minutes: None,
        })
        .unwrap();
        d.set_task_completed("old-task", true).unwrap();
        {
            // Make this a genuine v7 file: remove everything v8 added and rewind the version.
            let c = d.0.lock().unwrap();
            c.execute_batch(
                "DROP TABLE notion_sources; DROP TABLE notion_connection; DROP TABLE portfolio_milestones; DROP TABLE portfolio_gallery; DROP TABLE portfolio_tools; DROP TABLE portfolio_case_studies; DROP TABLE daily_priorities; DROP TABLE recurrence_occurrences; DROP TABLE recurrence_rules;
                 DROP TABLE routine_execution_steps; DROP TABLE routine_executions; DROP TABLE routine_steps; DROP TABLE routines;
                 DROP TABLE habit_checkins; DROP TABLE habit_schedules; DROP TABLE habits;
                 DROP TABLE goal_entries; DROP TABLE goal_targets; DROP TABLE goals; PRAGMA user_version = 7;",
            )
            .unwrap();
        }
        drop(d);
        let d = Database::open(&p).unwrap();
        let w = d.workspace().unwrap();
        assert_eq!(w.tasks.len(), 1);
        assert_eq!(w.tasks[0].category, "Math homework");
        assert_eq!(w.progression.xp, 25);
        let c = d.0.lock().unwrap();
        let version: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 10);
        let violations = c
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count();
        assert_eq!(violations, 0);
        let quick: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0)).unwrap();
        assert_eq!(quick, "ok");
        drop(c);
        assert!(d.personal().unwrap().goals.is_empty());
        d.save_goal(goal("g", "numeric", Some(10), None), TODAY)
            .unwrap();
        // Opening again must not touch what exists.
        drop(d);
        let d = Database::open(&p).unwrap();
        assert_eq!(d.personal().unwrap().goals.len(), 1);
        finish(d, p);
    }
}
