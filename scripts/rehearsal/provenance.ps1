param(
  [Parameter(Mandatory)][string]$ExpectedSha,
  [Parameter(Mandatory)][ValidateSet('checkout','dependencies','build')][string]$Phase
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_REPOSITORY -cne 'webswe/CivilDesk' -or
    $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or $env:GITHUB_REF -cne 'refs/heads/main' -or
    $env:GITHUB_WORKFLOW_SHA -cne $env:GITHUB_SHA -or $env:GITHUB_WORKSPACE -ine $repo -or
    $ExpectedSha -cnotmatch '^[0-9a-f]{40}$' -or
    $env:APPROVED_SOURCE_SHA -cne $ExpectedSha) { throw 'Checkout provenance runner or owner authorization check failed.' }
$head = (git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -cne $ExpectedSha) { throw 'Checkout HEAD differs from independently approved SHA.' }
& git -C $repo diff --quiet --exit-code HEAD --
if ($LASTEXITCODE -ne 0) { throw 'Tracked checkout content differs from approved commit.' }
$untracked = @(git -C $repo ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0 -or $untracked.Count) { throw 'Unexpected untracked source file in checkout.' }
foreach ($path in @(
  'package.json','package-lock.json','src-tauri/Cargo.lock','src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json','src-tauri/tauri.protected.conf.json',
  'src-tauri/src/brightspace_package.rs',
  '.github/workflows/protected-installation-rehearsal.yml',
  'scripts/rehearsal/run.ps1','scripts/rehearsal/standard-probe.ps1',
  'scripts/rehearsal/provenance.ps1','scripts/rehearsal/lib/security-gates.ps1',
  'scripts/rehearsal/check-workflow.mjs','scripts/rehearsal/test-local.ps1',
  'scripts/rehearsal/synthetic-manifest.mjs','scripts/rehearsal/synthetic_migration.py'
)) {
  $expectedBlob = (git -C $repo rev-parse "${ExpectedSha}:$path").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Approved commit lacks $path." }
  $actualBlob = (git -C $repo hash-object -- (Join-Path $repo $path)).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualBlob -cne $expectedBlob) { throw "Approved source blob changed: $path." }
}
if ($Phase -ne 'checkout') {
  if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules/@tauri-apps/cli/package.json') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $repo 'node_modules/@esbuild/win32-x64/esbuild.exe') -PathType Leaf)) {
    throw 'Locked Windows build dependencies are missing.'
  }
}
if ($Phase -eq 'build') {
  $target = (Resolve-Path -LiteralPath $env:CARGO_TARGET_DIR).Path
  if (-not $target.StartsWith((Join-Path $repo 'src-tauri/target') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build target escaped expected ignored output directory.'
  }
}
"Approved source $ExpectedSha remains clean after $Phase. Ignored outputs are limited to node_modules, dist, and src-tauri/target."
