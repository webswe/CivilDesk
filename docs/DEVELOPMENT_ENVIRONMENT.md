# Local development environment

`npm run tauri dev` runs CivilDesk as an isolated **development** application. It can never open the production, Acceptance or E2E data.

| Variant | Identifier | SQLite database |
| --- | --- | --- |
| Production | `com.webswe.civildesk` | `%APPDATA%\com.webswe.civildesk\civildesk.sqlite3` |
| Acceptance | `com.webswe.civildesk.acceptance` | `%APPDATA%\com.webswe.civildesk.acceptance\civildesk.sqlite3` |
| E2E | `com.webswe.civildesk.e2e` | `%APPDATA%\com.webswe.civildesk.e2e\civildesk.sqlite3` |
| **Development** | `com.webswe.civildesk.dev` | `%APPDATA%\com.webswe.civildesk.dev\civildesk.sqlite3` |

The development WebView profile (localStorage, cache) is `%LOCALAPPDATA%\com.webswe.civildesk.dev\EBWebView`.

## How it works
- `npm run tauri` runs `scripts/tauri.mjs`. For `tauri dev` (and only for it) it adds `--config src-tauri/tauri.dev.conf.json` unless you pass your own `--config`. `tauri build` and every other subcommand are passed through unchanged, so CI and release builds are unaffected.
- `src-tauri/tauri.dev.conf.json` sets the identifier, the title "CivilDesk Dev" and `appDirectoriesOverride` for data and local data, the same mechanism as the Acceptance and E2E configs. No Rust change was needed: the app already derives its database path from `app_data_dir()`.
- The Cargo target directory stays on `E:/build/cargo-target/civildesk` (`.cargo/config.toml`).

## Launch
```
npm install
npm run tauri dev      # first build compiles Rust; later runs are fast
```
The Vite dev server uses port 1420 (strict). If it reports the port is in use, close the previous dev window or stop its process first. The window title reads "CivilDesk Dev".

## Reset (development data only)
Close the dev app, then delete only the two development folders:
```
Remove-Item -Recurse "$env:APPDATA\com.webswe.civildesk.dev"
Remove-Item -Recurse "$env:LOCALAPPDATA\com.webswe.civildesk.dev"
```
Double-check the folder name ends in `.dev` before deleting. The next launch recreates a fresh database at the current schema.

## Verify
`npm run check:dev-config` asserts that the other three identities are unchanged, that the merged dev config resolves to `com.webswe.civildesk.dev`, that its data and WebView paths do not equal or nest inside any other identity's, and that the wrapper is wired in.

No updater is configured for development builds.
