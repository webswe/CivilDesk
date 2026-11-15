param(
  [Parameter(Mandatory)][string]$BaselineInstaller,
  [Parameter(Mandatory)][string]$CandidateInstaller,
  [Parameter(Mandatory)][string]$BaselineSha,
  [Parameter(Mandatory)][string]$CandidateSha
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:GITHUB_ACTIONS -cne 'true' -or $env:CI -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
  throw 'Installer execution is allowed only on a disposable GitHub-hosted Windows runner.'
}
if ($BaselineSha -cne '7d293bbc61dce674d796220e3241571a9f15aa6b' -or $CandidateSha -notmatch '^[a-f0-9]{40}$' -or $CandidateSha -ceq $BaselineSha) {
  throw 'Source commit identity is invalid.'
}
$data = Join-Path $env:APPDATA 'com.webswe.civildesk'
$db = Join-Path $data 'civildesk.sqlite3'
$install = Join-Path $env:LOCALAPPDATA 'CivilDesk'
$exe = Join-Path $install 'civildesk.exe'
$uninstaller = Join-Path $install 'uninstall.exe'
$temp = Join-Path $env:RUNNER_TEMP 'civildesk-release-rehearsal'
$attachment = Join-Path $temp 'Drawing.txt'
$fixture = Join-Path $PSScriptRoot 'fixture.mjs'
$probe = Join-Path $PSScriptRoot 'probe-app.mjs'
if ((Test-Path -LiteralPath $data) -or (Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $temp)) {
  throw 'The disposable runner is not clean; refusing to touch pre-existing CivilDesk files.'
}
New-Item -ItemType Directory -Path $temp | Out-Null

function Invoke-Node([string[]]$Arguments) {
  $result = & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Node fixture command failed: $($Arguments[1])" }
  return $result
}
function RegistryEntry {
  $entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -eq 'CivilDesk' })
  if ($entries.Count -ne 1) { throw "Expected one HKCU CivilDesk uninstall entry, found $($entries.Count)." }
  return $entries[0]
}
function Assert-Installed([string]$Version) {
  if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $uninstaller)) { throw 'Expected current-user installation files are missing.' }
  $entry = RegistryEntry
  if ($entry.DisplayVersion -notlike "$Version*") { throw "HKCU uninstall version mismatch: $($entry.DisplayVersion)" }
  $actualVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ($actualVersion -notlike "$Version*") { throw "Installed executable version mismatch: $actualVersion" }
  $extra = @(Get-ChildItem -LiteralPath $install -Filter '*.exe' -Recurse -File | Where-Object { $_.Name -notin @('civildesk.exe','uninstall.exe') })
  if ($extra.Count) { throw "Unexpected installed executable(s): $($extra.Name -join ', ')" }
  foreach ($forbidden in @('civildesk-e2e.exe','brightspace-synthetic.exe','civildesk.sqlite3','.env')) {
    if (Get-ChildItem -LiteralPath $install -File -Recurse | Where-Object Name -eq $forbidden) { throw "Forbidden bundled file: $forbidden" }
  }
  $acl = Get-Acl -LiteralPath $exe
  "Installed $Version in $install; HKCU registration present; owner $($acl.Owner); ACL $($acl.Sddl)"
}
function Install([string]$Installer, [string]$Version) {
  $file = (Resolve-Path -LiteralPath $Installer -ErrorAction Stop).Path
  if ([IO.Path]::GetFileName($file) -cne "CivilDesk_${Version}_x64-setup.exe") { throw 'Unexpected NSIS installer filename.' }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  "Installer $Version SHA-256 $hash; Authenticode $($signature.Status)"
  $process = Start-Process -FilePath $file -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "NSIS installer $Version failed with exit code $($process.ExitCode)." }
  Assert-Installed $Version
}
function Start-And-Check([string]$ChallengeId, [int]$Port) {
  $previous = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
  $process = Start-Process -FilePath $exe -PassThru
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previous
  try {
    for ($i=0; $i -lt 60; $i++) {
      $process.Refresh()
      if ($process.HasExited) { throw 'Installed application exited before verification.' }
      if ($process.MainWindowHandle -ne 0 -and (Test-Path -LiteralPath $db)) { break }
      Start-Sleep -Milliseconds 500
    }
    if ($process.MainWindowHandle -eq 0 -or -not (Test-Path -LiteralPath $db)) { throw 'Installed application did not open its window and database.' }
    if ($ChallengeId) { Invoke-Node @($probe, $db, $attachment, $ChallengeId, [string]$Port) | Out-Host }
  } finally {
    if (-not $process.HasExited) {
      if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(15000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'Installed application did not close cleanly; backup and upgrade are blocked.'
      }
    }
  }
}
function Inspect([string]$ChallengeId, [string]$Output) {
  Invoke-Node @($fixture, 'inspect', $db, $attachment, $ChallengeId, $Output) | Out-Null
}
function Uninstall {
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller is missing.' }
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstaller failed with exit code $($process.ExitCode)." }
  if (Test-Path -LiteralPath $exe) { throw 'Application binary remains after uninstall.' }
  if (-not (Test-Path -LiteralPath $db)) { throw 'Uninstall removed the synthetic user database.' }
  if (-not (Test-Path -LiteralPath $attachment)) { throw 'Uninstall removed the external synthetic file.' }
  $entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -eq 'CivilDesk' })
  if ($entries.Count) { throw 'HKCU CivilDesk uninstall entry remains.' }
}

