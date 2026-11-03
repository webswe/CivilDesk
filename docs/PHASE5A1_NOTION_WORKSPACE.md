# Phase 5A.1 — Notion-Style Workspace

Replaces the narrow Notion "browse" modal from Phase 5A with a dedicated, Notion-inspired **workspace view** inside CivilDesk's main content area. It stays **read-only**: nothing is written to Notion, nothing is imported into CivilDesk, and nothing is synced.

> **Verification status in one line:** behaviour is verified with frontend tests, Rust tests and the full native Windows E2E suite (real binary, real WebView2, **loopback mock** Notion). The screenshots are of the real native window showing **synthetic mock content**. The maintainer's own Notion workspace was deliberately **not** opened, screenshotted or committed by this work.

## 1. Previous browser limitations

The Phase 5A browser was a `Modal` capped at ~860 px and anchored to the left of the screen, opened from Settings. It behaved like an API inspector:

- A flat list of search results, with no hierarchy and no breadcrumbs.
- A data source showed its **property schema first**, then a plain preview table with raw values (ISO timestamps, `Yes`/`No`, comma-joined tags).
- Table rows were not clickable; there was no way to open an entry as a page.
- Pages were a plain-text "content preview": every block was a bare paragraph, numbered lists were bullets, nested content was never loaded, links were dropped.
- A modal inside Settings, so there was no way to keep context (search, recents, saved sources) while reading.
- Every back navigation restarted from the list, and the list re-ran its search.

## 2. New workspace architecture

Route: **Settings → Notion → Open workspace** opens the page `Notion` (not in the sidebar; Settings stays highlighted, and the top bar reads *Settings › Notion workspace*). A **Settings** button inside the workspace returns to Settings. There is no modal.

```
src/notion/
  Workspace.tsx   layout, toolbar, history, drawer/resizer, connection + offline handling
  Sidebar.tsx     identity, search, recents, saved sources, shared list, expandable sub-pages
  Content.tsx     PageContent, DataSourceContent (table), DatabaseContent, breadcrumbs
  Blocks.tsx      document rendering, paginated, on-demand nested blocks
  Values.tsx      property values (badges/tags/checkbox/date), errors, external-open buttons
  format.ts       date formatting + small helpers
  session.ts      in-memory session store (history, recents, caches)
  ctx.ts          React context shared by the pieces
  notion-workspace.css
```

`NotionBrowser.tsx` was deleted. `NotionSettings.tsx` keeps every connection control (connect, check, replace token, disconnect, remembered sources list); its **Browse content** button became **Open workspace**.

**Session memory** (`session.ts`) is in-memory only: navigation history (max 50), recents (8), expanded tree nodes, de-duplicated promises for page/data-source/database lookups, the shared list and the sidebar width. It holds names and identifiers only, never the credential, and nothing is persisted. It is cleared when the connection identity (workspace name + connected-at time) changes, which covers disconnect and reconnect, so a different workspace never shows the previous one's pages. Because the workspace re-mounts when you leave and return, the last open resource and the loaded lists are restored without contacting Notion again.

### Data model rule: databases and data sources stay separate

Three resource kinds are tracked and never conflated: `page`, `ds` (a data source: the table) and `db` (a database *container* that holds data sources). A database with exactly one data source opens straight to its table (the navigation entry is *replaced*, so Back is not trapped); with several it lists them.

## 3. Navigation model

- **Toolbar:** Settings, show/hide navigation, Back, Forward, and a *Read-only* badge. Back/Forward walk a real history stack, so opening a row and pressing Back returns to the table.
- **Breadcrumbs** follow only the parent that Notion itself declares on a page (`page_id`, `database_id`, `data_source_id`, `block_id`, `workspace`). The walk is bounded (6 hops) and cached. A parent that cannot be read renders as a non-clickable *Inaccessible parent*; a block parent renders as *Parent block*; a workspace parent as *Workspace*. A database's own parent is not exposed by the API client, so trails end at the database.
- **Sub-pages:** a page row in the sidebar has an expander. It reads the page's own child blocks and shows `child_page` / `child_database` entries. That is the only authoritative parent→child information available, so it is the only source of nesting.
- **Search results and the shared list are flat.** They are shown in the order Notion returns them; nothing is nested or grouped by guesswork (they are only split under *Pages* and *Databases* headings by type).
- **Opening a result or row never re-runs a search.** Lookups are cached for the session.
- **Sidebar:** workspace identity and connection status, title search with a type filter, *Recent*, *Saved sources*, *Shared with CivilDesk* with pagination. It is collapsible, resizable (drag, or ←/→ on the focused separator, 220–480 px) and becomes a drawer on narrow windows.
- **Saved sources** are listed from local storage with no Notion request. Remembering or forgetting a source (from the page/table header) uses the existing Phase 5A persistence and **imports nothing**.

