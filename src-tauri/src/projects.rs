use crate::persistence::Database;
use crate::productivity::{now_ms, valid_date};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub description: String,
    pub discipline: String,
    pub category: String,
    pub project_type: String,
    pub software: Vec<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub portfolio_candidate: bool,
    pub portfolio_summary: String,
    pub objectives: String,
    pub contributions: String,
    pub skills: String,
    pub decisions: String,
    pub lessons: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub target_date: String,
    pub completed_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReference {
    pub id: String,
    pub project_id: String,
    pub display_name: String,
    pub path: String,
    pub category: String,
    pub description: String,
    pub added_at_ms: i64,
    pub missing: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub entry_date: String,
    pub description: String,
    pub work_completed: String,
    pub problems: String,
    pub solutions: String,
    pub skills: String,
    pub file_ids: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsData {
    pub projects: Vec<Project>,
    pub milestones: Vec<Milestone>,
    pub files: Vec<FileReference>,
    pub journal: Vec<JournalEntry>,
}

fn field(s: &str, max: usize) -> bool {
    s.chars().count() <= max
}
fn id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100
}
fn title(s: &str) -> bool {
    !s.trim().is_empty() && field(s, 200)
}
fn date(s: &Option<String>) -> bool {
    s.as_deref().is_none_or(valid_date)
}
fn sqlite<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn safe_reference(path: &Path) -> bool {
    let blocked = [
        "exe", "com", "bat", "cmd", "ps1", "vbs", "js", "jse", "wsf", "msi", "msp", "scr", "lnk",
        "url",
    ];
    path.is_absolute()
        && path.is_file()
        && path
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|x| !blocked.contains(&x.to_ascii_lowercase().as_str()))
}

