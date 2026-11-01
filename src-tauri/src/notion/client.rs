//! The Notion API boundary. Every request is built from the closed `ReadOp` set, checked against a strict
//! allowlist, sent to one fixed HTTPS host with timeouts, bounded retries and one request in flight at a time.
//! There is deliberately no function here that can create, update, or delete Notion content.

use super::secrets::{redact, Secret};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

/// The one place the Notion API version is configured.
pub const API_VERSION: &str = "2026-03-11";
/// The only host the client talks to.
pub const API_BASE: &str = "https://api.notion.com";
pub const PREVIEW_PAGE_SIZE: u32 = 10;
pub const LIST_PAGE_SIZE: u32 = 25;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

// ---------------------------------------------------------------- errors

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotConnected,
    AuthFailed,
    Restricted,
    NotFound,
    RateLimited,
    Offline,
    Timeout,
    Tls,
    Unavailable,
    InvalidRequest,
    InvalidResponse,
    Cancelled,
    Storage,
}

/// A sanitized, user-presentable error. It never carries a token or a raw response body.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionError {
    pub kind: ErrorKind,
    pub message: String,
    pub retry_after_seconds: Option<u64>,
}

impl NotionError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: redact(&message.into(), None),
            retry_after_seconds: None,
        }
    }
    pub fn not_connected() -> Self {
        Self::new(
            ErrorKind::NotConnected,
            "Notion isn't connected. Connect it in Settings to browse content.",
        )
    }
    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Storage, message)
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidRequest, message)
    }
    pub fn invalid_response() -> Self {
        Self::new(ErrorKind::InvalidResponse, "Notion sent a response CivilDesk couldn't understand. Your CivilDesk data is unaffected.")
    }
    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "The Notion request was cancelled.")
    }
    pub fn unreachable_offline() -> Self {
        Self::new(
            ErrorKind::Offline,
            "Notion couldn't be reached. Your CivilDesk data is unaffected.",
        )
    }
}

fn status_error(status: u16, retry_after: Option<u64>) -> NotionError {
    match status {
        401 => NotionError::new(ErrorKind::AuthFailed, "Notion didn't accept the saved connection token. It may have been revoked or replaced. Reconnect with a current token. Your CivilDesk data is unaffected."),
        403 => NotionError::new(ErrorKind::Restricted, "This connection isn't allowed to read that content. Check that the Notion connection has the \u{201c}Read content\u{201d} capability and has been shared with the page or database."),
        404 => NotionError::new(ErrorKind::NotFound, "Notion couldn't find that item. It may have been moved or deleted, or it hasn't been shared with this connection."),
        429 | 529 => {
            let mut e = NotionError::new(ErrorKind::RateLimited, match retry_after { Some(s) => format!("Notion is limiting requests right now. Try again in about {s} seconds."), None => "Notion is limiting requests right now. Try again in a moment.".to_string() });
            e.retry_after_seconds = retry_after;
            e
        }
        400 | 409 | 406 => NotionError::new(ErrorKind::InvalidRequest, "Notion couldn't process that request."),
        500 | 502 | 503 | 504 => NotionError::new(ErrorKind::Unavailable, "Notion is having trouble right now. Try again later. Your CivilDesk data is unaffected."),
        _ => NotionError::invalid_response(),
    }
}

// ---------------------------------------------------------------- the read-only operation set

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchKind {
    Page,
    DataSource,
}

