//! Study experience (schema v7): planned study blocks and weekly goals.
//!
//! Actual study time is never stored here. It lives in `focus_sessions`, the one authoritative timer
//! record: a session started from academic context carries `course_id` (and optionally the task and the
//! study block). A study block is only a plan; it counts as done when a completed session links to it.

use crate::persistence::Database;
use crate::productivity::{now_ms, valid_date, valid_time};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyBlock {
    pub id: String,
    pub course_id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_date: String,
    pub start_time: String,
    pub duration_minutes: i64,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub cancelled_at_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyBlockInput {
    pub id: String,
    pub course_id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_date: String,
    pub start_time: String,
    pub duration_minutes: i64,
}

/// A weekly target that applies from `effective_week` (a Monday) until a later row replaces it.
/// Both targets empty means "no goal from this week on".
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyGoal {
    pub course_id: String,
    pub effective_week: String,
    pub weekly_minutes: Option<i64>,
    pub weekly_sessions: Option<i64>,
}

/// A completed Focus session that belongs to a course. `credited_ms` is the timer's elapsed time,
/// capped at the session's own length.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySession {
    pub id: String,
    pub course_id: String,
    pub task_id: Option<String>,
    pub study_block_id: Option<String>,
    pub credited_ms: i64,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyData {
    pub blocks: Vec<StudyBlock>,
    pub goals: Vec<StudyGoal>,
    pub sessions: Vec<StudySession>,
}

fn sql(e: rusqlite::Error) -> String {
    e.to_string()
}

/// 0 = Monday … 6 = Sunday, for a valid `YYYY-MM-DD` date (Sakamoto's method).
fn weekday_from_monday(date: &str) -> u32 {
    let y: i32 = date[0..4].parse().unwrap_or(2000);
    let m: usize = date[5..7].parse().unwrap_or(1);
    let d: i32 = date[8..10].parse().unwrap_or(1);
    let offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    let sunday_first = (y + y / 4 - y / 100 + y / 400 + offsets[m - 1] + d).rem_euclid(7) as u32;
    (sunday_first + 6) % 7
}

fn has_completed_session(c: &Connection, block_id: &str) -> Result<bool, String> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM focus_sessions WHERE study_block_id=?1 AND status='completed')",
        [block_id],
        |r| r.get(0),
    )
    .map_err(sql)
}

