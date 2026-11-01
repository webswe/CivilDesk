# Phase 5A — Notion Integration Foundation

A secure, **read-only** foundation for connecting CivilDesk to Notion. It authenticates, verifies the connection, discovers what the owner has shared, previews it, and lets the user remember sources for a later milestone. It does **not** synchronize, import, create, update or delete anything.

> **Verification status in one line:** the behaviour is verified against a **mock** Notion API (Rust unit tests, frontend tests, and a native Windows E2E run against a loopback mock). It has **not** been verified against live Notion. See [§18](#18-live-testing-requirements).

## 1. Starting repository state

| Item | Value |
| --- | --- |
| Repository | `C:\Users\Alejandro\Documents\GitHub\CivilDesk` |
| Branch / HEAD | `main` @ `fa9de1b` |
| `origin/main` | `fa9de1b` (in sync) |
| Working tree | clean |
| Baseline | 209 frontend tests, 72 Rust tests, 77 native E2E tests, SQLite schema v9, 51 tables |

The actual state matched the expected state; there was nothing to report before starting.

## 2. Architecture audit

| Area | Finding | Phase 5A decision |
| --- | --- | --- |
| Tauri commands | Flat `#[tauri::command]` functions in `lib.rs`, registered in one `generate_handler!`; state is `RuntimeState { database: Option<Database> }`. | Added `notion_*` commands the same way, plus a second managed state `NotionState`. |
| Rust patterns | One module per domain (`academic.rs`, `personal.rs`, …) with an `impl Database` block; errors are `String`. | New `notion/` module. Errors are a structured, serializable `NotionError { kind, message, retryAfterSeconds }` because the UI must distinguish *offline* from *revoked*. |
| Migrations | `PRAGMA user_version` ladder in `persistence::migrate`, one transactional `execute_batch` per version. | Added **v10**, additive only. |
| App settings | `app_state` key/value JSON (preferences). | Not used for Notion: connection state needs relational rows and a cascade. |
| Secrets | **None existed.** | New identity-scoped Windows Credential Manager store. |
| Frontend boundaries | `src/services/*.ts`: `invoke` when `__TAURI_INTERNALS__` exists, otherwise an in-memory browser-preview adapter. | `services/notion.ts` follows the same split. |
| Settings navigation | `Settings` is a single page of `setting-group` sections; Settings sits in the sidebar utility group. | Notion is a new group on that page. **No new sidebar item.** |
| Network security | CSP `connect-src ipc: http://ipc.localhost`; the WebView cannot reach any other host; capabilities are `core:default` + `dialog:allow-open`. | Unchanged. All Notion traffic is made by Rust, so the CSP and capabilities stay as strict as before. |
| Identities | `tauri.conf.json` (production), `tauri.acceptance.conf.json`, `tauri.e2e.conf.json`, `tauri.dev.conf.json`, each with its own `identifier` and data folders. | Credential service names derive from the *runtime* `identifier`, so isolation follows the existing identity system. |
| Tests | Vitest (jsdom), Rust unit tests, and a WebdriverIO native suite that drives the real binary. | Extended all three. |

Existing Tasks, Projects and School models were read to understand future mapping needs and **not modified**.

## 3. Proposed integration architecture

```
Settings UI (React)                       Rust backend                                    Windows / network
-------------------                       ------------                                    -----------------
NotionSettings ── invoke ──▶ notion_* commands (async, spawn_blocking)
NotionBrowser                  │
                               ▼
                         NotionService ──── SecretStore ───────────────────────────────▶ Credential Manager
                               │               (identity-scoped service name)             "<identifier>.notion"
                               │
                               ├── SQLite (notion_connection, notion_sources: nonsecret metadata only)
                               │
                               ▼
                         Client (one request at a time, spacing, bounded retries, cancel)
                               │  ReadOp (closed enum) ─▶ allowlist ─▶ Transport
                               ▼
                         ReqwestTransport ── HTTPS only, fixed host ────────────────────▶ api.notion.com
                               │
                               ▼
                         parse.rs  → sanitized display structs (plain text only) ──▶ UI
```

Module layout:

| File | Responsibility |
| --- | --- |
| `src-tauri/src/notion/secrets.rs` | `Secret` (redacted `Debug`/`Display`), `SecretStore`, Credential Manager implementation, `redact()` |
| `src-tauri/src/notion/client.rs` | `API_VERSION`, `ReadOp`, allowlist, `Transport`, retry/rate-limit logic, `NotionError` |
| `src-tauri/src/notion/parse.rs` | Notion JSON → sanitized structs |
| `src-tauri/src/notion/mod.rs` | `NotionService` (connect/check/disconnect/browse/select) and the SQLite `store` |
| `src/services/notion.ts` | Types, `invoke` wrappers, browser-preview adapter |
| `src/NotionSettings.tsx`, `src/NotionBrowser.tsx`, `src/notion.css` | UI |

## 4. Authentication strategy

**Phase 5A: a single-workspace, development connection using an internal Notion connection token.**

- Entered once through a `type="password"` field in Settings → Notion. Sent to Rust, verified with `GET /v1/users/me`, then stored in Credential Manager. The input is cleared after success (and after a non-transient failure). The token is never returned by any command.
- The token is stored **only after** it has been verified. A rejected token, or one entered while offline, is never saved.
- The owner must create the connection with **Read content** only and share only the pages/databases to be visible. CivilDesk cannot enforce Notion-side capabilities, so the UI and this document ask for read-only capabilities; the Rust allowlist (§9) enforces read-only behaviour on CivilDesk's side regardless.
- **No shared token is embedded in any build.** The code contains no token, and nothing reads one from the environment or a file. A tester must create their own connection and enter their own secret.

### Development authentication vs. production-ready onboarding

| | Phase 5A (this) | Future public release |
| --- | --- | --- |
| Who creates the credential | The user, as an *internal* connection in their own workspace | The user authorizes a *public* connection through OAuth |
| Storage | Credential Manager, per identity | Credential Manager (access + refresh token), per identity |
| Distribution | Never distributed; each user supplies their own | Needs a registered public integration, a `client_id`, and a secure `client_secret` story (a desktop app cannot keep a secret, so a token-exchange service or PKCE-style flow must be chosen) |
| Extra work | none | OAuth redirect handling (loopback or custom scheme), token refresh, revocation handling, privacy policy |

The authentication boundary is `SecretStore` + `NotionService::connect`: the client only ever receives a `&Secret`. Swapping "paste a token" for "OAuth yields a token" changes `connect`, not the client, the allowlist, the parsers or the UI below it. OAuth is **not** implemented.

## 5. API version

`2026-03-11`, defined once as `API_VERSION` in `notion/client.rs` and sent in the `Notion-Version` header by the single `request_headers()` function. The frontend shows it read-only in the connected state.

Documentation checked on 2026-11-01 (https://developers.notion.com/reference):

| Concept | Finding used |
| --- | --- |
| Search | `POST /v1/search`; `filter.property = "object"` with `value` **`page`** or **`data_source`** (not `database`); cursor pagination via `start_cursor` / `next_cursor` / `has_more`; may report `request_status: incomplete`. |
| Databases vs data sources | `GET /v1/databases/{id}` returns a `data_sources` array of `{id, name}`; `GET /v1/data_sources/{id}` returns the schema (`properties`) and a `parent.database_id`. **IDs are not interchangeable**; CivilDesk never sends a database ID to a data-source endpoint (asserted by a test). |
| Querying | `POST /v1/data_sources/{id}/query` (not the obsolete database query). `page_size` set to 10 for previews; archived entries use `is_archived`, which CivilDesk does not send. |
| Blocks | `GET /v1/blocks/{id}/children`; first-level children only; `rich_text` carries `plain_text`. |
| Identity | `GET /v1/users/me` returns a bot user; `bot.workspace_name` may be `null` and `bot.owner` differs for internal vs public connections. CivilDesk shows only fields actually present. |
| Rate limits | Roughly 3 requests/second per connection (180/min on most plans); `429` with integer `Retry-After`; `529` handled the same way; `public_api_request_blocked` is not retryable. |

Not verified: a changelog for 2026-03-11 was not available from the pages fetched ("the content doesn't include a changelog for this version"), so differences from 2025-09-03 beyond the above were not enumerated. The parsers read fields defensively (`in_trash`, `is_archived` and `archived` are all honoured) and unknown property/block types degrade to an explicit "unsupported" label.

## 6. Credential-storage design

- **Store:** Windows Credential Manager through the `keyring` crate (v3, `windows-native` backend only). Entry: service `"<identifier>.notion"`, account `notion-connection`; Windows names it `notion-connection.<identifier>.notion`.
- **Not stored in:** SQLite, JSON, environment files, logs, exports, or frontend state. The only database tables are `notion_connection` and `notion_sources` (§10); a test dumps every table after connecting and asserts the token is absent.
- **`Secret` type:** wraps the value; `Debug` and `Display` print `<redacted>`; `expose()` is called in one place (building the `Authorization` header).
- **Redaction:** `NotionError::new` passes every message through `redact()`, which masks anything shaped like `ntn_…` / `secret_…`. Errors never include response bodies; only a validated machine code is read from them.
- **Not cached:** the token is read from Credential Manager for each request, so deleting it takes effect immediately.
- **Honest limits:** Credential Manager entries are protected by the Windows user profile (DPAPI), not by a CivilDesk password; any process running as the same Windows user can read them. The token also exists briefly in the WebView's input field and in Rust process memory.

## 7. Application identity isolation

The credential service name is `format!("{identifier}.notion")` using the identifier Tauri reports at runtime (`app.config().identifier`, which already reflects the merged `--config` overlay).

| Build | Identifier | Credential service |
| --- | --- | --- |
| Production | `com.webswe.civildesk` | `com.webswe.civildesk.notion` |
| Acceptance | `com.webswe.civildesk.acceptance` | `com.webswe.civildesk.acceptance.notion` |
| E2E | `com.webswe.civildesk.e2e` | `com.webswe.civildesk.e2e.notion` |
| Development | `com.webswe.civildesk.dev` | `com.webswe.civildesk.dev.notion` |

A development token is therefore invisible to production. Tests: `service_names_are_identity_scoped_and_distinct`, `credentials_are_isolated_between_identities` (secrets), `credentials_are_isolated_between_application_identities` (service level), and `windows_credential_manager_round_trip_and_isolation`, which exercises the **real** Credential Manager with throwaway identities.

The SQLite file is already per identity, so connection metadata and remembered sources are isolated the same way.

## 8. Resource discovery

Settings → Notion → **Browse content** opens a dialog:

- Search box (submitted explicitly), type filter (all / pages / data sources), results list with a type label, last-edited date, and a **Remembered** badge.
- `Load more` follows cursors; results are de-duplicated by ID in both Rust and the UI.
- Unnamed items show as "Untitled page" / "Untitled data source" in italics.
- An empty result explains that only shared content is visible and how to share it (page `…` menu → Connections).
- If Notion reports `request_status: incomplete`, the UI says the list may be incomplete. Search is never treated as a full inventory.
- Opening a **data source** shows its properties (type and options) and a 10-row, paginated entry preview; a "View its database" link lists the database's data sources. Opening a **page** shows title, edit time, properties and a block preview.
- Trashed/archived items are skipped. A 403/404 on one item is shown as a clear message and does **not** mark the whole connection failed.

Standalone *databases* are not search results in this API version (search returns pages and data sources); a database is reached through its data source's parent link.

## 9. Read-only enforcement (backend)

1. **No write command exists.** The registered commands are `notion_status`, `_connect`, `_check`, `_disconnect`, `_cancel`, `_search`, `_open_database`, `_open_data_source`, `_preview_entries`, `_open_page`, `_page_blocks`, `_set_source_selected`, `_selected_sources`. The last two change **local** SQLite only. The native E2E asserts that `notion_update_page`, `notion_create_page`, `notion_delete_block`, `notion_request` and `notion_sync` do not exist.
2. **`ReadOp` is a closed enum.** Callers pass IDs, cursors and a search string, never a path, method, header or body. IDs must be UUIDs (`normalize_id`); cursors are restricted to `[A-Za-z0-9-_:=.]`.
3. **Allowlist (`is_allowed`)** accepts exactly seven method+path shapes. It is checked when a request is built, again in `Client::call`, and again inside `ReqwestTransport::send`. Tests cover mutations (`POST /v1/pages`, `POST /v1/blocks/{id}/children`, `PATCH`-style paths, `..` traversal, unexpected query strings, other API versions, absolute URLs).
4. **POST ≠ write:** `POST /v1/search` and `POST /v1/data_sources/{id}/query` are allowed only because they are reads; the body is constructed in Rust.
5. **Fixed host, HTTPS only, no redirects.** `reqwest` is configured with `https_only(true)` and `Policy::none()`.
6. UI buttons are not the enforcement mechanism; the above is.

### The test-only loopback mock

The native E2E needs a fake Notion. A cargo feature `notion-mock` (off by default, **not** in any release/acceptance/dev build, enforced by `scripts/check-e2e-config.mjs`) swaps `base_url()` for one read from `CIVILDESK_NOTION_MOCK_URL`, which must be `http://127.0.0.1:<port>`. Without the feature, `base_url()` returns the constant and the environment variable is never read. The mock server itself contains no outbound networking, listens on `127.0.0.1` only, and is tested for both.

## 10. SQLite changes

Schema **v9 → v10**, additive; 51 → **53 tables**. No existing table is modified.

```sql
notion_connection(id='default' PK, identifier, bot_name, workspace_id, workspace_name,
                  status IN ('connected','auth_failed','restricted'), connected_at_ms, last_verified_at_ms)
notion_sources(connection_id → notion_connection ON DELETE CASCADE, resource_id,
               resource_type IN ('page','data_source'), display_name, database_id,
               selected 0/1, selected_at_ms, last_verified_at_ms, PK(connection_id, resource_id))
```

- Only nonsecret metadata. No credential, no copies of Notion pages or entries, no task/project/mapping tables.
- Persisted status is only what a verification *proved*; network trouble (offline, timeout, rate limit) is never persisted.
- Reconnecting to the same workspace keeps remembered sources; connecting to a different workspace drops them; disconnecting removes both tables' rows.
- Existing migration tests that simulate older schemas by dropping later tables now also drop these two tables (test-only edits in `academic.rs`, `study.rs`, `personal.rs`, `portfolio.rs`), and their version assertions moved from 9 to 10. `e2e/lib/fixture.mjs`'s script extractor was made tolerant of `rustfmt` wrapping the call across lines.

## 11. Offline behaviour

- Startup never touches Notion; `NotionService` construction does no I/O. Opening My Day or Settings makes **no** network request: Settings reads only local state (credential presence + SQLite). A test and the native E2E both assert zero requests on open and after restart.
- No polling, no background tasks. Requests happen only on **Connect**, **Check connection** and the user's own browsing.
- Offline failures say "Notion couldn't be reached. Your CivilDesk data is unaffected."; the last verified state is preserved and shown as **Offline** on top of it. The native E2E performs a *real* connection-refused (it stops the mock listener) and then adds and reads a task.
- No response cache was introduced. Previews are fetched live and held only in component state; closing the dialog discards them and cancels in-flight requests. Remembered sources store name/ID/type only, and the UI shows when each was last verified.

## 12. Network error handling

| Condition | Behaviour |
| --- | --- |
| 401 | `auth_failed`; **not retried**; browsing a 401 persists `auth_failed`; connect refuses to store the token |
| 403 | `restricted` (capability/sharing message) |
| 404 | `not_found` ("not shared with this connection") |
| 400 / 406 / 409 | `invalid_request` |
| 429, 529 | Honours `Retry-After`; waits inline only if ≤ 20 s, otherwise reports it; at most 2 retries; `public_api_request_blocked` never retried |
| 500, 502, 503, 504 | Up to 2 retries with 1 s, 2 s backoff, then `unavailable` (all operations are reads, so retrying is safe) |
| Timeout | 8 s connect / 20 s total; one retry |
| Offline / DNS / connection refused | `offline`, no retry |
| TLS failure | `tls` (message distinct from offline) |
| Non-JSON / unexpected shape | `invalid_response` |
| Cancellation | A generation counter checked before each attempt and every 50 ms during waits; used on dialog close and on disconnect |

One request is in flight at a time, spaced ≥ 350 ms (≈ 3/s), which also serializes the Retry-After pause for every caller. No jitter is applied (a single client cannot collide with itself).

## 13. Security review

Data flow: **token entry → Rust → Credential Manager → HTTPS read → sanitized structs → UI.**

| Question | Answer |
| --- | --- |
| Credentials logged? | There is no logging of requests. `Secret` cannot be formatted; error text is redacted and body-free. |
| Token returned by a command? | No. `ConnectionStatus` has no token field (test asserts JSON contains no "token"). |
| Untrusted content executing? | Everything is rendered as React text nodes. No `dangerouslySetInnerHTML`, no links, no `<img>`/`<iframe>`. Attachment URLs (signed S3 links) are dropped in Rust and never reach the UI. Tests render `<img onerror>`/`<script>`/`javascript:` payloads and assert no elements and no side effects, in jsdom and in the real WebView. |
| Arbitrary hosts? | No. One constant host, HTTPS-only, redirects off. |
| Read-only enforced in backend? | Yes, §9. |
| Identity separation? | Yes, §7. |
| Disconnect removes the credential? | Yes; verified against the real Credential Manager in the native E2E. |
| Sensitive content in CI artifacts? | The E2E uses a fake token and fabricated mock data; the mock records booleans, never the token. |
| Independent of Notion? | Yes; see §11. |
| New network permissions? | None. CSP and capabilities are unchanged; no local HTTP server in the app. |

Residual risks, stated plainly:

- Same-user processes can read the Credential Manager entry.
- Notion-side capability scoping is the owner's responsibility; CivilDesk can only decline to use write endpoints.
- A malicious Notion page can still show misleading *text* in the preview.
- The WebView briefly holds the pasted token in an input element.
- `cargo audit` / dependency review for the new crates (`keyring`, `reqwest`, `native-tls`) was not run.

## 14. Frontend tests

`src/NotionSettings.test.tsx` — 20 tests (suite: 209 → 229 with the mock tests below counted separately in §16): disconnected state without network, placement inside Settings with no sidebar item, successful connect with token cleared and absent from the DOM, auth failure (token dropped), offline (value retained for retry), connecting state, rate-limited check, restricted/auth-failed states from the backend, typed discovery list with untitled items and pagination, loading and empty states, search, data-source schema + paginated preview with unsupported properties, database ↔ data-source navigation, remember/forget source, page preview, hostile-content rendering, inaccessible item error, confirmed disconnect with revocation guidance, token replacement, and accessible names/roles/captions.

Browser preview (`npm run dev` in a browser) uses a clearly labelled in-memory sample workspace; any 10+ character string "connects". It never calls the network or a credential API.

## 15. Rust tests

72 → **131** (+59): 21 client (allowlist, version header, retries, Retry-After, cancellation, redaction), 12 parsers, 5 secrets (including a real Credential Manager round trip), 21 service/SQLite (connect, replace, check, revoke, disconnect, isolation, discovery, selection persistence, migration v9→v10, token-not-in-DB). All use mocked transports; no network and no real token.

## 16. Native E2E coverage

`e2e/specs/13-notion.e2e.mjs`, run against the real Tauri binary built with `--features notion-mock`, using the loopback mock in `e2e/lib/notion-mock.mjs` (with 6 Vitest tests of its own).

**Result (local Windows machine, WebView2 156.0.4314.58, tauri-driver 2.1.0): all 13 spec files pass, 91 tests, 0 failed; `npm run verify` confirms schema v10, 53 tables, `quick_check = ok` and no foreign-key violations after every spec.** The Notion spec adds 13 tests and runs against the *mock*, never live Notion. The existing specs ran unchanged on the same binary. (One earlier full run had two transient failures in `10-personal`, while the machine was busy with other work; that spec passed alone and in the next full run. It was not investigated further.)

The 13 tests:

1. Starts disconnected; no credential in Credential Manager; zero requests to the mock.
2. Connects through the real password field; the only request is `GET /v1/users/me` with version `2026-03-11`; the credential then exists in Credential Manager under the **E2E** identity; status JSON contains no token.
3. Scans every file in the E2E data and WebView folders (UTF-8 and UTF-16) and the page DOM/localStorage for the token: none found.
4. Discovery: pages vs data sources, "Load more", 28 unique items.
5. Data-source schema and entry preview (rollup flagged unsupported), database view, remember a source.
6. Page preview as inert text; a hostile page (`<img onerror>`, `<script>`, `javascript:`) creates no elements and runs nothing.
7. Restart: still connected, source remembered, **zero** requests to Notion during startup.
8. Narrow widths 1600/1280/900/760/700 (screenshots only when `CIVILDESK_E2E_EVIDENCE_DIR` is set).
9. Rate-limited, authentication-failed, access-restricted and recovered states.
10. Real offline (the mock listener is closed): "Offline" label, last verified state kept, and a School task can still be added and read.
11. Every request the mock saw was an allowlisted read with the pinned version; no violations; write-style commands do not exist.
12. Disconnect: credential gone from Credential Manager, sources cleared, no further requests, other CivilDesk data intact.
13. Stays disconnected after restart.

How to run locally (build with the feature, then the usual harness): `npm run tauri build -- --debug --no-bundle --config src-tauri/tauri.e2e.conf.json -- --features notion-mock`, then `npm test` in `e2e/`. The harness removes only the E2E identity's own credential before and after a run. The manual CI workflow was updated to build with the feature; **it has not been run on GitHub Actions**.

Baseline note: the brief expected 77 existing native tests; the JUnit total is 91 including the 13 new ones, so the existing suite counts 78. The 77 figure was not reconciled.

## 17. Manual connection setup

1. In Notion open **Settings → Connections → Develop or manage integrations** (or https://www.notion.so/profile/integrations) and create an **internal** integration in a *disposable* workspace or test page.
2. Under **Capabilities** enable **Read content** only. Disable *Update content*, *Insert content* and *User information* (email).
3. Open a disposable page or database, choose `…` → **Connections** → add the integration.
4. Start CivilDesk Dev: `npm run tauri dev` (identity `com.webswe.civildesk.dev`).
5. Settings → Notion → paste the integration secret into **Connection token** → **Connect**. Do not paste it anywhere else.
6. **Check connection**, then **Browse content**.

### Revoking access in Notion

Disconnecting in CivilDesk removes the token from *this computer* only. To revoke it in Notion: remove the connection from each shared page (`…` → Connections), or delete/regenerate the secret in the integration's settings. Do both if the token may have been exposed.

## 18. Live testing requirements

**Not yet performed.** Every result above came from mocks. Before treating the integration as working with real Notion, the owner should run this against a disposable workspace:

1. Create the integration and share a disposable page and database (§17).
2. Connect in CivilDesk Dev; confirm the workspace name appears and *Last verified* updates.
3. Browse: confirm the page and the database's data source appear; open the data source; confirm the schema and entries; open the page.
4. Remember the data source; restart; confirm it persists.
5. Unshare the page in Notion and re-check: browsing it should report "not shared".
6. Regenerate the secret in Notion; **Check connection** should show *Authentication failed*.
7. Disconnect; confirm the Credential Manager entry `notion-connection.com.webswe.civildesk.dev.notion` (Control Panel → Credential Manager → Windows Credentials) is gone.
8. Confirm Tasks, School and Focus still work throughout.

Never paste the token into Claude Code, GitHub, a test report or an issue. Do not test against a personal workspace without deciding to.

## 19. Screenshots

Captured from the **real Windows application** (the E2E build, driven by WebDriver) against the mock Notion, in `docs/evidence/phase5a/`:

| File | Shows |
| --- | --- |
| `01-disconnected.png` | Settings ? Notion, not connected, setup steps and password field |
| `02-connected.png` | Connected state, workspace, last verified, buttons |
| `03-browse.png` | Discovery list |
| `04-data-source.png` | Schema and entry preview |
| `05-page-preview.png` | Page content preview |
| `06-offline.png` | Offline state with explanatory message |
| `07-settings-{1600,1280,900,760,700}.png` | Settings at each width |
| `08-browse-700.png`, `09-data-source-700.png` | Browse dialog at 700 px |

`npm run tauri dev` was **not** launched by hand for this report; the screenshots come from the E2E build, which is the same code with a different identity. After these screenshots were taken, one CSS tweak was made (the remembered-source rows now stack the name and its caption); it is covered by tests but not re-photographed.

## 20. Known limitations

- Not verified against live Notion (see §18).
- Only the first level of page blocks is shown; nested blocks, tables, synced blocks and rollups appear as "unsupported". Attachments, embeds and images are intentionally not loaded.
- Formula/relation/people values are summarized (counts or primitives); relation titles are not resolved.
- Search returns pages and data sources only; a database with no accessible data source cannot be listed directly.
- Single connection (`id = 'default'`); no multi-workspace support.
- Property ordering in previews is alphabetical with the title first, because the API response is a JSON object.
- No retry jitter; no cross-session caching; no per-token rate-limit tracking beyond spacing and `Retry-After`.
- The Credential Manager test only runs on Windows (`#[cfg(windows)]`).
- OAuth is not implemented.

## 21. Future synchronization architecture (design only)

Nothing below is implemented.

- **5B — Source mapping.** A `notion_source_mappings` table keyed by `(connection, data_source)` with an explicit target concept (task / project / assignment), a reviewed property→field map, a compatibility report (missing, type-mismatched, unsupported properties) and a no-write dry-run preview. Stable identity: `(data_source_id, page_id)` ↔ local row ID in a link table, never title matching.
- **5C — Controlled import.** User-approved batches; each import creates link rows plus an `import_runs`/`import_items` history; duplicates are prevented by the unique link key; every imported local row records its origin so a run can be rolled back (delete only rows created by that run and unchanged since).
- **5D — Synchronization.** Explicit direction per mapping; a stored last-synced snapshot (Notion `last_edited_time` + hash of mapped fields) enables three-way conflict detection; local edits made offline queue as pending operations; deletions are soft by default and always confirmed; operations carry idempotency keys so a replay is a no-op. Writes would be a *separate* allowlist and a separate capability, requested only when the user turns on a two-way mapping, and never added to the read-only `ReadOp` set.

## 22. Final Git state

See the final report; recorded at completion.
