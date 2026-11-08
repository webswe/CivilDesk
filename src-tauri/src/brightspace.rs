//! Restricted, offline D2L-CLI v1 contract adapter. No academic reads or login.
use crate::persistence::Database;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const KEY: &str = "brightspace_connection_v1";
const CONTRACT: u8 = 1;
const STDOUT_LIMIT: usize = 32 * 1024;
const STDERR_LIMIT: usize = 8 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5);
const REQUIRED: [&str; 9] = [
    "credential_profiles_v2",
    "origin_binding_v2",
    "auth_status_json_v1",
    "read_courses",
    "read_assignments",
    "read_grades",
    "read_announcements",
    "read_overview",
    "get_only_requests",
];
const SYNTHETIC_ORIGIN: &str = "https://synthetic.example.test";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredConfig {
    portal_origin: String,
    executable_path: String,
    executable_sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub portal_origin: String,
    pub executable_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub state: String,
    pub profile_id: String,
    pub portal_origin: Option<String>,
    pub executable_path: Option<String>,
    pub cli_available: bool,
    pub cli_compatible: bool,
    pub live_verified: bool,
    pub message: String,
}

impl Inspection {
    fn new(
        state: &str,
        profile: &str,
        config: Option<&StoredConfig>,
        available: bool,
        compatible: bool,
        message: &str,
    ) -> Self {
        Self {
            state: state.into(),
            profile_id: profile.into(),
            portal_origin: config.map(|c| c.portal_origin.clone()),
            executable_path: config.map(|c| c.executable_path.clone()),
            cli_available: available,
            cli_compatible: compatible,
            live_verified: false,
            message: message.into(),
        }
    }
}

pub struct Adapter {
    identity: String,
    profile: &'static str,
    cancelled: AtomicBool,
    in_flight: Mutex<()>,
}

impl Adapter {
    pub fn new(identity: &str) -> Result<Self, String> {
        let profile = match identity {
            "com.webswe.civildesk" => "civildesk-prod",
            "com.webswe.civildesk.dev" => "civildesk-dev",
            "com.webswe.civildesk.acceptance" => "civildesk-acceptance",
            "com.webswe.civildesk.e2e" if cfg!(feature = "notion-mock") => {
                "civildesk-e2e-synthetic"
            }
            _ => return Err("Brightspace is unavailable for this application identity.".into()),
        };
        if cfg!(feature = "notion-mock") && identity != "com.webswe.civildesk.e2e" {
            return Err("The synthetic build requires the isolated E2E identity.".into());
        }
        Ok(Self {
            identity: identity.into(),
            profile,
            cancelled: AtomicBool::new(false),
            in_flight: Mutex::new(()),
        })
    }

    fn load(&self, db: &Database) -> Result<Option<StoredConfig>, String> {
        let conn =
            db.0.lock()
                .map_err(|_| "Brightspace settings are unavailable.")?;
        let raw: Option<String> = conn
            .query_row("SELECT value FROM app_state WHERE key=?1", [KEY], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "Brightspace settings are unavailable.")?;
        raw.map(|v| {
            serde_json::from_str(&v).map_err(|_| "Brightspace settings are invalid.".into())
        })
        .transpose()
    }

    pub fn configuration(&self, db: &Database) -> Result<Option<ConfigView>, String> {
        Ok(self.load(db)?.map(|c| ConfigView {
            portal_origin: c.portal_origin,
            executable_path: c.executable_path,
        }))
    }