/// Works out the academic context of a new Focus session and rejects inconsistent combinations.
/// Returns `(course_id, task_id, study_block_id)`.
#[allow(clippy::type_complexity)]
pub(crate) fn resolve_focus_context(
    c: &Connection,
    course_id: Option<&str>,
    task_id: Option<&str>,
    block_id: Option<&str>,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let mut course = course_id.map(str::to_string);
    let mut task = task_id.map(str::to_string);
    if let Some(block) = block_id {
        let row: Option<(String, Option<String>, String)> = c
            .query_row(
                "SELECT course_id,task_id,status FROM study_blocks WHERE id=?1",
                [block],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(sql)?;
        let (block_course, block_task, status) = row.ok_or("Study block no longer exists")?;
        if status != "planned" {
            return Err("A cancelled study block cannot be started".into());
        }
        if course.as_deref().is_some_and(|x| x != block_course) {
            return Err("The study block belongs to a different course".into());
        }
        course = Some(block_course);
        if task.is_none() {
            task = block_task;
        }
    }
    if let Some(t) = &task {
        let linked: Option<String> = c
            .query_row(
                "SELECT course_id FROM task_academic WHERE task_id=?1",
                [t],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if let Some(linked) = linked {
            if course.as_deref().is_some_and(|x| x != linked) {
                return Err("The task belongs to a different course".into());
            }
            course = Some(linked);
        }
    }
    if let Some(c_id) = &course {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM courses WHERE id=?1)",
                [c_id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if !exists {
            return Err("Course no longer exists".into());
        }
    }
    Ok((course, task, block_id.map(str::to_string)))
}

impl Database {
    pub fn study(&self) -> Result<StudyData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let blocks = c
            .prepare("SELECT id,course_id,task_id,title,start_date,start_time,duration_minutes,status,created_at_ms,updated_at_ms,cancelled_at_ms FROM study_blocks ORDER BY start_date, start_time, created_at_ms")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(StudyBlock {
                    id: r.get(0)?,
                    course_id: r.get(1)?,
                    task_id: r.get(2)?,
                    title: r.get(3)?,
                    start_date: r.get(4)?,
                    start_time: r.get(5)?,
                    duration_minutes: r.get(6)?,
                    status: r.get(7)?,
                    created_at_ms: r.get(8)?,
                    updated_at_ms: r.get(9)?,
                    cancelled_at_ms: r.get(10)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        let goals = c
            .prepare("SELECT course_id,effective_week,weekly_minutes,weekly_sessions FROM study_goals ORDER BY course_id, effective_week")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(StudyGoal {
                    course_id: r.get(0)?,
                    effective_week: r.get(1)?,
                    weekly_minutes: r.get(2)?,
                    weekly_sessions: r.get(3)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        let sessions = c
            .prepare("SELECT id,course_id,task_id,study_block_id,MIN(elapsed_ms,duration_minutes*60000),started_at_ms,finished_at_ms FROM focus_sessions WHERE status='completed' AND course_id IS NOT NULL AND finished_at_ms IS NOT NULL ORDER BY finished_at_ms DESC")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(StudySession {
                    id: r.get(0)?,
                    course_id: r.get(1)?,
                    task_id: r.get(2)?,
                    study_block_id: r.get(3)?,
                    credited_ms: r.get(4)?,
                    started_at_ms: r.get(5)?,
                    finished_at_ms: r.get(6)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        Ok(StudyData {
            blocks,
            goals,
            sessions,
        })
    }

    /// Creates or reschedules a planned block. Blocks that already produced a completed session are history.
    pub fn save_study_block(&self, b: StudyBlockInput) -> Result<(), String> {
        if b.id.is_empty() || b.id.len() > 100 || b.course_id.is_empty() {
            return Err("Invalid study block".into());
        }
        if b.title.chars().count() > 120 {
            return Err("The study objective is too long".into());
        }
        if !valid_date(&b.start_date) || !valid_time(&b.start_time) {
            return Err("Choose a valid date and start time".into());
        }
        if !(5..=480).contains(&b.duration_minutes) {
            return Err("A study block must last 5–480 minutes".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let unavailable: Option<bool> = tx
            .query_row(
                "SELECT c.archived OR s.archived FROM courses c JOIN semesters s ON s.id=c.semester_id WHERE c.id=?1",
                [&b.course_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        match unavailable {
            None => return Err("Course no longer exists".into()),
            Some(true) => {
                return Err(
                    "Restore the archived course or semester before scheduling study time".into(),
                )
            }
            Some(false) => {}
        }
        if let Some(task) = &b.task_id {
            let linked: Option<String> = tx
                .query_row(
                    "SELECT course_id FROM task_academic WHERE task_id=?1",
                    [task],
                    |r| r.get(0),
                )
                .optional()
                .map_err(sql)?;
            if linked.as_deref() != Some(b.course_id.as_str()) {
                return Err("Choose coursework that belongs to this course".into());
            }
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT status FROM study_blocks WHERE id=?1",
                [&b.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if let Some(status) = existing {
            if status != "planned" {
                return Err("Restore a cancelled study block before changing it".into());
            }
            if has_completed_session(&tx, &b.id)? {
                return Err(
                    "A study block that was already studied is history and cannot be rescheduled"
                        .into(),
                );
            }
        }
        let now = now_ms();
        tx.execute(
            "INSERT INTO study_blocks(id,course_id,task_id,title,start_date,start_time,duration_minutes,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)
             ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id,task_id=excluded.task_id,title=excluded.title,start_date=excluded.start_date,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes,updated_at_ms=excluded.updated_at_ms",
            params![b.id, b.course_id, b.task_id, b.title.trim(), b.start_date, b.start_time, b.duration_minutes, now],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    /// Soft cancellation: the row stays, it just stops being an active plan. Studied blocks cannot be cancelled.
    pub fn set_study_block_cancelled(&self, id: &str, cancelled: bool) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM study_blocks WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if !exists {
            return Err("Study block no longer exists".into());
        }
        if cancelled && has_completed_session(&c, id)? {
            return Err("A study block that was already studied cannot be cancelled".into());
        }
        let now = now_ms();
        c.execute(
            "UPDATE study_blocks SET status=?2, cancelled_at_ms=?3, updated_at_ms=?4 WHERE id=?1",
            params![
                id,
                if cancelled { "cancelled" } else { "planned" },
                if cancelled { Some(now) } else { None },
                now
            ],
        )
        .map_err(sql)?;
        Ok(())
    }

    pub fn save_study_goal(&self, g: StudyGoal) -> Result<(), String> {
        if !valid_date(&g.effective_week) || weekday_from_monday(&g.effective_week) != 0 {
            return Err("A weekly goal takes effect from a Monday".into());
        }
        if g.weekly_minutes.is_some_and(|v| !(1..=10080).contains(&v))
            || g.weekly_sessions.is_some_and(|v| !(1..=100).contains(&v))
        {
            return Err("Weekly goals must be 1–10080 minutes or 1–100 sessions".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM courses WHERE id=?1)",
                [&g.course_id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if !exists {
            return Err("Course no longer exists".into());
        }
        c.execute(
            "INSERT INTO study_goals(course_id,effective_week,weekly_minutes,weekly_sessions,updated_at_ms) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(course_id,effective_week) DO UPDATE SET weekly_minutes=excluded.weekly_minutes,weekly_sessions=excluded.weekly_sessions,updated_at_ms=excluded.updated_at_ms",
            params![g.course_id, g.effective_week, g.weekly_minutes, g.weekly_sessions, now_ms()],
        )
        .map_err(sql)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::academic::{CourseInput, CourseworkInput, SemesterInput};
    use crate::persistence::migrate;
    use crate::productivity::TaskInput;
    use std::sync::Mutex;

    fn db() -> Database {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&c).unwrap();
        let d = Database(Mutex::new(c));
        d.save_semester(SemesterInput {
            id: "s".into(),
            name: "Fall".into(),
            institution: String::new(),
            start_date: "2026-08-24".into(),
            end_date: "2026-12-18".into(),
            make_active: true,
        })
        .unwrap();
        for (id, code) in [("c1", "CSE 1321"), ("c2", "MATH 2")] {
            d.save_course(CourseInput {
                id: id.into(),
                semester_id: "s".into(),
                code: code.into(),
                name: code.into(),
                instructor: String::new(),
                description: String::new(),
                meeting_schedule: String::new(),
                location: String::new(),
                color: String::new(),
            })
            .unwrap();
        }
        d.save_coursework(CourseworkInput {
            task: TaskInput {
                id: "exam".into(),
                title: "Midterm".into(),
                description: String::new(),
                category: "School".into(),
                priority: "normal".into(),
                due_date: Some("2026-11-10".into()),
                due_time: None,
                subtasks: vec![],
                reminder_offset_minutes: None,
            },
            course_id: "c1".into(),
            work_type: "exam".into(),
            reference_notes: String::new(),
        })
        .unwrap();
        d
    }
    fn block(id: &str, course: &str, task: Option<&str>) -> StudyBlockInput {
        StudyBlockInput {
            id: id.into(),
            course_id: course.into(),
            task_id: task.map(str::to_string),
            title: "Review".into(),
            start_date: "2026-11-05".into(),
            start_time: "18:30".into(),
            duration_minutes: 60,
        }
    }
    /// Runs a real (1 minute) session to completion by rewinding its clock, then completes it through the production path.
    fn complete_session(
        d: &Database,
        id: &str,
        task: Option<&str>,
        course: Option<&str>,
        blk: Option<&str>,
    ) {
        d.focus_action("start", id, task, 1, 5, course, blk)
            .unwrap();
        d.0.lock()
            .unwrap()
            .execute(
                "UPDATE focus_sessions SET run_started_at_ms = run_started_at_ms - 61000 WHERE id=?1",
                [id],
            )
            .unwrap();
        d.focus_action("complete", id, None, 0, 0, None, None)
            .unwrap();
    }

    #[test]
    fn weekday_math_matches_known_dates() {
        assert_eq!(weekday_from_monday("2026-11-02"), 0); // Monday
        assert_eq!(weekday_from_monday("2026-11-08"), 6); // Sunday
        assert_eq!(weekday_from_monday("2024-02-29"), 3); // Thursday
        assert_eq!(weekday_from_monday("2000-01-01"), 5); // Saturday
    }

    #[test]
    fn blocks_are_created_edited_rescheduled_and_validated() {
        let d = db();
        d.save_study_block(block("b1", "c1", Some("exam"))).unwrap();
        let mut moved = block("b1", "c1", Some("exam"));
        moved.start_date = "2026-11-06".into();
        moved.duration_minutes = 90;
        d.save_study_block(moved).unwrap();
        let data = d.study().unwrap();
        assert_eq!(data.blocks.len(), 1);
        assert_eq!(
            (
                data.blocks[0].start_date.as_str(),
                data.blocks[0].duration_minutes
            ),
            ("2026-11-06", 90)
        );
        // The exam's deadline is untouched by scheduling.
        assert_eq!(
            d.workspace().unwrap().tasks[0].due_date.as_deref(),
            Some("2026-11-10")
        );
        let mut bad = block("b2", "c1", None);
        bad.start_time = "25:00".into();
        assert!(d.save_study_block(bad).is_err());
        let mut short = block("b2", "c1", None);
        short.duration_minutes = 1;
        assert!(d.save_study_block(short).is_err());
        assert!(d.save_study_block(block("b2", "nope", None)).is_err());
        // Coursework of another course cannot be attached.
        assert!(d.save_study_block(block("b3", "c2", Some("exam"))).is_err());
    }

    #[test]
    fn cancellation_is_soft_and_reversible() {
        let d = db();
        d.save_study_block(block("b1", "c1", None)).unwrap();
        d.set_study_block_cancelled("b1", true).unwrap();
        let blocks = d.study().unwrap().blocks;
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].status, "cancelled");
        assert!(blocks[0].cancelled_at_ms.is_some());
        assert!(d.save_study_block(block("b1", "c1", None)).is_err());
        d.set_study_block_cancelled("b1", false).unwrap();
        assert_eq!(d.study().unwrap().blocks[0].status, "planned");
    }

    #[test]
    fn focus_started_from_a_block_records_course_task_and_block_and_credits_timer_time() {
        let d = db();
        d.save_study_block(block("b1", "c1", Some("exam"))).unwrap();
        complete_session(&d, "s1", None, None, Some("b1"));
        let study = d.study().unwrap();
        assert_eq!(study.sessions.len(), 1);
        let s = &study.sessions[0];
        assert_eq!(
            (
                s.course_id.as_str(),
                s.task_id.as_deref(),
                s.study_block_id.as_deref()
            ),
            ("c1", Some("exam"), Some("b1"))
        );
        // 1-minute session, not the 60-minute plan.
        assert_eq!(s.credited_ms, 60_000);
        assert!(d.set_study_block_cancelled("b1", true).is_err());
        assert!(d.save_study_block(block("b1", "c1", None)).is_err());
    }

    #[test]
    fn completion_is_idempotent_and_awards_xp_once() {
        let d = db();
        d.focus_action("start", "s1", Some("exam"), 1, 5, None, None)
            .unwrap();
        d.0.lock()
            .unwrap()
            .execute(
                "UPDATE focus_sessions SET run_started_at_ms = run_started_at_ms - 61000",
                [],
            )
            .unwrap();
        for _ in 0..3 {
            d.focus_action("complete", "s1", None, 0, 0, None, None)
                .unwrap();
        }
        let study = d.study().unwrap();
        assert_eq!(study.sessions.len(), 1);
        assert_eq!(study.sessions[0].course_id, "c1"); // derived from the academic task
        assert_eq!(d.workspace().unwrap().progression.xp, 50);
    }

    #[test]
    fn stopped_early_and_general_sessions_are_not_study_time() {
        let d = db();
        d.focus_action("start", "stopped", None, 25, 5, Some("c1"), None)
            .unwrap();
        d.focus_action("stop", "stopped", None, 0, 0, None, None)
            .unwrap();
        assert!(d
            .focus_action("complete", "stopped", None, 0, 0, None, None)
            .is_err());
        complete_session(&d, "general", None, None, None);
        assert!(d.study().unwrap().sessions.is_empty());
        assert_eq!(d.workspace().unwrap().progression.xp, 50); // the general session still earns its normal reward
    }

    #[test]
    fn inconsistent_focus_context_is_rejected() {
        let d = db();
        d.save_study_block(block("b1", "c1", None)).unwrap();
        d.save_study_block(block("b2", "c2", None)).unwrap();
        assert!(d
            .focus_action("start", "x", None, 5, 5, Some("c2"), Some("b1"))
            .is_err());
        assert!(d
            .focus_action("start", "x", Some("exam"), 5, 5, Some("c2"), None)
            .is_err());
        assert!(d
            .focus_action("start", "x", None, 5, 5, None, Some("missing"))
            .is_err());
        d.set_study_block_cancelled("b2", true).unwrap();
        assert!(d
            .focus_action("start", "x", None, 5, 5, None, Some("b2"))
            .is_err());
        assert_eq!(d.workspace().unwrap().sessions.len(), 0);
    }

    #[test]
    fn goals_apply_from_a_monday_and_keep_history() {
        let d = db();
        let goal = |week: &str, minutes: Option<i64>| StudyGoal {
            course_id: "c1".into(),
            effective_week: week.into(),
            weekly_minutes: minutes,
            weekly_sessions: None,
        };
        assert!(d.save_study_goal(goal("2026-11-03", Some(120))).is_err()); // a Tuesday
        assert!(d.save_study_goal(goal("2026-11-02", Some(0))).is_err());
        d.save_study_goal(goal("2026-10-26", Some(120))).unwrap();
        d.save_study_goal(goal("2026-11-02", Some(180))).unwrap();
        d.save_study_goal(goal("2026-11-02", Some(240))).unwrap();
        d.save_study_goal(goal("2026-11-09", None)).unwrap();
        let goals = d.study().unwrap().goals;
        assert_eq!(goals.len(), 3);
        assert_eq!(goals[0].weekly_minutes, Some(120)); // earlier week keeps its own target
        assert_eq!(goals[1].weekly_minutes, Some(240));
        assert_eq!(goals[2].weekly_minutes, None);
        let mut other = goal("2026-11-02", Some(60));
        other.course_id = "missing".into();
        assert!(d.save_study_goal(other).is_err());
    }

    #[test]
    fn history_survives_task_deletion_and_course_archive_and_moves_detach_blocks() {
        let d = db();
        d.save_study_block(block("b1", "c1", Some("exam"))).unwrap();
        complete_session(&d, "s1", Some("exam"), None, Some("b1"));
        d.set_course_archived("c1", true).unwrap();
        d.delete_task("exam").unwrap();
        let study = d.study().unwrap();
        assert_eq!(study.sessions.len(), 1);
        assert_eq!(study.sessions[0].task_id, None);
        assert_eq!(study.blocks[0].task_id, None);
        assert!(d.save_study_block(block("b9", "c1", None)).is_err()); // archived course takes no new plans

        let d = db();
        d.save_study_block(block("b1", "c1", Some("exam"))).unwrap();
        d.save_coursework(CourseworkInput {
            task: TaskInput {
                id: "exam".into(),
                title: "Midterm".into(),
                description: String::new(),
                category: "School".into(),
                priority: "normal".into(),
                due_date: Some("2026-11-12".into()),
                due_time: None,
                subtasks: vec![],
                reminder_offset_minutes: None,
            },
            course_id: "c2".into(),
            work_type: "exam".into(),
            reference_notes: String::new(),
        })
        .unwrap();
        let study = d.study().unwrap();
        assert_eq!(study.blocks[0].course_id, "c1");
        assert_eq!(study.blocks[0].task_id, None); // detached, not deleted
    }

    #[test]
    fn migration_from_v6_preserves_everything_and_is_repeatable() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&c).unwrap();
        // Rebuild the v6 shape of focus_sessions and drop the v7 tables.
        c.execute_batch("DROP TABLE portfolio_milestones; DROP TABLE portfolio_gallery; DROP TABLE portfolio_tools; DROP TABLE portfolio_case_studies; DROP TABLE daily_priorities; DROP TABLE recurrence_occurrences; DROP TABLE recurrence_rules; DROP TABLE routine_execution_steps; DROP TABLE routine_executions; DROP TABLE routine_steps; DROP TABLE routines; DROP TABLE habit_checkins; DROP TABLE habit_schedules; DROP TABLE habits; DROP TABLE goal_entries; DROP TABLE goal_targets; DROP TABLE goals;
            DROP TABLE study_goals; DROP TABLE study_blocks; DROP TABLE focus_sessions;
            CREATE TABLE focus_sessions (
                id TEXT PRIMARY KEY NOT NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                status TEXT NOT NULL, duration_minutes INTEGER NOT NULL, break_minutes INTEGER NOT NULL,
                started_at_ms INTEGER NOT NULL, run_started_at_ms INTEGER, elapsed_ms INTEGER NOT NULL DEFAULT 0,
                finished_at_ms INTEGER
            );
            CREATE UNIQUE INDEX one_active_focus ON focus_sessions((1)) WHERE status IN ('running', 'paused');
            PRAGMA user_version = 6;
            INSERT INTO semesters(id,name,start_date,end_date,is_active,created_at_ms,updated_at_ms) VALUES ('s','Fall','2026-08-24','2026-12-18',1,1,1);
            INSERT INTO courses(id,semester_id,code,name,created_at_ms,updated_at_ms) VALUES ('c','s','CSE','P',1,1);
            INSERT INTO tasks(id,title,category,created_at_ms,updated_at_ms) VALUES ('t','Homework','School',1,1);
            INSERT INTO task_academic(task_id,course_id,work_type,created_at_ms) VALUES ('t','c','assignment',1);
            INSERT INTO focus_sessions(id,task_id,status,duration_minutes,break_minutes,started_at_ms,elapsed_ms,finished_at_ms) VALUES ('old','t','completed',25,5,1,1500000,2);
            INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms) VALUES ('p','Bridge','','Civil','S','D','Planning',1,1);
            INSERT INTO reward_events(id,kind,source_id,occurred_at,xp) VALUES ('r','focus_completed','old','1',50);").unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let version: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 9);
        let d = Database(Mutex::new(c));
        // Pre-existing focus history is kept; it simply has no course context (it is not guessed).
        let w = d.workspace().unwrap();
        assert_eq!(
            (w.tasks.len(), w.sessions.len(), w.progression.xp),
            (1, 1, 50)
        );
        assert_eq!(d.academic().unwrap().work.len(), 1);
        assert!(d.study().unwrap().sessions.is_empty());
        let conn = d.0.lock().unwrap();
        let projects: i64 = conn
            .query_row("SELECT COUNT(*) FROM engineering_projects", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(projects, 1);
        let check: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(check, "ok");
        let fk: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fk, 0);
    }
}
