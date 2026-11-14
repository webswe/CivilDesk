$ErrorActionPreference = 'Stop'
foreach ($name in @('run.ps1','standard-probe.ps1','provenance.ps1','lib/security-gates.ps1')) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw "$name has PowerShell syntax errors: $($errors -join '; ')" }
}
. (Join-Path $PSScriptRoot 'lib/security-gates.ps1')
$name = New-RehearsalAccountName -Suffix '0123456789ab'
if ($name -cne 'CDR0123456789ab' -or $name.Length -gt 20) { throw 'Short account-name fixture failed.' }
foreach ($case in @(
  @{suffix='0123456789ab';existing=@($name)},
  @{suffix='not-hex';existing=@()},
  @{suffix='0123456789abcdef012345';existing=@()}
)) {
  try { New-RehearsalAccountName -Suffix $case.suffix -ExistingNames $case.existing | Out-Null; throw 'Invalid account name accepted.' }
  catch { if ($_.Exception.Message -eq 'Invalid account name accepted.') { throw } }
}
$expected = 'S-1-5-21-111-222-333-444'
$parent = 'S-1-5-21-111-222-333-555'
if (@(Test-RehearsalToken -ExpectedSid $expected -ActualSid $expected -ParentSid $parent -Administrator:$false -Elevated:$false).Count) { throw 'Valid distinct token fixture failed.' }
foreach ($fixture in @(
  @{actual=$parent;admin=$false;elevated=$false;priv=@()},
  @{actual=$expected;admin=$true;elevated=$false;priv=@()},
  @{actual=$expected;admin=$false;elevated=$true;priv=@()},
  @{actual=$expected;admin=$false;elevated=$false;priv=@('SeDebugPrivilege')}
)) {
  if (-not @(Test-RehearsalToken -ExpectedSid $expected -ActualSid $fixture.actual -ParentSid $parent -Administrator:$fixture.admin -Elevated:$fixture.elevated -PrivilegeNames $fixture.priv).Count) {
    throw 'Invalid standard-user token fixture passed.'
  }
}
if (-not @(Test-RehearsalToken -ExpectedSid $expected -ActualSid $expected -ParentSid $parent -Administrator:$false -AdministratorGroupMember:$true -Elevated:$false).Count) {
  throw 'Administrator group membership fixture passed.'
}
if (-not (Test-ExpectedAccessDenied -Failure ([UnauthorizedAccessException]::new('denied'))) -or
    -not (Test-ExpectedAccessDenied -Failure ([IO.IOException]::new('access denied', -2147024891))) -or
    (Test-ExpectedAccessDenied -Failure ([IO.IOException]::new('sharing violation', -2147024864))) -or
    (Test-ExpectedAccessDenied -Failure ([IO.FileNotFoundException]::new('missing')))) {
  throw 'Access-denial classification fixtures failed.'
}
if (Test-ProbeTarget -Path (Join-Path $PSScriptRoot 'intentionally-absent.exe')) { throw 'Missing probe target accepted.' }
if ((Get-RehearsalExitFailure -PrimaryFailure 'primary' -CleanupFailures @('cleanup')) -cne 'primary' -or
    (Get-RehearsalExitFailure -CleanupFailures @('cleanup')) -cne 'cleanup') { throw 'Cleanup failure precedence fixture failed.' }