impl Database {
    pub fn projects(&self) -> Result<ProjectsData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let projects = c.prepare("SELECT id,title,description,discipline,category,project_type,software_json,start_date,target_date,status,priority,created_at_ms,updated_at_ms,completed_at_ms,portfolio_candidate,portfolio_summary,objectives,contributions,skills,decisions,lessons FROM engineering_projects ORDER BY updated_at_ms DESC")
            .map_err(sqlite)?.query_map([], |r| {
                let json: String = r.get(6)?;
                let software = serde_json::from_str(&json).map_err(|e| rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e)))?;
                Ok(Project { id:r.get(0)?, title:r.get(1)?, description:r.get(2)?, discipline:r.get(3)?, category:r.get(4)?, project_type:r.get(5)?, software, start_date:r.get(7)?, target_date:r.get(8)?, status:r.get(9)?, priority:r.get(10)?, created_at_ms:r.get(11)?, updated_at_ms:r.get(12)?, completed_at_ms:r.get(13)?, portfolio_candidate:r.get(14)?, portfolio_summary:r.get(15)?, objectives:r.get(16)?, contributions:r.get(17)?, skills:r.get(18)?, decisions:r.get(19)?, lessons:r.get(20)? })
            }).map_err(sqlite)?.collect::<rusqlite::Result<_>>().map_err(sqlite)?;
        let milestones = c.prepare("SELECT id,project_id,title,description,target_date,completed_at_ms,created_at_ms,updated_at_ms FROM project_milestones ORDER BY target_date,id")
            .map_err(sqlite)?.query_map([], |r| Ok(Milestone { id:r.get(0)?, project_id:r.get(1)?, title:r.get(2)?, description:r.get(3)?, target_date:r.get(4)?, completed_at_ms:r.get(5)?, created_at_ms:r.get(6)?, updated_at_ms:r.get(7)? })).map_err(sqlite)?.collect::<rusqlite::Result<_>>().map_err(sqlite)?;
        let files = c.prepare("SELECT id,project_id,display_name,path,category,description,added_at_ms FROM project_files ORDER BY added_at_ms DESC")
            .map_err(sqlite)?.query_map([], |r| { let path:String=r.get(3)?; let missing=!Path::new(&path).is_file(); Ok(FileReference { id:r.get(0)?, project_id:r.get(1)?, display_name:r.get(2)?, path, category:r.get(4)?, description:r.get(5)?, added_at_ms:r.get(6)?, missing }) }).map_err(sqlite)?.collect::<rusqlite::Result<_>>().map_err(sqlite)?;
        let journal = c.prepare("SELECT id,project_id,title,entry_date,description,work_completed,problems,solutions,skills,file_ids_json,created_at_ms,updated_at_ms FROM project_journal ORDER BY entry_date DESC,created_at_ms DESC")
            .map_err(sqlite)?.query_map([], |r| { let json:String=r.get(9)?; let file_ids=serde_json::from_str(&json).map_err(|e|rusqlite::Error::FromSqlConversionFailure(9,rusqlite::types::Type::Text,Box::new(e)))?; Ok(JournalEntry { id:r.get(0)?,project_id:r.get(1)?,title:r.get(2)?,entry_date:r.get(3)?,description:r.get(4)?,work_completed:r.get(5)?,problems:r.get(6)?,solutions:r.get(7)?,skills:r.get(8)?,file_ids,created_at_ms:r.get(10)?,updated_at_ms:r.get(11)? }) }).map_err(sqlite)?.collect::<rusqlite::Result<_>>().map_err(sqlite)?;
        Ok(ProjectsData {
            projects,
            milestones,
            files,
            journal,
        })
    }
    pub fn save_project(&self, p: Project) -> Result<(), String> {
        if !id(&p.id)
            || !title(&p.title)
            || p.discipline.trim().is_empty()
            || !field(&p.discipline, 100)
            || !field(&p.category, 100)
            || !field(&p.project_type, 100)
            || !field(&p.description, 20_000)
            || p.software.len() > 30
            || p.software
                .iter()
                .any(|s| s.trim().is_empty() || !field(s, 100))
            || !date(&p.start_date)
            || !date(&p.target_date)
            || p.start_date
                .as_ref()
                .zip(p.target_date.as_ref())
                .is_some_and(|(a, b)| a > b)
            || ![
                "Planning",
                "In Progress",
                "On Hold",
                "Completed",
                "Archived",
            ]
            .contains(&p.status.as_str())
            || p.priority
                .as_deref()
                .is_some_and(|s| !["low", "normal", "high"].contains(&s))
            || [
                &p.portfolio_summary,
                &p.objectives,
                &p.contributions,
                &p.skills,
                &p.decisions,
                &p.lessons,
            ]
            .iter()
            .any(|s| !field(s, 20_000))
        {
            return Err("Invalid project details".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sqlite)?;
        let old: Option<Option<i64>> = tx
            .query_row(
                "SELECT completed_at_ms FROM engineering_projects WHERE id=?1",
                [&p.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sqlite)?;
        let now = now_ms();
        let completed = if p.status == "Completed" {
            old.flatten().or(Some(now))
        } else if p.status == "Archived" {
            old.flatten()
        } else {
            None
        };
        tx.execute("INSERT INTO engineering_projects (id,title,description,discipline,category,project_type,software_json,start_date,target_date,status,priority,created_at_ms,updated_at_ms,completed_at_ms,portfolio_candidate,portfolio_summary,objectives,contributions,skills,decisions,lessons) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,?13,?14,?15,?16,?17,?18,?19,?20) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,discipline=excluded.discipline,category=excluded.category,project_type=excluded.project_type,software_json=excluded.software_json,start_date=excluded.start_date,target_date=excluded.target_date,status=excluded.status,priority=excluded.priority,updated_at_ms=excluded.updated_at_ms,completed_at_ms=excluded.completed_at_ms,portfolio_candidate=excluded.portfolio_candidate,portfolio_summary=excluded.portfolio_summary,objectives=excluded.objectives,contributions=excluded.contributions,skills=excluded.skills,decisions=excluded.decisions,lessons=excluded.lessons",params![p.id,p.title.trim(),p.description,p.discipline,p.category,p.project_type,serde_json::to_string(&p.software).map_err(sqlite)?,p.start_date,p.target_date,p.status,p.priority,now,completed,p.portfolio_candidate,p.portfolio_summary,p.objectives,p.contributions,p.skills,p.decisions,p.lessons]).map_err(sqlite)?;
        tx.commit().map_err(sqlite)
    }
    pub fn save_milestone(&self, m: Milestone) -> Result<(), String> {
        if !id(&m.id)
            || !id(&m.project_id)
            || !title(&m.title)
            || !field(&m.description, 10_000)
            || !valid_date(&m.target_date)
        {
            return Err("Invalid milestone".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let now = now_ms();
        c.execute("INSERT INTO project_milestones (id,project_id,title,description,target_date,completed_at_ms,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,target_date=excluded.target_date,updated_at_ms=excluded.updated_at_ms",params![m.id,m.project_id,m.title.trim(),m.description,m.target_date,m.completed_at_ms,now]).map_err(sqlite)?;
        Ok(())
    }
    pub fn set_milestone_completed(&self, id: &str, completed: bool) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let current: Option<Option<i64>> = c
            .query_row(
                "SELECT completed_at_ms FROM project_milestones WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sqlite)?;
        let current = current.ok_or("Milestone not found")?;
        if current.is_some() == completed {
            return Ok(());
        }
        if c.execute(
            "UPDATE project_milestones SET completed_at_ms=?2,updated_at_ms=?3 WHERE id=?1",
            params![id, if completed { Some(now_ms()) } else { None }, now_ms()],
        )
        .map_err(sqlite)?
            == 0
        {
            return Err("Milestone not found".into());
        }
        Ok(())
    }
    pub fn delete_project_item(&self, kind: &str, id: &str) -> Result<(), String> {
        let table = match kind {
            "milestone" => "project_milestones",
            "file" => "project_files",
            "journal" => "project_journal",
            _ => return Err("Invalid item type".into()),
        };
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute(&format!("DELETE FROM {table} WHERE id=?1"), [id])
            .map_err(sqlite)?
            == 0
        {
            return Err("Item not found".into());
        }
        Ok(())
    }
    pub fn associate_task(&self, task_id: &str, project_id: Option<&str>) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute(
            "UPDATE tasks SET project_id=?2,updated_at_ms=?3 WHERE id=?1",
            params![task_id, project_id, now_ms()],
        )
        .map_err(sqlite)?
            == 0
        {
            return Err("Task not found".into());
        }
        Ok(())
    }
    pub fn save_file(&self, f: FileReference) -> Result<(), String> {
        if !id(&f.id)
            || !id(&f.project_id)
            || !title(&f.display_name)
            || !field(&f.category, 100)
            || !field(&f.description, 10_000)
            || !safe_reference(Path::new(&f.path))
        {
            return Err("Choose an existing file using its absolute path".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("INSERT INTO project_files(id,project_id,display_name,path,category,description,added_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,path=excluded.path,category=excluded.category,description=excluded.description",params![f.id,f.project_id,f.display_name.trim(),f.path,f.category,f.description,now_ms()]).map_err(sqlite)?;
        Ok(())
    }
    pub fn save_journal(&self, j: JournalEntry) -> Result<(), String> {
        if !id(&j.id)
            || !id(&j.project_id)
            || !title(&j.title)
            || !valid_date(&j.entry_date)
            || [
                &j.description,
                &j.work_completed,
                &j.problems,
                &j.solutions,
                &j.skills,
            ]
            .iter()
            .any(|s| !field(s, 30_000))
            || j.file_ids.len() > 100
        {
            return Err("Invalid journal entry".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let now = now_ms();
        c.execute("INSERT INTO project_journal(id,project_id,title,entry_date,description,work_completed,problems,solutions,skills,file_ids_json,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11) ON CONFLICT(id) DO UPDATE SET title=excluded.title,entry_date=excluded.entry_date,description=excluded.description,work_completed=excluded.work_completed,problems=excluded.problems,solutions=excluded.solutions,skills=excluded.skills,file_ids_json=excluded.file_ids_json,updated_at_ms=excluded.updated_at_ms",params![j.id,j.project_id,j.title.trim(),j.entry_date,j.description,j.work_completed,j.problems,j.solutions,j.skills,serde_json::to_string(&j.file_ids).map_err(sqlite)?,now]).map_err(sqlite)?;
        Ok(())
    }
    pub fn open_file(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let path: String = c
            .query_row("SELECT path FROM project_files WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(sqlite)?;
        if !Path::new(&path).is_file() {
            return Err("File is missing or has moved".into());
        }
        if !safe_reference(Path::new(&path)) {
            return Err("This file type cannot be opened from CivilDesk".into());
        }
        open_associated(&path)
    }
}

#[cfg(windows)]
fn open_associated(path: &str) -> Result<(), String> {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    } as isize;
    if result <= 32 {
        Err(format!("Windows could not open this file (code {result})"))
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn open_associated(_path: &str) -> Result<(), String> {
    Err("Opening project files is available in the Windows desktop build".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> (Database, std::path::PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "civildesk-projects-{}-{}.sqlite3",
            std::process::id(),
            nanos
        ));
        (Database::open(&path).unwrap(), path)
    }
    fn project(id: &str) -> Project {
        Project {
            id: id.into(),
            title: "Bridge study".into(),
            description: "Original description".into(),
            discipline: "Structural Engineering".into(),
            category: "Coursework".into(),
            project_type: "Academic exercise".into(),
            software: vec!["Revit".into()],
            start_date: None,
            target_date: Some("2026-12-01".into()),
            status: "Planning".into(),
            priority: None,
            created_at_ms: 0,
            updated_at_ms: 0,
            completed_at_ms: None,
            portfolio_candidate: false,
            portfolio_summary: String::new(),
            objectives: String::new(),
            contributions: String::new(),
            skills: String::new(),
            decisions: String::new(),
            lessons: String::new(),
        }
    }
    #[test]
    fn project_milestone_and_portfolio_round_trip() {
        let (db, path) = database();
        let mut p = project("p");
        db.save_project(p.clone()).unwrap();
        p.status = "Completed".into();
        p.portfolio_candidate = true;
        p.portfolio_summary = "Private draft".into();
        db.save_project(p.clone()).unwrap();
        let done = db.projects().unwrap().projects.remove(0);
        assert!(done.completed_at_ms.is_some());
        assert_eq!(done.portfolio_summary, "Private draft");
        p.status = "Archived".into();
        db.save_project(p).unwrap();
        assert_eq!(
            db.projects().unwrap().projects[0].completed_at_ms,
            done.completed_at_ms
        );
        let m = Milestone {
            id: "m".into(),
            project_id: "p".into(),
            title: "Load case".into(),
            description: "".into(),
            target_date: "2026-11-01".into(),
            completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        db.save_milestone(m).unwrap();
        db.set_milestone_completed("m", true).unwrap();
        let first = db.projects().unwrap().milestones[0].completed_at_ms;
        db.set_milestone_completed("m", true).unwrap();
        assert_eq!(db.projects().unwrap().milestones[0].completed_at_ms, first);
        db.set_milestone_completed("m", false).unwrap();
        assert_eq!(db.projects().unwrap().milestones[0].completed_at_ms, None);
        db.delete_project_item("milestone", "m").unwrap();
        assert!(db.projects().unwrap().milestones.is_empty());
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn file_reference_tracks_missing_file_without_deleting_it() {
        let (db, path) = database();
        db.save_project(project("p")).unwrap();
        let file_path = path.with_extension("pdf");
        std::fs::write(&file_path, b"sample").unwrap();
        let f = FileReference {
            id: "f".into(),
            project_id: "p".into(),
            display_name: "Report".into(),
            path: file_path.to_string_lossy().into_owned(),
            category: "Report".into(),
            description: "".into(),
            added_at_ms: 0,
            missing: false,
        };
        db.save_file(f.clone()).unwrap();
        assert!(!db.projects().unwrap().files[0].missing);
        db.delete_project_item("file", "f").unwrap();
        assert!(file_path.is_file());
        db.save_file(f).unwrap();
        std::fs::remove_file(&file_path).unwrap();
        assert!(db.projects().unwrap().files[0].missing);
        assert!(db.open_file("f").is_err());
        db.delete_project_item("file", "f").unwrap();
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_executable_reference() {
        let path = std::env::temp_dir().join(format!("civildesk-test-{}.exe", now_ms()));
        std::fs::write(&path, b"sample").unwrap();
        assert!(!safe_reference(&path));
        std::fs::remove_file(path).unwrap();
    }
}