/// Every operation CivilDesk may perform against Notion. All are reads. Adding a write requires editing this
/// enum AND the allowlist below; neither is reachable from a frontend command parameter.
#[derive(Debug, Clone)]
pub enum ReadOp {
    Me,
    Search {
        query: Option<String>,
        kind: Option<SearchKind>,
        cursor: Option<String>,
    },
    GetDatabase(String),
    GetDataSource(String),
    QueryDataSource {
        id: String,
        cursor: Option<String>,
    },
    GetPage(String),
    BlockChildren {
        id: String,
        cursor: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: Method,
    pub path: String,
    pub body: Option<String>,
}

/// Accepts 32 hex characters, with or without dashes, and returns the canonical dashed lowercase UUID.
/// Anything else (path separators, query strings, `..`) is rejected before a URL is ever built.
pub fn normalize_id(raw: &str) -> Result<String, NotionError> {
    let hex: String = raw.trim().chars().filter(|c| *c != '-').collect();
    let dashes_ok = raw.trim().len() == 32 || raw.trim().len() == 36;
    if !dashes_ok || hex.len() != 32 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(NotionError::invalid(
            "That Notion item identifier isn't valid.",
        ));
    }
    let h = hex.to_ascii_lowercase();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

fn valid_cursor(cursor: &str) -> bool {
    !cursor.is_empty()
        && cursor.len() <= 256
        && cursor
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_:=.".contains(c))
}

impl ReadOp {
    pub fn to_request(&self) -> Result<HttpRequest, NotionError> {
        let cursor_ok = |c: &Option<String>| -> Result<(), NotionError> {
            match c {
                Some(c) if !valid_cursor(c) => {
                    Err(NotionError::invalid("The page position is not valid."))
                }
                _ => Ok(()),
            }
        };
        let req = match self {
            ReadOp::Me => HttpRequest {
                method: Method::Get,
                path: "/v1/users/me".into(),
                body: None,
            },
            ReadOp::Search {
                query,
                kind,
                cursor,
            } => {
                cursor_ok(cursor)?;
                let mut body = json!({ "page_size": LIST_PAGE_SIZE, "sort": { "timestamp": "last_edited_time", "direction": "descending" } });
                if let Some(q) = query.as_ref().map(|q| q.trim()).filter(|q| !q.is_empty()) {
                    body["query"] = json!(q.chars().take(200).collect::<String>());
                }
                match kind {
                    Some(SearchKind::Page) => {
                        body["filter"] = json!({ "property": "object", "value": "page" })
                    }
                    Some(SearchKind::DataSource) => {
                        body["filter"] = json!({ "property": "object", "value": "data_source" })
                    }
                    None => {}
                }
                if let Some(c) = cursor {
                    body["start_cursor"] = json!(c);
                }
                HttpRequest {
                    method: Method::Post,
                    path: "/v1/search".into(),
                    body: Some(body.to_string()),
                }
            }
            ReadOp::GetDatabase(id) => HttpRequest {
                method: Method::Get,
                path: format!("/v1/databases/{}", normalize_id(id)?),
                body: None,
            },
            ReadOp::GetDataSource(id) => HttpRequest {
                method: Method::Get,
                path: format!("/v1/data_sources/{}", normalize_id(id)?),
                body: None,
            },
            ReadOp::QueryDataSource { id, cursor } => {
                cursor_ok(cursor)?;
                let mut body = json!({ "page_size": PREVIEW_PAGE_SIZE });
                if let Some(c) = cursor {
                    body["start_cursor"] = json!(c);
                }
                HttpRequest {
                    method: Method::Post,
                    path: format!("/v1/data_sources/{}/query", normalize_id(id)?),
                    body: Some(body.to_string()),
                }
            }
            ReadOp::GetPage(id) => HttpRequest {
                method: Method::Get,
                path: format!("/v1/pages/{}", normalize_id(id)?),
                body: None,
            },
            ReadOp::BlockChildren { id, cursor } => {
                cursor_ok(cursor)?;
                let mut path = format!("/v1/blocks/{}/children?page_size=50", normalize_id(id)?);
                if let Some(c) = cursor {
                    path.push_str("&start_cursor=");
                    path.push_str(c);
                }
                HttpRequest {
                    method: Method::Get,
                    path,
                    body: None,
                }
            }
        };
        if !is_allowed(&req) {
            return Err(NotionError::invalid(
                "That Notion operation isn't permitted.",
            ));
        }
        Ok(req)
    }
}

/// The strict allowlist. Checked when a request is built, again before it is sent, and again in the transport.
pub fn is_allowed(req: &HttpRequest) -> bool {
    let (path, query) = match req.path.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (req.path.as_str(), None),
    };
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let is_id = |s: &str| s.len() == 36 && normalize_id(s).map(|n| n == s).unwrap_or(false);
    let query_ok = |expected_cursor_ok: bool| match query {
        None => true,
        Some(q) if expected_cursor_ok => q.split('&').all(|kv| match kv.split_once('=') {
            Some(("page_size", v)) => v
                .parse::<u32>()
                .map(|n| (1..=100).contains(&n))
                .unwrap_or(false),
            Some(("start_cursor", v)) => valid_cursor(v),
            _ => false,
        }),
        Some(_) => false,
    };
    match (req.method, parts.as_slice()) {
        (Method::Get, ["v1", "users", "me"]) => query.is_none(),
        (Method::Post, ["v1", "search"]) => query.is_none(),
        (Method::Get, ["v1", "databases", id]) => is_id(id) && query.is_none(),
        (Method::Get, ["v1", "data_sources", id]) => is_id(id) && query.is_none(),
        (Method::Post, ["v1", "data_sources", id, "query"]) => is_id(id) && query.is_none(),
        (Method::Get, ["v1", "pages", id]) => is_id(id) && query.is_none(),
        (Method::Get, ["v1", "blocks", id, "children"]) => is_id(id) && query_ok(true),
        _ => false,
    }
}

