use crate::persistence::Database;
use crate::productivity::{now_ms, valid_date};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub id: String,
    pub version: i64,
    pub title: String,
    pub track: String,
    pub discipline: String,
    pub difficulty: String,
    pub minutes: i64,
    pub description: String,
    pub objectives: Vec<String>,
    pub prerequisites: Vec<String>,
    pub skills: Vec<String>,
    pub guided: Vec<String>,
    pub mistakes: Vec<String>,
    pub brief: String,
    pub deliverables: Vec<String>,
    pub checklist: Vec<String>,
    pub starter: Vec<String>,
    pub references: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeSettings {
    pub automatic: bool,
    pub tracks: Vec<String>,
    pub difficulties: Vec<String>,
    pub weekly_count: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub id: String,
    pub week_start: String,
    pub challenge_id: String,
    pub content_version: i64,
    pub source: String,
    pub status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub challenge_id: String,
    pub content_version: i64,
    pub mode: String,
    pub status: String,
    pub notes: String,
    pub deadline_date: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub checks: Vec<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub challenge_id: String,
    pub display_name: String,
    pub path: String,
    pub category: String,
    pub added_at_ms: i64,
    pub missing: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pathway {
    pub id: String,
    pub title: String,
    pub description: String,
    pub track: String,
    pub challenge_ids: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeProject {
    pub challenge_id: String,
    pub project_id: String,
    pub created_from_challenge: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeData {
    pub challenges: Vec<Challenge>,
    pub versions: Vec<Challenge>,
    pub settings: ChallengeSettings,
    pub assignments: Vec<Assignment>,
    pub progress: Vec<Progress>,
    pub evidence: Vec<Evidence>,
    pub pathways: Vec<Pathway>,
    pub projects: Vec<ChallengeProject>,
}

fn sql(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn library() -> Result<Vec<Challenge>, String> {
    serde_json::from_str(include_str!("challenge_library.json")).map_err(sql)
}
fn valid_week(c: &rusqlite::Connection, week: &str) -> Result<bool, String> {
    if !valid_date(week) {
        return Ok(false);
    }
    let weekday: Option<String> = c
        .query_row("SELECT strftime('%w',?1)", [week], |r| r.get(0))
        .map_err(sql)?;
    Ok(weekday.as_deref() == Some("1"))
}
fn event(c: &rusqlite::Transaction<'_>, kind: &str, source: &str) -> Result<(), String> {
    c.execute(
        "INSERT OR IGNORE INTO engineering_events VALUES (?1,?2,?3)",
        params![kind, source, now_ms()],
    )
    .map_err(sql)?;
    Ok(())
}
pub fn seed(c: &rusqlite::Connection) -> Result<(), String> {
    let c = c.unchecked_transaction().map_err(sql)?;
    let items = library()?;
    for item in &items {
        c.execute(
            "INSERT OR IGNORE INTO challenge_definitions VALUES (?1,?2,?3,?4,1)",
            params![item.id, item.track, item.discipline, item.difficulty],
        )
        .map_err(sql)?;
        c.execute(
            "INSERT OR IGNORE INTO challenge_versions VALUES (?1,?2,?3)",
            params![
                item.id,
                item.version,
                serde_json::to_string(&item).map_err(sql)?
            ],
        )
        .map_err(sql)?;
    }
    for item in &items {
        for prereq in &item.prerequisites {
            c.execute(
                "INSERT OR IGNORE INTO challenge_prerequisites VALUES (?1,?2)",
                params![item.id, prereq],
            )
            .map_err(sql)?;
        }
        for skill in &item.skills {
            let title = skill
                .split('-')
                .map(|w| {
                    let mut chars = w.chars();
                    chars
                        .next()
                        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(" ");
            c.execute(
                "INSERT OR IGNORE INTO engineering_skills VALUES (?1,?2,?3)",
                params![skill, title, item.track],
            )
            .map_err(sql)?;
            c.execute(
                "INSERT OR IGNORE INTO challenge_skills VALUES (?1,?2)",
                params![item.id, skill],
            )
            .map_err(sql)?;
        }
    }
    for (id, title, track, ids) in [
        (
            "cad-foundations",
            "AutoCAD drawing practice",
            "AutoCAD",
            vec!["acad-drafting", "acad-site-plan", "acad-layout"],
        ),
        (
            "roadway-concepts",
            "Civil 3D roadway concepts",
            "Civil 3D",
            vec!["c3d-survey", "c3d-alignment", "c3d-roadway"],
        ),
        (
            "bim-documentation",
            "Revit model to documents",
            "Revit",
            vec!["revit-bim", "revit-foundation", "revit-docs"],
        ),
    ] {
        c.execute(
            "INSERT OR IGNORE INTO learning_pathways VALUES (?1,?2,?3,?4)",
            params![
                id,
                title,
                "Optional sequence of educational exercises",
                track
            ],
        )
        .map_err(sql)?;
        for (position, challenge) in ids.iter().enumerate() {
            c.execute(
                "INSERT OR IGNORE INTO pathway_challenges VALUES (?1,?2,?3)",
                params![id, challenge, position as i64],
            )
            .map_err(sql)?;
        }
    }
    c.commit().map_err(sql)
}
impl Database {
    pub fn challenges(&self) -> Result<ChallengeData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let challenges=c.prepare("SELECT v.content_json FROM challenge_versions v JOIN challenge_definitions d ON d.id=v.challenge_id WHERE d.active=1 AND v.version=(SELECT MAX(version) FROM challenge_versions WHERE challenge_id=d.id) ORDER BY d.track,v.challenge_id").map_err(sql)?.query_map([],|r| {let s:String=r.get(0)?;serde_json::from_str(&s).map_err(|e|rusqlite::Error::FromSqlConversionFailure(0,rusqlite::types::Type::Text,Box::new(e))) }).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        let versions = c
            .prepare("SELECT content_json FROM challenge_versions ORDER BY challenge_id,version")
            .map_err(sql)?
            .query_map([], |r| {
                let value: String = r.get(0)?;
                serde_json::from_str(&value).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        let settings=c.query_row("SELECT automatic,tracks_json,difficulties_json,weekly_count FROM challenge_settings WHERE id=1",[],|r| {let tracks:String=r.get(1)?;let difficulties:String=r.get(2)?;Ok(ChallengeSettings{automatic:r.get(0)?,tracks:serde_json::from_str(&tracks).unwrap_or_default(),difficulties:serde_json::from_str(&difficulties).unwrap_or_default(),weekly_count:r.get(3)?})}).map_err(sql)?;
        let assignments=c.prepare("SELECT id,week_start,challenge_id,content_version,source,status FROM weekly_challenges ORDER BY week_start DESC,created_at_ms,id").map_err(sql)?.query_map([],|r|Ok(Assignment{id:r.get(0)?,week_start:r.get(1)?,challenge_id:r.get(2)?,content_version:r.get(3)?,source:r.get(4)?,status:r.get(5)?})).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        let progress=c.prepare("SELECT challenge_id,content_version,mode,status,notes,deadline_date,started_at_ms,completed_at_ms FROM challenge_progress").map_err(sql)?.query_map([],|r|Ok(Progress{challenge_id:r.get(0)?,content_version:r.get(1)?,mode:r.get(2)?,status:r.get(3)?,notes:r.get(4)?,deadline_date:r.get(5)?,started_at_ms:r.get(6)?,completed_at_ms:r.get(7)?,checks:vec![]})).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        let mut progress: Vec<Progress> = progress;
        for p in &mut progress {
            p.checks=c.prepare("SELECT item_index FROM challenge_checks WHERE challenge_id=?1 AND content_version=?2 AND checked=1 ORDER BY item_index").map_err(sql)?.query_map(params![p.challenge_id,p.content_version],|r|r.get(0)).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        }
        let evidence=c.prepare("SELECT id,challenge_id,display_name,path,category,added_at_ms FROM challenge_evidence ORDER BY added_at_ms DESC").map_err(sql)?.query_map([],|r|{let path:String=r.get(3)?;let missing=!Path::new(&path).is_file();Ok(Evidence{id:r.get(0)?,challenge_id:r.get(1)?,display_name:r.get(2)?,path,category:r.get(4)?,added_at_ms:r.get(5)?,missing})}).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        let mut pathways = c
            .prepare("SELECT id,title,description,track FROM learning_pathways ORDER BY id")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(Pathway {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    track: r.get(3)?,
                    challenge_ids: vec![],
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        for p in &mut pathways {
            p.challenge_ids=c.prepare("SELECT challenge_id FROM pathway_challenges WHERE pathway_id=?1 ORDER BY position").map_err(sql)?.query_map([&p.id],|r|r.get(0)).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        }
        let projects = c
            .prepare(
                "SELECT challenge_id,project_id,created_from_challenge FROM challenge_projects",
            )
            .map_err(sql)?
            .query_map([], |r| {
                Ok(ChallengeProject {
                    challenge_id: r.get(0)?,
                    project_id: r.get(1)?,
                    created_from_challenge: r.get(2)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        Ok(ChallengeData {
            challenges,
            versions,
            settings,
            assignments,
            progress,
            evidence,
            pathways,
            projects,
        })
    }
    pub fn challenge_settings(&self, s: ChallengeSettings) -> Result<(), String> {
        if !(1..=9).contains(&s.weekly_count)
            || s.tracks
                .iter()
                .any(|v| !["AutoCAD", "Civil 3D", "Revit"].contains(&v.as_str()))
            || s.difficulties
                .iter()
                .any(|v| !["Beginner", "Intermediate", "Advanced"].contains(&v.as_str()))
        {
            return Err("Invalid challenge settings".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("UPDATE challenge_settings SET automatic=?1,tracks_json=?2,difficulties_json=?3,weekly_count=?4 WHERE id=1",params![s.automatic,serde_json::to_string(&s.tracks).map_err(sql)?,serde_json::to_string(&s.difficulties).map_err(sql)?,s.weekly_count]).map_err(sql)?;
        Ok(())
    }
    pub fn assign_week(&self, week: &str, manual: Option<&str>) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        if !valid_week(&c, week)? {
            return Err("Week must be a local Monday date".into());
        }
        let tx = c.transaction().map_err(sql)?;
        let (automatic,tracks_json,difficulties_json,count):(bool,String,String,i64)=tx.query_row("SELECT automatic,tracks_json,difficulties_json,weekly_count FROM challenge_settings WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(sql)?;
        let tracks: Vec<String> = serde_json::from_str(&tracks_json).map_err(sql)?;
        let difficulties: Vec<String> = serde_json::from_str(&difficulties_json).map_err(sql)?;
        let ids:Vec<(String,i64,String,String)>=tx.prepare("SELECT d.id,MAX(v.version),d.track,d.difficulty FROM challenge_definitions d JOIN challenge_versions v ON v.challenge_id=d.id WHERE d.active=1 GROUP BY d.id ORDER BY d.id").map_err(sql)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        let assigned: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM weekly_challenges WHERE week_start=?1",
                [week],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let candidates: Vec<_> = ids
            .into_iter()
            .filter(|(id, _, track, difficulty)| {
                if let Some(manual_id) = manual {
                    id == manual_id
                } else {
                    automatic
                        && assigned < count
                        && tracks.contains(track)
                        && difficulties.contains(difficulty)
                }
            })
            .collect();
        if manual.is_some() && candidates.is_empty() {
            return Err("Challenge is unavailable".into());
        }
        // A local Monday is the only rotation input. Existing records never get regenerated.
        let rotation = (week
            .bytes()
            .fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32))
            as usize)
            % candidates.len().max(1);
        let mut added = 0;
        for (id, version, _, _) in candidates
            .iter()
            .cycle()
            .skip(rotation)
            .take(candidates.len())
        {
            if added
                >= if manual.is_some() {
                    1
                } else {
                    (count - assigned).max(0)
                }
            {
                break;
            }
            let prereqs: Vec<String> = tx
                .prepare(
                    "SELECT prerequisite_id FROM challenge_prerequisites WHERE challenge_id=?1",
                )
                .map_err(sql)?
                .query_map([id], |r| r.get(0))
                .map_err(sql)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(sql)?;
            if manual.is_none()
                && prereqs.iter().any(|p| {
                    tx.query_row(
                        "SELECT status FROM challenge_progress WHERE challenge_id=?1",
                        [p],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
                    .as_deref()
                        != Some("Completed")
                })
            {
                continue;
            }
            let existing_status: Option<String> = tx
                .query_row(
                    "SELECT status FROM challenge_progress WHERE challenge_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(sql)?;
            if manual.is_none() && existing_status.as_deref() == Some("Completed") {
                continue;
            }
            let status = match existing_status.as_deref() {
                Some("Completed") => "Completed",
                Some("In Progress") => "In Progress",
                Some("Skipped") => "Skipped",
                _ => "Not Started",
            };
            let inserted = tx
                .execute(
                    "INSERT OR IGNORE INTO weekly_challenges VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        format!("{week}:{id}"),
                        week,
                        id,
                        version,
                        if manual.is_some() {
                            "manual"
                        } else {
                            "automatic"
                        },
                        status,
                        now_ms()
                    ],
                )
                .map_err(sql)?;
            added += inserted as i64;
        }
        tx.commit().map_err(sql)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn challenge_action(
        &self,
        id: &str,
        action: &str,
        week: &str,
        mode: Option<&str>,
        notes: Option<&str>,
        deadline: Option<&str>,
        check: Option<i64>,
    ) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        if !valid_week(&c, week)? {
            return Err("Invalid local week".into());
        }
        let tx = c.transaction().map_err(sql)?;
        let version: i64 = tx
            .query_row(
                "SELECT MAX(version) FROM challenge_versions WHERE challenge_id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT content_version,status FROM challenge_progress WHERE challenge_id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(sql)?;
        let chosen = existing.as_ref().map(|x| x.0).unwrap_or(version);
        let now = now_ms();
        match action {
            "start" => {
                let m = mode.unwrap_or("guided");
                if !["guided", "brief"].contains(&m) {
                    return Err("Invalid mode".into());
                }
                tx.execute("INSERT INTO challenge_progress VALUES (?1,?2,?3,'In Progress','',NULL,?4,NULL,?4) ON CONFLICT(challenge_id) DO UPDATE SET status='In Progress',mode=excluded.mode,updated_at_ms=excluded.updated_at_ms",params![id,chosen,m,now]).map_err(sql)?;
                if existing.is_none() {
                    event(&tx, "challenge_started", id)?;
                }
            }
            "notes" => {
                let value = notes.unwrap_or("");
                if value.chars().count() > 20000 {
                    return Err("Notes are too long".into());
                }
                if tx.execute("UPDATE challenge_progress SET notes=?2,updated_at_ms=?3 WHERE challenge_id=?1",params![id,value,now]).map_err(sql)?==0{return Err("Start the challenge first".into())}
            }
            "deadline" => {
                if deadline.is_some_and(|d| !valid_date(d)) {
                    return Err("Invalid deadline".into());
                }
                if tx.execute("UPDATE challenge_progress SET deadline_date=?2,updated_at_ms=?3 WHERE challenge_id=?1",params![id,deadline,now]).map_err(sql)?==0{return Err("Start the challenge first".into())}
            }
            "check" | "uncheck" => {
                let index = check.ok_or("Missing checklist index")?;
                let json:String=tx.query_row("SELECT content_json FROM challenge_versions WHERE challenge_id=?1 AND version=?2",params![id,chosen],|r|r.get(0)).map_err(sql)?;
                let content: Challenge = serde_json::from_str(&json).map_err(sql)?;
                if index < 0
                    || index as usize >= content.checklist.len()
                    || existing.is_none()
                    || existing.as_ref().is_some_and(|x| x.1 == "Completed")
                {
                    return Err("Invalid checklist item".into());
                }
                tx.execute("INSERT INTO challenge_checks VALUES (?1,?2,?3,?4) ON CONFLICT(challenge_id,content_version,item_index) DO UPDATE SET checked=excluded.checked",params![id,chosen,index,action=="check"]).map_err(sql)?;
            }
            "complete" => {
                if existing.is_none() {
                    return Err("Start the challenge first".into());
                }
                let json:String=tx.query_row("SELECT content_json FROM challenge_versions WHERE challenge_id=?1 AND version=?2",params![id,chosen],|r|r.get(0)).map_err(sql)?;
                let content: Challenge = serde_json::from_str(&json).map_err(sql)?;
                let checked:i64=tx.query_row("SELECT COUNT(*) FROM challenge_checks WHERE challenge_id=?1 AND content_version=?2 AND checked=1",params![id,chosen],|r|r.get(0)).map_err(sql)?;
                if checked < content.checklist.len() as i64 {
                    return Err("Complete the checklist before finishing".into());
                }
                tx.execute("UPDATE challenge_progress SET status='Completed',completed_at_ms=COALESCE(completed_at_ms,?2),updated_at_ms=?2 WHERE challenge_id=?1",params![id,now]).map_err(sql)?;
                if existing.as_ref().is_some_and(|x| x.1 != "Completed") {
                    event(&tx, "challenge_completed", id)?;
                    for pathway in tx
                        .prepare("SELECT pathway_id FROM pathway_challenges WHERE challenge_id=?1")
                        .map_err(sql)?
                        .query_map([id], |r| r.get::<_, String>(0))
                        .map_err(sql)?
                        .collect::<rusqlite::Result<Vec<_>>>()
                        .map_err(sql)?
                    {
                        let remaining:i64=tx.query_row("SELECT COUNT(*) FROM pathway_challenges pc LEFT JOIN challenge_progress cp ON cp.challenge_id=pc.challenge_id AND cp.status='Completed' WHERE pc.pathway_id=?1 AND cp.challenge_id IS NULL",[&pathway],|r|r.get(0)).map_err(sql)?;
                        if remaining == 0 {
                            event(&tx, "pathway_milestone", &pathway)?;
                        }
                    }
                }
            }
            "skip" => {
                if existing.is_none() {
                    return Err("Start the challenge first".into());
                }
                tx.execute("UPDATE challenge_progress SET status='Skipped',updated_at_ms=?2 WHERE challenge_id=?1",params![id,now]).map_err(sql)?;
            }
            _ => return Err("Invalid challenge action".into()),
        }
        if ["start", "complete", "skip"].contains(&action) {
            let status = match action {
                "complete" => "Completed",
                "skip" => "Skipped",
                _ => "In Progress",
            };
            tx.execute("UPDATE weekly_challenges SET status=?2 WHERE challenge_id=?1 AND week_start=?3 AND status!='Completed'",params![id,status,week]).map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }
    pub fn add_evidence(&self, id: &str, challenge_id: &str, path: &str) -> Result<(), String> {
        let file = Path::new(path);
        if !file.is_absolute()
            || !file.is_file()
            || [
                "exe", "com", "bat", "cmd", "ps1", "vbs", "js", "msi", "lnk", "url",
            ]
            .contains(
                &file
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str(),
            )
        {
            return Err("Choose an existing engineering document".into());
        }
        let name = file
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid file name")?;
        let category = file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute(
            "INSERT OR IGNORE INTO challenge_evidence VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, challenge_id, name, path, category, now_ms()],
        )
        .map_err(sql)?;
        Ok(())
    }
    pub fn remove_evidence(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("DELETE FROM challenge_evidence WHERE id=?1", [id])
            .map_err(sql)?;
        Ok(())
    }
    pub fn link_challenge_project(
        &self,
        challenge_id: &str,
        project_id: &str,
    ) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute(
            "INSERT OR IGNORE INTO challenge_projects VALUES (?1,?2,?3,0)",
            params![challenge_id, project_id, now_ms()],
        )
        .map_err(sql)?;
        Ok(())
    }
    pub fn create_challenge_project(&self, challenge_id: &str) -> Result<String, String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        if let Some(id)=tx.query_row("SELECT project_id FROM challenge_projects WHERE challenge_id=?1 AND created_from_challenge=1",[challenge_id],|r|r.get(0)).optional().map_err(sql)?{return Ok(id)}
        let json:String=tx.query_row("SELECT content_json FROM challenge_versions WHERE challenge_id=?1 ORDER BY version DESC LIMIT 1",[challenge_id],|r|r.get(0)).map_err(sql)?;
        let challenge: Challenge = serde_json::from_str(&json).map_err(sql)?;
        let id = format!("challenge-{challenge_id}");
        let now = now_ms();
        tx.execute("INSERT INTO engineering_projects (id,title,description,discipline,category,project_type,software_json,start_date,target_date,status,priority,created_at_ms,updated_at_ms,completed_at_ms,portfolio_candidate,portfolio_summary,objectives,contributions,skills,decisions,lessons) VALUES (?1,?2,?3,?4,'Learning challenge','Educational',?5,NULL,NULL,'Planning','normal',?6,?6,NULL,0,'',?7,'',?8,'','')",params![id,challenge.title,challenge.description,challenge.discipline,serde_json::to_string(&vec![&challenge.track]).map_err(sql)?,now,challenge.objectives.join("\n"),challenge.skills.join(", ")]).map_err(sql)?;
        tx.execute(
            "INSERT INTO challenge_projects VALUES (?1,?2,?3,1)",
            params![challenge_id, id, now],
        )
        .map_err(sql)?;
        for (file_id,name,path,category,added) in tx.prepare("SELECT id,display_name,path,category,added_at_ms FROM challenge_evidence WHERE challenge_id=?1").map_err(sql)?.query_map([challenge_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?))).map_err(sql)?.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)? {tx.execute("INSERT INTO project_files VALUES (?1,?2,?3,?4,?5,'Linked from learning challenge',?6)",params![format!("{id}:{file_id}"),id,name,path,category,added]).map_err(sql)?;}
        event(&tx, "project_from_challenge", challenge_id)?;
        tx.commit().map_err(sql)?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Database;
    use std::sync::Mutex;

    fn test_db() -> Database {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        // Run the production migration through a disposable database, then seed content.
        crate::persistence::migrate(&c).unwrap();
        seed(&c).unwrap();
        Database(Mutex::new(c))
    }
    #[test]
    fn library_and_weekly_assignments_are_stable() {
        let db = test_db();
        assert_eq!(db.challenges().unwrap().challenges.len(), 9);
        db.challenge_settings(ChallengeSettings {
            automatic: true,
            tracks: vec!["AutoCAD".into()],
            difficulties: vec!["Beginner".into()],
            weekly_count: 2,
        })
        .unwrap();
        db.assign_week("2026-11-02", None).unwrap();
        let before = db.challenges().unwrap().assignments;
        assert_eq!(before.len(), 1);
        db.assign_week("2026-11-02", None).unwrap();
        assert_eq!(db.challenges().unwrap().assignments.len(), 1);
        assert!(db.assign_week("2026-11-03", None).is_err());
    }
    #[test]
    fn progress_and_project_conversion_are_idempotent() {
        let db = test_db();
        db.challenge_action(
            "acad-drafting",
            "start",
            "2026-11-02",
            Some("guided"),
            None,
            None,
            None,
        )
        .unwrap();
        assert!(db
            .challenge_action(
                "acad-drafting",
                "complete",
                "2026-11-02",
                None,
                None,
                None,
                None
            )
            .is_err());
        for n in 0..3 {
            db.challenge_action(
                "acad-drafting",
                "check",
                "2026-11-02",
                None,
                None,
                None,
                Some(n),
            )
            .unwrap();
        }
        db.challenge_action(
            "acad-drafting",
            "complete",
            "2026-11-02",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let a = db.create_challenge_project("acad-drafting").unwrap();
        let b = db.create_challenge_project("acad-drafting").unwrap();
        assert_eq!(a, b);
        let c = db.0.lock().unwrap();
        let count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM engineering_events WHERE kind='challenge_completed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let integrity: String = c
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
        let fk: Vec<i64> = c
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(fk.is_empty());
    }
}