## 4. Page rendering

Pages render as documents: icon (emoji, or a page glyph), title, edited date, a property list (badges/tags/dates/checks, not a debug dump), then blocks. Everything is React text nodes: **no HTML from Notion is ever interpreted**, no remote images or embeds are loaded, and links open only on an explicit click.

- Paragraphs, headings (H1–H4), bulleted and **numbered** lists (numbering computed per run, continuing across *Load more*), checkboxes (read-only), quotes, callouts, code and equations (monospace, scrollable), dividers.
- **Nested blocks** load one level at a time, only when the reader expands them (chevron with `aria-expanded`). Each level is its own paginated request; expansion stops at depth 4 and shows *Open in Notion*.
- Sub-pages and sub-databases render as cards that navigate inside the workspace.
- **Links** are shown as host buttons (`example.com ↗`) next to the text that carried them. Only `https` links survive: the Rust parser filters them and the frontend filters again. Clicking calls a backend command that re-validates and opens the system browser.
- **Open in Notion** is available on every page and data source, and next to any content CivilDesk cannot display faithfully.

## 5. Database presentation

A data source opens as a table, not a schema:

- Human-readable column headings from the property names; a sticky title column; sensible widths; long titles wrap in the title column; other cells truncate with ellipsis.
- The table has its own horizontal scroll container (focusable, `tabindex=0`, labelled). The page and application never scroll sideways.
- Status → rounded badge with a dot; select → tag; multi-select → several tags; checkbox → check box with screen-reader text; numbers right-aligned; dates → readable local text; empty → an unobtrusive *Empty*; unsupported types → *Not supported* (the original reason is in the tooltip). Unsupported properties are never rendered as misleading text.
- Rows open the underlying page: click the title button or anywhere on the row.
- Pagination: *Load more entries* with a running count (`10+ entries`, then `12 entries`). Loading, empty, error (with Retry) and "may be incomplete" states.
- The property schema lives behind a collapsed **Properties (n)** control.

**Optional views (list/board):** evaluated and **not implemented**. The read-only API client returns the data source's entries, not Notion's saved view definitions, so a board or list would be a CivilDesk invention rather than a faithful view of the owner's data, which the brief rules out.

### Date presentation

`formatNotionInstant` / `formatNotionDate` (`format.ts`) never show raw ISO text. A date with no time is built from its calendar parts, so `2026-03-05` is always 5 March regardless of time zone. A date-time is shown in local time with the time. Ranges (`start → end`) format each side. Anything unparseable is shown exactly as Notion sent it. The stored/authoritative values are untouched.

## 6. Supported and unsupported Notion content

| Supported (read-only) | Behaviour |
| --- | --- |
| Pages, data sources, databases | Documents, tables, container list |
| Paragraph, heading 1–4, bulleted/numbered list, to-do, quote, callout, code, equation, divider, toggle | Rendered; nested content on demand |
| Child page / child database | Cards that navigate in-app; sidebar sub-pages |
| Bookmark / embed / link preview | An https host button; otherwise inert text |
| Rich-text links | https only, host button, click to open |
| Properties: title, text, number, select, status, multi-select, date, checkbox, url, email, phone, people, relation (count), files (count), formula (string/number/boolean/date), unique ID, created/edited time | Native presentation |

| Not supported | Behaviour |
| --- | --- |
| Images, files, PDFs, video, audio | A labelled placeholder ("Attachment not downloaded") + Open in Notion. Never fetched |
| Tables, columns, synced blocks, and any other block type | "This content can't be shown in CivilDesk" + Open in Notion |
| Rollups, and other unsupported property types | *Not supported* |
| Rich-text formatting (bold, italic, colour, mentions) | Plain text only |
| Notion view types (board, list, calendar, timeline), sorts, filters | Not shown |
| Status/select **colours** | Not exposed by the client: badges are neutral |
| Custom or external page icons | Emoji icons only |
| Anything beyond nesting depth 4 | Open in Notion |
| Writing, importing, syncing | Not implemented, by design |

## 7. API considerations

