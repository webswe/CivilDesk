//! Academic foundation (schema v6): semesters, courses and coursework metadata.
//!
//! Coursework is never a second kind of task. An assignment, quiz or exam is an ordinary row in
//! `tasks` (so completion, XP, Calendar, My Day and Focus keep working unchanged) plus one
//! optional `task_academic` row that links it to a course. Nothing here deletes tasks.

use crate::persistence::Database;
use crate::productivity::{now_ms, upsert_task, valid_date, TaskInput};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Semester {
    pub id: String,
    pub name: String,
    pub institution: String,
    pub start_date: String,
    pub end_date: String,
    pub active: bool,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemesterInput {
    pub id: String,
    pub name: String,
    pub institution: String,
    pub start_date: String,
    pub end_date: String,
    /// Only ever set when the user explicitly asks; saving never changes the active semester otherwise.
    pub make_active: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub semester_id: String,
    pub code: String,
    pub name: String,
    pub instructor: String,
    pub description: String,
    pub meeting_schedule: String,
    pub location: String,
    pub color: String,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseInput {
    pub id: String,
    pub semester_id: String,
    pub code: String,
    pub name: String,
    pub instructor: String,
    pub description: String,
    pub meeting_schedule: String,
    pub location: String,
    pub color: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseworkLink {
    pub task_id: String,
    pub course_id: String,
    pub work_type: String,
    pub reference_notes: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseworkInput {
    pub task: TaskInput,
    pub course_id: String,
    pub work_type: String,
    pub reference_notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicData {
    pub semesters: Vec<Semester>,
    pub courses: Vec<Course>,
    pub work: Vec<CourseworkLink>,
}

fn sql(e: rusqlite::Error) -> String {
    let text = e.to_string();
    if text.contains("courses_semester_code") || text.contains("courses.semester_id") {
        "This semester already has a course with that code.".into()
    } else {
        text
    }
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100
}

fn valid_color(s: &str) -> bool {
    s.is_empty()
        || (s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()))
}

fn validate_semester(s: &SemesterInput) -> Result<(), String> {
    if !valid_id(&s.id) {
        return Err("Invalid semester identifier".into());
    }
    if s.name.trim().is_empty() || s.name.chars().count() > 80 {
        return Err("Semester name must be 1–80 characters".into());
    }
    if s.institution.chars().count() > 120 {
        return Err("Institution name is too long".into());
    }
    if !valid_date(&s.start_date) || !valid_date(&s.end_date) {
        return Err("Choose a valid start and end date".into());
    }
    if s.end_date < s.start_date {
        return Err("The semester cannot end before it starts".into());
    }
    Ok(())
}

fn validate_course(c: &CourseInput) -> Result<(), String> {
    if !valid_id(&c.id) || !valid_id(&c.semester_id) {
        return Err("Invalid course identifier".into());
    }
    if c.code.trim().is_empty() || c.code.chars().count() > 30 {
        return Err("Course code must be 1–30 characters".into());
    }
    if c.name.trim().is_empty() || c.name.chars().count() > 120 {
        return Err("Course name must be 1–120 characters".into());
    }
    if c.instructor.chars().count() > 120
        || c.location.chars().count() > 120
        || c.meeting_schedule.chars().count() > 200
        || c.description.chars().count() > 5_000
    {
        return Err("A course field is too long".into());
    }
    if !valid_color(&c.color) {
        return Err("Course color must look like #A1B2C3".into());
    }
    Ok(())
}

fn semester_state(c: &Connection, id: &str) -> Result<(bool, bool), String> {
    c.query_row(
        "SELECT is_active, archived FROM semesters WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "Semester no longer exists".into())
}

impl Database {
    pub fn academic(&self) -> Result<AcademicData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let semesters = c
            .prepare("SELECT id,name,institution,start_date,end_date,is_active,archived,created_at_ms,updated_at_ms FROM semesters ORDER BY start_date DESC, created_at_ms DESC")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(Semester {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    institution: r.get(2)?,
                    start_date: r.get(3)?,
                    end_date: r.get(4)?,
                    active: r.get(5)?,
                    archived: r.get(6)?,
                    created_at_ms: r.get(7)?,
                    updated_at_ms: r.get(8)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        let courses = c
            .prepare("SELECT id,semester_id,code,name,instructor,description,meeting_schedule,location,color,archived,created_at_ms,updated_at_ms FROM courses ORDER BY code COLLATE NOCASE, created_at_ms")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(Course {
                    id: r.get(0)?,
                    semester_id: r.get(1)?,
                    code: r.get(2)?,
                    name: r.get(3)?,
                    instructor: r.get(4)?,
                    description: r.get(5)?,
                    meeting_schedule: r.get(6)?,
                    location: r.get(7)?,
                    color: r.get(8)?,
                    archived: r.get(9)?,
                    created_at_ms: r.get(10)?,
                    updated_at_ms: r.get(11)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        let work = c
            .prepare("SELECT task_id,course_id,work_type,reference_notes FROM task_academic")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(CourseworkLink {
                    task_id: r.get(0)?,
                    course_id: r.get(1)?,
                    work_type: r.get(2)?,
                    reference_notes: r.get(3)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        Ok(AcademicData {
            semesters,
            courses,
            work,
        })
    }

    pub fn save_semester(&self, s: SemesterInput) -> Result<(), String> {
        validate_semester(&s)?;
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let now = now_ms();
        let existing: Option<bool> = tx
            .query_row("SELECT archived FROM semesters WHERE id=?1", [&s.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(sql)?;
        if s.make_active && existing == Some(true) {
            return Err("Restore an archived semester before making it active".into());
        }
        tx.execute(
            "INSERT INTO semesters(id,name,institution,start_date,end_date,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?6)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,institution=excluded.institution,start_date=excluded.start_date,end_date=excluded.end_date,updated_at_ms=excluded.updated_at_ms",
            params![s.id, s.name.trim(), s.institution.trim(), s.start_date, s.end_date, now],
        )
        .map_err(sql)?;
        if s.make_active {
            tx.execute(
                "UPDATE semesters SET is_active=0 WHERE is_active=1 AND id<>?1",
                [&s.id],
            )
            .map_err(sql)?;
            tx.execute("UPDATE semesters SET is_active=1 WHERE id=?1", [&s.id])
                .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// `None` clears the active semester. Archived semesters cannot be active.
    pub fn set_active_semester(&self, id: Option<&str>) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        if let Some(id) = id {
            let (_, archived) = semester_state(&tx, id)?;
            if archived {
                return Err("Restore an archived semester before making it active".into());
            }
        }
        tx.execute("UPDATE semesters SET is_active=0 WHERE is_active=1", [])
            .map_err(sql)?;
        if let Some(id) = id {
            tx.execute(
                "UPDATE semesters SET is_active=1, updated_at_ms=?2 WHERE id=?1",
                params![id, now_ms()],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// Archiving only hides a semester from day-to-day views. Courses and coursework are untouched.
    pub fn set_semester_archived(&self, id: &str, archived: bool) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        semester_state(&c, id)?;
        c.execute(
            "UPDATE semesters SET archived=?2, is_active=CASE WHEN ?2=1 THEN 0 ELSE is_active END, updated_at_ms=?3 WHERE id=?1",
            params![id, archived, now_ms()],
        )
        .map_err(sql)?;
        Ok(())
    }

    pub fn save_course(&self, input: CourseInput) -> Result<(), String> {
        validate_course(&input)?;
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let (_, semester_archived) = semester_state(&tx, &input.semester_id)?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT semester_id FROM courses WHERE id=?1",
                [&input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if semester_archived && previous.as_deref() != Some(input.semester_id.as_str()) {
            return Err("Courses cannot be added to an archived semester".into());
        }
        let now = now_ms();
        tx.execute(
            "INSERT INTO courses(id,semester_id,code,name,instructor,description,meeting_schedule,location,color,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
             ON CONFLICT(id) DO UPDATE SET semester_id=excluded.semester_id,code=excluded.code,name=excluded.name,instructor=excluded.instructor,description=excluded.description,meeting_schedule=excluded.meeting_schedule,location=excluded.location,color=excluded.color,updated_at_ms=excluded.updated_at_ms",
            params![
                input.id,
                input.semester_id,
                input.code.trim(),
                input.name.trim(),
                input.instructor.trim(),
                input.description,
                input.meeting_schedule.trim(),
                input.location.trim(),
                input.color,
                now
            ],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    /// Archiving a course never touches its coursework; open work keeps appearing in My Day and Calendar.
    pub fn set_course_archived(&self, id: &str, archived: bool) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute(
            "UPDATE courses SET archived=?2, updated_at_ms=?3 WHERE id=?1",
            params![id, archived, now_ms()],
        )
        .map_err(sql)?
            == 0
        {
            return Err("Course no longer exists".into());
        }
        Ok(())
    }

    /// Creates or updates coursework: one task row and one academic link, in one transaction.
    /// Calling it for an existing task with a different `course_id` moves it between courses.
    pub fn save_coursework(&self, input: CourseworkInput) -> Result<(), String> {
        if !["assignment", "quiz", "exam", "general"].contains(&input.work_type.as_str()) {
            return Err("Invalid coursework type".into());
        }
        if input.reference_notes.chars().count() > 5_000 {
            return Err("Reference notes are too long".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let archived: bool = tx
            .query_row(
                "SELECT archived FROM courses WHERE id=?1",
                [&input.course_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?
            .ok_or("Course no longer exists")?;
        let linked: Option<String> = tx
            .query_row(
                "SELECT course_id FROM task_academic WHERE task_id=?1",
                [&input.task.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if archived && linked.as_deref() != Some(input.course_id.as_str()) {
            return Err("Restore this archived course before adding coursework to it".into());
        }
        let exists: bool = tx
            .query_row("SELECT 1 FROM tasks WHERE id=?1", [&input.task.id], |_| {
                Ok(true)
            })
            .optional()
            .map_err(sql)?
            .unwrap_or(false);
        let mut task = input.task;
        if !exists {
            // New coursework is filed under School. An existing task keeps whatever category it had.
            task.category = "School".into();
        }
        upsert_task(&tx, &task)?;
        tx.execute(
            "INSERT INTO task_academic(task_id,course_id,work_type,reference_notes,created_at_ms) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(task_id) DO UPDATE SET course_id=excluded.course_id,work_type=excluded.work_type,reference_notes=excluded.reference_notes",
            params![task.id, input.course_id, input.work_type, input.reference_notes, now_ms()],
        )
        .map_err(sql)?;
        // Study blocks planned for this task in another course no longer describe it; keep the block, drop the link.
        tx.execute(
            "UPDATE study_blocks SET task_id=NULL WHERE task_id=?1 AND course_id<>?2",
            params![task.id, input.course_id],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    /// Detaches a task from its course without touching the task itself.
    pub fn unlink_coursework(&self, task_id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("DELETE FROM task_academic WHERE task_id=?1", [task_id])
            .map_err(sql)?;
        c.execute(
            "UPDATE study_blocks SET task_id=NULL WHERE task_id=?1",
            [task_id],
        )
        .map_err(sql)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::migrate;
    use std::sync::Mutex;

    fn db() -> Database {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&c).unwrap();
        Database(Mutex::new(c))
    }
    fn semester(id: &str, make_active: bool) -> SemesterInput {
        SemesterInput {
            id: id.into(),
            name: format!("Semester {id}"),
            institution: String::new(),
            start_date: "2026-08-24".into(),
            end_date: "2026-12-18".into(),
            make_active,
        }
    }
    fn course(id: &str, semester_id: &str, code: &str) -> CourseInput {
        CourseInput {
            id: id.into(),
            semester_id: semester_id.into(),
            code: code.into(),
            name: "Programming".into(),
            instructor: String::new(),
            description: String::new(),
            meeting_schedule: String::new(),
            location: String::new(),
            color: "#9c4a5a".into(),
        }
    }
    fn task(id: &str) -> TaskInput {
        TaskInput {
            id: id.into(),
            title: "Problem set".into(),
            description: String::new(),
            category: "Whatever".into(),
            priority: "normal".into(),
            due_date: Some("2026-09-01".into()),
            due_time: None,
            subtasks: vec![],
            reminder_offset_minutes: None,
        }
    }
    fn work(task_id: &str, course_id: &str, kind: &str) -> CourseworkInput {
        CourseworkInput {
            task: task(task_id),
            course_id: course_id.into(),
            work_type: kind.into(),
            reference_notes: String::new(),
        }
    }

    #[test]
    fn semesters_validate_dates_and_keep_one_active() {
        let d = db();
        let mut bad = semester("bad", false);
        bad.end_date = "2026-01-01".into();
        assert!(d.save_semester(bad).is_err());
        d.save_semester(semester("a", false)).unwrap();
        d.save_semester(semester("b", false)).unwrap();
        assert!(d.academic().unwrap().semesters.iter().all(|s| !s.active));
        d.set_active_semester(Some("a")).unwrap();
        d.set_active_semester(Some("b")).unwrap();
        let active: Vec<_> = d
            .academic()
            .unwrap()
            .semesters
            .into_iter()
            .filter(|s| s.active)
            .map(|s| s.id)
            .collect();
        assert_eq!(active, vec!["b"]);
        // Editing without make_active never changes the user's choice.
        d.save_semester(semester("a", false)).unwrap();
        assert!(
            d.academic()
                .unwrap()
                .semesters
                .iter()
                .find(|s| s.id == "b")
                .unwrap()
                .active
        );
    }

    #[test]
    fn archiving_deactivates_but_keeps_everything() {
        let d = db();
        d.save_semester(semester("a", true)).unwrap();
        d.save_course(course("c1", "a", "CSE 1321")).unwrap();
        d.save_coursework(work("t1", "c1", "exam")).unwrap();
        d.set_semester_archived("a", true).unwrap();
        let data = d.academic().unwrap();
        assert!(!data.semesters[0].active && data.semesters[0].archived);
        assert_eq!(data.courses.len(), 1);
        assert_eq!(data.work.len(), 1);
        assert!(d.set_active_semester(Some("a")).is_err());
        assert!(d.save_course(course("c2", "a", "MATH 1")).is_err());
    }

    #[test]
    fn same_course_code_allowed_across_semesters_but_not_within_one() {
        let d = db();
        d.save_semester(semester("a", false)).unwrap();
        d.save_semester(semester("b", false)).unwrap();
        d.save_course(course("c1", "a", "CSE 1321")).unwrap();
        d.save_course(course("c2", "b", "cse 1321")).unwrap();
        assert!(d.save_course(course("c3", "a", "cse 1321")).is_err());
    }

    #[test]
    fn coursework_is_one_task_and_survives_move_and_archive() {
        let d = db();
        d.save_semester(semester("a", true)).unwrap();
        d.save_course(course("c1", "a", "A")).unwrap();
        d.save_course(course("c2", "a", "B")).unwrap();
        d.save_coursework(work("t1", "c1", "quiz")).unwrap();
        let conn = d.0.lock().unwrap();
        let category: String = conn
            .query_row("SELECT category FROM tasks WHERE id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(category, "School");
        drop(conn);
        d.save_coursework(work("t1", "c2", "exam")).unwrap();
        d.set_course_archived("c2", true).unwrap();
        // A generic task edit cannot move the task out of School.
        let mut edit = task("t1");
        edit.category = "Personal".into();
        d.save_task(edit).unwrap();
        let w = d.workspace().unwrap();
        assert_eq!(w.tasks.len(), 1);
        assert_eq!(w.tasks[0].category, "School");
        let data = d.academic().unwrap();
        assert_eq!(data.work.len(), 1);
        assert_eq!(
            (
                data.work[0].course_id.as_str(),
                data.work[0].work_type.as_str()
            ),
            ("c2", "exam")
        );
        // Archived course rejects new coursework but keeps the existing link editable.
        assert!(d.save_coursework(work("t2", "c2", "general")).is_err());
        d.save_coursework(work("t1", "c2", "exam")).unwrap();
    }

    #[test]
    fn completion_uses_the_task_system_and_awards_xp_once() {
        let d = db();
        d.save_semester(semester("a", true)).unwrap();
        d.save_course(course("c1", "a", "A")).unwrap();
        d.save_coursework(work("t1", "c1", "assignment")).unwrap();
        d.set_task_completed("t1", true).unwrap();
        d.set_task_completed("t1", false).unwrap();
        d.set_task_completed("t1", true).unwrap();
        assert_eq!(d.workspace().unwrap().progression.xp, 25);
    }

    #[test]
    fn courses_with_work_cannot_be_deleted_and_deleting_a_task_removes_only_its_link() {
        let d = db();
        d.save_semester(semester("a", true)).unwrap();
        d.save_course(course("c1", "a", "A")).unwrap();
        d.save_coursework(work("t1", "c1", "assignment")).unwrap();
        {
            let conn = d.0.lock().unwrap();
            assert!(conn
                .execute("DELETE FROM courses WHERE id='c1'", [])
                .is_err());
            assert!(conn
                .execute("DELETE FROM semesters WHERE id='a'", [])
                .is_err());
        }
        d.delete_task("t1").unwrap();
        assert!(d.academic().unwrap().work.is_empty());
        assert_eq!(d.academic().unwrap().courses.len(), 1);
    }

    #[test]
    fn invalid_input_is_rejected() {
        let d = db();
        d.save_semester(semester("a", false)).unwrap();
        let mut bad = course("c1", "a", "A");
        bad.color = "red".into();
        assert!(d.save_course(bad).is_err());
        d.save_course(course("c1", "a", "A")).unwrap();
        assert!(d.save_coursework(work("t1", "c1", "homework")).is_err());
        assert!(d.save_coursework(work("t1", "missing", "quiz")).is_err());
    }

    #[test]
    fn migration_from_v5_keeps_tasks_and_unassigned_school_work() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        // Build a genuine v5 database, then upgrade it.
        c.execute_batch("PRAGMA user_version = 0;").unwrap();
        migrate(&c).unwrap();
        c.execute_batch("DROP TABLE daily_priorities; DROP TABLE recurrence_occurrences; DROP TABLE recurrence_rules; DROP TABLE routine_execution_steps; DROP TABLE routine_executions; DROP TABLE routine_steps; DROP TABLE routines; DROP TABLE habit_checkins; DROP TABLE habit_schedules; DROP TABLE habits; DROP TABLE goal_entries; DROP TABLE goal_targets; DROP TABLE goals;
            DROP TABLE study_goals; DROP TABLE study_blocks; DROP TABLE focus_sessions;
            CREATE TABLE focus_sessions (
                id TEXT PRIMARY KEY NOT NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
                status TEXT NOT NULL, duration_minutes INTEGER NOT NULL, break_minutes INTEGER NOT NULL,
                started_at_ms INTEGER NOT NULL, run_started_at_ms INTEGER, elapsed_ms INTEGER NOT NULL DEFAULT 0,
                finished_at_ms INTEGER
            );
            CREATE UNIQUE INDEX one_active_focus ON focus_sessions((1)) WHERE status IN ('running', 'paused');
            DROP TABLE task_academic; DROP TABLE courses; DROP TABLE semesters; PRAGMA user_version = 5;
            INSERT INTO tasks(id,title,description,category,priority,created_at_ms,updated_at_ms) VALUES ('old','Old school task','','School','normal',1,1);").unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let d = Database(Mutex::new(c));
        let w = d.workspace().unwrap();
        assert_eq!(w.tasks.len(), 1);
        let a = d.academic().unwrap();
        assert!(a.semesters.is_empty() && a.courses.is_empty() && a.work.is_empty());
        let conn = d.0.lock().unwrap();
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