$cleanupGates = [ordered]@{}
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
Invoke-RehearsalCleanup -Name 'owned_account' -Gates $cleanupGates -Failures $cleanupFailures -Body { throw 'synthetic cleanup error' }
if ($cleanupGates.owned_account.status -cne 'FAIL' -or $cleanupFailures.Count -ne 1 -or
    (Get-RehearsalExitFailure -PrimaryFailure 'primary' -CleanupFailures $cleanupFailures.ToArray()) -cne 'primary') {
  throw 'Cleanup failure reporting fixture failed.'
}
$workflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../.github/workflows/protected-installation-rehearsal.yml')
$start = [Array]::FindIndex($workflow, [Predicate[string]]{param($line) $line -eq '        run: |'})
if ($start -lt 0) { throw 'Preflight run block not found.' }
$blockLines = [System.Collections.Generic.List[string]]::new()
for ($index = $start + 1; $index -lt $workflow.Count; $index++) {
  if ($workflow[$index] -match '^      - ') { break }
  if ($workflow[$index] -notmatch '^          ') { throw 'Malformed preflight block.' }
  $blockLines.Add($workflow[$index].Substring(10))
}
$preflight = [scriptblock]::Create(($blockLines -join "`n"))
$fixtureEnv = [ordered]@{
  GITHUB_ACTIONS='true'; GITHUB_REPOSITORY='webswe/CivilDesk'; GITHUB_EVENT_NAME='workflow_dispatch';
  GITHUB_REF='refs/heads/main'; GITHUB_WORKFLOW_SHA=('a' * 40); GITHUB_SHA=('a' * 40);
  RUNNER_OS='Windows'; RUNNER_ARCH='X64'; RUNNER_ENVIRONMENT='github-hosted';
  REVIEWED_SOURCE_SHA=('b' * 40); APPROVED_SOURCE_SHA=('b' * 40)
}
$priorEnv = @{}
try {
  foreach ($key in $fixtureEnv.Keys) {
    $priorEnv[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
    [Environment]::SetEnvironmentVariable($key,$fixtureEnv[$key],'Process')
  }
  & $preflight | Out-Null
  foreach ($fixture in @(
    @{key='APPROVED_SOURCE_SHA';value=''},
    @{key='APPROVED_SOURCE_SHA';value=('c' * 40)},
    @{key='RUNNER_ENVIRONMENT';value='self-hosted'},
    @{key='GITHUB_EVENT_NAME';value='push'},
    @{key='GITHUB_REF';value='refs/heads/verification/scope-a-installation-rehearsal'}
  )) {
    [Environment]::SetEnvironmentVariable($fixture.key,$fixture.value,'Process')
    $rejected = $false
    try { & $preflight | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Preflight accepted invalid $($fixture.key)." }
    [Environment]::SetEnvironmentVariable($fixture.key,$fixtureEnv[$fixture.key],'Process')
  }
} finally {
  foreach ($key in $fixtureEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$priorEnv[$key],'Process') }
}
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$migrationTemp = Join-Path $repo 'src-tauri/target/rehearsal-local-fixture'
if (Test-Path -LiteralPath $migrationTemp) { throw 'Local synthetic migration fixture path already exists.' }
try {
  $migrationJson = & python (Join-Path $PSScriptRoot 'synthetic_migration.py') --repo $repo --temp-root $migrationTemp
  if ($LASTEXITCODE -ne 0 -or ($migrationJson | ConvertFrom-Json).status -cne 'PASS') { throw 'Synthetic migration fixture failed.' }
} finally {
  if (Test-Path -LiteralPath $migrationTemp) {
    foreach ($item in @(Get-ChildItem -LiteralPath $migrationTemp -Force -ErrorAction Stop)) {
      if ($item.PSIsContainer -or $item.Name -cnotmatch '^civildesk-synthetic-[0-9a-f]{32}-(v8|backup|failed)\.sqlite3$') { throw 'Unexpected local synthetic migration fixture.' }
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
    }
    Remove-Item -LiteralPath $migrationTemp -Force -ErrorAction Stop
  }
}
$provenanceEnv = [ordered]@{
  GITHUB_ACTIONS='true'; RUNNER_ENVIRONMENT='github-hosted'; RUNNER_OS='Windows'; RUNNER_ARCH='X64';
  GITHUB_REPOSITORY='webswe/CivilDesk'; GITHUB_EVENT_NAME='workflow_dispatch'; GITHUB_REF='refs/heads/main';
  GITHUB_WORKFLOW_SHA=('a' * 40); GITHUB_SHA=('a' * 40); GITHUB_WORKSPACE=$repo;
  APPROVED_SOURCE_SHA=('c' * 40)
}
$priorProvenanceEnv = @{}
try {
  foreach ($key in $provenanceEnv.Keys) {
    $priorProvenanceEnv[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
    [Environment]::SetEnvironmentVariable($key,$provenanceEnv[$key],'Process')
  }
  $rejected = $false
  try { & (Join-Path $PSScriptRoot 'provenance.ps1') -ExpectedSha ('c' * 40) -Phase checkout | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Mismatched checkout SHA accepted.' }
  [Environment]::SetEnvironmentVariable('APPROVED_SOURCE_SHA',$null,'Process')
  $rejected = $false
  try { & (Join-Path $PSScriptRoot 'provenance.ps1') -ExpectedSha ('c' * 40) -Phase checkout | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Missing independently approved SHA accepted.' }
} finally {
  foreach ($key in $provenanceEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$priorProvenanceEnv[$key],'Process') }
}
try {
  & (Join-Path $PSScriptRoot 'run.ps1') -SourceSha ('a' * 40) -TargetDirectory $PSScriptRoot
  throw 'Runner guard accepted a local execution.'
} catch {
  if ($_.Exception.Message -notlike '*Disposable GitHub-hosted rehearsal guard failed*') { throw }
}
'PowerShell syntax, authorization, account, token, access-denial, cleanup, and local execution guards passed.'