    pub fn save(
        &self,
        db: &Database,
        portal: &str,
        executable: &str,
    ) -> Result<ConfigView, String> {
        self.cancel();
        let origin = canonical_origin(portal)?;
        let path = Path::new(executable);
        if !path.is_absolute()
            || path
                .extension()
                .and_then(|v| v.to_str())
                .map(|s| !s.eq_ignore_ascii_case("exe"))
                .unwrap_or(true)
        {
            return Err("Choose an absolute path to a trusted D2L-CLI executable.".into());
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| "The selected D2L-CLI executable is unavailable.")?;
        if !canonical.is_file() {
            return Err("The selected D2L-CLI executable is unavailable.".into());
        }
        if self.profile != "civildesk-e2e-synthetic" && !is_cli_executable(&canonical) {
            return Err("Choose the installed d2l.exe executable.".into());
        }
        self.check_synthetic_boundary(&origin, &canonical)?;
        let hash = file_sha256(&canonical)?;
        let value = StoredConfig {
            portal_origin: origin,
            executable_path: canonical.to_string_lossy().into_owned(),
            executable_sha256: hash,
        };
        let serialized = serde_json::to_string(&value)
            .map_err(|_| "Brightspace settings could not be saved.")?;
        let conn =
            db.0.lock()
                .map_err(|_| "Brightspace settings are unavailable.")?;
        conn.execute("INSERT INTO app_state(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![KEY, serialized])
            .map_err(|_| "Brightspace settings could not be saved.")?;
        Ok(ConfigView {
            portal_origin: value.portal_origin,
            executable_path: value.executable_path,
        })
    }

    fn check_synthetic_boundary(&self, origin: &str, path: &Path) -> Result<(), String> {
        if self.profile != "civildesk-e2e-synthetic" {
            return Ok(());
        }
        if origin != SYNTHETIC_ORIGIN {
            return Err("The E2E build accepts only its synthetic Brightspace origin.".into());
        }
        let expected = std::env::current_exe()
            .map_err(|_| "The synthetic executable cannot be located.")?
            .with_file_name("brightspace-synthetic.exe")
            .canonicalize()
            .map_err(|_| "The synthetic executable cannot be located.")?;
        if path != expected {
            return Err("The E2E build accepts only its dedicated synthetic executable.".into());
        }
        Ok(())
    }

    pub fn inspect(&self, db: &Database) -> Inspection {
        let _guard = match self.in_flight.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                return Inspection::new(
                    "process_error",
                    self.profile,
                    None,
                    false,
                    false,
                    "A Brightspace status check is already running.",
                )
            }
        };
        self.cancelled.store(false, Ordering::SeqCst);
        let config = match self.load(db) {
            Ok(Some(c)) => c,
            Ok(None) => {
                return Inspection::new(
                    "not_configured",
                    self.profile,
                    None,
                    false,
                    false,
                    "Add a portal and trusted CLI executable.",
                )
            }
            Err(_) => {
                return Inspection::new(
                    "configuration_error",
                    self.profile,
                    None,
                    false,
                    false,
                    "Brightspace settings could not be read.",
                )
            }
        };
        let path = PathBuf::from(&config.executable_path);
        let canonical = match path.canonicalize() {
            Ok(p) if p.is_file() => p,
            _ => {
                return Inspection::new(
                    "cli_unavailable",
                    self.profile,
                    Some(&config),
                    false,
                    false,
                    "The configured D2L-CLI executable is unavailable.",
                )
            }
        };
        if canonical != path
            || (self.profile != "civildesk-e2e-synthetic" && !is_cli_executable(&canonical))
            || self
                .check_synthetic_boundary(&config.portal_origin, &canonical)
                .is_err()
        {
            return Inspection::new(
                "cli_untrusted",
                self.profile,
                Some(&config),
                false,
                false,
                "The configured executable no longer matches the trusted path.",
            );
        }
        match file_sha256(&canonical) {
            Ok(digest) if digest == config.executable_sha256 => {}
            _ => {
                return Inspection::new(
                    "cli_untrusted",
                    self.profile,
                    Some(&config),
                    false,
                    false,
                    "The configured executable changed. Review and save it again.",
                )
            }
        }
        let capabilities = match self.run(
            &canonical,
            &config.executable_sha256,
            &config.portal_origin,
            &["auth", "capabilities", "--json", "--contract-version", "1"],
        ) {
            Ok(output) => output,
            Err(kind) => {
                return Inspection::new(
                    kind,
                    self.profile,
                    Some(&config),
                    true,
                    false,
                    process_message(kind),
                )
            }
        };
        if capabilities.stdout.is_empty() && capabilities.exit_code != 2 {
            return Inspection::new(
                "process_error",
                self.profile,
                Some(&config),
                true,
                false,
                process_message("process_error"),
            );
        }
        if parse_capabilities(&capabilities).is_err() {
            return Inspection::new(
                "cli_incompatible",
                self.profile,
                Some(&config),
                true,
                false,
                "This D2L-CLI does not support the required authentication contract.",
            );
        }
        let status = match self.run(
            &canonical,
            &config.executable_sha256,
            &config.portal_origin,
            &["auth", "status", "--json", "--contract-version", "1"],
        ) {
            Ok(output) => output,
            Err(kind) => {
                return Inspection::new(
                    kind,
                    self.profile,
                    Some(&config),
                    true,
                    true,
                    process_message(kind),
                )
            }
        };
        if status.stdout.is_empty() {
            return Inspection::new(
                "process_error",
                self.profile,
                Some(&config),
                true,
                true,
                process_message("process_error"),
            );
        }
        match parse_status(&status, self.profile, &config.portal_origin) {
            Ok(state) => Inspection::new(
                state,
                self.profile,
                Some(&config),
                true,
                true,
                state_message(state),
            ),
            Err(_) => Inspection::new(
                "cli_incompatible",
                self.profile,
                Some(&config),
                true,
                false,
                "D2L-CLI returned an invalid authentication status.",
            ),
        }
    }

    fn run(
        &self,
        executable: &Path,
        digest: &str,
        origin: &str,
        args: &[&str],
    ) -> Result<Output, &'static str> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err("cancelled");
        }
        if file_sha256(executable).as_deref() != Ok(digest) {
            return Err("cli_untrusted");
        }
        let mut command = Command::new(executable);
        command
            .args(args)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for key in [
            "SystemRoot",
            "WINDIR",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "ProgramData",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .env("D2L_CLI_PROFILE", self.profile)
            .env("D2L_CLI_BASE_URL", origin);
        if self.identity == "com.webswe.civildesk.e2e" {
            let app_data = std::env::var_os("APPDATA").ok_or("process_error")?;
            let scenario = PathBuf::from(app_data)
                .join("com.webswe.civildesk.e2e")
                .join("brightspace-scenario.txt");
            command.env("CIVILDESK_BRIGHTSPACE_SCENARIO_FILE", scenario);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|_| "cli_unavailable")?;
        #[cfg(windows)]
        let job = match Job::attach(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("process_error");
            }
        };
        let stdout = child.stdout.take().ok_or("process_error")?;
        let stderr = child.stderr.take().ok_or("process_error")?;
        let overflow = Arc::new(AtomicBool::new(false));
        let out_reader = bounded_reader(stdout, STDOUT_LIMIT, overflow.clone());
        let err_reader = bounded_reader(stderr, STDERR_LIMIT, overflow.clone());
        let deadline = Instant::now() + TIMEOUT;
        let result = loop {
            if self.cancelled.load(Ordering::SeqCst) {
                break Err("cancelled");
            }
            if overflow.load(Ordering::Relaxed) {
                break Err("output_too_large");
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                Ok(None) => break Err("cli_timeout"),
                Err(_) => break Err("process_error"),
            }
        };
        if result.is_err() {
            let _ = child.kill();
        }
        #[cfg(windows)]
        drop(job); // KILL_ON_JOB_CLOSE cleans up descendants too.
        let _ = child.wait();
        let out = out_reader
            .join()
            .map_err(|_| "process_error")?
            .map_err(|_| "process_error")?;
        let err = err_reader
            .join()
            .map_err(|_| "process_error")?
            .map_err(|_| "process_error")?;
        if out.len() > STDOUT_LIMIT || err.len() > STDERR_LIMIT {
            return Err("output_too_large");
        }
        let status = result?;
        if status.code().is_none() {
            return Err("process_error");
        }
        Ok(Output {
            stdout: out,
            exit_code: status.code().unwrap_or(1),
        })
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

