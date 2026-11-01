//! Phase 5A: a read-only Notion integration foundation.
//!
//! * `secrets`  – Windows Credential Manager storage, scoped per application identity.
//! * `client`   – allowlisted, HTTPS-only, rate-limit-aware API client.
//! * `parse`    – sanitizing converters from Notion JSON to display structures.
//! * this file  – the service that ties them to SQLite metadata. No synchronization, no writes to Notion.

pub mod client;
pub mod parse;
pub mod secrets;

use crate::persistence::Database;
use client::{
    CancelSource, Client, ClientConfig, ErrorKind, NotionError, ReadOp, ReqwestTransport,
    SearchKind, API_VERSION,
};
use parse::{BlocksPage, DataSourceView, DatabaseView, DiscoveryPage, EntriesPage, PageView};
use rusqlite::{params, Connection, OptionalExtension};
use secrets::{CredentialManagerStore, Secret, SecretStore};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    /// not_connected | connected | auth_failed | restricted | unavailable
    pub state: String,
    pub workspace_name: Option<String>,
    pub bot_name: Option<String>,
    pub connected_at_ms: Option<i64>,
    pub last_verified_at_ms: Option<i64>,
    pub selected_count: i64,
    pub read_only: bool,
    pub api_version: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedSource {
    pub resource_id: String,
    pub resource_type: String,
    pub display_name: String,
    pub database_id: Option<String>,
    pub selected_at_ms: i64,
    pub last_verified_at_ms: Option<i64>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_err(_: rusqlite::Error) -> NotionError {
    NotionError::storage("CivilDesk couldn't save the Notion connection details locally.")
}

pub struct NotionService {
    secrets: Box<dyn SecretStore>,
    client: Result<Arc<Client>, String>,
    cancel: CancelSource,
    identifier: String,
}

impl NotionService {
    /// The production service: Credential Manager scoped to this build's identity, real HTTPS transport.
    pub fn production(identifier: &str) -> Self {
        let client = ReqwestTransport::new()
            .map(|t| Arc::new(Client::new(Arc::new(t), ClientConfig::production())));
        Self::new(
            identifier,
            Box::new(CredentialManagerStore::for_identity(identifier)),
            client,
        )
    }

    pub fn new(
        identifier: &str,
        secrets: Box<dyn SecretStore>,
        client: Result<Arc<Client>, String>,
    ) -> Self {
        Self {
            secrets,
            client,
            cancel: CancelSource::default(),
            identifier: identifier.to_string(),
        }
    }

    /// Abandons in-flight requests and any retry waits. Used by the UI when a dialog closes, and on disconnect.
    pub fn cancel_all(&self) {
        self.cancel.cancel();
    }

    fn token(&self) -> Result<Secret, NotionError> {
        match self.secrets.get() {
            Ok(Some(t)) => Ok(t),
            Ok(None) => Err(NotionError::not_connected()),
            Err(secrets::SecretError::Unavailable(m)) => Err(NotionError::storage(m)),
        }
    }

    fn call_with(&self, token: &Secret, op: &ReadOp) -> Result<serde_json::Value, NotionError> {
        let client = self
            .client
            .as_ref()
            .map_err(|m| NotionError::new(ErrorKind::Unavailable, m.clone()))?;
        client.call(op, token, &self.cancel.token())
    }

    /// An authenticated read for browsing. A rejected credential is recorded so the UI stops claiming "connected".
    fn read(&self, db: &Database, op: ReadOp) -> Result<serde_json::Value, NotionError> {
        let token = self.token()?;
        match self.call_with(&token, &op) {
            Err(e) if matches!(e.kind, ErrorKind::AuthFailed) => {
                let conn =
                    db.0.lock()
                        .map_err(|_| NotionError::storage("Local data is busy."))?;
                let _ = store::set_state(&conn, "auth_failed");
                Err(e)
            }
            other => other,
        }
    }

    // -------------------------------------------------------------- connection

    /// Local only: no network. "connected" means the last verification succeeded and a credential is still stored.
    pub fn status(&self, db: &Database) -> Result<ConnectionStatus, NotionError> {
        let conn =
            db.0.lock()
                .map_err(|_| NotionError::storage("Local data is busy."))?;
        let row = store::connection(&conn).map_err(db_err)?;
        let selected_count = store::selected_count(&conn).map_err(db_err)?;
        let mut status = ConnectionStatus {
            state: "not_connected".into(),
            workspace_name: None,
            bot_name: None,
            connected_at_ms: None,
            last_verified_at_ms: None,
            selected_count,
            read_only: true,
            api_version: API_VERSION.into(),
            message: None,
        };
        match self.secrets.get() {
            Ok(Some(_)) => {
                if let Some(r) = row {
                    status.state = r.state;
                    status.workspace_name = r.workspace_name;
                    status.bot_name = r.bot_name;
                    status.connected_at_ms = Some(r.connected_at_ms);
                    status.last_verified_at_ms = r.last_verified_at_ms;
                } else {
                    // A credential with no verified record is never presented as connected.
                    status.message = Some("A saved credential has not been verified. Check the connection or disconnect.".into());
                    status.state = "auth_failed".into();
                }
            }
            Ok(None) => {}
            Err(secrets::SecretError::Unavailable(m)) => {
                status.state = "unavailable".into();
                status.message = Some(m);
            }
        }
        if status.state == "not_connected" {
            status.selected_count = 0;
        }
        Ok(status)
    }

    fn valid_token_shape(token: &str) -> bool {
        (10..=400).contains(&token.len()) && token.chars().all(|c| c.is_ascii_graphic())
    }

    /// Verifies the token with a read-only request, and only then stores it. Replaces any existing credential.
    pub fn connect(&self, db: &Database, token: String) -> Result<ConnectionStatus, NotionError> {
        let trimmed = token.trim().to_string();
        drop(token);
        if !Self::valid_token_shape(&trimmed) {
            return Err(NotionError::invalid("That doesn't look like a Notion connection token. Copy the internal connection secret from Notion and try again."));
        }
        let secret = Secret::new(trimmed);
        let me = self.call_with(&secret, &ReadOp::Me)?;
        let bot = parse::parse_me(&me)?;
        self.secrets
            .set(&secret)
            .map_err(|secrets::SecretError::Unavailable(m)| NotionError::storage(m))?;
        {
            let conn =
                db.0.lock()
                    .map_err(|_| NotionError::storage("Local data is busy."))?;
            store::upsert_connection(&conn, &self.identifier, &bot, now_ms()).map_err(db_err)?;
        }
        self.status(db)
    }

    /// A user-initiated read-only verification. Network trouble leaves the last known state untouched.
    pub fn check(&self, db: &Database) -> Result<ConnectionStatus, NotionError> {
        let token = self.token()?;
        match self
            .call_with(&token, &ReadOp::Me)
            .and_then(|v| parse::parse_me(&v))
        {
            Ok(bot) => {
                {
                    let conn =
                        db.0.lock()
                            .map_err(|_| NotionError::storage("Local data is busy."))?;
                    store::upsert_connection(&conn, &self.identifier, &bot, now_ms())
                        .map_err(db_err)?;
                }
                self.status(db)
            }
            Err(e) => {
                let state = match e.kind {
                    ErrorKind::AuthFailed => Some("auth_failed"),
                    ErrorKind::Restricted => Some("restricted"),
                    _ => None,
                };
                if let Some(state) = state {
                    let conn =
                        db.0.lock()
                            .map_err(|_| NotionError::storage("Local data is busy."))?;
                    store::set_state(&conn, state).map_err(db_err)?;
                }
                Err(e)
            }
        }
    }

    /// Removes the local credential first (so no further request can be authenticated), then the local metadata.
    /// This does not revoke the connection inside Notion.
    pub fn disconnect(&self, db: &Database) -> Result<ConnectionStatus, NotionError> {
        self.cancel.cancel();
        self.secrets
            .delete()
            .map_err(|secrets::SecretError::Unavailable(m)| NotionError::storage(m))?;
        {
            let conn =
                db.0.lock()
                    .map_err(|_| NotionError::storage("Local data is busy."))?;
            store::clear(&conn).map_err(db_err)?;
        }
        self.status(db)
    }

    // -------------------------------------------------------------- browsing (all reads)

    pub fn search(
        &self,
        db: &Database,
        query: Option<String>,
        kind: Option<String>,
        cursor: Option<String>,
    ) -> Result<DiscoveryPage, NotionError> {
        let kind = match kind.as_deref() {
            None | Some("") | Some("all") => None,
            Some("page") => Some(SearchKind::Page),
            Some("data_source") => Some(SearchKind::DataSource),
            Some(_) => return Err(NotionError::invalid("Unknown resource type.")),
        };
        parse::parse_search(&self.read(
            db,
            ReadOp::Search {
                query,
                kind,
                cursor,
            },
        )?)
    }

    pub fn open_database(&self, db: &Database, id: String) -> Result<DatabaseView, NotionError> {
        parse::parse_database(&self.read(db, ReadOp::GetDatabase(id))?)
    }

    pub fn open_data_source(
        &self,
        db: &Database,
        id: String,
    ) -> Result<DataSourceView, NotionError> {
        let view = parse::parse_data_source(&self.read(db, ReadOp::GetDataSource(id))?)?;
        self.refresh_selected(db, &view.id, &view.name, view.database_id.as_deref());
        Ok(view)
    }

    pub fn preview_entries(
        &self,
        db: &Database,
        id: String,
        cursor: Option<String>,
    ) -> Result<EntriesPage, NotionError> {
        parse::parse_entries(&self.read(db, ReadOp::QueryDataSource { id, cursor })?)
    }

    pub fn open_page(&self, db: &Database, id: String) -> Result<PageView, NotionError> {
        let view = parse::parse_page(&self.read(db, ReadOp::GetPage(id))?)?;
        self.refresh_selected(db, &view.id, &view.title, None);
        Ok(view)
    }

    pub fn page_blocks(
        &self,
        db: &Database,
        id: String,
        cursor: Option<String>,
    ) -> Result<BlocksPage, NotionError> {
        parse::parse_blocks(&self.read(db, ReadOp::BlockChildren { id, cursor })?)
    }

    // -------------------------------------------------------------- remembered sources (no sync)

    fn refresh_selected(&self, db: &Database, id: &str, name: &str, database_id: Option<&str>) {
        if let Ok(conn) = db.0.lock() {
            let _ = store::refresh_source(&conn, id, name, database_id, now_ms());
        }
    }

    /// Remembers (or forgets) a source. The name and type come from Notion again, not from the caller.
    pub fn set_source_selected(
        &self,
        db: &Database,
        resource_id: String,
        resource_type: String,
        selected: bool,
    ) -> Result<Vec<SelectedSource>, NotionError> {
        let id = client::normalize_id(&resource_id)?;
        {
            let conn =
                db.0.lock()
                    .map_err(|_| NotionError::storage("Local data is busy."))?;
            if store::connection(&conn).map_err(db_err)?.is_none() {
                return Err(NotionError::not_connected());
            }
        }
        if selected {
            let (name, database_id) = match resource_type.as_str() {
                "data_source" => {
                    let v = parse::parse_data_source(
                        &self.read(db, ReadOp::GetDataSource(id.clone()))?,
                    )?;
                    (v.name, v.database_id)
                }
                "page" => {
                    let v = parse::parse_page(&self.read(db, ReadOp::GetPage(id.clone()))?)?;
                    (v.title, None)
                }
                _ => {
                    return Err(NotionError::invalid(
                        "Only pages and data sources can be remembered.",
                    ))
                }
            };
            let conn =
                db.0.lock()
                    .map_err(|_| NotionError::storage("Local data is busy."))?;
            store::select_source(
                &conn,
                &id,
                &resource_type,
                &name,
                database_id.as_deref(),
                now_ms(),
            )
            .map_err(db_err)?;
        } else {
            let conn =
                db.0.lock()
                    .map_err(|_| NotionError::storage("Local data is busy."))?;
            store::deselect_source(&conn, &id).map_err(db_err)?;
        }
        self.selected_sources(db)
    }

    pub fn selected_sources(&self, db: &Database) -> Result<Vec<SelectedSource>, NotionError> {
        let conn =
            db.0.lock()
                .map_err(|_| NotionError::storage("Local data is busy."))?;
        store::selected(&conn).map_err(db_err)
    }
}

/// SQLite access for the nonsecret metadata. Statements are parameterised; no credential ever reaches this layer.
pub mod store {
    use super::*;

    pub struct ConnectionRow {
        pub state: String,
        pub workspace_id: Option<String>,
        pub workspace_name: Option<String>,
        pub bot_name: Option<String>,
        pub connected_at_ms: i64,
        pub last_verified_at_ms: Option<i64>,
    }

    pub fn connection(conn: &Connection) -> rusqlite::Result<Option<ConnectionRow>> {
        conn.query_row("SELECT status, workspace_id, workspace_name, bot_name, connected_at_ms, last_verified_at_ms FROM notion_connection WHERE id='default'", [], |r| {
            Ok(ConnectionRow { state: r.get(0)?, workspace_id: r.get(1)?, workspace_name: r.get(2)?, bot_name: r.get(3)?, connected_at_ms: r.get(4)?, last_verified_at_ms: r.get(5)? })
        })
        .optional()
    }

    /// Records a successful verification. If the credential now belongs to a different workspace, old selections are dropped.
    pub fn upsert_connection(
        conn: &Connection,
        identifier: &str,
        bot: &parse::BotInfo,
        now: i64,
    ) -> rusqlite::Result<()> {
        let existing = connection(conn)?;
        if let Some(old) = &existing {
            if old.workspace_id.is_some()
                && bot.workspace_id.is_some()
                && old.workspace_id != bot.workspace_id
            {
                conn.execute("DELETE FROM notion_sources", [])?;
            }
        }
        let connected_at = existing.as_ref().map(|e| e.connected_at_ms).unwrap_or(now);
        conn.execute(
            "INSERT INTO notion_connection(id, identifier, bot_name, workspace_id, workspace_name, status, connected_at_ms, last_verified_at_ms)
             VALUES ('default', ?1, ?2, ?3, ?4, 'connected', ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET identifier=excluded.identifier, bot_name=excluded.bot_name, workspace_id=excluded.workspace_id,
               workspace_name=excluded.workspace_name, status='connected', last_verified_at_ms=excluded.last_verified_at_ms",
            params![identifier, bot.bot_name, bot.workspace_id, bot.workspace_name, connected_at, now],
        )?;
        Ok(())
    }

    pub fn set_state(conn: &Connection, state: &str) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE notion_connection SET status=?1 WHERE id='default'",
            [state],
        )?;
        Ok(())
    }

    pub fn clear(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute("DELETE FROM notion_connection", [])?; // cascades to notion_sources
        conn.execute("DELETE FROM notion_sources", [])?;
        Ok(())
    }

    pub fn selected_count(conn: &Connection) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM notion_sources WHERE selected=1",
            [],
            |r| r.get(0),
        )
    }

    pub fn select_source(
        conn: &Connection,
        id: &str,
        kind: &str,
        name: &str,
        database_id: Option<&str>,
        now: i64,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO notion_sources(connection_id, resource_id, resource_type, display_name, database_id, selected, selected_at_ms, last_verified_at_ms)
             VALUES ('default', ?1, ?2, ?3, ?4, 1, ?5, ?5)
             ON CONFLICT(connection_id, resource_id) DO UPDATE SET resource_type=excluded.resource_type, display_name=excluded.display_name,
               database_id=excluded.database_id, selected=1, last_verified_at_ms=excluded.last_verified_at_ms",
            params![id, kind, name, database_id, now],
        )?;
        Ok(())
    }

    pub fn deselect_source(conn: &Connection, id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE notion_sources SET selected=0 WHERE resource_id=?1",
            [id],
        )?;
        Ok(())
    }

    /// Updates the remembered name and verification time when a selected source was just read successfully.
    pub fn refresh_source(
        conn: &Connection,
        id: &str,
        name: &str,
        database_id: Option<&str>,
        now: i64,
    ) -> rusqlite::Result<()> {
        conn.execute("UPDATE notion_sources SET display_name=?2, database_id=COALESCE(?3, database_id), last_verified_at_ms=?4 WHERE resource_id=?1 AND selected=1", params![id, name, database_id, now])?;
        Ok(())
    }

    pub fn selected(conn: &Connection) -> rusqlite::Result<Vec<SelectedSource>> {
        let mut stmt = conn.prepare("SELECT resource_id, resource_type, display_name, database_id, selected_at_ms, last_verified_at_ms FROM notion_sources WHERE selected=1 ORDER BY display_name COLLATE NOCASE, resource_id")?;
        let rows = stmt.query_map([], |r| {
            Ok(SelectedSource {
                resource_id: r.get(0)?,
                resource_type: r.get(1)?,
                display_name: r.get(2)?,
                database_id: r.get(3)?,
                selected_at_ms: r.get(4)?,
                last_verified_at_ms: r.get(5)?,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::client::tests::{ok, status, test_client, MockTransport};
    use super::client::{HttpResponse, NetError};
    use super::secrets::{MemorySecretStore, MemoryVault};
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    const TOKEN: &str = "ntn_integration_test_token_0123456789";
    const WS_A: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const DS: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const PG: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    fn me(workspace: &str, name: &str) -> client::tests::Scripted {
        ok(
            json!({"object":"user","id":WS_A,"type":"bot","name":"CivilDesk Dev","bot":{"owner":{"type":"workspace","workspace":true},"workspace_id":workspace,"workspace_name":name}}),
        )
    }
    fn memory_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::persistence::migrate(&conn).unwrap();
        Database(Mutex::new(conn))
    }
    fn service(
        vault: &MemoryVault,
        ident: &str,
        script: Vec<client::tests::Scripted>,
    ) -> (NotionService, Arc<MockTransport>) {
        let t = MockTransport::scripted(script);
        let (c, _) = test_client(t.clone());
        (
            NotionService::new(
                ident,
                Box::new(MemorySecretStore::new(vault, ident)),
                Ok(Arc::new(c)),
            ),
            t,
        )
    }
    fn connected(
        script_after: Vec<client::tests::Scripted>,
    ) -> (NotionService, Database, Arc<MockTransport>, MemoryVault) {
        let vault = MemoryVault::default();
        let mut script = vec![me("ws-1", "Lab")];
        script.extend(script_after);
        let (svc, t) = service(&vault, "com.webswe.civildesk.dev", script);
        let db = memory_db();
        svc.connect(&db, TOKEN.into()).unwrap();
        (svc, db, t, vault)
    }
    fn all_text(db: &Database) -> String {
        let conn = db.0.lock().unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let mut out = String::new();
        for t in tables {
            let mut stmt = conn.prepare(&format!("SELECT * FROM \"{t}\"")).unwrap();
            let n = stmt.column_count();
            let rows = stmt
                .query_map([], |r| {
                    Ok((0..n)
                        .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                        .collect::<Vec<_>>()
                        .join("|"))
                })
                .unwrap();
            for r in rows {
                out.push_str(&r.unwrap());
                out.push('\n');
            }
        }
        out
    }

    #[test]
    fn migration_is_additive_and_v9_data_survives() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::persistence::migrate(&conn).unwrap();
        let v: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 10);
        let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0)).unwrap();
        assert_eq!(tables, 53);
        let fk: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fk, 0);
    }

    #[test]
    fn starts_disconnected_without_any_network_request() {
        let vault = MemoryVault::default();
        let (svc, t) = service(&vault, "com.webswe.civildesk.dev", vec![]);
        let db = memory_db();
        let s = svc.status(&db).unwrap();
        assert_eq!(s.state, "not_connected");
        assert!(s.read_only);
        assert_eq!(s.api_version, "2026-03-11");
        assert!(t.paths().is_empty());
        assert_eq!(
            svc.search(&db, None, None, None).unwrap_err().kind,
            ErrorKind::NotConnected
        );
        assert!(t.paths().is_empty());
    }

    #[test]
    fn connect_verifies_with_a_read_then_stores_the_credential() {
        let (svc, db, t, vault) = connected(vec![]);
        assert_eq!(t.paths(), vec!["/v1/users/me"]);
        let s = svc.status(&db).unwrap();
        assert_eq!(s.state, "connected");
        assert_eq!(s.workspace_name.as_deref(), Some("Lab"));
        assert!(s.last_verified_at_ms.is_some());
        assert_eq!(
            vault.entries(),
            vec![(
                "com.webswe.civildesk.dev.notion".to_string(),
                "notion-connection".to_string()
            )]
        );
    }

    #[test]
    fn the_token_is_never_written_to_sqlite_or_returned_to_the_ui() {
        let (svc, db, _, _) = connected(vec![]);
        assert!(!all_text(&db).contains(TOKEN));
        let json = serde_json::to_string(&svc.status(&db).unwrap()).unwrap();
        assert!(!json.contains(TOKEN) && !json.to_lowercase().contains("token"));
    }

    #[test]
    fn invalid_token_is_not_saved_and_shows_auth_failure() {
        let vault = MemoryVault::default();
        let (svc, t) = service(&vault, "com.webswe.civildesk.dev", vec![status(401)]);
        let db = memory_db();
        let e = svc.connect(&db, TOKEN.into()).unwrap_err();
        assert_eq!(e.kind, ErrorKind::AuthFailed);
        assert!(vault.entries().is_empty());
        assert_eq!(svc.status(&db).unwrap().state, "not_connected");
        assert_eq!(t.paths().len(), 1, "no retry of an invalid credential");
        assert!(!format!("{e:?}").contains(TOKEN));
    }

    #[test]
    fn malformed_tokens_are_rejected_before_any_request() {
        let vault = MemoryVault::default();
        let (svc, t) = service(&vault, "com.webswe.civildesk.dev", vec![me("w", "x")]);
        let db = memory_db();
        for bad in [
            "",
            "short",
            "has space inside the token 1234",
            "line\nbreak0123456789",
        ] {
            assert_eq!(
                svc.connect(&db, bad.into()).unwrap_err().kind,
                ErrorKind::InvalidRequest,
                "{bad}"
            );
        }
        assert!(t.paths().is_empty() && vault.entries().is_empty());
    }

    #[test]
    fn connecting_while_offline_stores_nothing() {
        let vault = MemoryVault::default();
        let (svc, _) = service(
            &vault,
            "com.webswe.civildesk.dev",
            vec![Err(NetError::Offline)],
        );
        let db = memory_db();
        let e = svc.connect(&db, TOKEN.into()).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Offline);
        assert!(e.message.contains("Your CivilDesk data is unaffected"));
        assert!(vault.entries().is_empty());
    }

    #[test]
    fn check_connection_updates_verification_and_handles_revocation() {
        let (svc, db, _, _) = connected(vec![me("ws-1", "Lab Renamed"), status(401)]);
        let s = svc.check(&db).unwrap();
        assert_eq!(s.workspace_name.as_deref(), Some("Lab Renamed"));
        let e = svc.check(&db).unwrap_err();
        assert_eq!(e.kind, ErrorKind::AuthFailed);
        assert_eq!(
            svc.status(&db).unwrap().state,
            "auth_failed",
            "revoked credentials are not shown as connected"
        );
    }

    #[test]
    fn transient_failures_do_not_change_the_recorded_state() {
        let (svc, db, _, _) = connected(vec![
            Err(NetError::Offline),
            Err(NetError::Timeout),
            Err(NetError::Timeout),
            Ok(HttpResponse {
                status: 429,
                retry_after: Some(60),
                body: "{}".into(),
            }),
        ]);
        assert_eq!(svc.check(&db).unwrap_err().kind, ErrorKind::Offline);
        assert_eq!(svc.status(&db).unwrap().state, "connected");
        assert_eq!(svc.check(&db).unwrap_err().kind, ErrorKind::Timeout);
        assert_eq!(svc.check(&db).unwrap_err().kind, ErrorKind::RateLimited);
        assert_eq!(svc.status(&db).unwrap().state, "connected");
    }

    #[test]
    fn restricted_check_is_recorded() {
        let (svc, db, _, _) = connected(vec![status(403)]);
        assert_eq!(svc.check(&db).unwrap_err().kind, ErrorKind::Restricted);
        assert_eq!(svc.status(&db).unwrap().state, "restricted");
    }

    #[test]
    fn replacing_the_credential_overwrites_it_and_keeps_selections_in_the_same_workspace() {
        let (svc, db, _, vault) = connected(vec![
            ok(
                json!({"object":"data_source","id":DS,"title":[{"plain_text":"Tasks"}],"properties":{}}),
            ),
            me("ws-1", "Lab"),
        ]);
        svc.set_source_selected(&db, DS.into(), "data_source".into(), true)
            .unwrap();
        svc.connect(&db, "ntn_second_replacement_token_99999".into())
            .unwrap();
        assert_eq!(vault.entries().len(), 1);
        assert_eq!(svc.selected_sources(&db).unwrap().len(), 1);
        assert!(!all_text(&db).contains("replacement_token"));
    }

    #[test]
    fn switching_to_a_different_workspace_drops_old_selections() {
        let (svc, db, _, _) = connected(vec![
            ok(
                json!({"object":"data_source","id":DS,"title":[{"plain_text":"Tasks"}],"properties":{}}),
            ),
            me("ws-OTHER", "Other"),
        ]);
        svc.set_source_selected(&db, DS.into(), "data_source".into(), true)
            .unwrap();
        svc.connect(&db, "ntn_other_workspace_token_12345".into())
            .unwrap();
        assert!(svc.selected_sources(&db).unwrap().is_empty());
    }

    #[test]
    fn disconnect_removes_the_credential_metadata_and_blocks_future_requests() {
        let (svc, db, t, vault) = connected(vec![ok(
            json!({"object":"data_source","id":DS,"title":[{"plain_text":"Tasks"}],"properties":{}}),
        )]);
        svc.set_source_selected(&db, DS.into(), "data_source".into(), true)
            .unwrap();
        db.0.lock()
            .unwrap()
            .execute(
                "INSERT INTO app_state(key,value) VALUES ('unrelated','keep')",
                [],
            )
            .unwrap();
        let s = svc.disconnect(&db).unwrap();
        assert_eq!(s.state, "not_connected");
        assert_eq!(s.selected_count, 0);
        assert!(vault.entries().is_empty());
        assert!(svc.selected_sources(&db).unwrap().is_empty());
        let before = t.paths().len();
        assert_eq!(
            svc.search(&db, None, None, None).unwrap_err().kind,
            ErrorKind::NotConnected
        );
        assert_eq!(
            t.paths().len(),
            before,
            "no Notion request after disconnect"
        );
        let kept: String =
            db.0.lock()
                .unwrap()
                .query_row(
                    "SELECT value FROM app_state WHERE key='unrelated'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
        assert_eq!(kept, "keep");
        assert!(svc.disconnect(&db).is_ok(), "disconnect is idempotent");
    }

    #[test]
    fn credentials_are_isolated_between_application_identities() {
        let vault = MemoryVault::default();
        let (dev, _) = service(&vault, "com.webswe.civildesk.dev", vec![me("w", "Dev")]);
        let (prod, tp) = service(&vault, "com.webswe.civildesk", vec![]);
        let db_dev = memory_db();
        let db_prod = memory_db();
        dev.connect(&db_dev, TOKEN.into()).unwrap();
        assert_eq!(prod.status(&db_prod).unwrap().state, "not_connected");
        assert_eq!(
            prod.search(&db_prod, None, None, None).unwrap_err().kind,
            ErrorKind::NotConnected
        );
        assert!(tp.paths().is_empty());
        assert_eq!(dev.status(&db_dev).unwrap().state, "connected");
    }

    #[test]
    fn discovery_search_and_pagination() {
        let page1 = ok(
            json!({"object":"list","has_more":true,"next_cursor":"cursor-2","results":[
            {"object":"data_source","id":DS,"title":[{"plain_text":"Assignments"}],"parent":{"type":"database_id","database_id":PG},"properties":{}}]}),
        );
        let page2 = ok(
            json!({"object":"list","has_more":false,"next_cursor":null,"results":[
            {"object":"page","id":PG,"properties":{"Name":{"type":"title","title":[{"plain_text":"Notes"}]}}}]}),
        );
        let (svc, db, t, _) = connected(vec![page1, page2]);
        let a = svc.search(&db, Some("a".into()), None, None).unwrap();
        assert!(a.has_more);
        let b = svc
            .search(&db, Some("a".into()), None, a.next_cursor.clone())
            .unwrap();
        assert!(!b.has_more && b.next_cursor.is_none());
        assert_eq!(a.items[0].resource_type, "data_source");
        assert_eq!(b.items[0].name, "Notes");
        let bodies: Vec<String> = t
            .seen
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, _, b)| b.clone())
            .collect();
        assert!(bodies[1].contains("cursor-2"));
    }

    #[test]
    fn database_then_data_source_then_entries_use_the_right_endpoints() {
        let (svc, db, t, _) = connected(vec![
            ok(
                json!({"object":"database","id":PG,"title":[{"plain_text":"Coursework"}],"data_sources":[{"id":DS,"name":"Main"}]}),
            ),
            ok(
                json!({"object":"data_source","id":DS,"title":[{"plain_text":"Main"}],"parent":{"type":"database_id","database_id":PG},"properties":{"Name":{"type":"title","title":{}}}}),
            ),
            ok(
                json!({"object":"list","has_more":false,"next_cursor":null,"results":[{"object":"page","id":WS_A,"properties":{"Name":{"type":"title","title":[{"plain_text":"Row"}]}}}]}),
            ),
        ]);
        let d = svc.open_database(&db, PG.into()).unwrap();
        assert_eq!(d.data_sources[0].id, DS);
        let ds = svc
            .open_data_source(&db, d.data_sources[0].id.clone())
            .unwrap();
        assert_eq!(ds.properties.len(), 1);
        let rows = svc.preview_entries(&db, ds.id.clone(), None).unwrap();
        assert_eq!(rows.rows[0].title, "Row");
        let paths = t.paths();
        assert!(paths[1].starts_with(&format!("/v1/databases/{PG}")));
        assert!(
            paths[2].starts_with(&format!("/v1/data_sources/{DS}")) && !paths[2].contains("/query")
        );
        assert!(paths[3].ends_with("/query"));
        // database ids and data source ids are not interchangeable: a database id is never sent to a data source endpoint
        assert!(!paths
            .iter()
            .any(|p| p.contains(&format!("data_sources/{PG}"))));
    }

    #[test]
    fn unauthorized_resource_is_a_clear_restricted_or_not_found_error() {
        let (svc, db, _, _) = connected(vec![status(404), status(403)]);
        assert_eq!(
            svc.open_page(&db, PG.into()).unwrap_err().kind,
            ErrorKind::NotFound
        );
        assert_eq!(
            svc.open_data_source(&db, DS.into()).unwrap_err().kind,
            ErrorKind::Restricted
        );
        assert_eq!(
            svc.status(&db).unwrap().state,
            "connected",
            "a single inaccessible item does not disconnect"
        );
    }

    #[test]
    fn a_401_while_browsing_marks_the_connection_as_failed() {
        let (svc, db, _, _) = connected(vec![status(401)]);
        assert_eq!(
            svc.search(&db, None, None, None).unwrap_err().kind,
            ErrorKind::AuthFailed
        );
        assert_eq!(svc.status(&db).unwrap().state, "auth_failed");
    }

    #[test]
    fn selecting_a_source_persists_metadata_and_survives_a_new_service() {
        let (svc, db, _, vault) = connected(vec![ok(
            json!({"object":"data_source","id":DS,"title":[{"plain_text":"Assignments"}],"parent":{"type":"database_id","database_id":PG},"properties":{}}),
        )]);
        let list = svc
            .set_source_selected(&db, DS.to_uppercase(), "data_source".into(), true)
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].display_name, "Assignments");
        assert_eq!(list[0].database_id.as_deref(), Some(PG));
        assert!(list[0].last_verified_at_ms.is_some());
        let (restarted, t2) = service(&vault, "com.webswe.civildesk.dev", vec![]);
        assert_eq!(
            restarted.selected_sources(&db).unwrap(),
            list,
            "selection is local and needs no network"
        );
        assert_eq!(restarted.status(&db).unwrap().selected_count, 1);
        assert!(t2.paths().is_empty());
        let after = restarted
            .set_source_selected(&db, DS.into(), "data_source".into(), false)
            .unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn selection_uses_notion_metadata_not_caller_supplied_names_and_rejects_bad_types() {
        let (svc, db, _, _) = connected(vec![status(404)]);
        assert_eq!(
            svc.set_source_selected(&db, PG.into(), "page".into(), true)
                .unwrap_err()
                .kind,
            ErrorKind::NotFound
        );
        assert!(svc.selected_sources(&db).unwrap().is_empty());
        assert_eq!(
            svc.set_source_selected(&db, PG.into(), "database".into(), true)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidRequest
        );
        assert_eq!(
            svc.set_source_selected(&db, "../x".into(), "page".into(), true)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidRequest
        );
    }

    #[test]
    fn selecting_never_creates_tasks_or_projects() {
        let (svc, db, _, _) = connected(vec![ok(
            json!({"object":"data_source","id":DS,"title":[{"plain_text":"Tasks"}],"properties":{}}),
        )]);
        let count = |table: &str| -> i64 {
            db.0.lock()
                .unwrap()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap()
        };
        let before = (count("tasks"), count("engineering_projects"));
        svc.set_source_selected(&db, DS.into(), "data_source".into(), true)
            .unwrap();
        assert_eq!((count("tasks"), count("engineering_projects")), before);
    }

    #[test]
    fn only_get_and_post_read_endpoints_are_ever_requested() {
        let (svc, db, t, _) = connected(vec![
            ok(json!({"object":"list","results":[],"has_more":false,"next_cursor":null})),
            ok(json!({"object":"page","id":PG,"properties":{}})),
            ok(json!({"object":"list","results":[],"has_more":false,"next_cursor":null})),
        ]);
        svc.search(&db, None, None, None).unwrap();
        svc.open_page(&db, PG.into()).unwrap();
        svc.page_blocks(&db, PG.into(), None).unwrap();
        for (m, p, _) in t.seen.lock().unwrap().iter() {
            assert!(
                client::is_allowed(&client::HttpRequest {
                    method: *m,
                    path: p.clone(),
                    body: None
                }),
                "{p}"
            );
        }
        assert!(t.tokens.lock().unwrap().iter().all(|x| x == TOKEN));
    }
}
