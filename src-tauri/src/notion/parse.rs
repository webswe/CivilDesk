//! Turns Notion API JSON into small, sanitized, display-only structures. Notion content is untrusted:
//! everything becomes plain text, control characters are stripped, lengths are capped, and nothing is
//! passed through as HTML, a URL to load, or an attachment to fetch.

use super::client::normalize_id;
use super::client::NotionError;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

const NAME_MAX: usize = 200;
const CELL_MAX: usize = 300;
const BLOCK_MAX: usize = 2000;
const MAX_CELLS: usize = 8;

fn clean(text: &str, max: usize, keep_newlines: bool) -> String {
    let mut out: String = text
        .chars()
        .filter(|c| !c.is_control() || (keep_newlines && (*c == '\n')))
        .map(|c| {
            if !keep_newlines && c == '\u{2028}' {
                ' '
            } else {
                c
            }
        })
        .collect();
    if out.chars().count() > max {
        out = out.chars().take(max).collect::<String>() + "\u{2026}";
    }
    out.trim().to_string()
}

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn plain(rich: &Value) -> String {
    rich.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|i| s(i, "plain_text"))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn is_trashed(v: &Value) -> bool {
    v.get("in_trash").and_then(Value::as_bool).unwrap_or(false)
        || v.get("is_archived")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        || v.get("archived").and_then(Value::as_bool).unwrap_or(false)
}

/// Only a single emoji-like icon is surfaced; external or file icons are never loaded.
fn emoji_icon(v: &Value) -> Option<String> {
    let icon = v.get("icon")?;
    if s(icon, "type") != Some("emoji") {
        return None;
    }
    Some(clean(s(icon, "emoji")?, 8, false)).filter(|e| !e.is_empty())
}

fn page_title(page: &Value) -> Option<String> {
    let props = page.get("properties")?.as_object()?;
    props
        .values()
        .find(|p| s(p, "type") == Some("title"))
        .map(|p| clean(&plain(&p["title"]), NAME_MAX, false))
        .filter(|t| !t.is_empty())
}

// ------------------------------------------------------------------ connection identity

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotInfo {
    pub bot_name: Option<String>,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
}

pub fn parse_me(v: &Value) -> Result<BotInfo, NotionError> {
    if s(v, "object") != Some("user") || s(v, "type") != Some("bot") {
        return Err(NotionError::invalid_response());
    }
    let bot = v.get("bot");
    let text = |o: Option<&Value>, k: &str| {
        o.and_then(|o| s(o, k))
            .map(|t| clean(t, NAME_MAX, false))
            .filter(|t| !t.is_empty())
    };
    Ok(BotInfo {
        bot_name: text(Some(v), "name"),
        workspace_id: text(bot, "workspace_id"),
        workspace_name: text(bot, "workspace_name"),
    })
}

// ------------------------------------------------------------------ discovery

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub id: String,
    pub resource_type: String,
    pub name: String,
    pub untitled: bool,
    pub database_id: Option<String>,
    pub last_edited: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPage {
    pub items: Vec<ResourceSummary>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub incomplete: bool,
}

fn list_meta(v: &Value) -> (Option<String>, bool, bool) {
    let has_more = v.get("has_more").and_then(Value::as_bool).unwrap_or(false);
    let next = s(v, "next_cursor").map(str::to_string).filter(|_| has_more);
    let incomplete = v.get("request_status").and_then(|r| s(r, "type")) == Some("incomplete");
    let more = next.is_some();
    (next, more, incomplete)
}

pub fn parse_resource(item: &Value) -> Option<ResourceSummary> {
    let kind = s(item, "object")?;
    if kind != "page" && kind != "data_source" {
        return None;
    }
    let id = normalize_id(s(item, "id")?).ok()?;
    if is_trashed(item) {
        return None;
    }
    let (name, database_id) = if kind == "page" {
        (page_title(item), None)
    } else {
        let t = item
            .get("title")
            .map(plain)
            .map(|t| clean(&t, NAME_MAX, false))
            .filter(|t| !t.is_empty());
        let db = item
            .get("parent")
            .and_then(|p| s(p, "database_id"))
            .and_then(|d| normalize_id(d).ok());
        (t, db)
    };
    let untitled = name.is_none();
    Some(ResourceSummary {
        id,
        resource_type: kind.to_string(),
        name: name.unwrap_or_else(|| {
            if kind == "page" {
                "Untitled page".into()
            } else {
                "Untitled data source".into()
            }
        }),
        untitled,
        database_id,
        last_edited: s(item, "last_edited_time").map(|t| clean(t, 40, false)),
        icon: emoji_icon(item),
    })
}

