// Build-configuration guard for the test-only Notion mock (cargo feature `notion-mock`).
// It inspects every file that can influence a distributed build and returns a list of violations (empty = safe).
// This is static validation of the repository; it complements, and does not replace, the compile-time `cfg` gating in Rust.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const E2E_WORKFLOW = '.github/workflows/e2e-windows.yml';

export function hasE2eCredentialSourceControls(source) {
  const text = source.replace(/\r\n/g, '\n');
  return text.includes('#[cfg(feature = "notion-mock")]\npub struct E2eMemoryStore')
    && text.includes('http://127.0.0.1:4456/credential')
    && text.includes('#[ignore = "manual OS credential-store test; excluded from offline verification"]');
}

// Anything that selects Cargo features, sets compiler cfg flags or supplies the mock endpoint.
// Forbidden in every distribution surface (release, Acceptance, CI, package scripts, Tauri configs, cargo config).
const FORBIDDEN_IN_DISTRIBUTION = [
  [/notion[-_ ]?mock/i, 'references the Notion mock'],
  [/CIVILDESK_NOTION/i, 'configures a Notion endpoint/mock variable'],
  [/--all-features\b/, 'enables all Cargo features'],
  [/--features\b|(^|\s)-F(\s+|=)\S|^.*(^|\s)(cargo|tauri)\s.*\s-F\S.*$|CARGO_FEATURE|CARGO_BUILD_FEATURES/m, 'selects Cargo features'],
  [/--cfg\b|rustflags/i, 'passes cfg/rustflags to the compiler'],
];

/** @param {string} root repository root */
export function checkNotionMockIsolation(root) {
  const problems = [];
  const has = f => existsSync(path.join(root, f));
  const read = f => readFileSync(path.join(root, f), 'utf8');
  const fail = msg => problems.push(msg);

  // 1. Cargo features: defined once, empty, and unreachable from `default`, another feature or a dependency.
  const stripped = read('src-tauri/Cargo.toml').split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  const mentions = stripped.match(/notion-mock/g) ?? [];
  if (!/^\s*notion-mock\s*=\s*\[\s*\]\s*$/m.test(stripped) || mentions.length !== 1) {
    fail('Cargo.toml: notion-mock must be defined exactly once as an empty feature and never referenced by another feature or dependency.');
  }
  const featuresBlock = /^\[features\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(stripped)?.[1] ?? '';
  const defaults = /^\s*default\s*=\s*\[([\s\S]*?)\]/m.exec(featuresBlock)?.[1] ?? '';
  if (/notion-mock/.test(defaults)) fail('Cargo.toml: notion-mock must not be a default feature.');

  // 2. Distribution surfaces must not select features, set cfg flags or mention the mock at all.
  const surfaces = new Set(['package.json', '.cargo/config.toml', 'src-tauri/.cargo/config.toml', 'src-tauri/build.rs', 'src-tauri/rust-toolchain.toml', 'rust-toolchain.toml']);
  if (has('.github/workflows')) {
    for (const f of readdirSync(path.join(root, '.github/workflows'))) {
      if (/\.ya?ml$/.test(f) && '.github/workflows/' + f !== E2E_WORKFLOW) surfaces.add('.github/workflows/' + f);
    }
  }
  for (const f of readdirSync(path.join(root, 'src-tauri'))) {
    if (/^tauri(\..+)?\.conf\.json$/.test(f) && f !== 'tauri.e2e.conf.json') surfaces.add('src-tauri/' + f);
  }
  if (has('scripts')) {
    for (const f of readdirSync(path.join(root, 'scripts'))) {
      if (/\.(mjs|js|cjs|ps1|sh)$/.test(f) && f !== 'check-e2e-config.mjs' && !/\.test\./.test(f)) surfaces.add('scripts/' + f);
    }
  }
  for (const f of surfaces) {
    if (!has(f)) continue;
    const text = read(f);
    for (const [pattern, why] of FORBIDDEN_IN_DISTRIBUTION) if (pattern.test(text)) fail(`${f}: ${why}.`);
  }

  // 3. The E2E workflow is the only place the feature is enabled: one E2E build command, loopback mock URL only.
  if (has(E2E_WORKFLOW)) {
    const text = read(E2E_WORKFLOW);
    const enabling = text.split(/\r?\n/).filter(l => /--features|(^|\s)-F\s|--all-features/.test(l));
    const notionBuilds = enabling.filter(l => /--features notion-mock\s*$/.test(l));
    const fixtureBuilds = enabling.filter(l => /cargo build/.test(l) && /--bin brightspace-synthetic/.test(l) && /--features e2e-brightspace-fixture\s+--locked\s*$/.test(l));
    const ok = enabling.length === 2 && notionBuilds.length === 1 && fixtureBuilds.length === 1
      && /tauri build/.test(notionBuilds[0]) && /tauri\.e2e\.conf\.json/.test(notionBuilds[0]) && /--no-bundle/.test(notionBuilds[0]);
    if (!ok) fail(`${E2E_WORKFLOW}: only the dedicated fixture build and E2E Tauri build may select features.`);
    for (const m of text.matchAll(/CIVILDESK_NOTION\w*\s*[:=]\s*(\S+)/g)) {
      if (!/^['"]?http:\/\/127\.0\.0\.1[:/'"]/.test(m[1])) fail(`${E2E_WORKFLOW}: mock endpoint must be http://127.0.0.1.`);
    }
  }

  // 4. Rust: the env var is read only inside the feature-gated base_url, in the Notion client.
  const walk = d => readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  for (const f of walk('src-tauri/src').filter(x => x.endsWith('.rs'))) {
    const text = read(f);
    if (!text.includes('CIVILDESK_NOTION_MOCK_URL')) continue;
    if (f !== 'src-tauri/src/notion/client.rs') { fail(`${f}: must not read the mock endpoint.`); continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('CIVILDESK_NOTION_MOCK_URL') || lines[i].trim().startsWith('//')) continue;
      let j = i;
      while (j >= 0 && !/^\s*(pub\s+)?fn\s/.test(lines[j])) j--;
      if (j < 1 || lines[j - 1].trim() !== '#[cfg(feature = "notion-mock")]') fail(`${f}:${i + 1}: mock endpoint read is not inside a notion-mock-gated function.`);
    }
  }
  return problems;
}
