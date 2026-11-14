param(
  [Parameter(Mandatory)][string]$SourceSha,
  [Parameter(Mandatory)][string]$TargetDirectory,
  [string]$ControlledEndpointIp,
  [int]$ControlledEndpointPort
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$expectedRef = 'refs/heads/main'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -cne 'webswe/CivilDesk' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
    $env:GITHUB_REF -cne $expectedRef -or $env:GITHUB_WORKFLOW_SHA -cne $env:GITHUB_SHA -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or $env:GITHUB_WORKSPACE -ine $repo -or
    $SourceSha -cnotmatch '^[0-9a-f]{40}$' -or (git rev-parse HEAD).Trim() -cne $SourceSha -or
    $env:APPROVED_SOURCE_SHA -cne $SourceSha) { throw 'Disposable GitHub-hosted rehearsal guard failed.' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator runner token required.' }
if (-not $env:RUNNER_TEMP -or -not (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) { throw 'Runner temp unavailable.' }
if ([bool]$ControlledEndpointIp -ne [bool]$ControlledEndpointPort) { throw 'Controlled endpoint IP and port must be supplied together.' }
if ($ControlledEndpointIp) {
  $address = $null
  if (-not [Net.IPAddress]::TryParse($ControlledEndpointIp, [ref]$address) -or
      $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
      [Net.IPAddress]::IsLoopback($address) -or $ControlledEndpointPort -lt 1 -or $ControlledEndpointPort -gt 65535) {
    throw 'Controlled endpoint must be a non-loopback IPv4 address and valid TCP port.'
  }
}
$target = (Resolve-Path -LiteralPath $TargetDirectory).Path
if (-not $target.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build target.' }
$report = Join-Path $env:RUNNER_TEMP 'civildesk-rehearsal-results.json'
if (Test-Path -LiteralPath $report) { throw 'Existing rehearsal report; refusing to overwrite.' }
$results = [ordered]@{
  source_sha=$SourceSha; runner_image=$env:ImageOS; runner_image_version=$env:ImageVersion;
  windows_version=[Environment]::OSVersion.VersionString; tauri_version=''; rust_version=(rustc --version); installer_sha256='';
  authenticode=''; nsis_mode='perMachine'; generated_nsi_sha256=''; paths=[ordered]@{};
  registry=[ordered]@{}; standard_user=[ordered]@{}; acl=[ordered]@{}; firewall=[ordered]@{}; sqlite=[ordered]@{}; gates=[ordered]@{};
  note='GitHub Windows runners disable UAC; this does not verify UAC prompts.'
}
. (Join-Path $PSScriptRoot 'lib/security-gates.ps1')
foreach ($name in @('installer_metadata','installer_identity','machine_install','hklm_registration','account_create','standard_user_launch',
  'synthetic_acl_setup','synthetic_acl','synthetic_manifest','canonical_and_reparse','firewall_rule','firewall_removal','firewall_enforcement','migration','transition_prepare','transition',
  'uninstall_preservation','reinstall','rollback','final_uninstall','account_cleanup','fixture_cleanup','firewall_cleanup')) { $results.gates[$name] = [ordered]@{status='NOT VERIFIED'; detail='not reached'} }
function Gate([string]$name,[scriptblock]$body) {
  try { $detail = & $body; $results.gates[$name] = [ordered]@{status='PASS'; detail=$detail} }
  catch { $results.gates[$name] = [ordered]@{status='FAIL'; detail=$_.Exception.Message}; throw }
}
function Cleanup-Gate([string]$name,[scriptblock]$body) {
  Invoke-RehearsalCleanup -Name $name -Gates $results.gates -Failures $cleanupFailures -Body $body
}
function Save-Report {
  $results | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $report -Encoding UTF8
  $summary = @('### Disposable installation rehearsal', '', "Source: ``$SourceSha``", '', '| Gate | Status |', '| --- | --- |')
  foreach ($name in $results.gates.Keys) { $summary += "| $name | $($results.gates[$name].status) |" }
  $summary += '', 'UAC prompts are not verified on GitHub-hosted Windows runners. No installer artifact was uploaded.'
  if ($env:GITHUB_STEP_SUMMARY) { $summary | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY }
  Write-Output ($results | ConvertTo-Json -Depth 12)
}
function Test-SyntheticTcp {
  $code = @"
`$client = New-Object Net.Sockets.TcpClient
try {
  `$pending = `$client.BeginConnect('$ControlledEndpointIp', $ControlledEndpointPort, `$null, `$null)
  if (-not `$pending.AsyncWaitHandle.WaitOne(5000)) { exit 3 }
  `$client.EndConnect(`$pending)
  exit 0
} catch { exit 3 } finally { `$client.Dispose() }
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  $process = Start-Process -FilePath (Join-Path $syntheticRoot 'd2l.exe') -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded" -Wait -PassThru
  return $process.ExitCode -eq 0
}
$testUser = $null
$testUserSid = $null
$testUserOwned = $false
$firewallRule = $null
$syntheticTransitionCreated = $false
$syntheticPackageOwned = $false
$installationOwned = $false
$linkCreated = $false
$probeDirOwned = $false
$migrationFixtureOwned = $false
$primaryFailure = $null
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
$migrationFixtureRoot = Join-Path $repo 'src-tauri/target/rehearsal-fixtures'
$syntheticUserInstall = Join-Path $env:LOCALAPPDATA 'Programs\CivilDesk-Rehearsal'
$syntheticUserKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CivilDesk-Rehearsal-Synthetic'
$syntheticShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\CivilDesk.lnk'
$installRoot = Join-Path ${env:ProgramFiles} 'CivilDesk'
$syntheticRoot = Join-Path ${env:ProgramFiles} 'CivilDesk D2L-CLI Rehearsal\synthetic'
try {
  Gate 'installer_metadata' {
    . (Join-Path $repo 'scripts/lib/protected-installer-metadata.ps1')
    $base = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
    $overlay = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.protected.conf.json') -Raw | ConvertFrom-Json
    if ($base.identifier -cne 'com.webswe.civildesk' -or $overlay.bundle.windows.nsis.installMode -cne 'perMachine') { throw 'Identity or mode changed.' }
    $nsi = Join-Path $target 'release/nsis/x64/installer.nsi'
    if (@(Test-ProtectedNsi -Script (Get-Content -LiteralPath $nsi -Raw) -Identity $base.identifier).Count) { throw 'Generated NSIS policy failed.' }
    $script:installer = @(Get-ChildItem -LiteralPath (Join-Path $target 'release/bundle/nsis') -Filter '*.exe' -File)
    if ($script:installer.Count -ne 1) { throw 'Expected exactly one installer.' }
    if ($script:installer[0].Name -cne "CivilDesk_$($base.version)_x64-setup.exe") { throw 'Unexpected installer name.' }
    if (@(Test-InstallerVersionMetadata -VersionInfo $script:installer[0].VersionInfo -ExpectedVersion $base.version).Count) { throw 'PE metadata mismatch.' }
    $results.tauri_version = [string](Get-Content -LiteralPath (Join-Path $repo 'node_modules/@tauri-apps/cli/package.json') -Raw | ConvertFrom-Json).version
    $results.installer_sha256 = (Get-FileHash -LiteralPath $script:installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $results.generated_nsi_sha256 = (Get-FileHash -LiteralPath $nsi -Algorithm SHA256).Hash.ToLowerInvariant()
    $results.authenticode = (Get-AuthenticodeSignature -LiteralPath $script:installer[0].FullName).Status.ToString()
    $results.paths.installer = $script:installer[0].FullName
    $results.paths.install_root = $installRoot
    'Generated NSIS, PE metadata, and pre-install SHA-256 verified.'
  }
  Gate 'installer_identity' {
    if ($results.authenticode -ne 'NotSigned') { throw "Unexpected Authenticode status: $($results.authenticode)" }
    if ((Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $results.installer_sha256) { throw 'Installer changed after hash.' }
    'Unsigned test candidate identified by same-job source and SHA-256; no publisher identity is claimed.'
  }
  Gate 'transition_prepare' {
    if ((Test-Path -LiteralPath $syntheticUserInstall) -or (Test-Path -LiteralPath $syntheticUserKey) -or (Test-Path -LiteralPath $syntheticShortcut)) { throw 'Synthetic current-user fixture path already exists.' }
    New-Item -ItemType Directory -Path $syntheticUserInstall -ErrorAction Stop | Out-Null
    $script:syntheticTransitionCreated = $true
    [IO.File]::WriteAllText((Join-Path $syntheticUserInstall 'CivilDesk.exe'), 'synthetic-current-user-install')
    New-Item -Path $syntheticUserKey -ErrorAction Stop | Out-Null
    Set-ItemProperty -Path $syntheticUserKey -Name DisplayName -Value 'CivilDesk'
    Set-ItemProperty -Path $syntheticUserKey -Name InstallLocation -Value $syntheticUserInstall
    Set-ItemProperty -Path $syntheticUserKey -Name UninstallString -Value (Join-Path $syntheticUserInstall 'uninstall.exe')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($syntheticShortcut)
    $shortcut.TargetPath = Join-Path $syntheticUserInstall 'CivilDesk.exe'
    $shortcut.Save()
    'Independent synthetic HKCU registration, user executable, and Start Menu shortcut prepared before machine install.'
  }
  Gate 'machine_install' {
    if (Test-Path -LiteralPath $installRoot) { throw 'Install root already exists.' }
    $script:installationOwned = $true
    $process = Start-Process -FilePath $installer[0].FullName -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)." }
    $script:application = Join-Path $installRoot 'CivilDesk.exe'
    if (-not (Test-Path -LiteralPath $script:application -PathType Leaf)) { throw 'Expected Program Files application absent.' }
    if ((Get-Item -LiteralPath $script:application).VersionInfo.ProductName -cne 'CivilDesk') { throw 'Application identity mismatch.' }
    $results.paths.application = $script:application
    'Silent per-machine install completed under Program Files.'
  }
  Gate 'hklm_registration' {
    $entries = @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -ceq 'CivilDesk' })
    if ($entries.Count -ne 1) { throw "Expected one HKLM entry, found $($entries.Count)." }
    if ($entries[0].InstallLocation.TrimEnd('\') -ine $installRoot.TrimEnd('\')) { throw 'HKLM install path mismatch.' }
    $script:uninstallCommand = [string]$entries[0].UninstallString
    if (-not $script:uninstallCommand) { throw 'HKLM uninstall command missing.' }
    $results.registry = [ordered]@{hive='HKLM'; display_name='CivilDesk'; entries=$entries.Count; install_location=$entries[0].InstallLocation; uninstall_command_present=$true}
    'One HKLM uninstall entry at expected root.'
  }
  Gate 'transition' {
    . (Join-Path $repo 'scripts/lib/installation-transition.ps1')
    $entries = @(
      [pscustomobject]@{hive='HKCU';displayName='CivilDesk';installLocation=$syntheticUserInstall;uninstallString=(Join-Path $syntheticUserInstall 'uninstall.exe')},
      [pscustomobject]@{hive='HKLM';displayName='CivilDesk';installLocation=$installRoot;uninstallString=$uninstallCommand}
    )
    $issues = @(Test-InstallationTransition -Entries $entries -ExpectedMachineRoot $installRoot)
    if ('duplicate-install-scopes' -notin $issues) { throw 'HKCU/HKLM coexistence was not detected.' }
    if (-not (Test-Path -LiteralPath $syntheticShortcut)) { throw 'Synthetic user shortcut vanished.' }
    $machineShortcuts = @(Get-ChildItem -LiteralPath (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs') -Filter 'CivilDesk.lnk' -Recurse -File -ErrorAction SilentlyContinue)
    if (-not $machineShortcuts.Count) { throw 'Machine Start Menu shortcut absent.' }
    'HKCU/HKLM duplicate detected; both user and machine shortcuts coexist. No automatic upgrade claim.'
  }
  Gate 'synthetic_acl_setup' {
    if (Test-Path -LiteralPath (Split-Path -Parent $syntheticRoot)) { throw 'Synthetic package parent already exists.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $syntheticRoot) -ErrorAction Stop | Out-Null
    $script:syntheticPackageOwned = $true
    New-Item -ItemType Directory -Path $syntheticRoot -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSHOME 'powershell.exe') -Destination (Join-Path $syntheticRoot 'd2l.exe')
    $parent = Split-Path -Parent $syntheticRoot
    & icacls.exe $parent /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Parent ACL setup failed.' }
    & icacls.exe $parent /setowner '*S-1-5-32-544' /T | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Owner setup failed.' }
    $acl = Get-Acl -LiteralPath (Join-Path $syntheticRoot 'd2l.exe')
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne 'S-1-5-32-544') { throw 'Synthetic file owner mismatch.' }
    'Synthetic package owned by Administrators with Users read and execute.'
  }
  Gate 'synthetic_manifest' {
    $manifestResult = & node (Join-Path $repo 'scripts/rehearsal/synthetic-manifest.mjs') $syntheticRoot $env:RUNNER_TEMP
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic manifest verifier failed.' }
    & icacls.exe (Join-Path $syntheticRoot 'd2l.exe') /setowner '*S-1-5-32-544' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic owner restoration failed.' }
    $manifestResult
  }
  Gate 'canonical_and_reparse' {
    $rootPath = (Resolve-Path -LiteralPath $syntheticRoot).Path
    if ($rootPath -ine $syntheticRoot -or (Get-Item -LiteralPath $rootPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Synthetic package root is not canonical.' }
    $link = Join-Path $env:RUNNER_TEMP 'synthetic-link'
    if (Test-Path -LiteralPath $link) { throw 'Synthetic junction path already exists.' }
    New-Item -ItemType Junction -Path $link -Target $syntheticRoot -ErrorAction Stop | Out-Null
    $script:linkCreated = $true
    if (-not ((Get-Item -LiteralPath $link).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Junction negative fixture missing.' }
    Remove-Item -LiteralPath $link -Force
    $script:linkCreated = $false
    'Canonical root accepted; junction identified as reparse point.'
  }
  Gate 'firewall_rule' {
    . (Join-Path $repo 'scripts/lib/offline-policy.ps1')
    if ($ControlledEndpointIp) { $script:baselineConnection = Test-SyntheticTcp }
    $script:firewallRule = 'CivilDesk-Rehearsal-' + ([Guid]::NewGuid().ToString('N'))
    New-NetFirewallRule -Name $firewallRule -DisplayName $firewallRule -Direction Outbound -Action Block -Program (Join-Path $syntheticRoot 'd2l.exe') -Profile Any -ErrorAction Stop | Out-Null
    $rule = Get-NetFirewallRule -Name $firewallRule -PolicyStore ActiveStore -ErrorAction Stop
    $applicationFilter = $rule | Get-NetFirewallApplicationFilter
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    $portFilter = $rule | Get-NetFirewallPortFilter
    $normalized = [pscustomobject]@{ program=[string]$applicationFilter.Program; enabled=$rule.Enabled -eq 'True';
      direction=[string]$rule.Direction; action=[string]$rule.Action; profiles=[string]$rule.Profile;
      remoteAddress=[string]$addressFilter.RemoteAddress; protocol=[string]$portFilter.Protocol }
    if (@(Test-ScopeAOutboundRule -Rules @($normalized) -ExpectedPath (Join-Path $syntheticRoot 'd2l.exe')).Count) { throw 'Exact-path firewall rule failed policy check.' }
    if (@(Test-ScopeAOutboundRule -Rules @($normalized) -ExpectedPath (Join-Path $syntheticRoot 'alternate.exe')).Count -eq 0) { throw 'Alternate executable path incorrectly protected.' }
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { $_.Name -in @('Domain','Private','Public') })
    if ($profiles.Count -ne 3 -or @($profiles | Where-Object { $_.Enabled -ne 'True' }).Count) { throw 'Not all firewall profiles are enabled.' }
    $results.firewall = [ordered]@{rule=$firewallRule; program=$normalized.program; profiles=$normalized.profiles; action=$normalized.action; alternate_path_rejected=$true; enforcement='NOT VERIFIED'}
    if ($ControlledEndpointIp -and $baselineConnection) { $script:blockedConnection = -not (Test-SyntheticTcp) }
    'Exact synthetic executable outbound rule covers Domain, Private, Public; alternate path rejected.'
  }
  Gate 'firewall_removal' {
    Remove-NetFirewallRule -Name $firewallRule -ErrorAction Stop
    $removed = @(Get-NetFirewallRule -Name $firewallRule -PolicyStore ActiveStore -ErrorAction SilentlyContinue)
    if ($removed.Count) { throw 'Firewall rule still present after removal.' }
    $script:firewallRule = $null
    $results.firewall.removal_detected = $true
    if ($ControlledEndpointIp) {
      $afterRemoval = Test-SyntheticTcp
      if (-not $baselineConnection -or -not $afterRemoval) {
        $results.gates.firewall_enforcement = [ordered]@{status='BLOCKED'; detail='Controlled endpoint or copied synthetic executable unavailable without rule.'}
      } elseif (-not $blockedConnection) {
        $results.gates.firewall_enforcement = [ordered]@{status='FAIL'; detail='Synthetic executable reached controlled endpoint while rule was active.'}
        throw 'Outbound firewall block did not enforce.'
      } else {
        $results.gates.firewall_enforcement = [ordered]@{status='PASS'; detail='Controlled TCP endpoint reachable before/after rule and denied during rule.'}
        $results.firewall.enforcement = 'PASS'
      }
    }
    'Rule removal detected in effective policy store.'
  }
  Gate 'migration' {
    if (Test-Path -LiteralPath $migrationFixtureRoot) { throw 'Synthetic migration fixture directory already exists.' }
    $script:migrationFixtureOwned = $true
    $json = & python (Join-Path $repo 'scripts/rehearsal/synthetic_migration.py') --repo $repo --temp-root $migrationFixtureRoot
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic migration failed.' }
    $migration = $json | ConvertFrom-Json
    if ($migration.status -cne 'PASS') { throw 'Synthetic migration did not pass.' }
    $results.sqlite = $migration
    $migration
  }
  Gate 'account_create' {
    $candidate = $null
    for ($attempt = 0; $attempt -lt 16; $attempt++) {
      $proposed = New-RehearsalAccountName -Suffix ([Guid]::NewGuid().ToString('N').Substring(0,12))
      if (-not (Get-LocalUser -Name $proposed -ErrorAction SilentlyContinue)) { $candidate = $proposed; break }
    }
    if (-not $candidate -or $candidate.Length -gt 20) { throw 'No valid unused local account name could be generated.' }
    $script:name = $candidate
    $script:password = ConvertTo-SecureString (([Guid]::NewGuid().ToString('N')) + 'aA1!') -AsPlainText -Force
    $created = New-LocalUser -Name $candidate -Password $password -PasswordNeverExpires -ErrorAction Stop
    $script:testUser = $candidate
    $script:testUserSid = $created.SID.Value
    $script:testUserOwned = $true
    $observed = Get-LocalUser -Name $candidate -ErrorAction Stop
    if ($observed.SID.Value -cne $testUserSid) { throw 'Created account SID changed.' }
    'Unique disposable local account created and ownership recorded by SID.'
  }
  Gate 'standard_user_launch' {
    $script:probeDir = Join-Path $env:RUNNER_TEMP ('civildesk-probe-' + $name)
    if (Test-Path -LiteralPath $probeDir) { throw 'Probe output directory already exists.' }
    New-Item -ItemType Directory -Path $probeDir -ErrorAction Stop | Out-Null
    $script:probeDirOwned = $true
    & icacls.exe $probeDir /grant "${name}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Probe directory grant failed.' }
    $probeResult = Join-Path $probeDir 'result.json'
    $credential = [pscredential]::new("$env:COMPUTERNAME\$name", $password)
    $parentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\rehearsal\standard-probe.ps1`" -Application `"$application`" -SyntheticRoot `"$syntheticRoot`" -ResultPath `"$probeResult`" -ExpectedSid `"$testUserSid`" -ParentSid `"$($parentIdentity.User.Value)`" -ParentProfile `"$env:USERPROFILE`""
    $probe = Start-Process -FilePath 'powershell.exe' -Credential $credential -LoadUserProfile -ArgumentList $args -Wait -PassThru
    if (-not (Test-Path -LiteralPath $probeResult)) { throw "Standard-user probe absent; exit $($probe.ExitCode)." }
    $script:probeData = Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
    $results.standard_user = [ordered]@{expected_sid=$testUserSid; actual_sid=$probeData.token_sid;
      identity_status=$probeData.identity_status; administrator=$probeData.administrator;
      administrator_group_member=$probeData.administrator_group_member;
      elevated=$probeData.elevated; privileges=$probeData.privileges}
    if ($probe.ExitCode -ne 0 -or $probeData.identity_status -cne 'PASS' -or
        $probeData.token_sid -cne $testUserSid -or $probeData.checks.application_launch -cne 'PASS') {
      throw 'Distinct standard-user token or application launch failed.'
    }
    'Separate local standard account launched CivilDesk without runtime elevation.'
  }
  Gate 'synthetic_acl' {
    foreach ($key in @('read_execute','write','replace','delete','create','parent_modify','acl_change','ownership_change')) {
      if ($probeData.checks.$key -cne 'PASS') { throw "Standard-user ACL probe failed: $key" }
    }
    $results.acl = $probeData.checks
    'Separate standard account read package and was denied writes, replacement, deletion, parent modification, ACL and owner changes.'
  }
  if (-not $ControlledEndpointIp) { $results.gates.firewall_enforcement = [ordered]@{status='NOT VERIFIED';detail='No controlled external endpoint; localhost cannot prove outbound enforcement.'} }
  Gate 'uninstall_preservation' {
    $userData = [string]$probeData.data_marker
    if (-not $userData -or -not $userData.StartsWith('C:\Users\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic profile marker path missing.' }
    if ($uninstallCommand -notmatch '^"?([^"\r\n]+?\.exe)"?(?:\s.*)?$') { throw 'Unexpected uninstall command syntax.' }
    $uninstaller = $Matches[1]
    if (-not $uninstaller.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstaller outside install root.' }
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstall exited $($process.ExitCode)." }
    if (Test-Path -LiteralPath $application) { throw 'Application survived uninstall.' }
    $remaining = @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -ceq 'CivilDesk' })
    if ($remaining.Count) { throw 'HKLM uninstall registration survived uninstall.' }
    $results.registry.machine_entry_removed = $true
    if (-not (Test-Path -LiteralPath $syntheticUserKey) -or -not (Test-Path -LiteralPath $syntheticShortcut) -or -not (Test-Path -LiteralPath (Join-Path $syntheticUserInstall 'CivilDesk.exe'))) { throw 'Synthetic current-user installation was removed.' }
    if ([IO.File]::ReadAllText($userData) -cne 'synthetic-preserve') { throw 'Synthetic user data was lost.' }
    if (-not (Test-Path -LiteralPath (Join-Path $syntheticRoot 'd2l.exe'))) { throw 'Independent synthetic package was removed.' }
    'Application removed; generated synthetic user data and independent package preserved.'
  }
  Gate 'reinstall' {
    if ((Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $results.installer_sha256) { throw 'Installer changed before reinstall.' }
    $process = Start-Process -FilePath $installer[0].FullName -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $application)) { throw 'Reinstall failed.' }
    $reinstalled = @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -ceq 'CivilDesk' })
    if ($reinstalled.Count -ne 1 -or $reinstalled[0].InstallLocation.TrimEnd('\') -ine $installRoot.TrimEnd('\')) { throw 'Reinstall HKLM registration mismatch.' }
    if (-not (Test-Path -LiteralPath (Join-Path $syntheticRoot 'd2l.exe'))) { throw 'Independent package disappeared on reinstall.' }
    'Same installer reinstalled at Program Files.'
  }
  $results.gates.rollback = [ordered]@{status='NOT VERIFIED';detail='Application version rollback requires a matched prior binary; synthetic SQLite restore is covered by migration gate.'}
} catch {
  $primaryFailure = $_.Exception.Message
  $results.error = $primaryFailure
} finally {
  if ($firewallRule) {
    Cleanup-Gate 'firewall_cleanup' {
      Remove-NetFirewallRule -Name $firewallRule -ErrorAction Stop
      if (@(Get-NetFirewallRule -Name $firewallRule -PolicyStore ActiveStore -ErrorAction SilentlyContinue).Count) { throw 'Firewall rule remains after cleanup.' }
      'Created firewall rule removed.'
    }
  }
  if ($installationOwned) {
    Cleanup-Gate 'final_uninstall' {
      if (-not (Test-Path -LiteralPath $installRoot)) { return 'Owned install root already removed.' }
      if (-not $uninstallCommand -or $uninstallCommand -notmatch '^"?([^"\r\n]+?\.exe)"?(?:\s.*)?$') { throw 'Partial installation lacks a safe recorded uninstaller.' }
      $uninstaller = $Matches[1]
      if (-not $uninstaller.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
          -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Recorded uninstaller is absent or outside owned install root.' }
      $p = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -ErrorAction Stop
      if ($p.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $installRoot 'CivilDesk.exe'))) { throw 'Final uninstall did not remove the application.' }
      $remaining = @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -ceq 'CivilDesk' })
      if ($remaining.Count) { throw 'Final uninstall left HKLM registration.' }
      'Owned machine installation removed after rehearsal.'
    }
  }
  if ($syntheticTransitionCreated -or $syntheticPackageOwned -or $probeDirOwned -or $linkCreated -or $migrationFixtureOwned) {
    Cleanup-Gate 'fixture_cleanup' {
      if ($linkCreated) {
        $link = Join-Path $env:RUNNER_TEMP 'synthetic-link'
        if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force -ErrorAction Stop }
      }
      if ($syntheticTransitionCreated) {
        if (Test-Path -LiteralPath $syntheticUserKey) { Remove-Item -LiteralPath $syntheticUserKey -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $syntheticShortcut) { Remove-Item -LiteralPath $syntheticShortcut -Force -ErrorAction Stop }
        $syntheticUserExe = Join-Path $syntheticUserInstall 'CivilDesk.exe'
        if (Test-Path -LiteralPath $syntheticUserExe) { Remove-Item -LiteralPath $syntheticUserExe -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $syntheticUserInstall) { Remove-Item -LiteralPath $syntheticUserInstall -Force -ErrorAction Stop }
      }
      if ($syntheticPackageOwned) {
        $syntheticFile = Join-Path $syntheticRoot 'd2l.exe'
        if (Test-Path -LiteralPath $syntheticFile) { Remove-Item -LiteralPath $syntheticFile -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $syntheticRoot) { Remove-Item -LiteralPath $syntheticRoot -Force -ErrorAction Stop }
        $packageParent = Split-Path -Parent $syntheticRoot
        if (Test-Path -LiteralPath $packageParent) { Remove-Item -LiteralPath $packageParent -Force -ErrorAction Stop }
      }
      if ($probeDirOwned) {
        $probeResult = Join-Path $probeDir 'result.json'
        if (Test-Path -LiteralPath $probeResult) { Remove-Item -LiteralPath $probeResult -Force -ErrorAction Stop }
        if (Test-Path -LiteralPath $probeDir) { Remove-Item -LiteralPath $probeDir -Force -ErrorAction Stop }
      }
      if ($migrationFixtureOwned -and (Test-Path -LiteralPath $migrationFixtureRoot)) {
        $files = @(Get-ChildItem -LiteralPath $migrationFixtureRoot -Force -ErrorAction Stop)
        foreach ($file in $files) {
          if (-not $file.PSIsContainer -and $file.Name -cmatch '^civildesk-synthetic-[0-9a-f]{32}-(v8|backup|failed)\.sqlite3$') {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
          } else { throw 'Unexpected file in owned synthetic migration directory.' }
        }
        Remove-Item -LiteralPath $migrationFixtureRoot -Force -ErrorAction Stop
      }
      'All harness-owned synthetic paths and registration removed; generated app profile is disposable runner data.'
    }
  }
  if ($testUserOwned) {
    Cleanup-Gate 'account_cleanup' {
      $current = Get-LocalUser -Name $testUser -ErrorAction Stop
      if ($current.SID.Value -cne $testUserSid) { throw 'Account SID changed; refusing to delete an unowned account.' }
      Remove-LocalUser -Name $testUser -ErrorAction Stop
      if (Get-LocalUser -Name $testUser -ErrorAction SilentlyContinue) { throw 'Created account remains after cleanup.' }
      'Harness-created account removed after SID ownership check.'
    }
  }
  try { Save-Report } catch { $cleanupFailures.Add("report: $($_.Exception.Message)") }
}
$exitFailure = Get-RehearsalExitFailure -PrimaryFailure $primaryFailure -CleanupFailures $cleanupFailures.ToArray()
if ($exitFailure) { throw $exitFailure }
