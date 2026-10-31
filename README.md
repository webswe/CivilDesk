# CivilDesk

A local-first Windows desktop workspace for a civil engineering student or early-career professional. The Rosewood workspace includes onboarding, tasks, focus sessions, a local calendar, in-app reminders, and Pip's first earned progression. Engineering and academic destinations remain clearly labeled future work.

## Development

Requires Node 24, npm, Rust stable with MSVC target, Windows C++ build tools, and WebView2. Run `npm ci`, then `npm run tauri dev`. `npm run dev` opens a browser preview: only preview preferences use browser local storage, while preview tasks and events are temporary in-memory examples. The packaged Windows app uses SQLite under the user's application-data directory for all productivity data.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri build -- --bundles nsis`.

See [architecture](docs/ARCHITECTURE.md) for schema, challenge, Notion, Pip, and release plans. See [Phase 2 verification](docs/PHASE2_VERIFICATION.md) for current checks and limitations. The [native Windows acceptance record](docs/NATIVE_VERIFICATION.md) applies to the prior Phase 1 installer.

## Local validation status

The Phase 1 Windows build and installer were verified through CI and a disposable profile; see the native acceptance record. This development machine still lacks MSVC `link.exe`, so Phase 2 Rust compilation, tests, and packaging require a new Windows CI run. No Phase 2 commits have been pushed or released. The release workflow remains a manual draft pipeline and has not been exercised.