- **API version and the read allowlist are unchanged** (`2026-03-11`; `GET /users/me`, `POST /search`, `GET /databases/{id}`, `GET /data_sources/{id}`, `POST /data_sources/{id}/query`, `GET /pages/{id}`, `GET /blocks/{id}/children`). The workspace issues no other Notion request. The native E2E re-asserts this against every request the mock saw.
- **Nested blocks need no new operation.** `GET /blocks/{id}/children` already accepts any block ID, so nesting reuses `notion_page_blocks`, with the existing 50-per-request page size and cursor validation.
- **Narrow parser additions in `parse.rs`** (data only, no new request): `PageView.parentId` (the identifier named by the parent's own `type`, validated by `normalize_id`) and `PageView.icon` (emoji); `BlockView.links` (https-only, at most 5, de-duplicated, from `rich_text` and `caption`).
- **Request volume:** opening the workspace issues one search (the shared list); a page issues one page read, one children request, and the breadcrumb lookups (cached); nested content, sub-page lists and table pages are on demand. Nothing prefetches a tree. Rate limiting and offline errors surface as calm, retryable messages.

## 8. Security boundaries (preserved)

Unchanged and not touched: Windows Credential Manager storage, credential identity isolation, the Notion API version, the read-operation allowlist, the Notion mock isolation guard (`npm run check:e2e-isolation` passes), SQLite schema v10 (53 tables), connection verification, source-selection persistence, and disconnect behaviour.

New surface and how it is bounded:

- Two local commands, **`notion_open_in_notion(id)`** and **`notion_open_link(url)`**. Neither contacts Notion and neither sends a credential. The first builds `https://www.notion.so/<32-hex id>` itself from an identifier validated by `normalize_id`; the frontend never supplies that URL. The second accepts only `https://` URLs with a plain host, no credentials (`@`), no whitespace/control characters and none of `" < > \ ^ ` { } |`, max 2000 characters (`is_safe_https`, unit-tested). The URL is passed as a single argument to `rundll32.exe url.dll,FileProtocolHandler` (no shell).
- These commands are **not** part of the Notion read allowlist and are not write operations. The E2E still proves that commands such as `notion_update_page`, `notion_create_page`, `notion_delete_block`, `notion_request` and `notion_sync` do not exist.
- The credential never reaches browser state, logs, screenshots or files; the E2E re-scans the E2E profile and the DOM for the fake token (UTF-8 and UTF-16) and finds nothing.
- Untrusted text is never interpreted as HTML (tested with `<img onerror>`, `<script>`, markdown links and `javascript:` bookmarks, in both Vitest and the native app).
- Selecting or remembering a source stores only name/ID on this computer; nothing is imported into tasks or projects.

## 9. Responsive behaviour

The workspace uses `calc(100vh − header)` height and scrolls inside itself. The sidebar is a column at **> 1000 px** and a **drawer** at **≤ 1000 px** (over a scrim; closes on selection, on the scrim, on Escape, or with its close button). The drawer never persists across the breakpoint: narrowing closes it, widening reopens the sidebar. Below 760 px the document header and property list stack. Tables scroll in their own container.

| Width | Result (native window) |
| --- | --- |
| 1600 / 1280 | Sidebar + content |
| 900 / 760 / 700 | Drawer; toolbar toggle; table scrolls inside its container; `documentElement.scrollWidth ≤ innerWidth` asserted at 700 |

## 10. Automated tests

| Suite | Before | After |
| --- | --- | --- |
| Frontend (`npm test`, includes `e2e/lib` Vitest) | 247 | **284** passing |
| Rust (`cargo test`) | 131 | **133** passing (+2: parent/icon parsing, https link filtering) |
| Native E2E (real binary) | 13 specs | **13 specs, 93 tests, 0 failed**; SQLite schema v10, integrity ok, 53 tables |

Frontend changes: `NotionSettings.test.tsx` 20 → 12 (the 9 browser-in-a-modal tests were replaced, not dropped, by the workspace tests below; one settings test was added for the new Open workspace flow), new `src/notion/Workspace.test.tsx` (39) and `src/notion/format.test.ts` (5), and one new mock-fixture test in `e2e/lib/notion-mock.test.mjs`.

`Workspace.test.tsx` covers: landing and a single initial request; connection-missing state; route from Settings (page, not dialog) and back; sidebar lists, pagination, no invented nesting, expand/collapse of real sub-pages, "No sub-pages", recents and active highlight; hide/show and keyboard resize; search (type filter, loading, pagination, clear, no re-search when opening a result); document rendering (headings, numbering, checkboxes, quotes, dividers, links); breadcrumbs, icon fallback, no raw identifiers; nested loading and depth; honest unsupported blocks and Open in Notion; https-only link opening; untrusted-HTML safety; sub-page navigation with Back/Forward; inaccessible parent; table headings, badges, tags, dates, unsupported columns and Properties control; table pagination; row → page → Back without a new search; click anywhere on a row; multi-data-source database and empty state; single-data-source redirect without trapping Back; entry error with Retry; remember/forget source without a new search; saved source on landing; session restore; clean start after reconnect; not-shared error; offline banner and recovery; sidebar Retry; token rejection; narrow drawer behaviour, resize across the breakpoint, table scroll container; accessibility labelling.

Native E2E (`13-notion.e2e.mjs`, 16 tests) was rewritten for the workspace and **keeps every security and persistence assertion** (no traffic while disconnected; credential only in Credential Manager; token absent from every profile file and the DOM; remembered source survives restart with no Notion request; rate-limited / auth-failed / forbidden / recovered; real connection-refused offline state with other features working; allowlisted requests only; disconnect removes credential and sources; stays disconnected after restart). It adds: no dialog; paginated discovery with no duplicates; table with readable dates and *Not supported*; Properties collapsed; remember a source and see it in the sidebar; breadcrumb to the database; row → page → Back with no extra `/v1/search`; document with numbered list, nested content, sub-page and breadcrumb; sidebar sub-page expansion; sidebar search and hostile content as inert text; saved source on the landing screen after a restart; and a narrow-window test (900/760/700, drawer, no page-level horizontal overflow). The loopback mock gained sub-page, database-row, nested-block and link fixtures (still loopback-only, read-only, and with no outbound code; its own tests are unchanged apart from one added).

Two harness notes: the E2E run needs `CIVILDESK_E2E_ALLOW_RESET=1` (the harness's existing opt-in to reset only its own `com.webswe.civildesk.e2e` folders) and a `msedgedriver.exe` matching the installed WebView2, obtained with the project's `msedgedriver-tool` outside the repository.

## 11. Visual evidence

Captured from the **real native E2E window** through WebDriver (`CIVILDESK_E2E_EVIDENCE_DIR`), against the loopback mock with synthetic content. Stored in `docs/evidence/phase5a1/`.

| # | Evidence | File |
| --- | --- | --- |
| 1 | Workspace landing | `03a-workspace-landing.png` |
| 2 | Expanded navigation (page expanded to its sub-page) | `05b-expanded-navigation.png` |
| 3 | Open page (document) | `05-page-document.png` |
| 4 | Nested content | `07-nested-content.png` |
| 5 | Data-source table | `04-data-source-table.png` |
| 6 | Opened database entry | `06-database-entry.png` |
| 7 | Search | `08-search.png` |
| 8 | Narrow layout: window sizes and drawer | `09-workspace-{1600,1280,900,760,700}.png`, `10-narrow-drawer.png`, `11-narrow-table.png` |

Looking at them while building produced two changes: bright system scrollbars on the table and content panes were themed to Rosewood, and the unsupported-property label was shortened from "Not shown in CivilDesk" to "Not supported" because it forced the table to scroll at 1280 px.

**Dev identity:** `npm run check:dev-config` passes (identity `com.webswe.civildesk.dev`), and `npm run tauri dev` was launched and showed the window titled *CivilDesk Dev* before being stopped. I did **not** open the connected workspace in that instance or capture it, so no screenshot of the maintainer's real private workspace exists or is committed. A quick manual pass of Settings → Open workspace against the real connection is the one thing left for the maintainer.

## 12. Remaining limitations

- Verified against a mock, not a live workspace, by this work. Real-API shape differences (for example child pages inside toggles or columns, which have a `block_id` parent and are not discovered by the sidebar tree) are handled defensively but have not been seen live here.
- Sub-pages in the sidebar tree are found from the first page of each page's child blocks plus a *Look for more sub-pages* control; very large pages need a few clicks.
- Breadcrumbs stop at a database, because the client does not expose a database's parent.
- Plain-text rendering: no inline formatting, status colours, cover images, file previews or custom icons.
- Table: Notion's default order only; no sort, filter, grouping, search-in-table, or column resize.
- *Open in Notion* and link opening use the system browser; the native E2E does not click them (that would launch a real browser). They are covered by Rust validation tests and by frontend tests that observe the request.
- Recents and expanded nodes are session-only by design (no schema change). The narrow breakpoint is a fixed 1000 px window width rather than a measurement of the container.
- One unrelated Vitest case (`e2e/lib/db.test.mjs`, "propagates the real SQLite error…") failed once during a parallel run and passed in the 5 subsequent full runs and 3 isolated runs; it is untouched by this change and I could not reproduce it.
- Not run on GitHub Actions. Nothing is pushed.
