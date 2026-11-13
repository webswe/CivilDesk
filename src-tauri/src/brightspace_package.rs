//! Verification of an approved PyInstaller one-directory D2L-CLI package.
//! The expected manifest digest must be supplied by an independently trusted
//! application record; a manifest found inside the package is never trusted.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path};

const SCHEMA: &str = "civildesk-d2l-windows-onedir-v1";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 10_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileRecord {
    sha256: String,
    size: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WheelRecord {
    requirement: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: String,
    source_commit: String,
    source_archive_sha256: String,
    source_file_count: usize,
    python_version: String,
    python_executable_sha256: String,
    pyinstaller_version: String,
    uv_version: String,
    lockfile_sha256: String,
    toolchain_requirements_sha256: String,
    runtime_requirements_sha256: String,
    entry_script_sha256: String,
    build_environment: String,
    build_command: String,
    executable_sha256: String,
    browser_bundle: String,
    reproducibility_limitations: String,
    approved_package_index: String,
    toolchain_wheels: Vec<WheelRecord>,
    runtime_lock_export: String,
    verification_procedure: String,
    tested_offline: String,
    files: BTreeMap<String, FileRecord>,
}

fn hash_file(path: &Path) -> Result<String, &'static str> {
    let mut file = File::open(path).map_err(|_| "A package component could not be read.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let len = file
            .read(&mut buffer)
            .map_err(|_| "A package component could not be read.")?;
        if len == 0 {
            break;
        }
        digest.update(&buffer[..len]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn safe_relative(name: &str) -> bool {
    if name.is_empty() || name.contains('\\') || name.contains(':') || name.contains('\0') {
        return false;
    }
    let path = Path::new(name);
    path.components().all(|c| matches!(c, Component::Normal(_)))
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn reparse_point(path: &Path) -> Result<bool, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "A package component is missing.")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(metadata.file_attributes() & 0x400 != 0)
    }
    #[cfg(not(windows))]
    {
        Ok(metadata.file_type().is_symlink())
    }
}

fn scan_dir(root: &Path, dir: &Path, expected: &BTreeSet<String>) -> Result<(), &'static str> {
    for item in fs::read_dir(dir).map_err(|_| "The package directory could not be read.")? {
        let path = item
            .map_err(|_| "The package directory could not be read.")?
            .path();
        if reparse_point(&path)? {
            return Err("The package contains a link or junction.");
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "The package path is invalid.")?
            .to_str()
            .ok_or("The package path is invalid.")?
            .replace('\\', "/");
        if path.is_dir() {
            let prefix = format!("{rel}/");
            if !expected.iter().any(|name| name.starts_with(&prefix)) {
                return Err("The package contains an unexpected directory.");
            }
            scan_dir(root, &path, expected)?;
        } else if !path.is_file() || !expected.contains(&rel) {
            return Err("The package contains an unexpected file.");
        }
    }
    Ok(())
}