// ---------------------------------------------------------------- transport

pub struct HttpResponse {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetError {
    Timeout,
    Offline,
    Tls,
    Other,
}

pub trait Transport: Send + Sync {
    fn send(&self, req: &HttpRequest, token: &Secret) -> Result<HttpResponse, NetError>;
}

/// The headers every request carries. Kept in one function so the version and auth scheme are tested centrally.
pub fn request_headers(token: &Secret) -> Vec<(&'static str, String)> {
    vec![
        ("Authorization", format!("Bearer {}", token.expose())),
        ("Notion-Version", API_VERSION.to_string()),
        ("Accept", "application/json".to_string()),
        ("Content-Type", "application/json".to_string()),
    ]
}

/// Resolves the base URL. Release/dev/acceptance builds can only ever reach https://api.notion.com. The `notion-mock`
/// feature (compiled into the E2E binary only) permits one loopback http address, taken from an environment variable.
#[cfg(not(feature = "notion-mock"))]
pub fn base_url() -> Result<String, String> {
    Ok(API_BASE.to_string())
}
#[cfg(feature = "notion-mock")]
pub fn base_url() -> Result<String, String> {
    let url = std::env::var("CIVILDESK_NOTION_MOCK_URL")
        .map_err(|_| "notion-mock build requires CIVILDESK_NOTION_MOCK_URL".to_string())?;
    if url.starts_with("http://127.0.0.1:") && !url.contains('@') && url.matches('/').count() == 2 {
        Ok(url)
    } else {
        Err("notion-mock only permits http://127.0.0.1:<port>".into())
    }
}

pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
    base: String,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, String> {
        let base = base_url()?;
        let client = reqwest::blocking::Client::builder()
            .https_only(base.starts_with("https://"))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .user_agent("CivilDesk-Notion-ReadOnly/5A")
            .build()
            .map_err(|_| "The secure network client could not start.".to_string())?;
        Ok(Self { client, base })
    }
}

fn classify(e: &reqwest::Error) -> NetError {
    if e.is_timeout() {
        return NetError::Timeout;
    }
    let mut text = e.to_string().to_lowercase();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        text.push(' ');
        text.push_str(&s.to_string().to_lowercase());
        source = s.source();
    }
    if ["certificate", "tls", "schannel", "ssl", "handshake"]
        .iter()
        .any(|k| text.contains(k))
    {
        NetError::Tls
    } else if e.is_connect() || e.is_request() {
        NetError::Offline
    } else {
        NetError::Other
    }
}

