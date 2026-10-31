use crate::persistence::Database;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before Unix epoch")
        .as_millis() as i64
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub done: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub subtasks: Vec<Subtask>,
    pub reminder_offset_minutes: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub first_completed_at_ms: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub subtasks: Vec<Subtask>,
    pub reminder_offset_minutes: Option<i64>,
}
fn leap(y: i32) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}
pub fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (
        s[0..4].parse::<i32>(),
        s[5..7].parse::<usize>(),
        s[8..10].parse::<u32>(),
    ) else {
        return false;
    };
    let days = [
        31,
        if leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days[m - 1]
}
pub fn valid_time(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 2 || c.is_ascii_digit())
        && s[0..2].parse::<u8>().is_ok_and(|v| v < 24)
        && s[3..5].parse::<u8>().is_ok_and(|v| v < 60)
}
fn validate_task(t: &TaskInput) -> Result<(), String> {
    if t.id.is_empty() || t.id.len() > 100 {
        return Err("Invalid task identifier".into());
    }
    if t.title.trim().is_empty() || t.title.chars().count() > 200 {
        return Err("Task title must be 1–200 characters".into());
    }
    if t.description.chars().count() > 10_000 || t.category.chars().count() > 80 {
        return Err("Description or category is too long".into());
    }
    if !["low", "normal", "high"].contains(&t.priority.as_str()) {
        return Err("Invalid priority".into());
    }
    if t.due_date.as_deref().is_some_and(|s| !valid_date(s))
        || t.due_time.as_deref().is_some_and(|s| !valid_time(s))
        || t.due_time.is_some() && t.due_date.is_none()
    {
        return Err("Invalid due date or time".into());
    }
    if t.reminder_offset_minutes
        .is_some_and(|v| !(0..=40320).contains(&v))
    {
        return Err("Invalid reminder offset".into());
    }
    if t.subtasks.len() > 100
        || t.subtasks
            .iter()
            .any(|s| s.id.is_empty() || s.title.trim().is_empty() || s.title.chars().count() > 200)
    {
        return Err("Invalid subtasks".into());
    }
    Ok(())
}
fn task_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let json: String = r.get(7)?;
    let subtasks = serde_json::from_str(&json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        category: r.get(3)?,
        priority: r.get(4)?,
        due_date: r.get(5)?,
        due_time: r.get(6)?,
        subtasks,
        reminder_offset_minutes: r.get(8)?,
        created_at_ms: r.get(9)?,
        updated_at_ms: r.get(10)?,
        completed_at_ms: r.get(11)?,
        first_completed_at_ms: r.get(12)?,
    })
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub task_id: Option<String>,
    pub status: String,
    pub duration_minutes: i64,
    pub break_minutes: i64,
    pub started_at_ms: i64,
    pub run_started_at_ms: Option<i64>,
    pub elapsed_ms: i64,
    pub finished_at_ms: Option<i64>,
}
fn focus_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: r.get(0)?,
        task_id: r.get(1)?,
        status: r.get(2)?,
        duration_minutes: r.get(3)?,
        break_minutes: r.get(4)?,
        started_at_ms: r.get(5)?,
        run_started_at_ms: r.get(6)?,
        elapsed_ms: r.get(7)?,
        finished_at_ms: r.get(8)?,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardEvent {
    pub id: String,
    pub kind: String,
    pub source_id: String,
    pub occurred_at_ms: i64,
    pub xp: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progression {
    pub xp: i64,
    pub level: i64,
    pub earned: Vec<String>,
    pub unlocked: Vec<String>,
    pub style_id: String,
    pub scarf: bool,
    pub headphones: bool,
    pub history: Vec<RewardEvent>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceData {
    pub tasks: Vec<Task>,
    pub sessions: Vec<FocusSession>,
    pub focus_duration_minutes: i64,
    pub break_duration_minutes: i64,
    pub progression: Progression,
}
fn strings(c: &Connection, sql: &str) -> Result<Vec<String>, String> {
    c.prepare(sql)
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}
impl Database {
    pub fn workspace(&self) -> Result<WorkspaceData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let tasks=c.prepare("SELECT id,title,description,category,priority,due_date,due_time,subtasks_json,reminder_offset_minutes,created_at_ms,updated_at_ms,completed_at_ms,first_completed_at_ms FROM tasks ORDER BY created_at_ms DESC").map_err(|e|e.to_string())?
            .query_map([],task_row).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        let sessions=c.prepare("SELECT id,task_id,status,duration_minutes,break_minutes,started_at_ms,run_started_at_ms,elapsed_ms,finished_at_ms FROM focus_sessions ORDER BY started_at_ms DESC LIMIT 200").map_err(|e|e.to_string())?
            .query_map([],focus_row).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        let (focus_duration_minutes, break_duration_minutes) = c
            .query_row(
                "SELECT duration_minutes,break_minutes FROM focus_defaults WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let xp: i64 = c
            .query_row("SELECT COALESCE(SUM(xp),0) FROM reward_events", [], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        let earned = strings(
            &c,
            "SELECT definition_id FROM earned_achievements ORDER BY earned_at DESC",
        )?;
        let unlocked = strings(
            &c,
            "SELECT cosmetic_id FROM cosmetic_unlocks ORDER BY unlocked_at DESC",
        )?;
        let (style_id, scarf, headphones): (String, bool, bool) = c
            .query_row(
                "SELECT style_id,scarf,headphones FROM pip_customization WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let history=c.prepare("SELECT id,kind,source_id,CAST(occurred_at AS INTEGER),xp FROM reward_events ORDER BY CAST(occurred_at AS INTEGER) DESC LIMIT 50").map_err(|e|e.to_string())?
            .query_map([],|r|Ok(RewardEvent{id:r.get(0)?,kind:r.get(1)?,source_id:r.get(2)?,occurred_at_ms:r.get(3)?,xp:r.get(4)?})).map_err(|e|e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        Ok(WorkspaceData {
            tasks,
            sessions,
            focus_duration_minutes,
            break_duration_minutes,
            progression: Progression {
                xp,
                level: xp / 100 + 1,
                earned,
                unlocked,
                style_id,
                scarf,
                headphones,
                history,
            },
        })
    }
    pub fn save_task(&self, t: TaskInput) -> Result<(), String> {
        validate_task(&t)?;
        let now = now_ms();
        let subtasks = serde_json::to_string(&t.subtasks).map_err(|e| e.to_string())?;
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("INSERT INTO tasks(id,title,description,category,priority,due_date,due_time,subtasks_json,reminder_offset_minutes,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,priority=excluded.priority,due_date=excluded.due_date,due_time=excluded.due_time,subtasks_json=excluded.subtasks_json,reminder_offset_minutes=excluded.reminder_offset_minutes,updated_at_ms=excluded.updated_at_ms",
            params![t.id,t.title.trim(),t.description,t.category.trim(),t.priority,t.due_date,t.due_time,subtasks,t.reminder_offset_minutes,now]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn delete_task(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute("DELETE FROM tasks WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("Task no longer exists".into());
        }
        Ok(())
    }
    pub fn set_task_completed(&self, id: &str, completed: bool) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(|e| e.to_string())?;
        let current: Option<(Option<i64>, Option<i64>)> = tx
            .query_row(
                "SELECT completed_at_ms,first_completed_at_ms FROM tasks WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (completed_at, first_completed_at) = current.ok_or("Task no longer exists")?;
        if completed_at.is_some() == completed {
            return Ok(());
        }
        let now = now_ms();
        tx.execute("UPDATE tasks SET completed_at_ms=?2,first_completed_at_ms=COALESCE(first_completed_at_ms,?2),updated_at_ms=?3 WHERE id=?1",
            params![id,if completed {Some(now)} else {None},now]).map_err(|e|e.to_string())?;
        if completed && first_completed_at.is_none() {
            award(&tx, "task_completed", id, 25, now)?
        }
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn set_focus_defaults(&self, duration: i64, break_minutes: i64) -> Result<(), String> {
        validate_duration(duration, break_minutes)?;
        self.0
            .lock()
            .map_err(|_| "database lock failed")?
            .execute(
                "UPDATE focus_defaults SET duration_minutes=?1,break_minutes=?2 WHERE id=1",
                params![duration, break_minutes],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn focus_action(
        &self,
        action: &str,
        id: &str,
        task_id: Option<&str>,
        duration: i64,
        break_minutes: i64,
    ) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(|e| e.to_string())?;
        let now = now_ms();
        if action == "start" {
            validate_duration(duration, break_minutes)?;
            if id.is_empty() {
                return Err("Session identifier is required".into());
            }
            let active: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM focus_sessions WHERE status IN ('running','paused')",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if active > 0 {
                return Err("Finish or stop the current focus session first".into());
            }
            tx.execute("INSERT INTO focus_sessions(id,task_id,status,duration_minutes,break_minutes,started_at_ms,run_started_at_ms,elapsed_ms) VALUES (?1,?2,'running',?3,?4,?5,?5,0)",params![id,task_id,duration,break_minutes,now]).map_err(|e|e.to_string())?;
        } else {
            let s:FocusSession=tx.query_row("SELECT id,task_id,status,duration_minutes,break_minutes,started_at_ms,run_started_at_ms,elapsed_ms,finished_at_ms FROM focus_sessions WHERE id=?1",[id],focus_row).optional().map_err(|e|e.to_string())?.ok_or("Focus session no longer exists")?;
            let elapsed =
                s.elapsed_ms + s.run_started_at_ms.map_or(0, |start| (now - start).max(0));
            match action {
                "pause" if s.status == "running" => {
                    tx.execute("UPDATE focus_sessions SET status='paused',run_started_at_ms=NULL,elapsed_ms=?2 WHERE id=?1",params![id,elapsed]).map_err(|e|e.to_string())?;
                }
                "resume" if s.status == "paused" => {
                    tx.execute("UPDATE focus_sessions SET status='running',run_started_at_ms=?2 WHERE id=?1",params![id,now]).map_err(|e|e.to_string())?;
                }
                "stop" if s.status == "running" || s.status == "paused" => {
                    tx.execute("UPDATE focus_sessions SET status='stopped',run_started_at_ms=NULL,elapsed_ms=?2,finished_at_ms=?3 WHERE id=?1",params![id,elapsed,now]).map_err(|e|e.to_string())?;
                }
                "complete" if s.status == "completed" => return Ok(()),
                "complete" if s.status == "running" && elapsed >= s.duration_minutes * 60_000 => {
                    tx.execute("UPDATE focus_sessions SET status='completed',run_started_at_ms=NULL,elapsed_ms=?2,finished_at_ms=?3 WHERE id=?1",params![id,elapsed,now]).map_err(|e|e.to_string())?;
                    award(&tx, "focus_completed", id, 50, now)?;
                }
                "complete" => {
                    return Err("Focus time has not finished; no completion was recorded".into())
                }
                _ => return Err("Focus action is not available in this state".into()),
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn equip_cosmetic(&self, id: &str, equipped: bool) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if id != "classic" && equipped {
            let unlocked: bool = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM cosmetic_unlocks WHERE cosmetic_id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !unlocked {
                return Err("This cosmetic is still locked".into());
            }
        }
        match id {
            "classic" | "berry" => {
                c.execute(
                    "UPDATE pip_customization SET style_id=?1 WHERE id=1",
                    [if equipped { id } else { "classic" }],
                )
                .map_err(|e| e.to_string())?;
            }
            "scarf" | "headphones" => {
                let column = if id == "scarf" { "scarf" } else { "headphones" };
                c.execute(
                    &format!("UPDATE pip_customization SET {column}=?1 WHERE id=1"),
                    [equipped],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => return Err("Unknown cosmetic".into()),
        }
        Ok(())
    }
}
fn validate_duration(d: i64, b: i64) -> Result<(), String> {
    if !(1..=180).contains(&d) || !(1..=60).contains(&b) {
        Err("Focus must be 1–180 minutes and break 1–60 minutes".into())
    } else {
        Ok(())
    }
}
fn achievement(
    tx: &Transaction<'_>,
    id: &str,
    event: &str,
    cosmetic: Option<&str>,
    now: i64,
) -> Result<(), String> {
    let changed=tx.execute("INSERT OR IGNORE INTO earned_achievements(definition_id,rule_version,event_id,earned_at) VALUES (?1,1,?2,?3)",params![id,event,now.to_string()]).map_err(|e|e.to_string())?;
    if changed > 0 {
        if let Some(cosmetic) = cosmetic {
            tx.execute("INSERT OR IGNORE INTO cosmetic_unlocks(cosmetic_id,source_event_id,unlocked_at) VALUES (?1,?2,?3)",params![cosmetic,event,now.to_string()]).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}
fn award(tx: &Transaction<'_>, kind: &str, source: &str, xp: i64, now: i64) -> Result<(), String> {
    let event = format!("{kind}:{source}");
    if tx.execute("INSERT OR IGNORE INTO reward_events(id,kind,source_id,occurred_at,xp) VALUES (?1,?2,?3,?4,?5)",params![event,kind,source,now.to_string(),xp]).map_err(|e|e.to_string())?==0{return Ok(())}
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM reward_events WHERE kind=?1",
            [kind],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if kind == "task_completed" {
        if count == 1 {
            achievement(tx, "first_task", &event, Some("scarf"), now)?
        }
        if count == 5 {
            achievement(tx, "five_tasks", &event, Some("berry"), now)?
        }
    } else if kind == "focus_completed" {
        if count == 1 {
            achievement(tx, "first_focus", &event, None, now)?
        }
        if count == 3 {
            achievement(tx, "three_focus", &event, Some("headphones"), now)?
        }
    }
    let total: i64 = tx
        .query_row("SELECT COALESCE(SUM(xp),0) FROM reward_events", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if total >= 400 {
        achievement(tx, "level_five", &event, None, now)?
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> (Database, std::path::PathBuf) {
        let p = std::env::temp_dir().join(format!(
            "civildesk-prod-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        (Database::open(&p).unwrap(), p)
    }
    fn task(id: &str) -> TaskInput {
        TaskInput {
            id: id.into(),
            title: "Draft section".into(),
            description: String::new(),
            category: String::new(),
            priority: "normal".into(),
            due_date: None,
            due_time: None,
            subtasks: vec![],
            reminder_offset_minutes: None,
        }
    }
    #[test]
    fn calendar_validation() {
        assert!(valid_date("2024-02-29"));
        assert!(!valid_date("2025-02-29"));
        assert!(!valid_date("2025-13-01"));
        assert!(valid_time("23:59"));
        assert!(!valid_time("24:00"))
    }
    #[test]
    fn task_reward_survives_reopen() {
        let (d, p) = db();
        d.save_task(task("one")).unwrap();
        d.set_task_completed("one", true).unwrap();
        d.set_task_completed("one", true).unwrap();
        d.set_task_completed("one", false).unwrap();
        d.set_task_completed("one", true).unwrap();
        assert_eq!(d.workspace().unwrap().progression.xp, 25);
        drop(d);
        let d = Database::open(&p).unwrap();
        assert_eq!(d.workspace().unwrap().progression.xp, 25);
        assert!(d
            .workspace()
            .unwrap()
            .progression
            .unlocked
            .contains(&"scarf".to_string()));
        drop(d);
        std::fs::remove_file(p).unwrap()
    }
    #[test]
    fn focus_cannot_finish_early() {
        let (d, p) = db();
        d.focus_action("start", "session", None, 1, 5).unwrap();
        assert!(d.focus_action("complete", "session", None, 0, 0).is_err());
        d.focus_action("pause", "session", None, 0, 0).unwrap();
        drop(d);
        let d = Database::open(&p).unwrap();
        assert_eq!(d.workspace().unwrap().sessions[0].status, "paused");
        d.focus_action("stop", "session", None, 0, 0).unwrap();
        assert_eq!(d.workspace().unwrap().progression.xp, 0);
        drop(d);
        std::fs::remove_file(p).unwrap()
    }

    #[test]
    fn five_tasks_unlock_style_and_equipment_persists() {
        let (d, p) = db();
        assert!(d.equip_cosmetic("berry", true).is_err());
        for i in 0..5 {
            let id = format!("task-{i}");
            d.save_task(task(&id)).unwrap();
            d.set_task_completed(&id, true).unwrap();
        }
        let progress = d.workspace().unwrap().progression;
        assert_eq!(progress.xp, 125);
        assert!(progress.earned.contains(&"five_tasks".to_string()));
        assert!(progress.unlocked.contains(&"berry".to_string()));
        d.equip_cosmetic("berry", true).unwrap();
        d.equip_cosmetic("scarf", true).unwrap();
        drop(d);
        let d = Database::open(&p).unwrap();
        assert_eq!(d.workspace().unwrap().progression.style_id, "berry");
        assert!(d.workspace().unwrap().progression.scarf);
        drop(d);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn focus_rewards_are_transactional_and_unique() {
        let (d, p) = db();
        for i in 0..3 {
            let id = format!("focus-{i}");
            d.focus_action("start", &id, None, 1, 5).unwrap();
            d.0.lock()
                .unwrap()
                .execute(
                    "UPDATE focus_sessions SET run_started_at_ms=?2 WHERE id=?1",
                    params![id, now_ms() - 61_000],
                )
                .unwrap();
            d.focus_action("complete", &id, None, 0, 0).unwrap();
            d.focus_action("complete", &id, None, 0, 0).unwrap();
        }
        let progress = d.workspace().unwrap().progression;
        assert_eq!(progress.xp, 150);
        assert_eq!(progress.history.len(), 3);
        assert!(progress.unlocked.contains(&"headphones".to_string()));
        drop(d);
        std::fs::remove_file(p).unwrap();
    }
}