try {
  Install $BaselineInstaller '0.1.0'
  Start-And-Check '' 9228 # Real baseline binary creates and seeds a fresh schema-v10 profile.
  $challenge = (Invoke-Node @($fixture, 'seed', $db, $attachment) | Select-Object -Last 1).Trim()
  Start-And-Check $challenge 9229
  $before = Join-Path $temp 'before.json'
  Inspect $challenge $before
  $backup = Join-Path $temp 'pre-upgrade.sqlite3'
  $rollback = Join-Path $temp 'rollback.sqlite3'
  "Pre-upgrade backup SHA-256 $(Invoke-Node @($fixture, 'backup', $db, $attachment, $challenge, $backup))"
  "Independent rollback snapshot SHA-256 $(Invoke-Node @($fixture, 'backup', $db, $attachment, $challenge, $rollback))"
  Install $CandidateInstaller '0.1.1'
  Start-And-Check $challenge 9230
  $after = Join-Path $temp 'after.json'
  Inspect $challenge $after
  if ((Get-Content -LiteralPath $before -Raw) -cne (Get-Content -LiteralPath $after -Raw)) { throw 'Synthetic records changed after the versioned upgrade.' }
  Start-And-Check $challenge 9231
  $restart = Join-Path $temp 'restart.json'
  Inspect $challenge $restart
  if ((Get-Content -LiteralPath $before -Raw) -cne (Get-Content -LiteralPath $restart -Raw)) { throw 'Synthetic records changed after restart.' }
  Uninstall
  Install $BaselineInstaller '0.1.0'
  Invoke-Node @($fixture, 'restore', $db, $attachment, $challenge, $rollback) | Out-Null
  Start-And-Check $challenge 9232
  $restored = Join-Path $temp 'restored.json'
  Inspect $challenge $restored
  if ((Get-Content -LiteralPath $before -Raw) -cne (Get-Content -LiteralPath $restored -Raw)) { throw 'Rollback did not restore the synthetic records.' }
  Uninstall
  'PASS: installed baseline, versioned upgrade, restart, uninstall retention, and independent rollback on synthetic data.'
} finally {
  # Start-And-Check owns and closes only the process it created. The hosted runner is disposed.
  'Runner-local synthetic files remain only until this hosted runner is discarded.'
}
