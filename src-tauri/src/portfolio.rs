//! Portfolio Studio: case-study presentation data layered on top of Engineering Projects.
//!
//! The engineering project stays the single authoritative record. This module stores only what a project does not
//! already hold (background, scope, process, outcomes, tool and skill presentation, gallery order, milestone
//! selection) and renders both the in-app preview and the static export from the same function so they cannot drift.
use crate::persistence::Database;
use crate::productivity::now_ms;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::path::{Component, Path, PathBuf};

const MAX_TEXT: usize = 20_000;
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES: u64 = 40 * 1024 * 1024;
const MAX_GALLERY: i64 = 40;
const MAX_TOOLS: usize = 40;
const EXPORT_MARKER: &str = ".civildesk-export";

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaseStudy {
    pub project_id: String,
    pub team_kind: String,
    pub background: String,
    pub scope: String,
    pub constraints: String,
    pub approach: String,
    pub methodology: String,
    pub challenges: String,
    pub solutions: String,
    pub deliverables: String,
    pub outcomes: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}
/// Input for one atomic save: the case-study-only fields plus the project-backed presentation fields that already
/// live on the project (summary, design objective, role, decisions, lessons).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseStudyInput {
    pub project_id: String,
    pub team_kind: String,
    pub background: String,
    pub scope: String,
    pub constraints: String,
    pub approach: String,
    pub methodology: String,
    pub challenges: String,
    pub solutions: String,
    pub deliverables: String,
    pub outcomes: String,
    pub portfolio_summary: String,
    pub objectives: String,
    pub contributions: String,
    pub decisions: String,
    pub lessons: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInput {
    pub kind: String,
    pub name: String,
    pub skill_id: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioTool {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub name: String,
    pub skill_id: Option<String>,
    pub position: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub id: String,
    pub project_id: String,
    pub file_id: String,
    pub caption: String,
    pub alt_text: String,
    pub position: i64,
    pub display_name: String,
    pub missing: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneSelection {
    pub project_id: String,
    pub milestone_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioData {
    pub studies: Vec<CaseStudy>,
    pub tools: Vec<PortfolioTool>,
    pub gallery: Vec<GalleryItem>,
    pub milestones: Vec<MilestoneSelection>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub html: String,
    /// Human-readable list of exactly what the export contains.
    pub included: Vec<String>,
    pub warnings: Vec<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub folder: String,
    pub files: Vec<String>,
    pub warnings: Vec<String>,
}

fn sql<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn too_long(values: &[&str]) -> bool {
    values.iter().any(|s| s.chars().count() > MAX_TEXT)
}

// ---------------------------------------------------------------------------------------------------------------
// Image validation. The extension must be an allowed raster type AND the file content must match it. SVG and any
// other active-content format are refused.
// ---------------------------------------------------------------------------------------------------------------
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ImageKind {
    Png,
    Jpeg,
    Gif,
    Webp,
}
impl ImageKind {
    fn ext(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }
    fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }
}
pub fn sniff_image(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(ImageKind::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImageKind::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageKind::Gif)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageKind::Webp)
    } else {
        None
    }
}
fn declared_kind(path: &Path) -> Option<ImageKind> {
    match path
        .extension()
        .and_then(|x| x.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some(ImageKind::Png),
        "jpg" | "jpeg" => Some(ImageKind::Jpeg),
        "gif" => Some(ImageKind::Gif),
        "webp" => Some(ImageKind::Webp),
        _ => None,
    }
}
/// Reads and validates an image file. Symbolic links, oversized files and content that does not match the declared
/// extension are rejected. Returns the bytes together with the content-derived type.
pub fn read_image(path: &Path, limit: u64) -> Result<(Vec<u8>, ImageKind), String> {
    if !path.is_absolute() {
        return Err("Choose an image using its absolute path".into());
    }
    let meta = std::fs::symlink_metadata(path)
        .map_err(|_| "The image file is missing or cannot be read".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Shortcuts and symbolic links cannot be used as portfolio images".into());
    }
    if !meta.is_file() {
        return Err("The image file is missing or cannot be read".into());
    }
    if meta.len() == 0 || meta.len() > limit {
        return Err(format!(
            "Images must be between 1 byte and {} MB",
            limit / 1024 / 1024
        ));
    }
    let declared = declared_kind(path)
        .ok_or("Supported image types are PNG, JPEG, GIF and WebP (SVG is not supported)")?;
    let bytes = std::fs::read(path).map_err(|_| "The image file could not be read".to_string())?;
    match sniff_image(&bytes) {
        Some(actual) if actual == declared => Ok((bytes, actual)),
        _ => Err("The file content does not match its image type".into()),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------------------
pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            '\0' => {}
            c => out.push(c),
        }
    }
    out
}
fn paragraphs(s: &str) -> String {
    let normalized = s.replace("\r\n", "\n");
    normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| {
            format!(
                "<p>{}</p>",
                p.split('\n')
                    .map(escape_html)
                    .collect::<Vec<_>>()
                    .join("<br>")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}
/// A Windows-safe folder name derived from the title. Never empty, never reserved, no separators or dots at the end.
pub fn safe_folder_name(title: &str) -> String {
    let mut name = String::new();
    let mut last_dash = true;
    for c in title.chars() {
        if c.is_alphanumeric() || c == '_' {
            name.push(c);
            last_dash = false;
        } else if !last_dash {
            name.push('-');
            last_dash = true;
        }
    }
    let mut name: String = name.trim_matches('-').chars().take(60).collect();
    name = name.trim_end_matches('-').to_string();
    let upper = name.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit());
    if name.is_empty() || reserved {
        name = format!(
            "case-study{}",
            if reserved {
                format!("-{name}")
            } else {
                String::new()
            }
        );
    }
    name
}

// ---------------------------------------------------------------------------------------------------------------
// Gathering: one explicit allowlist of what may appear in a case study
// ---------------------------------------------------------------------------------------------------------------
struct Gathered {
    title: String,
    discipline: String,
    project_type: String,
    start: Option<String>,
    target: Option<String>,
    summary: String,
    objectives: String,
    role: String,
    decisions: String,
    lessons: String,
    study: CaseStudy,
    software: Vec<String>,
    skills: Vec<String>,
    milestones: Vec<(String, String, bool)>,
    images: Vec<GalleryRow>,
}
struct GalleryRow {
    caption: String,
    alt: String,
    path: String,
}

fn gather(c: &Connection, project_id: &str) -> Result<Gathered, String> {
    let project = c
        .query_row(
            "SELECT title,discipline,project_type,start_date,target_date,portfolio_summary,objectives,contributions,decisions,lessons FROM engineering_projects WHERE id=?1",
            [project_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                ))
            },
        )
        .optional()
        .map_err(sql)?
        .ok_or("Project not found")?;
    let study = case_study(c, project_id)?.unwrap_or_else(|| CaseStudy {
        project_id: project_id.into(),
        team_kind: "individual".into(),
        ..CaseStudy::default()
    });
    let names = |kind: &str| -> Result<Vec<String>, String> {
        c.prepare("SELECT name FROM portfolio_tools WHERE project_id=?1 AND kind=?2 ORDER BY position,name")
            .map_err(sql)?
            .query_map(params![project_id, kind], |r| r.get(0))
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)
    };
    let milestones = c
        .prepare("SELECT m.title,m.target_date,m.completed_at_ms IS NOT NULL FROM portfolio_milestones s JOIN project_milestones m ON m.id=s.milestone_id WHERE s.project_id=?1 ORDER BY m.target_date,m.id")
        .map_err(sql)?
        .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    let images = c
        .prepare("SELECT g.caption,g.alt_text,f.path FROM portfolio_gallery g JOIN project_files f ON f.id=g.file_id WHERE g.project_id=?1 ORDER BY g.position,g.created_at_ms")
        .map_err(sql)?
        .query_map([project_id], |r| {
            Ok(GalleryRow {
                caption: r.get(0)?,
                alt: r.get(1)?,
                path: r.get(2)?,
            })
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    Ok(Gathered {
        title: project.0,
        discipline: project.1,
        project_type: project.2,
        start: project.3,
        target: project.4,
        summary: project.5,
        objectives: project.6,
        role: project.7,
        decisions: project.8,
        lessons: project.9,
        study,
        software: names("software")?,
        skills: names("skill")?,
        milestones,
        images,
    })
}
fn case_study(c: &Connection, project_id: &str) -> Result<Option<CaseStudy>, String> {
    c.query_row(
        "SELECT project_id,team_kind,background,scope,constraints,approach,methodology,challenges,solutions,deliverables,outcomes,created_at_ms,updated_at_ms FROM portfolio_case_studies WHERE project_id=?1",
        [project_id],
        row_to_study,
    )
    .optional()
    .map_err(sql)
}
fn row_to_study(r: &rusqlite::Row<'_>) -> rusqlite::Result<CaseStudy> {
    Ok(CaseStudy {
        project_id: r.get(0)?,
        team_kind: r.get(1)?,
        background: r.get(2)?,
        scope: r.get(3)?,
        constraints: r.get(4)?,
        approach: r.get(5)?,
        methodology: r.get(6)?,
        challenges: r.get(7)?,
        solutions: r.get(8)?,
        deliverables: r.get(9)?,
        outcomes: r.get(10)?,
        created_at_ms: r.get(11)?,
        updated_at_ms: r.get(12)?,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering (shared by preview and export)
// ---------------------------------------------------------------------------------------------------------------
enum Media<'a> {
    /// Preview: images are embedded as data URLs.
    Embedded,
    /// Export: images are referenced as `assets/<file>` relative paths, in gallery order.
    Relative(&'a [Option<String>]),
}
struct Rendered {
    html: String,
    included: Vec<String>,
    warnings: Vec<String>,
    /// Gallery rows whose image passed validation, with the bytes ready to be written or embedded.
    images: Vec<LoadedImage>,
}

type LoadedImage = Option<(Vec<u8>, ImageKind)>;

fn load_images(
    rows: &[GalleryRow],
    limit: u64,
    total_limit: Option<u64>,
) -> (Vec<LoadedImage>, Vec<String>) {
    let mut out = Vec::new();
    let mut warnings = Vec::new();
    let mut total = 0u64;
    for (i, row) in rows.iter().enumerate() {
        let label = if row.caption.trim().is_empty() {
            format!("Image {}", i + 1)
        } else {
            row.caption.clone()
        };
        match read_image(Path::new(&row.path), limit) {
            Ok((bytes, kind)) => {
                total += bytes.len() as u64;
                if total_limit.is_some_and(|max| total > max) {
                    warnings.push(format!(
                        "\"{label}\" was left out of the preview because the gallery is very large"
                    ));
                    out.push(None);
                } else {
                    out.push(Some((bytes, kind)));
                }
            }
            Err(e) => {
                warnings.push(format!("\"{label}\" is not included: {e}"));
                out.push(None);
            }
        }
    }
    (out, warnings)
}

const STYLE: &str = "*{box-sizing:border-box}body{margin:0;background:#faf7f6;color:#2b2226;font:17px/1.65 Georgia,'Times New Roman',serif}\
main{max-width:46rem;margin:0 auto;padding:3rem 1.25rem 4rem}header{border-bottom:2px solid #8c5a6a;padding-bottom:1.5rem;margin-bottom:2rem}\
.kicker{font:600 .8rem/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8c5a6a;margin:0 0 .75rem}\
h1{font-size:2.2rem;line-height:1.2;margin:0 0 .75rem}h2{font:700 1.15rem/1.3 system-ui,sans-serif;margin:2.25rem 0 .6rem;color:#4a2f3a}\
.lede{font-size:1.15rem;color:#4a3d43;margin:0}.meta{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;margin:1rem 0 0;padding:0;list-style:none;font:.9rem system-ui,sans-serif;color:#5d4f56}\
.chips{display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:0;list-style:none}.chips li{font:.9rem system-ui,sans-serif;background:#efe3e7;color:#4a2f3a;border-radius:999px;padding:.25rem .8rem}\
figure{margin:1.25rem 0}figure img{display:block;max-width:100%;height:auto;border:1px solid #d9c8ce;border-radius:6px}figcaption{font:.9rem system-ui,sans-serif;color:#5d4f56;margin-top:.4rem}\
.timeline{list-style:none;margin:0;padding:0 0 0 1.1rem;border-left:2px solid #d9c8ce}.timeline li{margin:0 0 .9rem;position:relative}.timeline li::before{content:'';position:absolute;left:-1.5rem;top:.6rem;width:.6rem;height:.6rem;border-radius:50%;background:#8c5a6a}\
.timeline time{display:block;font:.85rem system-ui,sans-serif;color:#5d4f56}footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #d9c8ce;font:.85rem system-ui,sans-serif;color:#6b5d63}\
a:focus-visible,img:focus-visible{outline:3px solid #8c5a6a;outline-offset:2px}\
@media print{body{background:#fff;font-size:11pt}main{padding:0}figure{break-inside:avoid}h2{break-after:avoid}}";

fn render(g: &Gathered, media: Media<'_>, images: &[LoadedImage]) -> (String, Vec<String>) {
    let mut included = vec!["Title and project type".to_string()];
    let mut h = String::new();
    let title = escape_html(&g.title);
    let _ = write!(
        h,
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'\">\n<meta name=\"referrer\" content=\"no-referrer\">\n<title>{title}</title>\n<style>{STYLE}</style>\n</head>\n<body>\n<main>\n<header>\n<p class=\"kicker\">{} · {}</p>\n<h1>{title}</h1>\n",
        escape_html(&g.discipline),
        escape_html(&g.project_type)
    );
    if !g.summary.trim().is_empty() {
        let _ = writeln!(h, "<p class=\"lede\">{}</p>", escape_html(g.summary.trim()));
        included.push("Professional summary".into());
    }
    let mut meta = Vec::new();
    if g.start.is_some() || g.target.is_some() {
        let period = match (&g.start, &g.target) {
            (Some(a), Some(b)) => format!("{a} to {b}"),
            (Some(a), None) => format!("Started {a}"),
            (None, Some(b)) => format!("Target {b}"),
            _ => String::new(),
        };
        meta.push(format!("<li>Period: {}</li>", escape_html(&period)));
        included.push("Project dates".into());
    }
    meta.push(format!(
        "<li>{}</li>",
        if g.study.team_kind == "team" {
            "Team project"
        } else {
            "Individual project"
        }
    ));
    let _ = writeln!(h, "<ul class=\"meta\">{}</ul>\n</header>", meta.join(""));

    let section = |h: &mut String, heading: &str, body: &str, included: &mut Vec<String>| {
        if !body.trim().is_empty() {
            let _ = write!(
                h,
                "<section>\n<h2>{}</h2>\n{}\n</section>\n",
                escape_html(heading),
                paragraphs(body)
            );
            included.push(heading.to_string());
        }
    };
    section(&mut h, "Background", &g.study.background, &mut included);
    section(
        &mut h,
        "Problem or design objective",
        &g.objectives,
        &mut included,
    );
    section(&mut h, "Scope of work", &g.study.scope, &mut included);
    section(
        &mut h,
        "Constraints and requirements",
        &g.study.constraints,
        &mut included,
    );
    section(&mut h, "My role", &g.role, &mut included);
    for (heading, list) in [
        ("Software used", &g.software),
        ("Skills practiced", &g.skills),
    ] {
        if !list.is_empty() {
            let items: String = list
                .iter()
                .map(|x| format!("<li>{}</li>", escape_html(x)))
                .collect();
            let _ = write!(
                h,
                "<section>\n<h2>{heading}</h2>\n<ul class=\"chips\">{items}</ul>\n</section>\n"
            );
            included.push(format!("{heading} ({})", list.len()));
        }
    }
    section(
        &mut h,
        "Technical approach",
        &g.study.approach,
        &mut included,
    );
    section(
        &mut h,
        "Design methodology",
        &g.study.methodology,
        &mut included,
    );
    section(&mut h, "Important decisions", &g.decisions, &mut included);
    section(
        &mut h,
        "Challenges encountered",
        &g.study.challenges,
        &mut included,
    );
    section(
        &mut h,
        "Solutions implemented",
        &g.study.solutions,
        &mut included,
    );
    section(&mut h, "Deliverables", &g.study.deliverables, &mut included);
    section(&mut h, "Outcomes", &g.study.outcomes, &mut included);
    section(&mut h, "Lessons learned", &g.lessons, &mut included);

    let shown: Vec<(usize, &GalleryRow)> = g
        .images
        .iter()
        .enumerate()
        .filter(|(i, _)| images.get(*i).is_some_and(Option::is_some))
        .collect();
    if !shown.is_empty() {
        h.push_str("<section>\n<h2>Project gallery</h2>\n");
        for (i, row) in &shown {
            let (bytes, kind) = images[*i].as_ref().expect("filtered");
            let src = match &media {
                Media::Embedded => format!("data:{};base64,{}", kind.mime(), base64(bytes)),
                Media::Relative(names) => {
                    format!("assets/{}", names[*i].clone().unwrap_or_default())
                }
            };
            let alt = if row.alt.trim().is_empty() {
                row.caption.trim()
            } else {
                row.alt.trim()
            };
            let _ = write!(
                h,
                "<figure><img src=\"{}\" alt=\"{}\" loading=\"lazy\">",
                escape_html(&src),
                escape_html(alt)
            );
            if !row.caption.trim().is_empty() {
                let _ = write!(
                    h,
                    "<figcaption>{}</figcaption>",
                    escape_html(row.caption.trim())
                );
            }
            h.push_str("</figure>\n");
        }
        h.push_str("</section>\n");
        included.push(format!("Gallery images ({})", shown.len()));
    }
    if !g.milestones.is_empty() {
        h.push_str("<section>\n<h2>Timeline</h2>\n<ol class=\"timeline\">\n");
        for (title, date, done) in &g.milestones {
            let _ = writeln!(
                h,
                "<li><time datetime=\"{d}\">{d}{}</time>{}</li>",
                if *done { " · completed" } else { "" },
                escape_html(title),
                d = escape_html(date)
            );
        }
        h.push_str("</ol>\n</section>\n");
        included.push(format!("Timeline milestones ({})", g.milestones.len()));
    }
    h.push_str("<footer>Project documentation prepared with CivilDesk. Descriptions are self-reported.</footer>\n</main>\n</body>\n</html>\n");
    (h, included)
}

fn build(c: &Connection, project_id: &str, embedded: bool) -> Result<(Gathered, Rendered), String> {
    let g = gather(c, project_id)?;
    let (images, mut warnings) = if embedded {
        load_images(
            &g.images,
            MAX_PREVIEW_IMAGE_BYTES,
            Some(MAX_PREVIEW_TOTAL_BYTES),
        )
    } else {
        load_images(&g.images, MAX_IMAGE_BYTES, None)
    };
    if g.summary.trim().is_empty() {
        warnings
            .push("Add a short professional summary so readers know what the project was.".into());
    }
    let names = asset_names(&images);
    let (html, included) = render(
        &g,
        if embedded {
            Media::Embedded
        } else {
            Media::Relative(&names)
        },
        &images,
    );
    Ok((
        g,
        Rendered {
            html,
            included,
            warnings,
            images,
        },
    ))
}
/// Deterministic asset names: `image-01.png`, `image-02.jpg`, ... in gallery order. User file names never reach disk
/// or HTML, so collisions and unsafe names cannot occur.
fn asset_names(images: &[LoadedImage]) -> Vec<Option<String>> {
    let mut n = 0;
    images
        .iter()
        .map(|i| {
            i.as_ref().map(|(_, kind)| {
                n += 1;
                format!("image-{n:02}.{}", kind.ext())
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------
// Export destination handling
// ---------------------------------------------------------------------------------------------------------------
fn validate_destination(dest: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dest.trim());
    if dest.trim().is_empty() || !path.is_absolute() {
        return Err("Choose an absolute destination folder".into());
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err("The destination folder cannot contain . or .. segments".into());
    }
    let text = path.to_string_lossy();
    if text.starts_with("\\\\.\\") || text.starts_with("\\\\?\\GLOBALROOT") {
        return Err("That destination is not a normal folder".into());
    }
    let meta = std::fs::symlink_metadata(&path)
        .map_err(|_| "The destination folder does not exist".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("The destination must be an existing, ordinary folder".into());
    }
    let resolved = path
        .canonicalize()
        .map_err(|_| "The destination folder cannot be used".to_string())?;
    Ok(plain_windows_path(resolved))
}
/// `canonicalize` returns the verbatim form (`\?\C:\...`) on Windows; show and use the ordinary drive path when one
/// exists. UNC and other verbatim forms are left untouched.
fn plain_windows_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

impl Database {
    pub fn portfolio(&self) -> Result<PortfolioData, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let studies = c
            .prepare("SELECT project_id,team_kind,background,scope,constraints,approach,methodology,challenges,solutions,deliverables,outcomes,created_at_ms,updated_at_ms FROM portfolio_case_studies")
            .map_err(sql)?
            .query_map([], row_to_study)
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)?;
        let tools = c
            .prepare("SELECT id,project_id,kind,name,skill_id,position FROM portfolio_tools ORDER BY project_id,kind,position")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(PortfolioTool { id: r.get(0)?, project_id: r.get(1)?, kind: r.get(2)?, name: r.get(3)?, skill_id: r.get(4)?, position: r.get(5)? })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)?;
        let gallery = c
            .prepare("SELECT g.id,g.project_id,g.file_id,g.caption,g.alt_text,g.position,f.display_name,f.path FROM portfolio_gallery g JOIN project_files f ON f.id=g.file_id ORDER BY g.project_id,g.position")
            .map_err(sql)?
            .query_map([], |r| {
                let path: String = r.get(7)?;
                Ok(GalleryItem {
                    id: r.get(0)?, project_id: r.get(1)?, file_id: r.get(2)?, caption: r.get(3)?, alt_text: r.get(4)?,
                    position: r.get(5)?, display_name: r.get(6)?,
                    missing: std::fs::symlink_metadata(&path).map(|m| !m.is_file()).unwrap_or(true),
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)?;
        let milestones = c
            .prepare("SELECT project_id,milestone_id FROM portfolio_milestones")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(MilestoneSelection {
                    project_id: r.get(0)?,
                    milestone_id: r.get(1)?,
                })
            })
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)?;
        Ok(PortfolioData {
            studies,
            tools,
            gallery,
            milestones,
        })
    }

    pub fn save_case_study(&self, i: CaseStudyInput) -> Result<(), String> {
        if i.project_id.is_empty()
            || !["individual", "team"].contains(&i.team_kind.as_str())
            || too_long(&[
                &i.background,
                &i.scope,
                &i.constraints,
                &i.approach,
                &i.methodology,
                &i.challenges,
                &i.solutions,
                &i.deliverables,
                &i.outcomes,
                &i.portfolio_summary,
                &i.objectives,
                &i.contributions,
                &i.decisions,
                &i.lessons,
            ])
        {
            return Err("Invalid case study details".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let now = now_ms();
        let updated = tx
            .execute(
                "UPDATE engineering_projects SET portfolio_summary=?2,objectives=?3,contributions=?4,decisions=?5,lessons=?6,updated_at_ms=?7 WHERE id=?1",
                params![i.project_id, i.portfolio_summary, i.objectives, i.contributions, i.decisions, i.lessons, now],
            )
            .map_err(sql)?;
        if updated == 0 {
            return Err("Project not found".into());
        }
        tx.execute(
            "INSERT INTO portfolio_case_studies(project_id,team_kind,background,scope,constraints,approach,methodology,challenges,solutions,deliverables,outcomes,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12) \
             ON CONFLICT(project_id) DO UPDATE SET team_kind=excluded.team_kind,background=excluded.background,scope=excluded.scope,constraints=excluded.constraints,approach=excluded.approach,methodology=excluded.methodology,challenges=excluded.challenges,solutions=excluded.solutions,deliverables=excluded.deliverables,outcomes=excluded.outcomes,updated_at_ms=excluded.updated_at_ms",
            params![i.project_id, i.team_kind, i.background, i.scope, i.constraints, i.approach, i.methodology, i.challenges, i.solutions, i.deliverables, i.outcomes, now],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    /// Replaces the project's presented software and skills. A tool never implies proficiency: it appears only
    /// because the user listed it here.
    pub fn set_portfolio_tools(
        &self,
        project_id: &str,
        tools: Vec<ToolInput>,
    ) -> Result<(), String> {
        if tools.len() > MAX_TOOLS
            || tools.iter().any(|t| {
                !["software", "skill"].contains(&t.kind.as_str())
                    || t.name.trim().is_empty()
                    || t.name.chars().count() > 100
            })
        {
            return Err("Invalid software or skill list".into());
        }
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM engineering_projects WHERE id=?1",
                [project_id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(sql)?
            > 0;
        if !exists {
            return Err("Project not found".into());
        }
        tx.execute(
            "DELETE FROM portfolio_tools WHERE project_id=?1",
            [project_id],
        )
        .map_err(sql)?;
        let now = now_ms();
        for (position, t) in tools.iter().enumerate() {
            let skill_id = match &t.skill_id {
                Some(id) => tx
                    .query_row("SELECT id FROM engineering_skills WHERE id=?1", [id], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()
                    .map_err(sql)?,
                None => None,
            };
            tx.execute(
                "INSERT OR IGNORE INTO portfolio_tools(id,project_id,kind,name,skill_id,position,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![format!("{project_id}:{}:{position}", t.kind), project_id, t.kind, t.name.trim(), skill_id, position as i64, now],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    pub fn set_portfolio_milestones(
        &self,
        project_id: &str,
        milestone_ids: Vec<String>,
    ) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        tx.execute(
            "DELETE FROM portfolio_milestones WHERE project_id=?1",
            [project_id],
        )
        .map_err(sql)?;
        for id in milestone_ids {
            let ok = tx.execute(
                "INSERT OR IGNORE INTO portfolio_milestones(project_id,milestone_id) SELECT ?1,id FROM project_milestones WHERE id=?2 AND project_id=?1",
                params![project_id, id],
            )
            .map_err(sql)?;
            if ok == 0 {
                let known: i64 = tx.query_row("SELECT COUNT(*) FROM portfolio_milestones WHERE project_id=?1 AND milestone_id=?2", params![project_id, id], |r| r.get(0)).map_err(sql)?;
                if known == 0 {
                    return Err("A selected milestone does not belong to this project".into());
                }
            }
        }
        tx.commit().map_err(sql)
    }

    /// Adds one image to the gallery. The file is validated, referenced by path (never copied or modified) and stored
    /// as an ordinary project file reference, so removing it from the gallery can never delete the original.
    pub fn add_gallery_image(&self, project_id: &str, path: &str) -> Result<(), String> {
        read_image(Path::new(path), MAX_IMAGE_BYTES)?;
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let exists: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM engineering_projects WHERE id=?1",
                [project_id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if exists == 0 {
            return Err("Project not found".into());
        }
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM portfolio_gallery WHERE project_id=?1",
                [project_id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if count >= MAX_GALLERY {
            return Err(format!("A gallery can hold up to {MAX_GALLERY} images"));
        }
        let now = now_ms();
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM project_files WHERE project_id=?1 AND path=?2",
                params![project_id, path],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        let file_id = match existing {
            Some(id) => id,
            None => {
                let id = format!("gallery-{project_id}-{now}-{count}");
                let name = Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Image")
                    .to_string();
                tx.execute(
                    "INSERT INTO project_files(id,project_id,display_name,path,category,description,added_at_ms) VALUES (?1,?2,?3,?4,'Portfolio image','',?5)",
                    params![id, project_id, name, path, now],
                )
                .map_err(sql)?;
                id
            }
        };
        let dup: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM portfolio_gallery WHERE project_id=?1 AND file_id=?2",
                params![project_id, file_id],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if dup > 0 {
            return Err("That image is already in the gallery".into());
        }
        tx.execute(
            "INSERT INTO portfolio_gallery(id,project_id,file_id,caption,alt_text,position,created_at_ms) VALUES (?1,?2,?3,'','',?4,?5)",
            params![format!("g-{project_id}-{now}-{count}"), project_id, file_id, count, now],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    pub fn save_gallery_item(&self, id: &str, caption: &str, alt_text: &str) -> Result<(), String> {
        if caption.chars().count() > 300 || alt_text.chars().count() > 500 {
            return Err(
                "Captions are limited to 300 characters and alternative text to 500".into(),
            );
        }
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute(
            "UPDATE portfolio_gallery SET caption=?2,alt_text=?3 WHERE id=?1",
            params![id, caption, alt_text],
        )
        .map_err(sql)?
            == 0
        {
            return Err("Gallery image not found".into());
        }
        Ok(())
    }

    pub fn reorder_gallery(&self, project_id: &str, ids: Vec<String>) -> Result<(), String> {
        let mut c = self.0.lock().map_err(|_| "database lock failed")?;
        let tx = c.transaction().map_err(sql)?;
        let mut current: Vec<String> = tx
            .prepare("SELECT id FROM portfolio_gallery WHERE project_id=?1")
            .map_err(sql)?
            .query_map([project_id], |r| r.get(0))
            .map_err(sql)?
            .collect::<rusqlite::Result<_>>()
            .map_err(sql)?;
        let mut requested = ids.clone();
        current.sort();
        requested.sort();
        if current != requested {
            return Err("The new order must list every gallery image exactly once".into());
        }
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE portfolio_gallery SET position=?2 WHERE id=?1",
                params![id, position as i64],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// Removes only the gallery entry. The project file reference and the original file on disk are untouched.
    pub fn remove_gallery_item(&self, id: &str) -> Result<(), String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        if c.execute("DELETE FROM portfolio_gallery WHERE id=?1", [id])
            .map_err(sql)?
            == 0
        {
            return Err("Gallery image not found".into());
        }
        Ok(())
    }

    /// Returns one validated gallery image as a data URL for in-app thumbnails (the CSP forbids file URLs).
    pub fn gallery_image_data(&self, id: &str) -> Result<String, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let path: String = c
            .query_row("SELECT f.path FROM portfolio_gallery g JOIN project_files f ON f.id=g.file_id WHERE g.id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(sql)?
            .ok_or("Gallery image not found")?;
        drop(c);
        let (bytes, kind) = read_image(Path::new(&path), MAX_PREVIEW_IMAGE_BYTES)?;
        Ok(format!("data:{};base64,{}", kind.mime(), base64(&bytes)))
    }

    pub fn preview_case_study(&self, project_id: &str) -> Result<PreviewResult, String> {
        let c = self.0.lock().map_err(|_| "database lock failed")?;
        let (_, r) = build(&c, project_id, true)?;
        Ok(PreviewResult {
            html: r.html,
            included: r.included,
            warnings: r.warnings,
        })
    }

    pub fn export_case_study(
        &self,
        project_id: &str,
        destination: &str,
        overwrite: bool,
    ) -> Result<ExportResult, String> {
        let dest = validate_destination(destination)?;
        let (title, rendered) = {
            let c = self.0.lock().map_err(|_| "database lock failed")?;
            let (g, r) = build(&c, project_id, false)?;
            (g.title, r)
        };
        let folder = dest.join(safe_folder_name(&title));
        if folder.parent().map(Path::to_path_buf) != Some(dest.clone()) {
            return Err("The export folder must be created directly inside the destination".into());
        }
        match std::fs::symlink_metadata(&folder) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    return Err(
                        "A file or shortcut with that name already exists in the destination"
                            .into(),
                    );
                }
                if !overwrite {
                    return Err(
                        "EXISTS: An export with this name already exists in the destination".into(),
                    );
                }
                if !folder.join(EXPORT_MARKER).is_file() {
                    return Err("That folder was not created by a CivilDesk export, so it will not be replaced".into());
                }
                std::fs::remove_dir_all(&folder)
                    .map_err(|e| format!("The previous export could not be replaced: {e}"))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("The destination could not be inspected: {e}")),
        }
        let write = || -> Result<Vec<String>, String> {
            let assets = folder.join("assets");
            std::fs::create_dir_all(&assets)
                .map_err(|e| format!("The export folder could not be created: {e}"))?;
            let mut files = vec!["index.html".to_string()];
            std::fs::write(folder.join(EXPORT_MARKER), "CivilDesk case-study export\n")
                .map_err(|e| e.to_string())?;
            std::fs::write(folder.join("index.html"), rendered.html.as_bytes())
                .map_err(|e| e.to_string())?;
            for name in asset_names(&rendered.images)
                .into_iter()
                .flatten()
                .zip(rendered.images.iter().flatten())
            {
                std::fs::write(assets.join(&name.0), &name.1 .0).map_err(|e| e.to_string())?;
                files.push(format!("assets/{}", name.0));
            }
            Ok(files)
        };
        match write() {
            Ok(files) => Ok(ExportResult {
                folder: folder.to_string_lossy().into_owned(),
                files,
                warnings: rendered.warnings,
            }),
            Err(e) => {
                let _ = std::fs::remove_dir_all(&folder);
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal valid headers; the renderer validates signatures, not full decodability.
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn database() -> (Database, PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "civildesk-portfolio-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (Database::open(&dir.join("test.sqlite3")).unwrap(), dir)
    }
    fn project(db: &Database, id: &str, title: &str) {
        let c = db.0.lock().unwrap();
        c.execute(
            "INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms,portfolio_summary,contributions,objectives) VALUES (?1,?2,'PRIVATE DESCRIPTION','Land Development','','Academic exercise','Planning',1,1,'A grading study','I drafted the sheets','Drain the site')",
            params![id, title],
        )
        .unwrap();
    }
    fn input(id: &str) -> CaseStudyInput {
        CaseStudyInput {
            project_id: id.into(),
            team_kind: "individual".into(),
            background: "Lot behind a school".into(),
            scope: String::new(),
            constraints: String::new(),
            approach: "Surface grading".into(),
            methodology: String::new(),
            challenges: String::new(),
            solutions: String::new(),
            deliverables: String::new(),
            outcomes: String::new(),
            portfolio_summary: "A grading study".into(),
            objectives: "Drain the site".into(),
            contributions: "I drafted the sheets".into(),
            decisions: String::new(),
            lessons: String::new(),
        }
    }
    fn image(dir: &Path, name: &str) -> String {
        let p = dir.join(name);
        std::fs::write(&p, PNG).unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn escapes_html_and_builds_safe_folder_names() {
        assert_eq!(
            escape_html("<script>alert('x')</script> & \"q\""),
            "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;"
        );
        for (title, expected) in [
            ("Site Grading: Phase 1", "Site-Grading-Phase-1"),
            ("../../Windows", "Windows"),
            ("CON", "case-study-CON"),
            ("???", "case-study"),
            ("a/b\\c", "a-b-c"),
        ] {
            assert_eq!(safe_folder_name(title), expected);
        }
        assert!(safe_folder_name(&"x".repeat(300)).len() <= 60);
    }

    #[test]
    fn verbatim_drive_prefix_is_removed_but_unc_is_kept() {
        assert_eq!(
            plain_windows_path(PathBuf::from(r"\\?\C:\Users\a")),
            PathBuf::from(r"C:\Users\a")
        );
        assert_eq!(
            plain_windows_path(PathBuf::from(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\?\UNC\srv\share")
        );
        assert_eq!(
            plain_windows_path(PathBuf::from("/tmp/x")),
            PathBuf::from("/tmp/x")
        );
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn validates_images_by_content_not_just_extension() {
        let (_db, dir) = database();
        let good = image(&dir, "plan.png");
        assert!(read_image(Path::new(&good), 1024).is_ok());
        let fake = dir.join("fake.png");
        std::fs::write(&fake, b"<svg onload=alert(1)>").unwrap();
        assert!(read_image(&fake, 1024).is_err());
        let svg = dir.join("art.svg");
        std::fs::write(&svg, b"<svg/>").unwrap();
        assert!(read_image(&svg, 1024).is_err());
        let renamed = dir.join("photo.jpg");
        std::fs::write(&renamed, PNG).unwrap();
        assert!(
            read_image(&renamed, 1024).is_err(),
            "PNG content under a .jpg name is refused"
        );
        assert!(read_image(&dir.join("missing.png"), 1024).is_err());
        assert!(read_image(Path::new("relative.png"), 1024).is_err());
        assert!(read_image(Path::new(&good), 4).is_err(), "size limit");
    }

    #[test]
    fn case_study_round_trip_updates_the_project_without_duplicating_it() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        assert!(db.portfolio().unwrap().studies.is_empty());
        let mut i = input("p1");
        i.team_kind = "team".into();
        i.lessons = "Check the survey datum".into();
        db.save_case_study(i).unwrap();
        db.save_case_study({
            let mut j = input("p1");
            j.outcomes = "Positive drainage".into();
            j
        })
        .unwrap();
        let data = db.portfolio().unwrap();
        assert_eq!(data.studies.len(), 1);
        assert_eq!(data.studies[0].outcomes, "Positive drainage");
        let projects = db.projects().unwrap();
        assert_eq!(
            projects.projects.len(),
            1,
            "no second project record is created"
        );
        assert_eq!(projects.projects[0].portfolio_summary, "A grading study");
        assert_eq!(
            projects.projects[0].description, "PRIVATE DESCRIPTION",
            "unrelated project fields are untouched"
        );
        assert!(db.save_case_study(input("ghost")).is_err());
        let mut bad = input("p1");
        bad.team_kind = "company".into();
        assert!(db.save_case_study(bad).is_err());
        let mut long = input("p1");
        long.scope = "x".repeat(MAX_TEXT + 1);
        assert!(db.save_case_study(long).is_err());
        drop(db);
        let reopened = Database::open(&dir.join("test.sqlite3")).unwrap();
        assert_eq!(
            reopened.portfolio().unwrap().studies[0].outcomes,
            "Positive drainage",
            "survives a restart"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tools_are_user_chosen_deduplicated_and_ordered() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        let t = |k: &str, n: &str| ToolInput {
            kind: k.into(),
            name: n.into(),
            skill_id: None,
        };
        db.set_portfolio_tools(
            "p1",
            vec![
                t("software", "Civil 3D"),
                t("software", "civil 3d"),
                t("skill", "Grading"),
                t("software", "Navisworks"),
            ],
        )
        .unwrap();
        let tools = db.portfolio().unwrap().tools;
        assert_eq!(
            tools.iter().filter(|x| x.kind == "software").count(),
            2,
            "case-insensitive duplicates collapse"
        );
        assert!(db
            .set_portfolio_tools("p1", vec![t("badge", "Expert")])
            .is_err());
        assert!(db
            .set_portfolio_tools("p1", vec![t("skill", "  ")])
            .is_err());
        assert!(db.set_portfolio_tools("ghost", vec![]).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gallery_adds_orders_captions_and_never_touches_the_source_file() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        let a = image(&dir, "a.png");
        let b = image(&dir, "b.png");
        db.add_gallery_image("p1", &a).unwrap();
        db.add_gallery_image("p1", &b).unwrap();
        assert!(
            db.add_gallery_image("p1", &a).is_err(),
            "no duplicate gallery entries"
        );
        assert!(db
            .add_gallery_image("p1", &dir.join("nope.png").to_string_lossy())
            .is_err());
        assert!(db.add_gallery_image("ghost", &a).is_err());
        let g = db.portfolio().unwrap().gallery;
        assert_eq!(g.len(), 2);
        db.save_gallery_item(&g[0].id, "Existing conditions", "Plan view of the lot")
            .unwrap();
        db.reorder_gallery("p1", vec![g[1].id.clone(), g[0].id.clone()])
            .unwrap();
        assert!(db.reorder_gallery("p1", vec![g[0].id.clone()]).is_err());
        let g = db.portfolio().unwrap().gallery;
        assert_eq!(g[1].caption, "Existing conditions");
        assert!(db
            .gallery_image_data(&g[0].id)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        db.remove_gallery_item(&g[1].id).unwrap();
        assert!(
            Path::new(&a).is_file(),
            "removing a gallery entry keeps the original file"
        );
        assert_eq!(
            db.projects().unwrap().files.len(),
            2,
            "the project file reference is kept too"
        );
        std::fs::remove_file(&b).unwrap();
        assert!(
            db.portfolio().unwrap().gallery[0].missing,
            "a deleted source is reported as missing"
        );
        assert!(db.gallery_image_data(&g[0].id).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn milestones_must_belong_to_the_project() {
        let (db, dir) = database();
        project(&db, "p1", "One");
        project(&db, "p2", "Two");
        db.save_milestone(crate::projects::Milestone {
            id: "m1".into(),
            project_id: "p1".into(),
            title: "Survey".into(),
            description: "PRIVATE NOTE".into(),
            target_date: "2026-09-01".into(),
            completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        db.set_portfolio_milestones("p1", vec!["m1".into()])
            .unwrap();
        assert!(db
            .set_portfolio_milestones("p2", vec!["m1".into()])
            .is_err());
        assert_eq!(db.portfolio().unwrap().milestones.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_contains_only_selected_content_and_no_private_data() {
        let (db, dir) = database();
        project(&db, "p1", "Grading <b>Study</b>");
        db.save_case_study({
            let mut i = input("p1");
            i.background = "Uses <script>alert(1)</script>".into();
            i
        })
        .unwrap();
        db.save_milestone(crate::projects::Milestone {
            id: "m1".into(),
            project_id: "p1".into(),
            title: "Survey".into(),
            description: "PRIVATE MILESTONE NOTE".into(),
            target_date: "2026-09-01".into(),
            completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        db.save_milestone(crate::projects::Milestone {
            id: "m2".into(),
            project_id: "p1".into(),
            title: "Unselected".into(),
            description: String::new(),
            target_date: "2026-09-02".into(),
            completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        db.set_portfolio_milestones("p1", vec!["m1".into()])
            .unwrap();
        db.save_journal(crate::projects::JournalEntry {
            id: "j1".into(),
            project_id: "p1".into(),
            title: "SECRET JOURNAL".into(),
            entry_date: "2026-09-01".into(),
            description: "SECRET".into(),
            work_completed: String::new(),
            problems: String::new(),
            solutions: String::new(),
            skills: String::new(),
            file_ids: vec![],
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        let sources = dir.join("sources");
        std::fs::create_dir_all(&sources).unwrap();
        let chosen = image(&sources, "Site Plan (final).png");
        let _unchosen = image(&sources, "private-scan.png");
        db.add_gallery_image("p1", &chosen).unwrap();
        let g = db.portfolio().unwrap().gallery;
        db.save_gallery_item(
            &g[0].id,
            "Plan <img src=x onerror=alert(1)>",
            "Site \"plan\"",
        )
        .unwrap();
        db.set_portfolio_tools(
            "p1",
            vec![ToolInput {
                kind: "software".into(),
                name: "Civil 3D".into(),
                skill_id: None,
            }],
        )
        .unwrap();
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let result = db
            .export_case_study("p1", &out.to_string_lossy(), false)
            .unwrap();
        let folder = PathBuf::from(&result.folder);
        assert_eq!(folder.file_name().unwrap(), "Grading-b-Study-b");
        let html = std::fs::read_to_string(folder.join("index.html")).unwrap();
        for private in [
            "PRIVATE DESCRIPTION",
            "PRIVATE MILESTONE NOTE",
            "SECRET",
            "Unselected",
            "private-scan",
            "Site Plan (final)",
            sources.to_string_lossy().as_ref(),
            "sqlite",
            "p1",
        ] {
            assert!(!html.contains(private), "export leaked {private}");
        }
        assert!(
            !html.contains("<script>alert") && !html.contains("<img src=x"),
            "untrusted text must be escaped"
        );
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(
            html.contains("src=\"assets/image-01.png\"")
                && html.contains("alt=\"Site &quot;plan&quot;\"")
        );
        assert!(!html.contains("<script"), "no scripts at all");
        assert!(
            html.contains("Civil 3D")
                && html.contains("Survey")
                && html.contains("A grading study")
        );
        assert_eq!(result.files, vec!["index.html", "assets/image-01.png"]);
        let mut listing: Vec<String> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        listing.sort();
        assert_eq!(listing, vec![".civildesk-export", "assets", "index.html"]);
        assert_eq!(
            std::fs::read_dir(folder.join("assets")).unwrap().count(),
            1,
            "only the selected image is copied"
        );
        // The package is portable: move it and the relative reference still resolves.
        let moved = dir.join("moved");
        std::fs::rename(&folder, &moved).unwrap();
        assert!(moved.join("assets/image-01.png").is_file());
        assert!(
            Path::new(&chosen).is_file(),
            "the source image is untouched"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_refuses_to_overwrite_unless_approved_and_ours() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let dest = out.to_string_lossy().into_owned();
        db.export_case_study("p1", &dest, false).unwrap();
        let err = db.export_case_study("p1", &dest, false).unwrap_err();
        assert!(err.starts_with("EXISTS"));
        db.save_case_study({
            let mut i = input("p1");
            i.background = "Second version".into();
            i
        })
        .unwrap();
        db.export_case_study("p1", &dest, true).unwrap();
        assert!(std::fs::read_to_string(out.join("Grading/index.html"))
            .unwrap()
            .contains("Second version"));
        // A folder that CivilDesk did not create is never deleted, even with approval.
        let stranger = out.join("Other");
        std::fs::create_dir_all(&stranger).unwrap();
        std::fs::write(stranger.join("keep.txt"), "mine").unwrap();
        project(&db, "p2", "Other");
        assert!(db.export_case_study("p2", &dest, true).is_err());
        assert!(stranger.join("keep.txt").is_file());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_destination_is_validated() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        for bad in [
            "",
            "relative/path",
            &format!("{}/../escape", dir.display()),
            &dir.join("missing").to_string_lossy(),
        ] {
            assert!(db.export_case_study("p1", bad, false).is_err(), "{bad:?}");
        }
        let file = dir.join("a-file");
        std::fs::write(&file, "x").unwrap();
        assert!(
            db.export_case_study("p1", &file.to_string_lossy(), false)
                .is_err(),
            "a file is not a folder"
        );
        assert!(db
            .export_case_study("ghost", &dir.to_string_lossy(), false)
            .is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_images_are_skipped_with_a_warning_and_preview_matches_export() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        let a = image(&dir, "a.png");
        db.add_gallery_image("p1", &a).unwrap();
        let preview = db.preview_case_study("p1").unwrap();
        assert!(preview.html.contains("data:image/png;base64,"));
        assert!(preview
            .included
            .iter()
            .any(|x| x.starts_with("Gallery images (1)")));
        std::fs::remove_file(&a).unwrap();
        let preview = db.preview_case_study("p1").unwrap();
        assert!(!preview.html.contains("data:image"));
        assert!(preview.warnings.iter().any(|w| w.contains("not included")));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let result = db
            .export_case_study("p1", &out.to_string_lossy(), false)
            .unwrap();
        assert_eq!(result.files, vec!["index.html"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Manual inspection helper: writes a realistic export so it can be opened in a browser. Does nothing unless
    /// `CIVILDESK_SAMPLE_EXPORT_DIR` (destination) and `CIVILDESK_SAMPLE_IMAGES` (semicolon-separated image paths) are set.
    #[test]
    fn sample_export_for_manual_inspection() {
        let (Ok(dest), Ok(images)) = (
            std::env::var("CIVILDESK_SAMPLE_EXPORT_DIR"),
            std::env::var("CIVILDESK_SAMPLE_IMAGES"),
        ) else {
            return;
        };
        let (db, dir) = database();
        project(&db, "p1", "Parking Lot Grading Study");
        let mut i = input("p1");
        i.team_kind = "team".into();
        i.background = "The lot behind the school ponded after storms.

Survey points were provided by the instructor."
            .into();
        i.scope = "Existing ground surface, proposed grading and a drainage layout.".into();
        i.constraints = "Maximum 5% slope; maintain the existing curb line.".into();
        i.approach =
            "Built an existing-ground surface and a proposed surface with a 1.5% minimum slope."
                .into();
        i.methodology = "Iterated the grading with feature lines and checked drainage with a catchment analysis.".into();
        i.challenges = "Low points near the entrance trapped water.".into();
        i.solutions = "Moved the high point and added a swale.".into();
        i.deliverables = "Plan sheet, profile sheet and a grading memo.".into();
        i.outcomes = "Positive drainage across the lot in the final model.".into();
        i.decisions = "Chose a swale over an inlet to keep the curb line.".into();
        i.lessons = "Check the survey datum before building surfaces.".into();
        db.save_case_study(i).unwrap();
        db.set_portfolio_tools(
            "p1",
            vec![
                ToolInput {
                    kind: "software".into(),
                    name: "Civil 3D".into(),
                    skill_id: None,
                },
                ToolInput {
                    kind: "software".into(),
                    name: "AutoCAD".into(),
                    skill_id: None,
                },
                ToolInput {
                    kind: "skill".into(),
                    name: "Grading".into(),
                    skill_id: None,
                },
                ToolInput {
                    kind: "skill".into(),
                    name: "Site planning".into(),
                    skill_id: None,
                },
            ],
        )
        .unwrap();
        for (n, img) in images.split(';').filter(|x| !x.is_empty()).enumerate() {
            db.add_gallery_image("p1", img).unwrap();
            let g = db.portfolio().unwrap().gallery;
            db.save_gallery_item(
                &g[n].id,
                &format!("Figure {}", n + 1),
                &format!("Sample figure {}", n + 1),
            )
            .unwrap();
        }
        db.save_milestone(crate::projects::Milestone {
            id: "m1".into(),
            project_id: "p1".into(),
            title: "Survey received".into(),
            description: String::new(),
            target_date: "2026-09-10".into(),
            completed_at_ms: Some(1),
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        db.save_milestone(crate::projects::Milestone {
            id: "m2".into(),
            project_id: "p1".into(),
            title: "Final sheets issued".into(),
            description: String::new(),
            target_date: "2026-10-12".into(),
            completed_at_ms: None,
            created_at_ms: 0,
            updated_at_ms: 0,
        })
        .unwrap();
        db.set_portfolio_milestones("p1", vec!["m1".into(), "m2".into()])
            .unwrap();
        let result = db.export_case_study("p1", &dest, true).unwrap();
        println!("sample export written to {}", result.folder);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_a_project_cascades_portfolio_data_and_nothing_else() {
        let (db, dir) = database();
        project(&db, "p1", "Grading");
        project(&db, "p2", "Keep");
        db.save_case_study(input("p1")).unwrap();
        db.save_case_study(input("p2")).unwrap();
        db.0.lock()
            .unwrap()
            .execute("DELETE FROM engineering_projects WHERE id='p1'", [])
            .unwrap();
        let data = db.portfolio().unwrap();
        assert_eq!(data.studies.len(), 1);
        assert_eq!(data.studies[0].project_id, "p2");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn migration_from_v8_adds_portfolio_tables_and_preserves_data() {
        let dir =
            std::env::temp_dir().join(format!("civildesk-portfolio-mig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("v8.sqlite3");
        {
            let c = Connection::open(&path).unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();
            // Build a v8-shaped database: the application's own migrations, with the v9 additions taken away again.
            crate::persistence::migrate(&c).unwrap();
            c.execute_batch("DROP TABLE notion_sources; DROP TABLE notion_connection; DROP INDEX portfolio_gallery_order; DROP TABLE portfolio_milestones; DROP TABLE portfolio_gallery; DROP TABLE portfolio_tools; DROP TABLE portfolio_case_studies; PRAGMA user_version = 8;").unwrap();
            c.execute("INSERT INTO engineering_projects(id,title,description,discipline,category,project_type,status,created_at_ms,updated_at_ms) VALUES ('old','Old project','kept','Land Development','','Academic exercise','Planning',1,1)", []).unwrap();
            let v: u32 = c
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap();
            assert_eq!(v, 8);
        }
        let db = Database::open(&path).unwrap();
        let c = db.0.lock().unwrap();
        let v: u32 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 10);
        let title: String = c
            .query_row(
                "SELECT title FROM engineering_projects WHERE id='old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Old project");
        let integrity: String = c
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
        let violations: i64 = c
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count() as i64;
        assert_eq!(violations, 0);
        drop(c);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