pub fn parse_search(v: &Value) -> Result<DiscoveryPage, NotionError> {
    let results = v
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(NotionError::invalid_response)?;
    let mut seen = HashSet::new();
    let items = results
        .iter()
        .filter_map(parse_resource)
        .filter(|r| seen.insert(r.id.clone()))
        .collect();
    let (next_cursor, has_more, incomplete) = list_meta(v);
    Ok(DiscoveryPage {
        items,
        next_cursor,
        has_more,
        incomplete,
    })
}

// ------------------------------------------------------------------ databases and data sources

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseView {
    pub id: String,
    pub name: String,
    pub data_sources: Vec<DataSourceRef>,
}

pub fn parse_database(v: &Value) -> Result<DatabaseView, NotionError> {
    if s(v, "object") != Some("database") {
        return Err(NotionError::invalid_response());
    }
    let id = normalize_id(s(v, "id").unwrap_or_default())?;
    let name = v
        .get("title")
        .map(plain)
        .map(|t| clean(&t, NAME_MAX, false))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled database".into());
    let mut seen = HashSet::new();
    let data_sources = v
        .get("data_sources")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|d| {
                    let id = normalize_id(s(d, "id")?).ok()?;
                    seen.insert(id.clone()).then(|| DataSourceRef {
                        id,
                        name: clean(s(d, "name").unwrap_or(""), NAME_MAX, false),
                    })
                })
                .map(|mut d| {
                    if d.name.is_empty() {
                        d.name = "Untitled data source".into();
                    }
                    d
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(DatabaseView {
        id,
        name,
        data_sources,
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PropertySchema {
    pub name: String,
    pub kind: String,
    pub options: Vec<String>,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceView {
    pub id: String,
    pub name: String,
    pub untitled: bool,
    pub database_id: Option<String>,
    pub properties: Vec<PropertySchema>,
}

/// Property kinds the preview renders as real values. Every other kind is shown as "unsupported", never as blank.
const SUPPORTED: &[&str] = &[
    "title",
    "rich_text",
    "number",
    "select",
    "multi_select",
    "status",
    "date",
    "checkbox",
    "url",
    "email",
    "phone_number",
    "created_time",
    "last_edited_time",
    "unique_id",
    "people",
    "created_by",
    "last_edited_by",
    "formula",
    "relation",
    "files",
];

pub fn parse_data_source(v: &Value) -> Result<DataSourceView, NotionError> {
    if s(v, "object") != Some("data_source") {
        return Err(NotionError::invalid_response());
    }
    let id = normalize_id(s(v, "id").unwrap_or_default())?;
    let title = v
        .get("title")
        .map(plain)
        .map(|t| clean(&t, NAME_MAX, false))
        .filter(|t| !t.is_empty());
    let mut properties: Vec<PropertySchema> = v
        .get("properties")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(name, p)| {
                    let kind = s(p, "type").unwrap_or("unknown").to_string();
                    let options = p
                        .get(&kind)
                        .and_then(|c| c.get("options"))
                        .and_then(Value::as_array)
                        .map(|o| {
                            o.iter()
                                .filter_map(|x| s(x, "name"))
                                .map(|n| clean(n, 80, false))
                                .take(50)
                                .collect()
                        })
                        .unwrap_or_default();
                    PropertySchema {
                        name: clean(name, NAME_MAX, false),
                        supported: SUPPORTED.contains(&kind.as_str()),
                        kind,
                        options,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    properties.sort_by_key(|p| (p.kind != "title", p.name.to_lowercase()));
    Ok(DataSourceView {
        id,
        untitled: title.is_none(),
        name: title.unwrap_or_else(|| "Untitled data source".into()),
        database_id: v
            .get("parent")
            .and_then(|p| s(p, "database_id"))
            .and_then(|d| normalize_id(d).ok()),
        properties,
    })
}

// ------------------------------------------------------------------ property values

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub name: String,
    pub kind: String,
    pub text: String,
    pub tags: Vec<String>,
    pub empty: bool,
    pub supported: bool,
}

fn date_text(d: &Value) -> String {
    if d.is_null() {
        return String::new();
    }
    let start = s(d, "start").unwrap_or("");
    match s(d, "end") {
        Some(end) if !end.is_empty() => format!("{start} \u{2192} {end}"),
        _ => start.to_string(),
    }
}

fn number_text(n: &Value) -> String {
    n.as_f64()
        .map(|f| {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", f as i64)
            } else {
                format!("{f}")
            }
        })
        .unwrap_or_default()
}

fn people_text(list: &Value) -> String {
    let arr = list.as_array().cloned().unwrap_or_default();
    let names: Vec<String> = arr
        .iter()
        .filter_map(|p| s(p, "name"))
        .map(|n| clean(n, 80, false))
        .filter(|n| !n.is_empty())
        .collect();
    if names.len() == arr.len() && !names.is_empty() {
        names.join(", ")
    } else if arr.is_empty() {
        String::new()
    } else {
        format!(
            "{} {}",
            arr.len(),
            if arr.len() == 1 { "person" } else { "people" }
        )
    }
}

pub fn parse_cell(name: &str, prop: &Value) -> Cell {
    let kind = s(prop, "type").unwrap_or("unknown").to_string();
    let value = prop.get(&kind).cloned().unwrap_or(Value::Null);
    let mut tags = Vec::new();
    let mut supported = SUPPORTED.contains(&kind.as_str());
    let mut text = match kind.as_str() {
        "title" | "rich_text" => plain(&value),
        "number" => number_text(&value),
        "select" | "status" => s(&value, "name").unwrap_or("").to_string(),
        "multi_select" => {
            tags = value
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|o| s(o, "name"))
                        .map(|n| clean(n, 60, false))
                        .collect()
                })
                .unwrap_or_default();
            String::new()
        }
        "date" => date_text(&value),
        "checkbox" => value
            .as_bool()
            .map(|b| {
                if b {
                    "Yes".to_string()
                } else {
                    "No".to_string()
                }
            })
            .unwrap_or_default(),
        "url" | "email" | "phone_number" | "created_time" | "last_edited_time" => {
            value.as_str().unwrap_or("").to_string()
        }
        "unique_id" => format!(
            "{}{}",
            s(&value, "prefix")
                .map(|p| format!("{p}-"))
                .unwrap_or_default(),
            value.get("number").map(number_text).unwrap_or_default()
        )
        .trim_end_matches('-')
        .to_string(),
        "people" | "created_by" | "last_edited_by" => people_text(&if value.is_array() {
            value
        } else {
            Value::Array(vec![value])
        }),
        "formula" => match s(&value, "type") {
            Some("string") => s(&value, "string").unwrap_or("").to_string(),
            Some("number") => value.get("number").map(number_text).unwrap_or_default(),
            Some("boolean") => value
                .get("boolean")
                .and_then(Value::as_bool)
                .map(|b| {
                    if b {
                        "Yes".to_string()
                    } else {
                        "No".to_string()
                    }
                })
                .unwrap_or_default(),
            Some("date") => value.get("date").map(date_text).unwrap_or_default(),
            _ => {
                supported = false;
                String::new()
            }
        },
        "relation" => {
            let n = value.as_array().map(Vec::len).unwrap_or(0);
            if n == 0 {
                String::new()
            } else {
                format!("{n} linked {}", if n == 1 { "item" } else { "items" })
            }
        }
        "files" => {
            let n = value.as_array().map(Vec::len).unwrap_or(0);
            if n == 0 {
                String::new()
            } else {
                format!(
                    "{n} {} (not downloaded)",
                    if n == 1 { "file" } else { "files" }
                )
            }
        }
        _ => String::new(),
    };
    if !supported {
        text = format!("Unsupported property type ({})", clean(&kind, 40, false));
    }
    let text = clean(&text, CELL_MAX, false);
    let empty = supported && text.is_empty() && tags.is_empty();
    Cell {
        name: clean(name, NAME_MAX, false),
        kind,
        text,
        tags,
        empty,
        supported,
    }
}

// ------------------------------------------------------------------ entries and pages

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRow {
    pub id: String,
    pub title: String,
    pub last_edited: Option<String>,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntriesPage {
    pub rows: Vec<EntryRow>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub incomplete: bool,
}

fn cells_for(page: &Value) -> Vec<Cell> {
    let Some(props) = page.get("properties").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut cells: Vec<Cell> = props
        .iter()
        .map(|(n, p)| parse_cell(n, p))
        .filter(|c| c.kind != "title")
        .collect();
    cells.sort_by_key(|c| (!c.supported, c.name.to_lowercase()));
    cells.truncate(MAX_CELLS - 1);
    cells
}

pub fn parse_entries(v: &Value) -> Result<EntriesPage, NotionError> {
    let results = v
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(NotionError::invalid_response)?;
    let mut seen = HashSet::new();
    let rows = results
        .iter()
        .filter(|p| s(p, "object") == Some("page") && !is_trashed(p))
        .filter_map(|p| {
            let id = normalize_id(s(p, "id")?).ok()?;
            seen.insert(id.clone()).then(|| EntryRow {
                id,
                title: page_title(p).unwrap_or_else(|| "Untitled".into()),
                last_edited: s(p, "last_edited_time").map(|t| clean(t, 40, false)),
                cells: cells_for(p),
            })
        })
        .collect();
    let (next_cursor, has_more, incomplete) = list_meta(v);
    Ok(EntriesPage {
        rows,
        next_cursor,
        has_more,
        incomplete,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageView {
    pub id: String,
    pub title: String,
    pub untitled: bool,
    pub created: Option<String>,
    pub last_edited: Option<String>,
    pub parent_kind: String,
    pub properties: Vec<Cell>,
}

pub fn parse_page(v: &Value) -> Result<PageView, NotionError> {
    if s(v, "object") != Some("page") {
        return Err(NotionError::invalid_response());
    }
    let id = normalize_id(s(v, "id").unwrap_or_default())?;
    let title = page_title(v);
    Ok(PageView {
        id,
        untitled: title.is_none(),
        title: title.unwrap_or_else(|| "Untitled page".into()),
        created: s(v, "created_time").map(|t| clean(t, 40, false)),
        last_edited: s(v, "last_edited_time").map(|t| clean(t, 40, false)),
        parent_kind: v
            .get("parent")
            .and_then(|p| s(p, "type"))
            .map(|t| clean(t, 40, false))
            .unwrap_or_else(|| "unknown".into()),
        properties: cells_for(v),
    })
}

// ------------------------------------------------------------------ blocks

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockView {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub checked: Option<bool>,
    pub language: Option<String>,
    pub has_children: bool,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlocksPage {
    pub blocks: Vec<BlockView>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

pub fn parse_block(b: &Value) -> Option<BlockView> {
    let id = normalize_id(s(b, "id")?).ok()?;
    if is_trashed(b) {
        return None;
    }
    let kind = s(b, "type").unwrap_or("unsupported").to_string();
    let body = b.get(&kind).cloned().unwrap_or(Value::Null);
    let rich = |k: &str| clean(&plain(body.get(k).unwrap_or(&Value::Null)), BLOCK_MAX, true);
    let mut checked = None;
    let mut language = None;
    let mut supported = true;
    let text = match kind.as_str() {
        "paragraph" | "heading_1" | "heading_2" | "heading_3" | "heading_4"
        | "bulleted_list_item" | "numbered_list_item" | "quote" | "toggle" | "callout" => {
            rich("rich_text")
        }
        "to_do" => {
            checked = body.get("checked").and_then(Value::as_bool);
            rich("rich_text")
        }
        "code" => {
            language = s(&body, "language").map(|l| clean(l, 40, false));
            rich("rich_text")
        }
        "equation" => clean(s(&body, "expression").unwrap_or(""), BLOCK_MAX, false),
        "divider" => String::new(),
        "child_page" | "child_database" => clean(s(&body, "title").unwrap_or(""), NAME_MAX, false),
        // Links are shown as inert text. Attachments and embeds are never fetched or rendered.
        "bookmark" | "embed" | "link_preview" => {
            clean(s(&body, "url").unwrap_or(""), CELL_MAX, false)
        }
        "image" | "file" | "pdf" | "video" | "audio" => {
            let caption = rich("caption");
            format!(
                "Attachment not downloaded{}",
                if caption.is_empty() {
                    String::new()
                } else {
                    format!(": {caption}")
                }
            )
        }
        _ => {
            supported = false;
            format!("Unsupported block ({})", clean(&kind, 40, false))
        }
    };
    Some(BlockView {
        id,
        kind,
        text,
        checked,
        language,
        has_children: b
            .get("has_children")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        supported,
    })
}

pub fn parse_blocks(v: &Value) -> Result<BlocksPage, NotionError> {
    let results = v
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(NotionError::invalid_response)?;
    let blocks = results.iter().filter_map(parse_block).collect();
    let (next_cursor, has_more, _) = list_meta(v);
    Ok(BlocksPage {
        blocks,
        next_cursor,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const A: &str = "11111111-1111-1111-1111-111111111111";
    const B: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn me_parses_identity_without_inventing_fields() {
        let v = json!({"object":"user","id":A,"type":"bot","name":"CivilDesk Dev","bot":{"owner":{"type":"workspace","workspace":true},"workspace_id":B,"workspace_name":"Lab","workspace_limits":{"max_file_upload_size_in_bytes":5242880}}});
        let me = parse_me(&v).unwrap();
        assert_eq!(me.workspace_name.as_deref(), Some("Lab"));
        let empty_bot = parse_me(&json!({"object":"user","id":A,"type":"bot","bot":{}})).unwrap();
        assert_eq!(
            empty_bot,
            BotInfo {
                bot_name: None,
                workspace_id: None,
                workspace_name: None
            }
        );
        assert!(parse_me(&json!({"object":"user","type":"person"})).is_err());
        assert!(parse_me(&json!({"object":"error"})).is_err());
    }

    #[test]
    fn search_distinguishes_pages_and_data_sources_and_dedupes() {
        let v = json!({"object":"list","type":"page_or_data_source","has_more":true,"next_cursor":"cur-2","results":[
            {"object":"page","id":A,"last_edited_time":"2026-01-01T00:00:00.000Z","icon":{"type":"emoji","emoji":"📘"},"parent":{"type":"workspace"},"properties":{"Name":{"type":"title","title":[{"plain_text":"Notes"}]}}},
            {"object":"data_source","id":B,"title":[{"plain_text":"Assignments"}],"parent":{"type":"database_id","database_id":"33333333333333333333333333333333"},"properties":{}},
            {"object":"page","id":A,"properties":{}},
            {"object":"data_source","id":"44444444-4444-4444-4444-444444444444","title":[],"properties":{}},
            {"object":"page","id":"55555555-5555-5555-5555-555555555555","in_trash":true,"properties":{}},
            {"object":"database","id":"66666666-6666-6666-6666-666666666666"},
            {"object":"page","id":"not-an-id"},
            {"object":"page","id":"77777777-7777-7777-7777-777777777777"}
        ]});
        let p = parse_search(&v).unwrap();
        let names: Vec<_> = p
            .items
            .iter()
            .map(|i| (i.resource_type.as_str(), i.name.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                ("page", "Notes"),
                ("data_source", "Assignments"),
                ("data_source", "Untitled data source"),
                ("page", "Untitled page")
            ]
        );
        assert_eq!(p.items[0].icon.as_deref(), Some("📘"));
        assert_eq!(
            p.items[1].database_id.as_deref(),
            Some("33333333-3333-3333-3333-333333333333")
        );
        assert!(p.items[2].untitled);
        assert!(p.has_more);
        assert_eq!(p.next_cursor.as_deref(), Some("cur-2"));
    }

    #[test]
    fn search_last_page_and_incomplete_status() {
        let v = json!({"object":"list","results":[],"has_more":false,"next_cursor":null,"request_status":{"type":"incomplete","incomplete_reason":"query_result_limit_reached"}});
        let p = parse_search(&v).unwrap();
        assert!(!p.has_more && p.next_cursor.is_none() && p.incomplete && p.items.is_empty());
        assert!(parse_search(&json!({"object":"list"})).is_err());
    }

    #[test]
    fn database_lists_its_data_sources_separately_from_its_own_id() {
        let v = json!({"object":"database","id":A,"title":[{"plain_text":"Coursework"}],"data_sources":[{"id":B,"name":"Main"},{"id":B,"name":"dup"},{"id":"44444444444444444444444444444444","name":""}]});
        let d = parse_database(&v).unwrap();
        assert_eq!(d.id, A);
        assert_eq!(d.data_sources.len(), 2);
        assert_eq!(
            d.data_sources[0],
            DataSourceRef {
                id: B.into(),
                name: "Main".into()
            }
        );
        assert_eq!(d.data_sources[1].name, "Untitled data source");
        assert_ne!(d.id, d.data_sources[0].id);
        assert!(parse_database(&json!({"object":"data_source","id":A})).is_err());
    }

    #[test]
    fn data_source_schema_lists_properties_and_flags_unsupported() {
        let v = json!({"object":"data_source","id":B,"title":[{"plain_text":"Assignments"}],"parent":{"type":"database_id","database_id":A},"properties":{
            "Name":{"id":"title","type":"title","title":{}},
            "Status":{"type":"status","status":{"options":[{"name":"Todo"},{"name":"Done"}],"groups":[]}},
            "Tags":{"type":"multi_select","multi_select":{"options":[{"name":"Lab"}]}},
            "Rollup":{"type":"rollup","rollup":{}},
            "Go":{"type":"button","button":{}}
        }});
        let d = parse_data_source(&v).unwrap();
        assert_eq!(d.database_id.as_deref(), Some(A));
        assert_eq!(d.properties[0].kind, "title");
        let status = d.properties.iter().find(|p| p.name == "Status").unwrap();
        assert_eq!(status.options, vec!["Todo", "Done"]);
        assert!(
            !d.properties
                .iter()
                .find(|p| p.name == "Go")
                .unwrap()
                .supported
        );
        assert!(
            !d.properties
                .iter()
                .find(|p| p.name == "Rollup")
                .unwrap()
                .supported
        );
    }

    #[test]
    fn cells_render_supported_types() {
        let c = |p: Value| parse_cell("P", &p);
        assert_eq!(
            c(json!({"type":"rich_text","rich_text":[{"plain_text":"a"},{"plain_text":"b"}]})).text,
            "ab"
        );
        assert_eq!(c(json!({"type":"number","number":3.0})).text, "3");
        assert_eq!(c(json!({"type":"number","number":2.5})).text, "2.5");
        assert_eq!(
            c(json!({"type":"select","select":{"name":"High"}})).text,
            "High"
        );
        assert_eq!(
            c(json!({"type":"status","status":{"name":"Done"}})).text,
            "Done"
        );
        assert_eq!(
            c(json!({"type":"multi_select","multi_select":[{"name":"x"},{"name":"y"}]})).tags,
            vec!["x", "y"]
        );
        assert_eq!(
            c(json!({"type":"date","date":{"start":"2026-02-01","end":"2026-02-03"}})).text,
            "2026-02-01 \u{2192} 2026-02-03"
        );
        assert_eq!(c(json!({"type":"checkbox","checkbox":true})).text, "Yes");
        assert_eq!(
            c(json!({"type":"unique_id","unique_id":{"prefix":"TASK","number":7}})).text,
            "TASK-7"
        );
        assert_eq!(
            c(json!({"type":"people","people":[{"name":"Ada"},{"name":"Lin"}]})).text,
            "Ada, Lin"
        );
        assert_eq!(
            c(json!({"type":"people","people":[{"id":A},{"id":B}]})).text,
            "2 people"
        );
        assert_eq!(
            c(json!({"type":"relation","relation":[{"id":A}]})).text,
            "1 linked item"
        );
        assert_eq!(
            c(json!({"type":"files","files":[{"name":"x"}]})).text,
            "1 file (not downloaded)"
        );
        assert_eq!(
            c(json!({"type":"formula","formula":{"type":"number","number":4}})).text,
            "4"
        );
    }

    #[test]
    fn empty_and_unsupported_values_are_distinguished() {
        let empty = parse_cell("D", &json!({"type":"date","date":null}));
        assert!(empty.empty && empty.supported);
        let unsupported = parse_cell(
            "R",
            &json!({"type":"rollup","rollup":{"type":"number","number":4}}),
        );
        assert!(!unsupported.supported && !unsupported.empty);
        assert_eq!(unsupported.text, "Unsupported property type (rollup)");
        let weird = parse_cell("W", &json!({"type":"brand_new_type","brand_new_type":{}}));
        assert!(!weird.supported && !weird.empty);
        let formula = parse_cell("F", &json!({"type":"formula","formula":{"type":"weird"}}));
        assert!(!formula.supported);
    }

    #[test]
    fn entries_page_has_title_cells_and_cursor() {
        let v = json!({"object":"list","has_more":true,"next_cursor":"n1","results":[
            {"object":"page","id":A,"last_edited_time":"2026-03-01T00:00:00.000Z","properties":{"Name":{"type":"title","title":[{"plain_text":"Lab 3"}]},"Due":{"type":"date","date":{"start":"2026-03-05"}},"Status":{"type":"status","status":{"name":"Todo"}}}},
            {"object":"page","id":B,"properties":{}}
        ]});
        let e = parse_entries(&v).unwrap();
        assert_eq!(e.rows.len(), 2);
        assert_eq!(e.rows[0].title, "Lab 3");
        assert_eq!(e.rows[0].cells.len(), 2);
        assert_eq!(e.rows[1].title, "Untitled");
        assert!(e.has_more);
    }

    #[test]
    fn page_view_reads_title_and_properties() {
        let v = json!({"object":"page","id":A,"created_time":"2026-01-01T00:00:00.000Z","parent":{"type":"data_source_id"},"properties":{"Name":{"type":"title","title":[{"plain_text":"Spec"}]},"Notes":{"type":"rich_text","rich_text":[]}}});
        let p = parse_page(&v).unwrap();
        assert_eq!(p.title, "Spec");
        assert_eq!(p.parent_kind, "data_source_id");
        assert!(p.properties[0].empty);
        assert!(parse_page(&json!({"object":"block","id":A})).is_err());
    }

    #[test]
    fn blocks_are_plain_text_with_graceful_unsupported_types() {
        let rt = |t: &str| json!({"rich_text":[{"plain_text":t}]});
        let v = json!({"object":"list","has_more":false,"next_cursor":null,"results":[
            {"object":"block","id":A,"type":"heading_1","heading_1":rt("Title")},
            {"object":"block","id":B,"type":"to_do","to_do":{"rich_text":[{"plain_text":"Task"}],"checked":true}},
            {"object":"block","id":"33333333-3333-3333-3333-333333333333","type":"image","image":{"type":"file","file":{"url":"https://prod-files-secure.s3.example/x.png?sig=SECRET"},"caption":[{"plain_text":"Diagram"}]}},
            {"object":"block","id":"44444444-4444-4444-4444-444444444444","type":"table","table":{}},
            {"object":"block","id":"55555555-5555-5555-5555-555555555555","type":"bookmark","bookmark":{"url":"https://example.com"}},
            {"object":"block","id":"66666666-6666-6666-6666-666666666666","type":"code","code":{"language":"python","rich_text":[{"plain_text":"print(1)"}]},"has_children":false}
        ]});
        let b = parse_blocks(&v).unwrap().blocks;
        assert_eq!(b[0].text, "Title");
        assert_eq!(b[1].checked, Some(true));
        assert_eq!(b[2].text, "Attachment not downloaded: Diagram");
        assert!(
            !format!("{b:?}").contains("SECRET"),
            "signed attachment URLs are dropped"
        );
        assert!(!b[3].supported && b[3].text.contains("table"));
        assert_eq!(b[4].text, "https://example.com");
        assert_eq!(b[5].language.as_deref(), Some("python"));
    }

    #[test]
    fn untrusted_text_is_stripped_and_truncated_but_never_interpreted() {
        let evil = "<script>alert(1)</script>\u{0007}\u{0000}ok";
        let v = json!({"object":"page","id":A,"properties":{"Name":{"type":"title","title":[{"plain_text":evil}]}}});
        let p = parse_page(&v).unwrap();
        assert!(!p.title.contains('\u{0007}') && !p.title.contains('\u{0000}'));
        assert!(
            p.title.contains("<script>"),
            "kept as inert text; the UI renders text nodes only"
        );
        let long = "x".repeat(5000);
        let v = json!({"object":"page","id":A,"properties":{"Name":{"type":"title","title":[{"plain_text":long}]}}});
        assert!(parse_page(&v).unwrap().title.chars().count() <= NAME_MAX + 1);
    }
}
