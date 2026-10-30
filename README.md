# CivilDesk

A local-first Windows desktop workspace for a civil engineering student or early-career professional. Phase 1 establishes the Rosewood desktop shell, onboarding, persistent settings, dashboard, and Pip companion. Other navigation destinations are explicitly marked as future milestones.

## Development

Requires Node 24, npm, Rust stable with MSVC target, Windows C++ build tools, and WebView2. Run `npm ci`, then `npm run tauri dev`. `npm run dev` opens a browser preview that stores preview preferences in browser local storage; the packaged Windows app uses SQLite under the user's application-data directory.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run tauri build -- --bundles nsis`.

See [architecture](docs/ARCHITECTURE.md) for schema, challenge, Notion, Pip, and release plans. Use the [native Windows acceptance procedure](docs/NATIVE_VERIFICATION.md) after CI produces an installer.

## Local validation status

The frontend checks and browser preview can run with Node alone. This development machine initially lacked Rust and Visual C++ Build Tools. Rust was installed, but the Visual C++ installer exited with code 1602, leaving `link.exe` unavailable. Consequently the native Rust tests and Windows NSIS package could not be completed locally. CI is configured to run those checks on a hosted Windows runner; its first result must be reviewed before calling the native milestone verified. The release workflow is a manual draft pipeline and has not been exercised.