fn process_message(kind: &str) -> &'static str {
    match kind {
        "cli_timeout" => "D2L-CLI did not respond in time.",
        "output_too_large" => "D2L-CLI returned too much output.",
        "cli_unavailable" => "The configured D2L-CLI executable could not be started.",
        "cancelled" => "The Brightspace status check was cancelled.",
        _ => "D2L-CLI could not complete the status check.",
    }
}

fn state_message(state: &str) -> &'static str {
    match state {
        "authentication_required" => {
            "Sign in through D2L-CLI when real-account connection is approved."
        }
        "credential_present_unverified" => {
            "A credential is stored for this portal. Brightspace has not verified it."
        }
        "portal_mismatch" => "The saved credential is bound to another portal.",
        "credential_error" => "The saved credential or secure storage needs attention.",
        "not_configured" => "D2L-CLI reports incomplete configuration.",
        "verification_unavailable" => "Live authentication verification is unavailable.",
        _ => "D2L-CLI reported an unsupported authentication state.",
    }
}

fn bounded_reader<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    overflow: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        reader
            .by_ref()
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > limit {
            overflow.store(true, Ordering::Relaxed);
        }
        Ok(bytes)
    })
}

struct Output {
    stdout: Vec<u8>,
    exit_code: i32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Capabilities {
    contract_version: u8,
    capabilities: Vec<String>,
    error_code: Option<String>,
    message: String,
}

fn has_required(capabilities: &[String]) -> bool {
    capabilities.len() <= 32
        && REQUIRED.iter().all(|r| capabilities.iter().any(|c| c == r))
        && capabilities.iter().all(|c| c.len() <= 64)
}

fn parse_capabilities(output: &Output) -> Result<(), ()> {
    let value: Capabilities = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if output.exit_code != 0
        || value.contract_version != CONTRACT
        || value.error_code.is_some()
        || value.message.len() > 256
        || !has_required(&value.capabilities)
    {
        return Err(());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Status {
    contract_version: u8,
    capabilities: Vec<String>,
    configuration_valid: bool,
    profile_id: Option<String>,
    portal_origin: Option<String>,
    state: String,
    credential_present: Option<bool>,
    authenticated: bool,
    verification: String,
    checked_at: Option<String>,
    error_code: Option<String>,
    message: String,
}

fn parse_status(output: &Output, profile: &str, origin: &str) -> Result<&'static str, ()> {
    let v: Status = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if v.contract_version != CONTRACT
        || !has_required(&v.capabilities)
        || v.authenticated
        || v.checked_at.is_some()
        || v.message.len() > 256
    {
        return Err(());
    }
    if v.state == "not_configured"
        && output.exit_code == 1
        && !v.configuration_valid
        && v.credential_present.is_none()
        && v.verification == "none"
        && matches!(
            v.error_code.as_deref(),
            Some("missing_profile" | "invalid_profile" | "missing_portal" | "invalid_portal")
        )
    {
        return Ok("not_configured");
    }
    if v.profile_id.as_deref() != Some(profile)
        || v.portal_origin.as_deref() != Some(origin)
        || !v.configuration_valid
    {
        return Err(());
    }
    let state = match (
        v.state.as_str(),
        v.credential_present,
        v.verification.as_str(),
        v.error_code.as_deref(),
        output.exit_code,
    ) {
        ("authentication_required", Some(false), "local", Some("missing_credential"), 0) => {
            "authentication_required"
        }
        ("credential_present_unverified", Some(true), "local", None, 0) => {
            "credential_present_unverified"
        }
        ("portal_mismatch", None, "none", Some("portal_mismatch"), 1) => "portal_mismatch",
        (
            "credential_error",
            None,
            "none",
            Some(
                "credential_corrupt"
                | "unsupported_credential_version"
                | "credential_access_error"
                | "storage_unavailable"
                | "unexpected_failure",
            ),
            1,
        ) => "credential_error",
        _ => return Err(()),
    };
    Ok(state)
}

fn canonical_origin(input: &str) -> Result<String, String> {
    let rest = input
        .strip_prefix("https://")
        .ok_or("Use a plain HTTPS Brightspace portal origin.")?;
    let host_port = rest.strip_suffix('/').unwrap_or(rest);
    if host_port.is_empty()
        || !host_port.is_ascii()
        || host_port.chars().any(|c| "/?#@%\\ \t\n\r".contains(c))
    {
        return Err("Use a plain HTTPS Brightspace portal origin.".into());
    }
    let (host, port) = host_port
        .rsplit_once(':')
        .map_or((host_port, None), |(h, p)| (h, Some(p)));
    if port.is_some_and(|p| p != "443") || host.len() > 253 {
        return Err("Use a plain HTTPS Brightspace portal origin.".into());
    }
    let labels: Vec<_> = host.split('.').collect();
    if labels.len() < 2
        || labels
            .last()
            .is_some_and(|l| l.chars().all(|c| c.is_ascii_digit()))
        || labels.iter().all(|l| numeric_label(l))
        || labels.iter().any(|l| {
            l.is_empty()
                || l.len() > 63
                || l.starts_with('-')
                || l.ends_with('-')
                || l.to_ascii_lowercase().starts_with("xn--")
                || !l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    {
        return Err("Use a plain HTTPS Brightspace portal origin.".into());
    }
    Ok(format!("https://{}", host.to_ascii_lowercase()))
}

fn numeric_label(label: &str) -> bool {
    let lower = label.to_ascii_lowercase();
    if lower.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if let Some(hex) = lower.strip_prefix("0x") {
        return !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    false
}

fn is_cli_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("d2l.exe"))
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "The executable could not be read.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "The executable could not be read.")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Job {
    fn attach(child: &std::process::Child) -> Result<Self, ()> {
        use std::mem::size_of;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle == 0 {
            return Err(());
        }
        let job = Self(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let assigned = configured != 0
            && unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as _) } != 0;
        if !assigned {
            return Err(());
        }
        Ok(job)
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(feature = "notion-mock"))]
    use rusqlite::Connection;
    use serde_json::json;
    #[cfg(not(feature = "notion-mock"))]
    use std::sync::Mutex;

    fn caps() -> Vec<String> {
        REQUIRED.iter().map(|v| v.to_string()).collect()
    }
    fn response(
        state: &str,
        present: Option<bool>,
        verification: &str,
        error: Option<&str>,
        code: i32,
    ) -> Output {
        Output { stdout: serde_json::to_vec(&json!({
            "contract_version":1,"capabilities":caps(),"configuration_valid":true,
            "profile_id":"civildesk-dev","portal_origin":"https://learn.example.edu",
            "state":state,"credential_present":present,"authenticated":false,
            "verification":verification,"checked_at":null,"error_code":error,"message":"Synthetic."
        })).unwrap(), exit_code:code }
    }
    #[test]
    fn strict_portal_canonicalization() {
        assert_eq!(
            canonical_origin("https://LEARN.example.EDU:443/").unwrap(),
            "https://learn.example.edu"
        );
        for bad in [
            "http://learn.example.edu",
            "https://u:p@learn.example.edu",
            "https://learn.example.edu/path",
            "https://learn.example.edu?x=1",
            "https://learn.example.edu:8443",
            "https://127.0.0.1",
            "https://0x7f.0x1",
            "https://09.0x1",
            "https://learn.example.edu.",
            "https://xn--bad.example",
            " https://learn.example.edu",
        ] {
            assert!(canonical_origin(bad).is_err(), "accepted {bad}");
        }
    }
    #[test]
    fn identities_are_fixed_and_e2e_never_selects_real_profile() {
        #[cfg(not(feature = "notion-mock"))]
        {
            assert_eq!(
                Adapter::new("com.webswe.civildesk.dev")
                    .unwrap_or_else(|_| panic!())
                    .profile,
                "civildesk-dev"
            );
            assert_eq!(
                Adapter::new("com.webswe.civildesk.acceptance")
                    .unwrap_or_else(|_| panic!())
                    .profile,
                "civildesk-acceptance"
            );
            assert_eq!(
                Adapter::new("com.webswe.civildesk")
                    .unwrap_or_else(|_| panic!())
                    .profile,
                "civildesk-prod"
            );
        }
        assert!(Adapter::new("com.webswe.civildesk.unknown").is_err());
        #[cfg(not(feature = "notion-mock"))]
        assert!(Adapter::new("com.webswe.civildesk.e2e").is_err());
        #[cfg(feature = "notion-mock")]
        {
            assert!(Adapter::new("com.webswe.civildesk.dev").is_err());
            assert!(Adapter::new("com.webswe.civildesk").is_err());
            assert_eq!(
                Adapter::new("com.webswe.civildesk.e2e").unwrap().profile,
                "civildesk-e2e-synthetic"
            );
        }
    }
    #[test]
    fn capability_contract_rejects_extra_fields_and_versions() {
        let valid = Output { stdout: serde_json::to_vec(&json!({"contract_version":1,"capabilities":caps(),"error_code":null,"message":"Synthetic."})).unwrap(), exit_code:0 };
        assert!(parse_capabilities(&valid).is_ok());
        for malformed in [
            json!({"contract_version":2,"capabilities":caps(),"error_code":null,"message":"Synthetic."}),
            json!({"contract_version":1,"capabilities":[],"error_code":null,"message":"Synthetic."}),
            json!({"contract_version":1,"capabilities":caps(),"error_code":null,"message":"Synthetic.","extra":true}),
        ] {
            assert!(parse_capabilities(&Output {
                stdout: serde_json::to_vec(&malformed).unwrap(),
                exit_code: 0
            })
            .is_err());
        }
        assert!(parse_capabilities(&Output {
            stdout: b"{no-json".to_vec(),
            exit_code: 0
        })
        .is_err());
        assert!(parse_capabilities(&Output {
            stdout: valid.stdout,
            exit_code: 2
        })
        .is_err());
    }
    #[test]
    fn local_status_never_claims_live_authentication() {
        assert_eq!(
            parse_status(
                &response(
                    "authentication_required",
                    Some(false),
                    "local",
                    Some("missing_credential"),
                    0
                ),
                "civildesk-dev",
                "https://learn.example.edu"
            ),
            Ok("authentication_required")
        );
        assert_eq!(
            parse_status(
                &response(
                    "credential_present_unverified",
                    Some(true),
                    "local",
                    None,
                    0
                ),
                "civildesk-dev",
                "https://learn.example.edu"
            ),
            Ok("credential_present_unverified")
        );
        assert_eq!(
            parse_status(
                &response("portal_mismatch", None, "none", Some("portal_mismatch"), 1),
                "civildesk-dev",
                "https://learn.example.edu"
            ),
            Ok("portal_mismatch")
        );
        assert_eq!(
            parse_status(
                &response(
                    "credential_error",
                    None,
                    "none",
                    Some("credential_corrupt"),
                    1
                ),
                "civildesk-dev",
                "https://learn.example.edu"
            ),
            Ok("credential_error")
        );
        let mut bad: serde_json::Value = serde_json::from_slice(
            &response(
                "credential_present_unverified",
                Some(true),
                "local",
                None,
                0,
            )
            .stdout,
        )
        .unwrap();
        for (key, value) in [
            ("authenticated", json!(true)),
            ("profile_id", json!("civildesk-prod")),
            ("portal_origin", json!("https://other.example.edu")),
            ("checked_at", json!("2026-01-01T00:00:00Z")),
            ("extra", json!("secret")),
        ] {
            bad[key] = value;
            assert!(parse_status(
                &Output {
                    stdout: serde_json::to_vec(&bad).unwrap(),
                    exit_code: 0
                },
                "civildesk-dev",
                "https://learn.example.edu"
            )
            .is_err());
            bad = serde_json::from_slice(
                &response(
                    "credential_present_unverified",
                    Some(true),
                    "local",
                    None,
                    0,
                )
                .stdout,
            )
            .unwrap();
        }
    }
    #[cfg(not(feature = "notion-mock"))]
    #[test]
    fn settings_store_only_nonsecret_origin_path_and_fingerprint() {
        let db = Database(Mutex::new(Connection::open_in_memory().unwrap()));
        db.0.lock()
            .unwrap()
            .execute(
                "CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
                [],
            )
            .unwrap();
        let adapter = Adapter::new("com.webswe.civildesk.dev").unwrap();
        assert!(adapter.configuration(&db).unwrap().is_none());
        let dir = std::env::temp_dir().join(format!(
            "civildesk-brightspace-unit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let other = dir.join("other.exe");
        std::fs::write(&other, b"SYNTHETIC_NOT_EXECUTED").unwrap();
        assert!(adapter
            .save(&db, "https://learn.example.edu", other.to_str().unwrap())
            .is_err());
        std::fs::remove_file(other).unwrap();
        let exe = dir.join("d2l.exe");
        std::fs::write(&exe, b"SYNTHETIC_NOT_EXECUTED").unwrap();
        let saved = adapter
            .save(&db, "https://LEARN.example.EDU:443/", exe.to_str().unwrap())
            .unwrap();
        assert_eq!(saved.portal_origin, "https://learn.example.edu");
        assert_eq!(
            adapter.configuration(&db).unwrap().unwrap().portal_origin,
            saved.portal_origin
        );
        let raw: String =
            db.0.lock()
                .unwrap()
                .query_row("SELECT value FROM app_state WHERE key=?1", [KEY], |r| {
                    r.get(0)
                })
                .unwrap();
        assert!(raw.contains("executableSha256"));
        assert!(!raw.contains("cookie") && !raw.contains("token") && !raw.contains("password"));
        std::fs::remove_file(&exe).unwrap();
        assert_eq!(adapter.inspect(&db).state, "cli_unavailable");
        std::fs::write(&exe, b"CHANGED_SYNTHETIC_NOT_EXECUTED").unwrap();
        assert_eq!(adapter.inspect(&db).state, "cli_untrusted");
        std::fs::remove_file(exe).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
