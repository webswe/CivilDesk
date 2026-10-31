use crate::persistence::Database;
use crate::productivity::{now_ms, valid_date, valid_time};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub start_time: Option<String>,
    pub end_date: String,
    pub end_time: Option<String>,
    pub all_day: bool,
    pub time_zone: String,
    pub start_at_ms: Option<i64>,
    pub end_at_ms: Option<i64>,
    pub reminder_offset_minutes: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInput {
    pub id: String,
    pub title: String,
    pub description: String,
    pub start_date: String,
    pub start_time: Option<String>,
    pub end_date: String,
    pub end_time: Option<String>,
    pub all_day: bool,
    pub time_zone: String,
    pub start_at_ms: Option<i64>,
    pub end_at_ms: Option<i64>,
    pub reminder_offset_minutes: Option<i64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPreferences {
    pub enabled: bool,
    pub quiet_start: String,
    pub quiet_end: String,
}

fn event_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        start_date: r.get(3)?,
        start_time: r.get(4)?,
        end_date: r.get(5)?,
        end_time: r.get(6)?,
        all_day: r.get(7)?,
        time_zone: r.get(8)?,
        start_at_ms: r.get(9)?,
        end_at_ms: r.get(10)?,
        reminder_offset_minutes: r.get(11)?,
        created_at_ms: r.get(12)?,
        updated_at_ms: r.get(13)?,
    })
}
pub fn read_events(c: &Connection) -> Result<Vec<CalendarEvent>, String> {
    c.prepare("SELECT id,title,description,start_date,start_time,end_date,end_time,all_day,time_zone,start_at_ms,end_at_ms,reminder_offset_minutes,created_at_ms,updated_at_ms FROM calendar_events ORDER BY start_date,start_time").map_err(|e|e.to_string())?
        .query_map([],event_row).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())
}
pub fn read_preferences(c: &Connection) -> Result<ReminderPreferences, String> {
    c.query_row(
        "SELECT enabled,quiet_start,quiet_end FROM reminder_preferences WHERE id=1",
        [],
        |r| {
            Ok(ReminderPreferences {
                enabled: r.get(0)?,
                quiet_start: r.get(1)?,
                quiet_end: r.get(2)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
fn validate_event(e: &CalendarInput) -> Result<(), String> {
    if e.id.is_empty()
        || e.id.len() > 100
        || e.title.trim().is_empty()
        || e.title.chars().count() > 200
    {
        return Err("Event identifier or title is invalid".into());
    }
    if e.description.chars().count() > 10000 || e.time_zone.is_empty() || e.time_zone.len() > 100 {
        return Err("Event description or time zone is invalid".into());
    }
    if !valid_date(&e.start_date) || !valid_date(&e.end_date) || e.end_date < e.start_date {
        return Err("Event dates are invalid".into());
    }
    if e.reminder_offset_minutes
        .is_some_and(|n| !(0..=40320).contains(&n))
    {
        return Err("Reminder offset is invalid".into());
    }
    if e.all_day {
        if e.start_time.is_some()
            || e.end_time.is_some()
            || e.start_at_ms.is_some()
            || e.end_at_ms.is_some()
        {
            return Err("All-day events cannot include a time".into());
        }
    } else {
        if !e.start_time.as_deref().is_some_and(valid_time)
            || !e.end_time.as_deref().is_some_and(valid_time)
        {
            return Err("Timed events need valid start and end times".into());
        }
        if e.start_at_ms.is_none() || e.end_at_ms.is_none() || e.start_at_ms >= e.end_at_ms {
            return Err("Timed event instants are invalid".into());
        }
        if e.start_date == e.end_date && e.start_time >= e.end_time {
            return Err("Event end must follow its start".into());
        }
    }
    Ok(())
}
impl Database {
    pub fn save_event(&self, e: CalendarInput) -> Result<(), String> {
        validate_event(&e)?;
        let now = now_ms();
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute("INSERT INTO calendar_events(id,title,description,start_date,start_time,end_date,end_time,all_day,time_zone,start_at_ms,end_at_ms,reminder_offset_minutes,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,start_date=excluded.start_date,start_time=excluded.start_time,end_date=excluded.end_date,end_time=excluded.end_time,all_day=excluded.all_day,time_zone=excluded.time_zone,start_at_ms=excluded.start_at_ms,end_at_ms=excluded.end_at_ms,reminder_offset_minutes=excluded.reminder_offset_minutes,updated_at_ms=excluded.updated_at_ms",
          params![e.id,e.title.trim(),e.description,e.start_date,e.start_time,e.end_date,e.end_time,e.all_day,e.time_zone,e.start_at_ms,e.end_at_ms,e.reminder_offset_minutes,now]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn delete_event(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute("DELETE FROM calendar_events WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("Calendar event no longer exists".into());
        }
        Ok(())
    }
    pub fn save_reminder_preferences(
        &self,
        enabled: bool,
        quiet_start: &str,
        quiet_end: &str,
    ) -> Result<(), String> {
        if !valid_time(quiet_start) || !valid_time(quiet_end) {
            return Err("Quiet hours must use valid local times".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        c.execute(
            "UPDATE reminder_preferences SET enabled=?1,quiet_start=?2,quiet_end=?3 WHERE id=1",
            params![enabled, quiet_start, quiet_end],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn claim_reminder(
        &self,
        kind: &str,
        id: &str,
        scheduled_at_ms: i64,
    ) -> Result<bool, String> {
        if !["task", "event"].contains(&kind) || id.is_empty() {
            return Err("Invalid reminder source".into());
        }
        if scheduled_at_ms > now_ms() {
            return Err("Reminder is not due yet".into());
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let enabled: bool = c
            .query_row(
                "SELECT enabled FROM reminder_preferences WHERE id=1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !enabled {
            return Ok(false);
        }
        let table = if kind == "task" {
            "tasks"
        } else {
            "calendar_events"
        };
        let present:bool=c.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND reminder_offset_minutes IS NOT NULL)"),[id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !present {
            return Ok(false);
        }
        let changed=c.execute("INSERT OR IGNORE INTO reminder_deliveries(source_kind,source_id,scheduled_at_ms,delivered_at_ms) VALUES (?1,?2,?3,?4)",params![kind,id,scheduled_at_ms,now_ms()]).map_err(|e|e.to_string())?;
        Ok(changed > 0)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Database;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn db() -> (Database, std::path::PathBuf) {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("civildesk-calendar-{n}.sqlite3"));
        (Database::open(&p).unwrap(), p)
    }
    fn input() -> CalendarInput {
        CalendarInput {
            id: "event".into(),
            title: "Studio review".into(),
            description: String::new(),
            start_date: "2026-11-01".into(),
            start_time: Some("10:00".into()),
            end_date: "2026-11-01".into(),
            end_time: Some("11:00".into()),
            all_day: false,
            time_zone: "America/New_York".into(),
            start_at_ms: Some(1_800_000_000_000),
            end_at_ms: Some(1_800_003_600_000),
            reminder_offset_minutes: Some(15),
        }
    }
    #[test]
    fn event_round_trip_and_reminder_dedup() {
        let (d, p) = db();
        let e = input();
        d.save_event(e).unwrap();
        assert_eq!(d.workspace().unwrap().events.len(), 1);
        let due = now_ms() - 1000;
        assert!(d.claim_reminder("event", "event", due).unwrap());
        assert!(!d.claim_reminder("event", "event", due).unwrap());
        d.save_reminder_preferences(true, "21:00", "07:00").unwrap();
        drop(d);
        let d = Database::open(&p).unwrap();
        assert!(!d.claim_reminder("event", "event", due).unwrap());
        assert_eq!(
            d.workspace().unwrap().reminder_preferences.quiet_start,
            "21:00"
        );
        d.delete_event("event").unwrap();
        assert!(d.workspace().unwrap().events.is_empty());
        drop(d);
        std::fs::remove_file(p).unwrap()
    }
    #[test]
    fn invalid_calendar_dates_and_ranges_rejected() {
        let (d, p) = db();
        let mut e = input();
        e.start_date = "2025-02-29".into();
        assert!(d.save_event(e).is_err());
        drop(d);
        std::fs::remove_file(p).unwrap()
    }
}