impl Transport for ReqwestTransport {
    fn send(&self, req: &HttpRequest, token: &Secret) -> Result<HttpResponse, NetError> {
        if !is_allowed(req) {
            return Err(NetError::Other);
        }
        let url = format!("{}{}", self.base, req.path);
        let mut builder = match req.method {
            Method::Get => self.client.get(&url),
            Method::Post => self.client.post(&url),
        };
        for (k, v) in request_headers(token) {
            builder = builder.header(k, v);
        }
        if let Some(body) = &req.body {
            builder = builder.body(body.clone());
        }
        let response = builder.send().map_err(|e| classify(&e))?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let bytes = response.bytes().map_err(|e| classify(&e))?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(NetError::Other);
        }
        Ok(HttpResponse {
            status,
            retry_after,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }
}

// ---------------------------------------------------------------- client

/// Cancels in-flight and future requests started before `cancel()` was called.
#[derive(Clone, Default)]
pub struct CancelSource(Arc<AtomicU64>);
impl CancelSource {
    pub fn cancel(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    pub fn token(&self) -> CancelToken {
        CancelToken {
            source: self.0.clone(),
            started: self.0.load(Ordering::SeqCst),
        }
    }
}
pub struct CancelToken {
    source: Arc<AtomicU64>,
    started: u64,
}
impl CancelToken {
    pub fn is_cancelled(&self) -> bool {
        self.source.load(Ordering::SeqCst) != self.started
    }
}

pub struct ClientConfig {
    pub min_interval: Duration,
    pub max_retries: u32,
    /// A Retry-After longer than this is reported to the user instead of silently waited out.
    pub max_inline_wait: Duration,
    pub tick: Duration,
    pub sleeper: Arc<dyn Fn(Duration) + Send + Sync>,
}
impl ClientConfig {
    pub fn production() -> Self {
        Self {
            min_interval: Duration::from_millis(350),
            max_retries: 2,
            max_inline_wait: Duration::from_secs(20),
            tick: Duration::from_millis(50),
            sleeper: Arc::new(std::thread::sleep),
        }
    }
}

pub struct Client {
    transport: Arc<dyn Transport>,
    cfg: ClientConfig,
    /// Serialises requests: at most one in flight, spaced by `min_interval`.
    gate: Mutex<Option<Instant>>,
}

impl Client {
    pub fn new(transport: Arc<dyn Transport>, cfg: ClientConfig) -> Self {
        Self {
            transport,
            cfg,
            gate: Mutex::new(None),
        }
    }

    fn pause(&self, total: Duration, cancel: &CancelToken) -> Result<(), NotionError> {
        let mut left = total;
        while !left.is_zero() {
            if cancel.is_cancelled() {
                return Err(NotionError::cancelled());
            }
            let step = left.min(self.cfg.tick);
            (self.cfg.sleeper)(step);
            left -= step;
        }
        Ok(())
    }

    /// Performs one allowlisted read and returns the parsed JSON. Errors are sanitized and token-free.
    pub fn call(
        &self,
        op: &ReadOp,
        token: &Secret,
        cancel: &CancelToken,
    ) -> Result<Value, NotionError> {
        let req = op.to_request()?;
        if !is_allowed(&req) {
            return Err(NotionError::invalid(
                "That Notion operation isn't permitted.",
            ));
        }
        let mut gate = self
            .gate
            .lock()
            .map_err(|_| NotionError::storage("The Notion client is unavailable."))?;
        if let Some(last) = *gate {
            let wait = self.cfg.min_interval.saturating_sub(last.elapsed());
            self.pause(wait, cancel)?;
        }
        let result = self.attempt(&req, token, cancel);
        *gate = Some(Instant::now());
        result
    }

