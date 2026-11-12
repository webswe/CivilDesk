//! Restricted D2L-CLI adapter. Course reads are available only in the synthetic E2E build.
use crate::brightspace_package::{is_frozen_package, verify_for_launch};
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
use std::time::{SystemTime, UNIX_EPOCH};

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
    #[serde(default)]
    frozen_package: bool,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrightspaceCourse {
    pub id: String,
    pub code: String,
    pub name: String,
    pub semester_name: String,
    pub is_active: bool,
    pub can_access: bool,
    pub is_new_enrollment: bool,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseSnapshot {
    pub portal_origin: String,
    pub mode: &'static str,
    pub retrieved_at_ms: u64,
    pub complete: bool,
    pub warnings: Vec<String>,
    pub courses: Vec<BrightspaceCourse>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrightspaceAssignment {
    pub id: String,
    pub course_id: String,
    pub name: String,
    pub submission_status: Option<String>,
    pub score: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentCourseResult {
    pub course_id: String,
    pub completeness: Option<AssignmentCompleteness>,
    pub error: Option<&'static str>,
    pub assignments: Vec<BrightspaceAssignment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentSnapshot {
    pub portal_origin: String,
    pub mode: &'static str,
    pub retrieved_at_ms: u64,
    pub courses: Vec<BrightspaceCourse>,
    pub results: Vec<AssignmentCourseResult>,
    pub limited_course_count: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentCompleteness {
    pub status: String,
    pub observed_row_count: usize,
    pub page_size_ceiling: Option<usize>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GradeItem {
    pub course_id: String,
    pub label: String,
    pub displayed_points: Option<String>,
    pub displayed_grade: Option<String>,
    pub displayed_weight: Option<String>,
    pub feedback_availability: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Announcement {
    pub course_id: String,
    pub announcement_id: String,
    pub title: String,
    pub body: Option<String>,
    pub detail_reference: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPage<T: Serialize> {
    pub course_id: String,
    pub retrieved_at_ms: Option<u64>,
    pub completeness: Option<&'static str>,
    pub error: Option<&'static str>,
    pub items: Vec<T>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassSnapshot<T: Serialize> {
    pub portal_origin: String,
    pub mode: &'static str,
    pub retrieved_at_ms: u64,
    pub courses: Vec<BrightspaceCourse>,
    pub results: Vec<ClassPage<T>>,
    pub limited_course_count: bool,
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

    pub fn course_mode(&self) -> &'static str {
        if self.identity == "com.webswe.civildesk.dev"
            && cfg!(debug_assertions)
            && !cfg!(feature = "notion-mock")
        {
            "demo"
        } else if self.identity == "com.webswe.civildesk.e2e" && cfg!(feature = "notion-mock") {
            "synthetic_cli"
        } else {
            "unavailable"
        }
    }

    pub fn courses(&self, db: &Database) -> Result<CourseSnapshot, String> {
        // This build gate is independent of the executable path and the parent
        // environment. Regular builds cannot invoke a real academic read.
        if self.course_mode() == "demo" {
            return Ok(demo_courses());
        }
        if self.course_mode() != "synthetic_cli" {
            return Err("Brightspace course retrieval is unavailable in this build.".into());
        }
        let _guard = self
            .in_flight
            .try_lock()
            .map_err(|_| "A Brightspace check is already running.")?;
        self.cancelled.store(false, Ordering::SeqCst);
        let config = self
            .load(db)?
            .ok_or("Configure the synthetic Brightspace connection first.")?;
        let path = PathBuf::from(&config.executable_path);
        let canonical = path
            .canonicalize()
            .map_err(|_| "The synthetic executable is unavailable.")?;
        if canonical != path
            || !canonical.is_file()
            || self
                .check_synthetic_boundary(&config.portal_origin, &canonical)
                .is_err()
        {
            return Err("The synthetic executable is not trusted.".into());
        }
        if file_sha256(&canonical).as_deref() != Ok(config.executable_sha256.as_str()) {
            return Err("The synthetic executable changed. Review and save it again.".into());
        }
        let capability = self
            .run(
                &canonical,
                &config.executable_sha256,
                &config.portal_origin,
                config.frozen_package,
                &["auth", "capabilities", "--json", "--contract-version", "1"],
            )
            .map_err(course_process_message)?;
        parse_capabilities(&capability)
            .map_err(|_| "The synthetic CLI contract is incompatible.")?;
        let output = self
            .run(
                &canonical,
                &config.executable_sha256,
                &config.portal_origin,
                config.frozen_package,
                &["courses", "list", "--json"],
            )
            .map_err(course_process_message)?;
        let courses = parse_courses(&output)
            .map_err(|_| "The synthetic CLI returned an invalid course list.")?;
        Ok(CourseSnapshot {
            portal_origin: config.portal_origin,
            mode: "synthetic_cli",
            retrieved_at_ms: now_ms(),
            complete: true,
            warnings: vec![],
            courses,
        })
    }

    pub fn assignments(&self, db: &Database) -> Result<AssignmentSnapshot, String> {
        if self.course_mode() == "demo" {
            return Ok(demo_assignments());
        }
        if self.course_mode() != "synthetic_cli" {
            return Err("Brightspace assignment retrieval is unavailable in this build.".into());
        }
        // The caller supplies no course IDs. Every ID is obtained from the
        // already restricted course listing in this same user-triggered read.
        let catalog = self.courses(db)?;
        let limited_course_count = catalog.courses.len() > 12;
        let courses: Vec<_> = catalog.courses.into_iter().take(12).collect();
        let _guard = self
            .in_flight
            .try_lock()
            .map_err(|_| "A Brightspace check is already running.")?;
        self.cancelled.store(false, Ordering::SeqCst);
        let config = self
            .load(db)?
            .ok_or("Configure the synthetic Brightspace connection first.")?;
        if config.portal_origin != catalog.portal_origin {
            return Err("The synthetic portal changed during refresh.".into());
        }
        let canonical = PathBuf::from(&config.executable_path)
            .canonicalize()
            .map_err(|_| "The synthetic executable is unavailable.")?;
        if !canonical.is_file()
            || canonical.to_string_lossy() != config.executable_path
            || self
                .check_synthetic_boundary(&config.portal_origin, &canonical)
                .is_err()
            || file_sha256(&canonical).as_deref() != Ok(config.executable_sha256.as_str())
        {
            return Err("The synthetic executable is not trusted.".into());
        }
        let mut results = Vec::with_capacity(courses.len());
        for course in &courses {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err("Assignment refresh was cancelled.".into());
            }
            let args = [
                "assignments",
                "list",
                "--course",
                course.id.as_str(),
                "--json",
                "--include-completeness",
            ];
            let parsed = self
                .run(
                    &canonical,
                    &config.executable_sha256,
                    &config.portal_origin,
                    config.frozen_package,
                    &args,
                )
                .map_err(|kind| {
                    if kind == "cancelled" {
                        "Assignment refresh was cancelled."
                    } else {
                        "This course could not be read."
                    }
                })
                .and_then(|output| {
                    parse_assignments(&output, &course.id)
                        .map_err(|_| "This course returned invalid assignment data.")
                });
            match parsed {
                Ok(page) => results.push(AssignmentCourseResult {
                    course_id: course.id.clone(),
                    completeness: Some(page.completeness),
                    error: None,
                    assignments: page.assignments,
                }),
                Err(_) if self.cancelled.load(Ordering::SeqCst) => {
                    return Err("Assignment refresh was cancelled.".into())
                }
                Err(message) => results.push(AssignmentCourseResult {
                    course_id: course.id.clone(),
                    completeness: None,
                    error: Some(message),
                    assignments: vec![],
                }),
            }
        }
        Ok(AssignmentSnapshot {
            portal_origin: config.portal_origin,
            mode: "synthetic_cli",
            retrieved_at_ms: now_ms(),
            courses,
            results,
            limited_course_count,
        })
    }

    pub fn grades(&self, db: &Database) -> Result<ClassSnapshot<GradeItem>, String> {
        self.class_pages(db, "grades", parse_grades, demo_grades)
    }

    pub fn announcements(&self, db: &Database) -> Result<ClassSnapshot<Announcement>, String> {
        self.class_pages(db, "announcements", parse_announcements, demo_announcements)
    }

    fn class_pages<T: Serialize>(
        &self,
        db: &Database,
        command: &'static str,
        parse: fn(&Output, &str) -> Result<Vec<T>, ()>,
        demo: fn() -> ClassSnapshot<T>,
    ) -> Result<ClassSnapshot<T>, String> {
        if self.course_mode() == "demo" {
            return Ok(demo());
        }
        if self.course_mode() != "synthetic_cli" {
            return Err("Brightspace academic retrieval is unavailable in this build.".into());
        }
        // No frontend course ID reaches this method. The fixed list comes from
        // the same restricted synthetic course read used by Assignments.
        let catalog = self.courses(db)?;
        let limited_course_count = catalog.courses.len() > 12;
        let courses: Vec<_> = catalog.courses.into_iter().take(12).collect();
        let _guard = self
            .in_flight
            .try_lock()
            .map_err(|_| "A Brightspace check is already running.")?;
        self.cancelled.store(false, Ordering::SeqCst);
        let config = self
            .load(db)?
            .ok_or("Configure the synthetic Brightspace connection first.")?;
        if config.portal_origin != catalog.portal_origin {
            return Err("The synthetic portal changed during refresh.".into());
        }
        let canonical = PathBuf::from(&config.executable_path)
            .canonicalize()
            .map_err(|_| "The synthetic executable is unavailable.")?;
        if !canonical.is_file()
            || canonical.to_string_lossy() != config.executable_path
            || self
                .check_synthetic_boundary(&config.portal_origin, &canonical)
                .is_err()
            || file_sha256(&canonical).as_deref() != Ok(config.executable_sha256.as_str())
        {
            return Err("The synthetic executable is not trusted.".into());
        }
        let mut results = Vec::with_capacity(courses.len());
        for course in &courses {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err("Academic refresh was cancelled.".into());
            }
            let args = [
                command,
                "list",
                "--course",
                course.id.as_str(),
                "--json",
                "--include-completeness",
            ];
            let parsed = self
                .run(
                    &canonical,
                    &config.executable_sha256,
                    &config.portal_origin,
                    config.frozen_package,
                    &args,
                )
                .map_err(|kind| {
                    if kind == "cancelled" {
                        "Academic refresh was cancelled."
                    } else {
                        "This course could not be read."
                    }
                })
                .and_then(|output| {
                    if output.exit_code != 0 {
                        return Err("This course could not be read.");
                    }
                    parse(&output, &course.id)
                        .map_err(|_| "This course returned invalid academic data.")
                });
            match parsed {
                Ok(items) => results.push(ClassPage {
                    course_id: course.id.clone(),
                    retrieved_at_ms: Some(now_ms()),
                    completeness: Some("unknown"),
                    error: None,
                    items,
                }),
                Err(_) if self.cancelled.load(Ordering::SeqCst) => {
                    return Err("Academic refresh was cancelled.".into());
                }
                Err(message) => results.push(ClassPage {
                    course_id: course.id.clone(),
                    retrieved_at_ms: None,
                    completeness: None,
                    error: Some(message),
                    items: vec![],
                }),
            }
        }
        Ok(ClassSnapshot {
            portal_origin: config.portal_origin,
            mode: "synthetic_cli",
            retrieved_at_ms: now_ms(),
            courses,
            results,
            limited_course_count,
        })
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
        let frozen_package = is_frozen_package(&canonical);
        verify_for_launch(&canonical, frozen_package).map_err(str::to_owned)?;
        let hash = file_sha256(&canonical)?;
        let value = StoredConfig {
            portal_origin: origin,
            executable_path: canonical.to_string_lossy().into_owned(),
            executable_sha256: hash,
            frozen_package,
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
            config.frozen_package,
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
            config.frozen_package,
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
        configured_frozen: bool,
        args: &[&str],
    ) -> Result<Output, &'static str> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err("cancelled");
        }
        if file_sha256(executable).as_deref() != Ok(digest) {
            return Err("cli_untrusted");
        }
        verify_for_launch(executable, configured_frozen).map_err(|_| "cli_untrusted")?;
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn course_process_message(kind: &'static str) -> String {
    process_message(kind).to_string()
}

fn demo_courses() -> CourseSnapshot {
    CourseSnapshot { portal_origin: SYNTHETIC_ORIGIN.into(), mode: "demo", retrieved_at_ms: now_ms(), complete: true, warnings: vec![], courses: vec![
        BrightspaceCourse { id: "610101".into(), code: "CIV 201".into(), name: "Structures and the Built Environment".into(), semester_name: "Sample Fall Term".into(), is_active: true, can_access: true, is_new_enrollment: false, start_date: None, end_date: None },
        BrightspaceCourse { id: "610202".into(), code: "MATH 240".into(), name: "Applied Mathematics for Designers".into(), semester_name: "Sample Fall Term".into(), is_active: true, can_access: true, is_new_enrollment: false, start_date: None, end_date: None },
        BrightspaceCourse { id: "610303".into(), code: "ENGR 310".into(), name: "A Long Sample Course Title for Narrow Window Layout Review and Course Detail Navigation".into(), semester_name: "".into(), is_active: false, can_access: true, is_new_enrollment: true, start_date: None, end_date: None },
    ] }
}

fn demo_grades() -> ClassSnapshot<GradeItem> {
    let catalog = demo_courses();
    let results = catalog
        .courses
        .iter()
        .map(|course| ClassPage {
            course_id: course.id.clone(),
            retrieved_at_ms: Some(now_ms()),
            completeness: Some("unknown"),
            error: None,
            items: vec![GradeItem {
                course_id: course.id.clone(),
                label: "Fictional practice set".into(),
                displayed_points: Some("0".into()),
                displayed_grade: None,
                displayed_weight: None,
                feedback_availability: "unknown".into(),
            }],
        })
        .collect();
    ClassSnapshot {
        portal_origin: catalog.portal_origin,
        mode: "demo",
        retrieved_at_ms: now_ms(),
        courses: catalog.courses,
        results,
        limited_course_count: false,
    }
}

fn demo_announcements() -> ClassSnapshot<Announcement> {
    let catalog = demo_courses();
    let results = catalog
        .courses
        .iter()
        .map(|course| ClassPage {
            course_id: course.id.clone(),
            retrieved_at_ms: Some(now_ms()),
            completeness: Some("unknown"),
            error: None,
            items: vec![Announcement {
                course_id: course.id.clone(),
                announcement_id: "501".into(),
                title: "Fictional class update".into(),
                body: Some("Sample details for this fictional class.".into()),
                detail_reference: format!("/d2l/le/news/{}/501/view", course.id),
            }],
        })
        .collect();
    ClassSnapshot {
        portal_origin: catalog.portal_origin,
        mode: "demo",
        retrieved_at_ms: now_ms(),
        courses: catalog.courses,
        results,
        limited_course_count: false,
    }
}

fn demo_assignments() -> AssignmentSnapshot {
    let catalog = demo_courses();
    let make = |course: &BrightspaceCourse, id: &str, name: &str, due: Option<&str>| {
        BrightspaceAssignment {
            id: id.into(),
            course_id: course.id.clone(),
            name: name.into(),
            submission_status: None,
            score: None,
            due_date: due.map(str::to_owned),
        }
    };
    let results = catalog
        .courses
        .iter()
        .map(|course| {
            let assignments = if course.id == "610101" {
                vec![
                    make(course, "801", "Design brief", Some("2026-11-18T17:00:00")),
                    make(course, "802", "Studio reflection", None),
                ]
            } else if course.id == "610202" {
                vec![make(
                    course,
                    "801",
                    "Design brief",
                    Some("2026-11-18T23:59:00"),
                )]
            } else {
                vec![]
            };
            AssignmentCourseResult {
                course_id: course.id.clone(),
                completeness: Some(AssignmentCompleteness {
                    status: "below_page_size_boundary".into(),
                    observed_row_count: assignments.len(),
                    page_size_ceiling: Some(50),
                }),
                error: None,
                assignments,
            }
        })
        .collect();
    AssignmentSnapshot {
        portal_origin: catalog.portal_origin,
        mode: "demo",
        retrieved_at_ms: now_ms(),
        courses: catalog.courses,
        results,
        limited_course_count: false,
    }
}

fn process_message(kind: &str) -> &'static str {
    match kind {
        "cli_timeout" => "D2L-CLI did not respond in time.",
        "output_too_large" => "D2L-CLI returned too much output.",
        "cli_unavailable" => "The configured D2L-CLI executable could not be started.",
        "cli_untrusted" => {
            "The D2L-CLI package changed or lacks approval. Review its trusted manifest."
        }
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
struct CourseEnvelope {
    courses: Vec<BrightspaceCourse>,
}

fn parse_courses(output: &Output) -> Result<Vec<BrightspaceCourse>, ()> {
    if output.exit_code != 0 {
        return Err(());
    }
    let envelope: CourseEnvelope = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if envelope.courses.len() > 200 {
        return Err(());
    }
    let mut ids = std::collections::HashSet::new();
    for c in &envelope.courses {
        if c.id.is_empty()
            || c.id.len() > 32
            || !c.id.bytes().all(|b| b.is_ascii_digit())
            || !ids.insert(c.id.as_str())
            || c.code.len() > 160
            || c.name.len() > 400
            || c.semester_name.len() > 160
            || c.start_date.as_ref().is_some_and(|s| s.len() > 100)
            || c.end_date.as_ref().is_some_and(|s| s.len() > 100)
        {
            return Err(());
        }
    }
    Ok(envelope.courses)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AssignmentEnvelope {
    assignments: Vec<BrightspaceAssignment>,
    completeness: AssignmentCompleteness,
}

fn valid_assignment_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit())
}

fn valid_naive_due(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !value.is_ascii()
        || bytes.len() < 19
        || bytes.len() > 26
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return false;
    }
    let date = &value[..10];
    if !valid_calendar_date(date)
        || ![11..13, 14..16, 17..19]
            .iter()
            .all(|range| value[range.clone()].bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    let h: u8 = value[11..13].parse().unwrap_or(255);
    let m: u8 = value[14..16].parse().unwrap_or(255);
    let s: u8 = value[17..19].parse().unwrap_or(255);
    h < 24
        && m < 60
        && s < 60
        && (bytes.len() == 19 || (bytes[19] == b'.' && bytes[20..].iter().all(u8::is_ascii_digit)))
}

fn valid_calendar_date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || ![&b[0..4], &b[5..7], &b[8..10]]
            .iter()
            .all(|part| part.iter().all(u8::is_ascii_digit))
    {
        return false;
    }
    let y: u16 = value[0..4].parse().unwrap_or(0);
    let m: usize = value[5..7].parse().unwrap_or(0);
    let d: u8 = value[8..10].parse().unwrap_or(0);
    if y == 0 || !(1..=12).contains(&m) {
        return false;
    }
    let leap = y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
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
    d >= 1 && d <= days[m - 1]
}

fn parse_assignments(output: &Output, course_id: &str) -> Result<AssignmentEnvelope, ()> {
    if output.exit_code != 0 || !valid_assignment_id(course_id) {
        return Err(());
    }
    let page: AssignmentEnvelope = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if page.assignments.len() > 200
        || page.completeness.observed_row_count > 1000
        || ![
            "below_page_size_boundary",
            "potentially_truncated",
            "unknown",
        ]
        .contains(&page.completeness.status.as_str())
        || page
            .completeness
            .page_size_ceiling
            .is_some_and(|n| n == 0 || n > 1000)
        || page.completeness.observed_row_count < page.assignments.len()
    {
        return Err(());
    }
    let mut ids = std::collections::HashSet::new();
    for a in &page.assignments {
        if !valid_assignment_id(&a.id)
            || a.course_id != course_id
            || !ids.insert(a.id.as_str())
            || a.name.trim().is_empty()
            || a.name.len() > 400
            || a.submission_status.as_ref().is_some_and(|s| s.len() > 300)
            || a.score.as_ref().is_some_and(|s| s.len() > 300)
            || a.due_date.as_ref().is_some_and(|s| !valid_naive_due(s))
        {
            return Err(());
        }
    }
    Ok(page)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GradeEnvelope {
    grade_items: Vec<GradeItem>,
    completeness: String,
}

fn parse_grades(output: &Output, course_id: &str) -> Result<Vec<GradeItem>, ()> {
    if output.exit_code != 0 || !valid_assignment_id(course_id) {
        return Err(());
    }
    let page: GradeEnvelope = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if page.completeness != "unknown" || page.grade_items.len() > 200 {
        return Err(());
    }
    for item in &page.grade_items {
        if item.course_id != course_id
            || item.label.trim().is_empty()
            || item.label.len() > 400
            || item
                .displayed_points
                .as_ref()
                .is_some_and(|s| s.len() > 300)
            || item.displayed_grade.as_ref().is_some_and(|s| s.len() > 300)
            || item
                .displayed_weight
                .as_ref()
                .is_some_and(|s| s.len() > 300)
            || !["none", "present", "unknown"].contains(&item.feedback_availability.as_str())
        {
            return Err(());
        }
    }
    Ok(page.grade_items)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnnouncementEnvelope {
    announcements: Vec<Announcement>,
    completeness: String,
}

fn parse_announcements(output: &Output, course_id: &str) -> Result<Vec<Announcement>, ()> {
    if output.exit_code != 0 || !valid_assignment_id(course_id) {
        return Err(());
    }
    let page: AnnouncementEnvelope = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    if page.completeness != "unknown" || page.announcements.len() > 200 {
        return Err(());
    }
    let mut ids = std::collections::HashSet::new();
    for item in &page.announcements {
        if item.course_id != course_id
            || !valid_assignment_id(&item.announcement_id)
            || !ids.insert(item.announcement_id.as_str())
            || item.title.trim().is_empty()
            || item.title.len() > 400
            || item.body.as_ref().is_some_and(|s| s.len() > 12_000)
            || item.detail_reference
                != format!("/d2l/le/news/{course_id}/{}/view", item.announcement_id)
        {
            return Err(());
        }
    }
    Ok(page.announcements)
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
    // Both selectors were validated and supplied by this adapter. A CLI that
    // claims either is missing or invalid has not honored the child contract.
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
            assert_eq!(
                Adapter::new("com.webswe.civildesk.e2e")
                    .unwrap()
                    .course_mode(),
                "synthetic_cli"
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
    fn course_contract_requires_complete_unique_numeric_records() {
        let course = json!({"id":"610101","code":"CIV 201","name":"Shared title","semester_name":"",
            "is_active":true,"can_access":true,"is_new_enrollment":false,"start_date":null,"end_date":null});
        let output = |value: serde_json::Value, code| Output {
            stdout: serde_json::to_vec(&value).unwrap(),
            exit_code: code,
        };
        assert_eq!(
            parse_courses(&output(json!({"courses":[course.clone()]}), 0))
                .unwrap()
                .len(),
            1
        );
        for value in [
            json!({"courses":[course.clone(),course.clone()]}),
            json!({"courses":[{"id":"bad"}]}),
            json!({"courses":[{"id":"610101","code":"CIV 201"}]}),
            json!({"courses":[course.clone()],"bookmark":"next"}),
        ] {
            assert!(parse_courses(&output(value, 0)).is_err());
        }
        assert!(parse_courses(&output(json!({"courses":[]}), 1)).is_err());
        assert!(parse_courses(&Output {
            stdout: b"{bad".to_vec(),
            exit_code: 0
        })
        .is_err());
    }
    #[test]
    fn assignment_contract_rejects_cross_course_identity_and_invalid_pages() {
        let assignment = json!({"id":"801","course_id":"610101","name":"Fictional task","submission_status":null,"score":null,"due_date":"2027-03-14T02:30:00"});
        let complete = json!({"status":"below_page_size_boundary","observed_row_count":1,"page_size_ceiling":50});
        let output = |value: serde_json::Value, code| Output {
            stdout: serde_json::to_vec(&value).unwrap(),
            exit_code: code,
        };
        assert!(parse_assignments(
            &output(
                json!({"assignments":[assignment.clone()],"completeness":complete.clone()}),
                0
            ),
            "610101"
        )
        .is_ok());
        for page in [
            json!({"assignments":[assignment.clone(),assignment.clone()],"completeness":complete.clone()}),
            json!({"assignments":[assignment.clone()],"completeness":{"status":"complete","observed_row_count":1,"page_size_ceiling":50}}),
            json!({"assignments":[assignment.clone()],"completeness":{"status":"unknown","observed_row_count":0,"page_size_ceiling":null}}),
            json!({"assignments":[{"id":"801","course_id":"610202","name":"Wrong course","submission_status":null,"score":null,"due_date":null}],"completeness":complete.clone()}),
            json!({"assignments":[{"id":"801","course_id":"610101","name":"Bad date","submission_status":null,"score":null,"due_date":"2027-02-29T10:00:00"}],"completeness":complete.clone()}),
            json!({"assignments":[{"id":"801","course_id":"610101","name":"Offset unsupported by v1","submission_status":null,"score":null,"due_date":"2027-01-01T10:00:00Z"}],"completeness":complete.clone()}),
            json!({"assignments":[assignment.clone()]}),
        ] {
            assert!(parse_assignments(&output(page, 0), "610101").is_err());
        }
        assert!(parse_assignments(
            &output(json!({"assignments":[],"completeness":complete}), 1),
            "610101"
        )
        .is_err());
        assert!(!valid_assignment_id("610101;rm"));
        assert!(valid_naive_due("2028-02-29T23:59:59"));
        assert!(!valid_naive_due("2027-03-14"));
    }
    #[cfg(not(feature = "notion-mock"))]
    #[test]
    fn regular_build_never_invokes_course_cli() {
        let db = Database(Mutex::new(Connection::open_in_memory().unwrap()));
        for identity in ["com.webswe.civildesk", "com.webswe.civildesk.acceptance"] {
            let adapter = Adapter::new(identity).unwrap();
            assert_eq!(adapter.course_mode(), "unavailable");
            assert!(adapter.courses(&db).is_err());
            assert!(adapter.assignments(&db).is_err());
            assert!(adapter.grades(&db).is_err());
            assert!(adapter.announcements(&db).is_err());
        }
    }
    #[test]
    fn grade_pages_preserve_display_values_and_reject_unverified_shapes() {
        let item = json!({"course_id":"610101","label":"Duplicate title","displayed_points":"0",
            "displayed_grade":null,"displayed_weight":"12.5%","feedback_availability":"unknown"});
        let good = Output {
            stdout: serde_json::to_vec(
                &json!({"grade_items":[item.clone(),item.clone()],"completeness":"unknown"}),
            )
            .unwrap(),
            exit_code: 0,
        };
        let parsed = parse_grades(&good, "610101").unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].displayed_points.as_deref(), Some("0"));
        assert_eq!(parsed[0].displayed_grade, None);
        for bad in [
            json!({"grade_items":[item.clone()]}),
            json!({"grade_items":[item.clone()],"completeness":"complete"}),
            json!({"grade_items":[{"course_id":"610202","label":"Wrong","displayed_points":null,"displayed_grade":null,"displayed_weight":null,"feedback_availability":"none"}],"completeness":"unknown"}),
            json!({"grade_items":[{"course_id":"610101","label":"X","displayed_points":null,"displayed_grade":null,"displayed_weight":null,"feedback_availability":"invented"}],"completeness":"unknown"}),
        ] {
            let output = Output {
                stdout: serde_json::to_vec(&bad).unwrap(),
                exit_code: 0,
            };
            assert!(parse_grades(&output, "610101").is_err());
        }
    }
    #[test]
    fn announcement_pages_require_course_bound_identity_and_plain_contract() {
        let item = json!({"course_id":"610101","announcement_id":"501","title":"Duplicate title",
            "body":"<script>literal text</script>","detail_reference":"/d2l/le/news/610101/501/view"});
        let good = Output {
            stdout: serde_json::to_vec(
                &json!({"announcements":[item.clone()],"completeness":"unknown"}),
            )
            .unwrap(),
            exit_code: 0,
        };
        assert_eq!(
            parse_announcements(&good, "610101").unwrap()[0]
                .body
                .as_deref(),
            Some("<script>literal text</script>")
        );
        for bad in [
            json!({"announcements":[item.clone(),item.clone()],"completeness":"unknown"}),
            json!({"announcements":[item.clone()],"completeness":"complete"}),
            json!({"announcements":[{"course_id":"610101","announcement_id":"501","title":"X","body":null,"detail_reference":"https://outside.example.test"}],"completeness":"unknown"}),
            json!({"announcements":[{"course_id":"610202","announcement_id":"501","title":"X","body":null,"detail_reference":"/d2l/le/news/610202/501/view"}],"completeness":"unknown"}),
        ] {
            let output = Output {
                stdout: serde_json::to_vec(&bad).unwrap(),
                exit_code: 0,
            };
            assert!(parse_announcements(&output, "610101").is_err());
        }
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
        let missing_selector = response("not_configured", None, "none", Some("missing_portal"), 1);
        assert!(parse_status(
            &missing_selector,
            "civildesk-dev",
            "https://learn.example.edu"
        )
        .is_err());
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

    #[cfg(not(feature = "notion-mock"))]
    #[test]
    fn frozen_package_is_rejected_before_process_launch_or_configuration_save() {
        let dir = std::env::temp_dir().join(format!(
            "civildesk-frozen-boundary-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("_internal")).unwrap();
        let exe = dir.join("d2l.exe");
        std::fs::write(&exe, b"synthetic, not executable").unwrap();
        let exe = exe.canonicalize().unwrap();
        let adapter = Adapter::new("com.webswe.civildesk.dev").unwrap();
        let db = Database(Mutex::new(Connection::open_in_memory().unwrap()));
        db.0.lock()
            .unwrap()
            .execute(
                "CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
                [],
            )
            .unwrap();
        assert!(adapter
            .save(&db, "https://synthetic.example.test", exe.to_str().unwrap())
            .err()
            .unwrap()
            .contains("not approved"));
        assert!(adapter.configuration(&db).unwrap().is_none());
        let digest = file_sha256(&exe).unwrap();
        adapter.cancelled.store(false, Ordering::SeqCst);
        assert!(matches!(
            adapter.run(
                &exe,
                &digest,
                "https://synthetic.example.test",
                true,
                &["auth", "capabilities", "--json", "--contract-version", "1"]
            ),
            Err("cli_untrusted")
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
