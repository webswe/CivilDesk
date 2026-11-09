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
    let courses = ["courses", "list", "--json"];
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
    if args.iter().map(String::as_str).collect::<Vec<_>>() == courses {
        let course = |id: &str, code: &str, name: &str, semester: &str| {
            json!({
                "id":id,"code":code,"name":name,"semester_name":semester,
                "is_active":true,"can_access":true,"is_new_enrollment":false,
                "start_date":null,"end_date":null
            })
        };
        match scenario {
            "courses_timeout" => std::thread::sleep(Duration::from_secs(30)),
            "courses_oversized" => {
                let _ = std::io::stdout().write_all(&vec![b'x'; 40_000]);
                return;
            }
            "courses_invalid_json" => {
                println!("{{invalid");
                return;
            }
            "courses_failure" => {
                eprintln!("Synthetic failure without credentials.");
                std::process::exit(1);
            }
            "courses_malformed" => {
                println!("{}", json!({"courses":[{"id":"bad","name":"Malformed"}]}));
                return;
            }
            "courses_empty" => {
                println!("{}", json!({"courses":[]}));
                return;
            }
            "courses_duplicate_names" => {
                println!(
                    "{}",
                    json!({"courses":[course("610101","CIV 201","Shared Title","Sample Fall Term"),course("610102","CIV 202","Shared Title","Sample Fall Term")]})
                );
                return;
            }
            "courses_missing_optional" => {
                println!(
                    "{}",
                    json!({"courses":[course("610303","","A Very Long Sample Course Title for Narrow Windows and Detail Navigation","")]})
                );
                return;
            }
            "assignments_many_courses" => {
                let many: Vec<_> = (0..13)
                    .map(|index| {
                        course(
                            &format!("{}", 610100 + index),
                            &format!("CIV {}", index),
                            &format!("Fictional course {}", index),
                            "Sample term",
                        )
                    })
                    .collect();
                println!("{}", json!({"courses":many}));
                return;
            }
            _ => {
                println!(
                    "{}",
                    json!({"courses":[course("610101","CIV 201","Structures and the Built Environment","Sample Fall Term"),course("610202","MATH 240","Applied Mathematics for Designers","Sample Fall Term")]})
                );
                return;
            }
        }
    }
    if args.len() == 6
        && args[0] == "assignments"
        && args[1] == "list"
        && args[2] == "--course"
        && args[4] == "--json"
        && args[5] == "--include-completeness"
        && (matches!(args[3].as_str(), "610101" | "610202")
            || (scenario == "assignments_many_courses"
                && args[3].bytes().all(|byte| byte.is_ascii_digit())))
    {
        let course_id = args[3].as_str();
        if scenario == "assignments_timeout" {
            std::thread::sleep(Duration::from_secs(30));
        }
        if scenario == "assignments_oversized" {
            let _ = std::io::stdout().write_all(&vec![b'x'; 40_000]);
            return;
        }
        if scenario == "assignments_invalid_json" {
            println!("{{bad");
            return;
        }
        if scenario == "assignments_failure"
            || (scenario == "assignments_partial_failure" && course_id == "610202")
        {
            eprintln!("Synthetic assignment failure.");
            std::process::exit(1);
        }
        let assignment = |id: &str, title: &str, due: Option<&str>| {
            json!({
                "id":id,"course_id":course_id,"name":title,"submission_status":null,"score":null,"due_date":due
            })
        };
        let assignments = if scenario == "assignments_empty" {
            vec![]
        } else if scenario == "assignments_malformed" {
            vec![json!({"id":"bad","course_id":course_id})]
        } else if course_id == "610101" {
            vec![
                assignment("801", "Design brief", Some("2026-11-18T17:00:00")),
                assignment("802", "Studio reflection", None),
                assignment("803", "Research notes", Some("2026-11-18T09:00:00")),
            ]
        } else {
            vec![assignment(
                "801",
                "Design brief",
                Some("2026-11-18T23:59:00"),
            )]
        };
        let status = if scenario == "assignments_partial" {
            "potentially_truncated"
        } else {
            "below_page_size_boundary"
        };
        println!(
            "{}",
            json!({"assignments":assignments,"completeness":{
                "status":status,"observed_row_count":assignments.len(),"page_size_ceiling":
                if scenario == "assignments_partial" { assignments.len() } else { 50 }
            }})
        );
        return;
    }
    if args.len() == 6
        && matches!(args[0].as_str(), "grades" | "announcements")
        && args[1] == "list"
        && args[2] == "--course"
        && args[4] == "--json"
        && args[5] == "--include-completeness"
        && matches!(args[3].as_str(), "610101" | "610202")
    {
        let kind = args[0].as_str();
        let id = args[3].as_str();
        let scenario_kind = if kind == "grades" {
            "grades"
        } else {
            "announcements"
        };
        if scenario == format!("{scenario_kind}_timeout") {
            std::thread::sleep(Duration::from_secs(30));
        }
        if scenario == format!("{scenario_kind}_oversized") {
            let _ = std::io::stdout().write_all(&vec![b'x'; 40_000]);
            return;
        }
        if scenario == format!("{scenario_kind}_invalid_json") {
            print!("{{bad");
            return;
        }
        if scenario == format!("{scenario_kind}_failure")
            || (scenario == format!("{scenario_kind}_partial_failure") && id == "610202")
        {
            eprintln!("Synthetic academic failure.");
            std::process::exit(1);
        }
        if kind == "grades" {
            let item = |label: &str,
                        points: Option<&str>,
                        grade: Option<&str>,
                        weight: Option<&str>,
                        feedback: &str| {
                json!({"course_id":id,"label":label,"displayed_points":points,"displayed_grade":grade,
                    "displayed_weight":weight,"feedback_availability":feedback})
            };
            let items = if scenario == "grades_empty" {
                vec![]
            } else if scenario == "grades_malformed" {
                vec![json!({"course_id":"999","label":"Wrong course"})]
            } else if id == "610101" {
                vec![
                    item(
                        "Fictional design brief",
                        Some("7 / 11"),
                        Some("Custom mark"),
                        None,
                        "none",
                    ),
                    item(
                        "Fictional design brief",
                        None,
                        None,
                        Some("12.5%"),
                        "present",
                    ),
                    item(
                        "A very long fictional laboratory grade item title for a narrow window",
                        Some("0"),
                        Some("Pending review"),
                        Some("0%"),
                        "unknown",
                    ),
                ]
            } else {
                vec![item(
                    "Fictional studio exercise",
                    Some("A"),
                    None,
                    None,
                    "none",
                )]
            };
            println!("{}", json!({"grade_items":items,"completeness":"unknown"}));
        } else {
            let item = |number: &str, title: &str, body: Option<&str>| {
                json!({
                    "course_id":id,"announcement_id":number,"title":title,"body":body,
                    "detail_reference":format!("/d2l/le/news/{id}/{number}/view")
                })
            };
            let items = if scenario == "announcements_empty" {
                vec![]
            } else if scenario == "announcements_malformed" {
                vec![
                    json!({"course_id":id,"announcement_id":"bad","title":"Malformed","body":null,"detail_reference":"https://unsafe.example.test"}),
                ]
            } else if id == "610101" {
                vec![
                    item("501", "Fictional studio update", Some("First paragraph.\n\n- First item\n- Second item")),
                    item("502", "Fictional studio update", Some("<script>alert('sample')</script> https://outside.example.test/image.png")),
                    item("503", "A very long fictional announcement title that wraps on a narrow display", Some("This fictional announcement has a longer body.\n\nIt remains plain text, with no embedded resources or automatically opened links.")),
                ]
            } else {
                vec![item("601", "Fictional schedule note", None)]
            };
            println!(
                "{}",
                json!({"announcements":items,"completeness":"unknown"})
            );
        }
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