/// Verify every runtime file before a frozen executable is launched.
/// `expected_manifest_sha256` must be embedded in an approved application
/// trust record, never loaded from the package or its writable settings.
pub fn verify_package(
    executable: &Path,
    manifest_path: &Path,
    expected_manifest_sha256: &str,
) -> Result<(), &'static str> {
    if !valid_hash(expected_manifest_sha256) {
        return Err("The package trust record is invalid.");
    }
    let root = executable
        .parent()
        .ok_or("The package executable path is invalid.")?;
    if !executable.is_absolute()
        || executable.file_name().and_then(|n| n.to_str()) != Some("d2l.exe")
        || root
            .canonicalize()
            .map_err(|_| "The package directory is unavailable.")?
            != root
        || reparse_point(root)?
        || reparse_point(executable)?
    {
        return Err("The package executable path is invalid.");
    }
    let trusted_path = manifest_path
        .canonicalize()
        .map_err(|_| "The trusted package manifest is unavailable.")?;
    if trusted_path.starts_with(root) || reparse_point(manifest_path)? {
        return Err("The package manifest is not independently located.");
    }
    let manifest_size = fs::metadata(&trusted_path)
        .map_err(|_| "The trusted package manifest is unavailable.")?
        .len();
    if manifest_size > MAX_MANIFEST_BYTES {
        return Err("The package manifest is invalid.");
    }
    let bytes = fs::read(&trusted_path).map_err(|_| "The package manifest could not be read.")?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The package manifest is invalid.");
    }
    if format!("{:x}", Sha256::digest(&bytes)) != expected_manifest_sha256 {
        return Err("The package manifest does not match the approved trust record.");
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "The package manifest is invalid.")?;
    if manifest.schema != SCHEMA {
        return Err("The package manifest version is unsupported.");
    }
    if !valid_hash(&manifest.executable_sha256)
        || !valid_hash(&manifest.source_archive_sha256)
        || !valid_hash(&manifest.python_executable_sha256)
        || !valid_hash(&manifest.lockfile_sha256)
        || !valid_hash(&manifest.toolchain_requirements_sha256)
        || !valid_hash(&manifest.runtime_requirements_sha256)
        || !valid_hash(&manifest.entry_script_sha256)
        || manifest.source_commit.len() != 40
        || !manifest
            .source_commit
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || manifest.source_file_count == 0
        || manifest.python_version.is_empty()
        || manifest.pyinstaller_version.is_empty()
        || manifest.uv_version.is_empty()
        || manifest.build_environment.is_empty()
        || manifest.build_command.is_empty()
        || manifest.browser_bundle.is_empty()
        || manifest.reproducibility_limitations.is_empty()
        || manifest.approved_package_index.is_empty()
        || manifest.runtime_lock_export.is_empty()
        || manifest.verification_procedure.is_empty()
        || manifest.tested_offline.is_empty()
        || manifest.toolchain_wheels.is_empty()
        || manifest
            .toolchain_wheels
            .iter()
            .any(|wheel| wheel.requirement.is_empty() || !valid_hash(&wheel.sha256))
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
        || manifest.files.get("d2l.exe").map(|v| &v.sha256) != Some(&manifest.executable_sha256)
    {
        return Err("The package manifest is invalid.");
    }
    let mut names = BTreeSet::new();
    for (name, record) in &manifest.files {
        if !safe_relative(name)
            || !valid_hash(&record.sha256)
            || !names.insert(name.to_ascii_lowercase())
        {
            return Err("The package manifest contains an invalid component path.");
        }
        let path = root.join(name);
        if reparse_point(&path)? || !path.is_file() {
            return Err("A package component is missing or linked.");
        }
        if fs::metadata(&path)
            .map_err(|_| "A package component could not be read.")?
            .len()
            != record.size
            || hash_file(&path)? != record.sha256
        {
            return Err("A package component has changed.");
        }
    }
    let expected: BTreeSet<String> = manifest.files.keys().cloned().collect();
    scan_dir(root, root, &expected)?;
    Ok(())
}

// Production approval is deliberately absent. Provisioning a package requires
// a separately reviewed manifest path and digest in the application binary.
// Neither the selected executable path nor SQLite settings can approve it.
const APPROVED_FROZEN: Option<(&str, &str)> = None;

pub fn is_frozen_package(executable: &Path) -> bool {
    executable
        .parent()
        .is_some_and(|root| root.join("_internal").exists())
}

