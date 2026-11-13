import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkNotionMockIsolation } from './notion-mock-guard.mjs';

// Every negative case runs against a disposable copy; the real workflows are never modified.
const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-guard-'));
  dirs.push(dir);
  for (const rel of ['.github', 'src-tauri/Cargo.toml', 'src-tauri/src', 'src-tauri/tauri.conf.json', 'src-tauri/tauri.release.conf.json', 'src-tauri/tauri.acceptance.conf.json', 'src-tauri/tauri.e2e.conf.json', 'package.json', 'scripts/tauri.mjs']) {
    fs.cpSync(path.join(real, rel), path.join(dir, rel), { recursive: true });
  }
  // .cargo/ is untracked developer configuration, so the fixture never copies it; it writes its own minimal file.
  fs.mkdirSync(path.join(dir, '.cargo'));
  fs.writeFileSync(path.join(dir, '.cargo/config.toml'), '[build]\ntarget-dir = "target"\n');
  return dir;
}
function edit(dir, rel, from, to) {
  const f = path.join(dir, rel);
  const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); // Windows checkouts use CRLF; anchors are written with LF.
  if (!text.includes(from)) throw new Error('fixture anchor missing in ' + rel + ': ' + from);
  fs.writeFileSync(f, text.replace(from, to));
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('notion-mock build guard', () => {
  it('passes for the real repository configuration', () => { expect(checkNotionMockIsolation(real)).toEqual([]); });
  it('passes for an untouched copy', () => { expect(checkNotionMockIsolation(fixture())).toEqual([]); });

  it('fails when a production build enables the mock', () => {
    const d = fixture();
    edit(d, '.github/workflows/release.yml', '--bundles nsis', '--bundles nsis -- --features notion-mock');
    expect(checkNotionMockIsolation(d).join()).toContain('release.yml');
  });
  it('fails when an Acceptance build enables the mock', () => {
    const d = fixture();
    edit(d, '.github/workflows/acceptance-build.yml', '--bundles nsis', '--bundles nsis -- --features notion-mock');
    expect(checkNotionMockIsolation(d).join()).toContain('acceptance-build.yml');
  });
  it('fails for equivalent routes: --all-features, -F, env vars, rustflags, npm scripts, Tauri build.features', () => {
    for (const [file, from, to] of [
      ['.github/workflows/ci.yml', 'cargo test --manifest-path', 'cargo test --all-features --manifest-path'],
      ['.github/workflows/ci.yml', 'cargo test --manifest-path', 'cargo test -F notion_mock --manifest-path'],
      ['.github/workflows/release.yml', 'steps:', 'env:\n      CARGO_BUILD_FEATURES: x\n    steps:'],
      ['.cargo/config.toml', '[build]', '[build]\nrustflags = ["--cfg", "x"]'],
      ['package.json', '"build": "tsc -b && vite build"', '"build": "tauri build -- --features notion-mock"'],
      ['src-tauri/tauri.release.conf.json', '{', '{"build":{"features":["notion-mock"]},'],
    ]) {
      const d = fixture();
      edit(d, file, from, to);
      expect(checkNotionMockIsolation(d), file + ' -> ' + to).not.toEqual([]);
    }
  });
  it('rejects forbidden rustflags in a fixture-created .cargo/config.toml, for that reason', () => {
    const d = fixture();
    edit(d, '.cargo/config.toml', '[build]', '[build]\nrustflags = ["--cfg", "feature=\\"x\\""]');
    expect(checkNotionMockIsolation(d)).toEqual(['.cargo/config.toml: passes cfg/rustflags to the compiler.']);
  });
  it('fails when the feature becomes a default Cargo feature', () => {
    const d = fixture();
    edit(d, 'src-tauri/Cargo.toml', '[features]', '[features]\ndefault = ["notion-mock"]');
    expect(checkNotionMockIsolation(d).join()).toContain('default feature');
  });
  it('fails when another feature aliases the mock', () => {
    const d = fixture();
    fs.appendFileSync(path.join(d, 'src-tauri/Cargo.toml'), '\nfull = ["notion-mock"]\n');
    expect(checkNotionMockIsolation(d)).not.toEqual([]);
  });
  it('fails when a distribution build supplies a mock endpoint', () => {
    for (const file of ['.github/workflows/release.yml', '.github/workflows/acceptance-build.yml', '.github/workflows/ci.yml']) {
      const d = fixture();
      edit(d, file, 'steps:', 'env:\n      CIVILDESK_NOTION_MOCK_URL: http://127.0.0.1:9\n    steps:');
      expect(checkNotionMockIsolation(d).join(), file).toContain('Notion endpoint');
    }
  });
  it('fails when the E2E workflow points the mock off-loopback or enables extra features', () => {
    let d = fixture();
    edit(d, '.github/workflows/e2e-windows.yml', 'steps:', 'env:\n      CIVILDESK_NOTION_MOCK_URL: https://api.notion.com\n    steps:');
    expect(checkNotionMockIsolation(d).join()).toContain('http://127.0.0.1');
    d = fixture();
    edit(d, '.github/workflows/e2e-windows.yml', 'cargo install tauri-driver --version 2.1.0 --locked', 'cargo build --all-features');
    expect(checkNotionMockIsolation(d)).not.toEqual([]);
  });
  it('fails when the E2E workflow stops being the single enabling build', () => {
    const d = fixture();
    edit(d, '.github/workflows/e2e-windows.yml', '-- --features notion-mock', '');
    expect(checkNotionMockIsolation(d)).not.toEqual([]);
  });
  it('fails when the mock endpoint is read outside the feature-gated function', () => {
    const d = fixture();
    edit(d, 'src-tauri/src/notion/client.rs', '#[cfg(feature = "notion-mock")]\npub fn base_url', 'pub fn base_url');
    expect(checkNotionMockIsolation(d).join()).toContain('client.rs');
  });
});