    fn attempt(
        &self,
        req: &HttpRequest,
        token: &Secret,
        cancel: &CancelToken,
    ) -> Result<Value, NotionError> {
        let mut attempt: u32 = 0;
        loop {
            if cancel.is_cancelled() {
                return Err(NotionError::cancelled());
            }
            match self.transport.send(req, token) {
                Ok(resp) => match resp.status {
                    200..=299 => {
                        return serde_json::from_str::<Value>(&resp.body).map_err(|_| NotionError::invalid_response());
                    }
                    429 | 529 => {
                        let blocked = error_code(&resp.body).as_deref() == Some("public_api_request_blocked");
                        let wait = resp.retry_after.unwrap_or(1u64 << attempt.min(4)).max(1);
                        if blocked || attempt >= self.cfg.max_retries || Duration::from_secs(wait) > self.cfg.max_inline_wait {
                            return Err(status_error(resp.status, Some(wait)));
                        }
                        self.pause(Duration::from_secs(wait), cancel)?;
                        attempt += 1;
                    }
                    500 | 502 | 503 | 504 => {
                        if attempt >= self.cfg.max_retries {
                            return Err(status_error(resp.status, None));
                        }
                        self.pause(Duration::from_secs(1u64 << attempt), cancel)?;
                        attempt += 1;
                    }
                    other => return Err(status_error(other, None)),
                },
                Err(NetError::Timeout) => {
                    if attempt >= 1.min(self.cfg.max_retries) {
                        return Err(NotionError::new(ErrorKind::Timeout, "Notion took too long to respond. Your CivilDesk data is unaffected."));
                    }
                    attempt += 1;
                }
                Err(NetError::Offline) => return Err(NotionError::unreachable_offline()),
                Err(NetError::Tls) => return Err(NotionError::new(ErrorKind::Tls, "A secure connection to Notion couldn't be established. Your CivilDesk data is unaffected.")),
                Err(NetError::Other) => return Err(NotionError::new(ErrorKind::Unavailable, "Notion couldn't be reached. Your CivilDesk data is unaffected.")),
            }
        }
    }
}

/// Notion's machine-readable error code, kept only if it looks like a code (never free text from the body).
fn error_code(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let code = v.get("code")?.as_str()?;
    (code.len() <= 48 && code.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
        .then(|| code.to_string())
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::VecDeque;

    pub type Scripted = Result<HttpResponse, NetError>;
    pub fn ok(body: Value) -> Scripted {
        Ok(HttpResponse {
            status: 200,
            retry_after: None,
            body: body.to_string(),
        })
    }
    pub fn status(code: u16) -> Scripted {
        Ok(HttpResponse { status: code, retry_after: None, body: json!({"object":"error","status":code,"code":"x","message":"secret_leaky_body_text"}).to_string() })
    }

    /// Replays scripted responses and records every request it is given.
    #[derive(Default)]
    pub struct MockTransport {
        pub queue: Mutex<VecDeque<Scripted>>,
        pub seen: Mutex<Vec<(Method, String, Option<String>)>>,
        pub tokens: Mutex<Vec<String>>,
    }
    impl MockTransport {
        pub fn scripted(items: Vec<Scripted>) -> Arc<Self> {
            Arc::new(Self {
                queue: Mutex::new(items.into()),
                ..Default::default()
            })
        }
        pub fn paths(&self) -> Vec<String> {
            self.seen
                .lock()
                .unwrap()
                .iter()
                .map(|(_, p, _)| p.clone())
                .collect()
        }
    }
    impl Transport for MockTransport {
        fn send(&self, req: &HttpRequest, token: &Secret) -> Result<HttpResponse, NetError> {
            self.seen
                .lock()
                .unwrap()
                .push((req.method, req.path.clone(), req.body.clone()));
            self.tokens.lock().unwrap().push(token.expose().to_string());
            self.queue
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(NetError::Other))
        }
    }

    pub fn test_client(t: Arc<MockTransport>) -> (Client, Arc<Mutex<Vec<Duration>>>) {
        let slept = Arc::new(Mutex::new(Vec::new()));
        let s = slept.clone();
        let cfg = ClientConfig {
            min_interval: Duration::ZERO,
            max_retries: 2,
            max_inline_wait: Duration::from_secs(20),
            tick: Duration::from_secs(1),
            sleeper: Arc::new(move |d| s.lock().unwrap().push(d)),
        };
        (Client::new(t, cfg), slept)
    }
    const ID: &str = "0123456789abcdef0123456789abcdef";
    fn secret() -> Secret {
        Secret::new("ntn_unit_test_token_value")
    }
    fn go(
        items: Vec<Scripted>,
        op: ReadOp,
    ) -> (
        Result<Value, NotionError>,
        Arc<MockTransport>,
        Vec<Duration>,
    ) {
        let t = MockTransport::scripted(items);
        let (c, slept) = test_client(t.clone());
        let src = CancelSource::default();
        let r = c.call(&op, &secret(), &src.token());
        let s = slept.lock().unwrap().clone();
        (r, t, s)
    }

    #[test]
    fn api_version_is_centrally_configured() {
        assert_eq!(API_VERSION, "2026-03-11");
        let headers = request_headers(&secret());
        assert!(headers
            .iter()
            .any(|(k, v)| *k == "Notion-Version" && v == "2026-03-11"));
        assert!(headers
            .iter()
            .any(|(k, v)| *k == "Authorization" && v.starts_with("Bearer ")));
    }

    #[test]
    fn only_the_fixed_https_host_is_used() {
        assert_eq!(API_BASE, "https://api.notion.com");
        #[cfg(not(feature = "notion-mock"))]
        assert_eq!(base_url().unwrap(), "https://api.notion.com");
    }

    #[test]
    fn every_read_op_builds_an_allowed_request() {
        let ops = vec![
            ReadOp::Me,
            ReadOp::Search {
                query: Some("plan".into()),
                kind: Some(SearchKind::DataSource),
                cursor: Some("abc-123".into()),
            },
            ReadOp::Search {
                query: None,
                kind: None,
                cursor: None,
            },
            ReadOp::GetDatabase(ID.into()),
            ReadOp::GetDataSource(ID.into()),
            ReadOp::QueryDataSource {
                id: ID.into(),
                cursor: None,
            },
            ReadOp::GetPage(ID.into()),
            ReadOp::BlockChildren {
                id: ID.into(),
                cursor: Some("c1".into()),
            },
        ];
        for op in ops {
            let req = op.to_request().unwrap();
            assert!(is_allowed(&req), "{req:?}");
        }
    }

    #[test]
    fn mutations_and_unknown_endpoints_are_not_allowed() {
        let id = "01234567-89ab-cdef-0123-456789abcdef";
        let bad = [
            (Method::Post, "/v1/pages".to_string()),
            (Method::Post, format!("/v1/pages/{id}")),
            (Method::Post, format!("/v1/blocks/{id}/children")),
            (Method::Get, "/v1/users".to_string()),
            (Method::Get, "/v1/comments".to_string()),
            (Method::Post, "/v1/databases".to_string()),
            (Method::Post, format!("/v1/databases/{id}")),
            (Method::Get, format!("/v1/pages/{id}/properties/title")),
            (Method::Get, "/v1/pages/../users/me".to_string()),
            (Method::Get, format!("/v1/pages/{id}?x=1")),
            (Method::Post, "/v1/search?filter_properties=x".to_string()),
            (Method::Get, "/v2/users/me".to_string()),
            (Method::Get, format!("/v1/blocks/{id}/children?evil=1")),
            (Method::Get, "https://evil.example/v1/users/me".to_string()),
        ];
        for (method, path) in bad {
            assert!(
                !is_allowed(&HttpRequest {
                    method,
                    path: path.clone(),
                    body: None
                }),
                "{path}"
            );
        }
        // the public API has no way to express a write: ids are the only caller input and must be UUIDs
        assert!(ReadOp::GetPage("../../v1/users/me".into())
            .to_request()
            .is_err());
        assert!(ReadOp::GetPage(format!("{ID}/archive"))
            .to_request()
            .is_err());
        assert!(ReadOp::BlockChildren {
            id: ID.into(),
            cursor: Some("a&b=1".into())
        }
        .to_request()
        .is_err());
    }

    #[test]
    fn ids_normalize_to_dashed_lowercase() {
        assert_eq!(
            normalize_id("0123456789ABCDEF0123456789abcdef").unwrap(),
            "01234567-89ab-cdef-0123-456789abcdef"
        );
        assert!(normalize_id("nope").is_err());
        assert!(normalize_id("").is_err());
    }

    #[test]
    fn search_uses_data_source_filter_not_database() {
        let req = ReadOp::Search {
            query: Some("x".into()),
            kind: Some(SearchKind::DataSource),
            cursor: None,
        }
        .to_request()
        .unwrap();
        let body = req.body.unwrap();
        assert!(body.contains("\"data_source\"") && !body.contains("\"database\""));
        assert_eq!(req.method, Method::Post);
    }

    #[test]
    fn query_uses_data_source_endpoint_and_page_size() {
        let req = ReadOp::QueryDataSource {
            id: ID.into(),
            cursor: Some("cur".into()),
        }
        .to_request()
        .unwrap();
        assert!(req.path.starts_with("/v1/data_sources/") && req.path.ends_with("/query"));
        assert!(!req.path.contains("/databases/"));
        let body: Value = serde_json::from_str(&req.body.unwrap()).unwrap();
        assert_eq!(body["page_size"], PREVIEW_PAGE_SIZE);
        assert_eq!(body["start_cursor"], "cur");
    }

    #[test]
    fn success_returns_json() {
        let (r, t, _) = go(vec![ok(json!({"object":"user"}))], ReadOp::Me);
        assert_eq!(r.unwrap()["object"], "user");
        assert_eq!(t.paths(), vec!["/v1/users/me"]);
    }

    #[test]
    fn unauthorized_is_not_retried_and_hides_the_body() {
        let (r, t, slept) = go(vec![status(401), status(401)], ReadOp::Me);
        let e = r.unwrap_err();
        assert_eq!(e.kind, ErrorKind::AuthFailed);
        assert_eq!(t.paths().len(), 1);
        assert!(slept.is_empty());
        assert!(!format!("{e:?}").contains("leaky"));
    }

    #[test]
    fn revoked_restricted_and_missing_map_to_distinct_kinds() {
        for (code, kind) in [
            (403, ErrorKind::Restricted),
            (404, ErrorKind::NotFound),
            (400, ErrorKind::InvalidRequest),
            (409, ErrorKind::InvalidRequest),
        ] {
            let (r, t, _) = go(vec![status(code)], ReadOp::GetPage(ID.into()));
            assert_eq!(r.unwrap_err().kind, kind, "{code}");
            assert_eq!(t.paths().len(), 1);
        }
    }

    #[test]
    fn rate_limit_honours_retry_after_then_succeeds() {
        let limited = Ok(HttpResponse {
            status: 429,
            retry_after: Some(3),
            body: "{}".into(),
        });
        let (r, t, slept) = go(vec![limited, ok(json!({"object":"user"}))], ReadOp::Me);
        assert!(r.is_ok());
        assert_eq!(t.paths().len(), 2);
        assert_eq!(slept.iter().sum::<Duration>(), Duration::from_secs(3));
    }

    #[test]
    fn rate_limit_is_bounded_and_reports_retry_after() {
        let mk = || {
            Ok(HttpResponse {
                status: 429,
                retry_after: Some(1),
                body: "{}".into(),
            })
        };
        let (r, t, _) = go(vec![mk(), mk(), mk(), mk()], ReadOp::Me);
        let e = r.unwrap_err();
        assert_eq!(e.kind, ErrorKind::RateLimited);
        assert_eq!(e.retry_after_seconds, Some(1));
        assert_eq!(
            t.paths().len(),
            3,
            "initial attempt plus two bounded retries"
        );
    }

    #[test]
    fn long_retry_after_is_reported_not_slept() {
        let limited = Ok(HttpResponse {
            status: 429,
            retry_after: Some(60),
            body: "{}".into(),
        });
        let (r, t, slept) = go(vec![limited], ReadOp::Me);
        let e = r.unwrap_err();
        assert_eq!(e.retry_after_seconds, Some(60));
        assert!(slept.is_empty());
        assert_eq!(t.paths().len(), 1);
    }

    #[test]
    fn blocked_requests_are_not_retried() {
        let blocked = Ok(HttpResponse {
            status: 429,
            retry_after: Some(1),
            body: json!({"code":"public_api_request_blocked"}).to_string(),
        });
        let (r, t, _) = go(vec![blocked, ok(json!({}))], ReadOp::Me);
        assert!(r.is_err());
        assert_eq!(t.paths().len(), 1);
    }

    #[test]
    fn server_errors_retry_with_backoff_then_give_up() {
        for code in [500, 503, 504] {
            let (r, t, slept) = go(vec![status(code), status(code), status(code)], ReadOp::Me);
            assert_eq!(r.unwrap_err().kind, ErrorKind::Unavailable, "{code}");
            assert_eq!(t.paths().len(), 3);
            assert_eq!(slept.iter().sum::<Duration>(), Duration::from_secs(3));
        }
        let (r, _, _) = go(vec![status(503), ok(json!({"ok":true}))], ReadOp::Me);
        assert!(r.is_ok());
        let (r, _, _) = go(vec![status(529), status(529), status(529)], ReadOp::Me);
        assert_eq!(r.unwrap_err().kind, ErrorKind::RateLimited);
    }

    #[test]
    fn network_failures_are_classified() {
        let (r, t, _) = go(vec![Err(NetError::Offline), ok(json!({}))], ReadOp::Me);
        let e = r.unwrap_err();
        assert_eq!(e.kind, ErrorKind::Offline);
        assert!(e.message.contains("Your CivilDesk data is unaffected"));
        assert_eq!(t.paths().len(), 1, "no retry storm while offline");
        let (r, _, _) = go(vec![Err(NetError::Tls)], ReadOp::Me);
        assert_eq!(r.unwrap_err().kind, ErrorKind::Tls);
    }

    #[test]
    fn timeout_retries_once() {
        let (r, t, _) = go(
            vec![
                Err(NetError::Timeout),
                Err(NetError::Timeout),
                ok(json!({})),
            ],
            ReadOp::Me,
        );
        assert_eq!(r.unwrap_err().kind, ErrorKind::Timeout);
        assert_eq!(t.paths().len(), 2);
        let (r, _, _) = go(vec![Err(NetError::Timeout), ok(json!({}))], ReadOp::Me);
        assert!(r.is_ok());
    }

    #[test]
    fn invalid_json_is_an_invalid_response() {
        let (r, _, _) = go(
            vec![Ok(HttpResponse {
                status: 200,
                retry_after: None,
                body: "<html>nope".into(),
            })],
            ReadOp::Me,
        );
        assert_eq!(r.unwrap_err().kind, ErrorKind::InvalidResponse);
    }

    #[test]
    fn cancellation_stops_before_sending() {
        let t = MockTransport::scripted(vec![ok(json!({}))]);
        let (c, _) = test_client(t.clone());
        let src = CancelSource::default();
        let token = src.token();
        src.cancel();
        assert_eq!(
            c.call(&ReadOp::Me, &secret(), &token).unwrap_err().kind,
            ErrorKind::Cancelled
        );
        assert!(t.paths().is_empty());
    }

    #[test]
    fn cancellation_interrupts_a_retry_wait() {
        let src = CancelSource::default();
        let t = MockTransport::scripted(vec![
            Ok(HttpResponse {
                status: 429,
                retry_after: Some(5),
                body: "{}".into(),
            }),
            ok(json!({})),
        ]);
        let s2 = src.clone();
        let cfg = ClientConfig {
            min_interval: Duration::ZERO,
            max_retries: 2,
            max_inline_wait: Duration::from_secs(20),
            tick: Duration::from_secs(1),
            sleeper: Arc::new(move |_| s2.cancel()),
        };
        let c = Client::new(t.clone(), cfg);
        assert_eq!(
            c.call(&ReadOp::Me, &secret(), &src.token())
                .unwrap_err()
                .kind,
            ErrorKind::Cancelled
        );
        assert_eq!(t.paths().len(), 1);
    }

    #[test]
    fn errors_never_contain_the_token() {
        for s in [
            status(401),
            status(403),
            status(500),
            Err(NetError::Offline),
        ] {
            let (r, _, _) = go(vec![s], ReadOp::Me);
            let text = format!("{:?}", r.unwrap_err());
            assert!(!text.contains("ntn_unit_test_token_value"));
        }
    }
}
