//! Dedicated offline fixture executable for the isolated native E2E build.
//! It imports no credential manager or HTTP client and accepts only the fixed contract commands.
use serde_json::json;
use std::io::Write;
use std::time::Duration;

const CAPS: [&str; 9] = [
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

fn main() {
    if std::env::var("D2L_CLI_PROFILE").as_deref() != Ok("civildesk-e2e-synthetic")
        || std::env::var("D2L_CLI_BASE_URL").as_deref() != Ok("https://synthetic.example.test")
    {
        std::process::exit(7);
    }
    let scenario = std::env::var("CIVILDESK_BRIGHTSPACE_SCENARIO_FILE")
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_else(|| "missing".into());
    let scenario = scenario.trim();
    let args: Vec<_> = std::env::args().skip(1).collect();
    let capability = ["auth", "capabilities", "--json", "--contract-version", "1"];
    let status = ["auth", "status", "--json", "--contract-version", "1"];
    if args.iter().map(String::as_str).collect::<Vec<_>>() == capability {
        match scenario {
            "timeout" => std::thread::sleep(Duration::from_secs(30)),
            "oversized" => {
                let _ = std::io::stdout().write_all(&vec![b'x'; 40_000]);
                return;
            }
            "oversized_stderr" => {
                let _ = std::io::stderr().write_all(&vec![b'x'; 10_000]);
                return;
            }
            "malformed" => {
                print!("{{not-json");
                return;
            }
            "terminated" => std::process::abort(),
            "nonzero" => std::process::exit(3),
            "unsupported" => {
                println!(
                    "{}",
                    json!({"contract_version":1,"capabilities":[],"error_code":"unsupported_contract","message":"Unsupported."})
                );
                std::process::exit(2);
            }
            "unexpected" => {
                println!(
                    "{}",
                    json!({"contract_version":1,"capabilities":CAPS,"error_code":null,"message":"Available.","extra":"reject"})
                );
                return;
            }
            _ => {}
        }
        println!(
            "{}",
            json!({"contract_version":1,"capabilities":CAPS,"error_code":null,"message":"Capabilities available."})
        );
        return;
    }
    if args.iter().map(String::as_str).collect::<Vec<_>>() != status {
        std::process::exit(8);
    }
    let (state, present, verification, error, code, origin, valid) = match scenario {
        "present" => (
            "credential_present_unverified",
            Some(true),
            "local",
            None,
            0,
            "https://synthetic.example.test",
            true,
        ),
        "mismatch" => (
            "portal_mismatch",
            None,
            "none",
            Some("portal_mismatch"),
            1,
            "https://synthetic.example.test",
            true,
        ),
        "credential_error" => (
            "credential_error",
            None,
            "none",
            Some("credential_corrupt"),
            1,
            "https://synthetic.example.test",
            true,
        ),
        "invalid_config" => (
            "not_configured",
            None,
            "none",
            Some("missing_portal"),
            1,
            "",
            false,
        ),
        _ => (
            "authentication_required",
            Some(false),
            "local",
            Some("missing_credential"),
            0,
            "https://synthetic.example.test",
            true,
        ),
    };
    println!(
        "{}",
        json!({
            "contract_version":1,"capabilities":CAPS,"configuration_valid":valid,
            "profile_id":"civildesk-e2e-synthetic","portal_origin":if origin.is_empty(){None}else{Some(origin)},
            "state":state,"credential_present":present,"authenticated":false,
            "verification":verification,"checked_at":null,"error_code":error,"message":"Synthetic fixture."
        })
    );
    std::process::exit(code);
}