pub fn verify_for_launch(executable: &Path, configured_frozen: bool) -> Result<(), &'static str> {
    if !configured_frozen && !is_frozen_package(executable) {
        return Ok(());
    }
    let (manifest, digest) =
        APPROVED_FROZEN.ok_or("This frozen D2L-CLI package is not approved.")?;
    verify_package(executable, Path::new(manifest), digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        parent: std::path::PathBuf,
        root: std::path::PathBuf,
        manifest: std::path::PathBuf,
        value: Value,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.parent);
        }
    }

    impl Fixture {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let parent = std::env::temp_dir()
                .join(format!("civildesk-package-{}-{unique}", std::process::id()));
            let root = parent.join("package");
            fs::create_dir_all(root.join("_internal")).unwrap();
            let contents = [
                ("d2l.exe", b"synthetic executable".as_slice()),
                ("_internal/python311.dll", b"synthetic DLL".as_slice()),
                (
                    "_internal/base_library.zip",
                    b"synthetic library".as_slice(),
                ),
            ];
            let mut files = serde_json::Map::new();
            for (name, content) in contents {
                fs::write(root.join(name), content).unwrap();
                files.insert(
                    name.into(),
                    json!({"size":content.len(),"sha256":hash_file(&root.join(name)).unwrap()}),
                );
            }
            let exe_hash = files["d2l.exe"]["sha256"].clone();
            let zero = "0".repeat(64);
            let value = json!({
                "schema":SCHEMA,"source_commit":"a".repeat(40),"source_archive_sha256":zero,
                "source_file_count":3,"python_version":"CPython 3.11.15 x64 Windows",
                "python_executable_sha256":"0".repeat(64),"pyinstaller_version":"6.16.0",
                "uv_version":"0.11.32","lockfile_sha256":"0".repeat(64),
                "toolchain_requirements_sha256":"0".repeat(64),
                "runtime_requirements_sha256":"0".repeat(64),
                "entry_script_sha256":"0".repeat(64),"build_environment":"synthetic",
                "build_command":"synthetic","executable_sha256":exe_hash,
                "browser_bundle":"none","reproducibility_limitations":"synthetic",
                "approved_package_index":"https://pypi.org/simple",
                "toolchain_wheels":[{"requirement":"test==1","sha256":"0".repeat(64)}],
                "runtime_lock_export":"synthetic","verification_procedure":"synthetic",
                "tested_offline":"synthetic","files":files
            });
            let manifest = parent.join("manifest.json");
            Self {
                parent,
                root: root.canonicalize().unwrap(),
                manifest,
                value,
            }
        }

        fn write_manifest(&self) -> String {
            fs::write(&self.manifest, serde_json::to_vec(&self.value).unwrap()).unwrap();
            hash_file(&self.manifest).unwrap()
        }

        fn exe(&self) -> std::path::PathBuf {
            self.root.join("d2l.exe")
        }
    }

    #[test]
    fn valid_package_and_runtime_tampering() {
        let fixture = Fixture::new();
        let hash = fixture.write_manifest();
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Ok(())
        );
        for name in [
            "d2l.exe",
            "_internal/python311.dll",
            "_internal/base_library.zip",
        ] {
            let path = fixture.root.join(name);
            let original = fs::read(&path).unwrap();
            fs::write(&path, b"modified").unwrap();
            assert!(
                verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err(),
                "{name}"
            );
            fs::write(&path, original).unwrap();
        }
        let missing = fixture.root.join("_internal/python311.dll");
        fs::remove_file(&missing).unwrap();
        assert!(verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err());
    }

    #[test]
    fn manifest_identity_schema_and_paths() {
        let mut fixture = Fixture::new();
        let hash = fixture.write_manifest();
        assert!(verify_package(&fixture.exe(), &fixture.manifest, &"0".repeat(64)).is_err());
        let package_manifest = fixture.root.join("manifest.json");
        fs::copy(&fixture.manifest, &package_manifest).unwrap();
        assert_eq!(
            verify_package(&fixture.exe(), &package_manifest, &hash),
            Err("The package manifest is not independently located.")
        );
        fs::remove_file(package_manifest).unwrap();
        fs::write(&fixture.manifest, b"modified manifest").unwrap();
        assert!(verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err());
        fixture.value["schema"] = json!("future-version");
        let hash = fixture.write_manifest();
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Err("The package manifest version is unsupported.")
        );
        fixture.value["schema"] = json!(SCHEMA);
        fixture.value["files"]["../escape"] = json!({"size":0,"sha256":"0".repeat(64)});
        let hash = fixture.write_manifest();
        assert!(verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err());
        fixture.value["files"]
            .as_object_mut()
            .unwrap()
            .remove("../escape");
        fixture.value["files"]["d2l.exe"]["size"] = json!("invalid");
        let hash = fixture.write_manifest();
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Err("The package manifest is invalid.")
        );
    }

    #[test]
    fn extra_files_and_unapproved_launch_fail_closed() {
        let fixture = Fixture::new();
        let hash = fixture.write_manifest();
        fs::write(fixture.root.join("unexpected.dll"), b"extra").unwrap();
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Err("The package contains an unexpected file.")
        );
        assert_eq!(
            verify_for_launch(&fixture.exe(), true),
            Err("This frozen D2L-CLI package is not approved.")
        );
    }

    #[test]
    fn replacement_directory_with_same_executable_is_rejected() {
        let fixture = Fixture::new();
        let hash = fixture.write_manifest();
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Ok(())
        );
        let old = fixture.parent.join("old-package");
        fs::rename(&fixture.root, &old).unwrap();
        fs::create_dir_all(fixture.root.join("_internal")).unwrap();
        fs::copy(old.join("d2l.exe"), fixture.exe()).unwrap();
        fs::copy(
            old.join("_internal/base_library.zip"),
            fixture.root.join("_internal/base_library.zip"),
        )
        .unwrap();
        fs::write(
            fixture.root.join("_internal/python311.dll"),
            b"replacement DLL",
        )
        .unwrap();
        assert!(verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err());
    }

    #[test]
    fn linked_runtime_component_cannot_escape() {
        let fixture = Fixture::new();
        let hash = fixture.write_manifest();
        let target = fixture.root.join("_internal/python311.dll");
        let outside = fixture.parent.join("outside.dll");
        fs::write(&outside, b"synthetic DLL").unwrap();
        fs::remove_file(&target).unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &target);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &target);
        if linked.is_ok() {
            assert!(verify_package(&fixture.exe(), &fixture.manifest, &hash).is_err());
        }
    }

    #[cfg(windows)]
    #[test]
    fn junction_escape_is_rejected() {
        let fixture = Fixture::new();
        let hash = fixture.write_manifest();
        let outside = fixture.parent.join("outside-directory");
        fs::create_dir(&outside).unwrap();
        let junction = fixture.root.join("unexpected-junction");
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&junction)
            .arg(&outside)
            .status()
            .unwrap();
        assert!(status.success(), "the test junction could not be created");
        assert_eq!(
            verify_package(&fixture.exe(), &fixture.manifest, &hash),
            Err("The package contains a link or junction.")
        );
    }

    #[test]
    fn frozen_candidate_copy_when_provided() {
        let Ok(root) = std::env::var("CIVILDESK_FROZEN_CANDIDATE_TEST_PATH") else {
            return;
        };
        let manifest = std::env::var("CIVILDESK_FROZEN_MANIFEST_TEST_PATH").unwrap();
        let root = Path::new(&root).canonicalize().unwrap();
        let manifest_value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        assert_eq!(
            manifest_value["source_commit"],
            "3ce164827ce10e6a311d4c4bdf6ecc9f7624c60f"
        );
        assert_eq!(manifest_value["files"].as_object().unwrap().len(), 306);
        assert_eq!(
            hash_file(&root.join("d2l.exe")).unwrap(),
            "fa06c5f1ab284130184715eb8b3ac04a61c5d07caa77ed44acb3f13bc1c46243"
        );
        assert_eq!(
            verify_package(
                &root.join("d2l.exe"),
                Path::new(&manifest),
                "7c09cc6f3941ff86d20e779a2275269ba0f9a47cac28939779f3cc0108cf29db",
            ),
            Ok(())
        );
    }
}
