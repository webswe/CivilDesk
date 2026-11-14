param(
  [Parameter(Mandatory)][string]$SourceSha,
  [Parameter(Mandatory)][string]$TargetDirectory,
  [string]$ControlledEndpointIp,
  [int]$ControlledEndpointPort
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$expectedRef = 'refs/heads/verification/scope-a-installation-rehearsal'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:GITHUB_REPOSITORY -cne 'webswe/CivilDesk' -or $env:GITHUB_REF -cne $expectedRef -or
    $env:RUNNER_OS -cne 'Windows' -or $env:GITHUB_WORKSPACE -ine $repo -or
    $SourceSha -cnotmatch '^[0-9a-f]{40}$' -or (git rev-parse HEAD).Trim() -cne $SourceSha -or
    $env:GITHUB_SHA -cne $SourceSha) { throw 'Disposable GitHub-hosted rehearsal guard failed.' }
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
  windows_version=[Environment]::OSVersion.VersionString; tauri_version=''; installer_sha256='';
  authenticode=''; nsis_mode='perMachine'; generated_nsi_sha256=''; paths=[ordered]@{};
  registry=[ordered]@{}; acl=[ordered]@{}; firewall=[ordered]@{}; sqlite=[ordered]@{}; gates=[ordered]@{};
  note='GitHub Windows runners disable UAC; this does not verify UAC prompts.'
}
foreach ($name in @('installer_metadata','installer_identity','machine_install','hklm_registration','standard_user_launch',
  'synthetic_acl_setup','synthetic_acl','synthetic_manifest','canonical_and_reparse','firewall_rule','firewall_removal','firewall_enforcement','migration','transition_prepare','transition',
  'uninstall_preservation','reinstall','rollback')) { $results.gates[$name] = [ordered]@{status='NOT VERIFIED'; detail='not reached'} }
function Gate([string]$name,[scriptblock]$body) {
  try { $detail = & $body; $results.gates[$name] = [ordered]@{status='PASS'; detail=$detail} }
  catch { $results.gates[$name] = [ordered]@{status='FAIL'; detail=$_.Exception.Message}; throw }
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
$firewallRule = $null
$syntheticTransitionCreated = $false
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
    $script:syntheticTransitionCreated = $true
    New-Item -ItemType Directory -Path $syntheticUserInstall -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $syntheticUserInstall 'CivilDesk.exe'), 'synthetic-current-user-install')
    New-Item -Path $syntheticUserKey -Force | Out-Null
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
    New-Item -ItemType Directory -Path $syntheticRoot -Force | Out-Null
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
    New-Item -ItemType Junction -Path $link -Target $syntheticRoot -ErrorAction Stop | Out-Null
    if (-not ((Get-Item -LiteralPath $link).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Junction negative fixture missing.' }
    Remove-Item -LiteralPath $link -Force
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
    $json = & python (Join-Path $repo 'scripts/rehearsal/synthetic_migration.py') --repo $repo
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic migration failed.' }
    $migration = $json | ConvertFrom-Json
    if ($migration.status -cne 'PASS') { throw 'Synthetic migration did not pass.' }
    $results.sqlite = $migration
    $migration
  }
  $name = 'CivilDeskRehearsal' + ([Guid]::NewGuid().ToString('N').Substring(0,8))
  $password = ConvertTo-SecureString (([Guid]::NewGuid().ToString('N')) + 'aA1!') -AsPlainText -Force
  New-LocalUser -Name $name -Password $password -PasswordNeverExpires -ErrorAction Stop | Out-Null
  $testUser = $name
  $probeDir = Join-Path $env:RUNNER_TEMP ('civildesk-probe-' + $name)
  New-Item -ItemType Directory -Path $probeDir | Out-Null
  & icacls.exe $probeDir /grant "${name}:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Probe directory grant failed.' }
  $probeResult = Join-Path $probeDir 'result.json'
  $credential = [pscredential]::new("$env:COMPUTERNAME\$name", $password)
  Gate 'standard_user_launch' {
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\rehearsal\standard-probe.ps1`" -Application `"$application`" -SyntheticRoot `"$syntheticRoot`" -ResultPath `"$probeResult`""
    $probe = Start-Process -FilePath 'powershell.exe' -Credential $credential -LoadUserProfile -ArgumentList $args -Wait -PassThru
    if (-not (Test-Path -LiteralPath $probeResult)) { throw "Standard-user probe absent; exit $($probe.ExitCode)." }
    $script:probeData = Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
    if ($probe.ExitCode -ne 0 -or $probeData.elevated -or $probeData.checks.application_launch -cne 'PASS') { throw 'Standard-user application launch failed.' }
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
    $process = Start-Process -FilePath $installer[0].FullName -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $application)) { throw 'Reinstall failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $syntheticRoot 'd2l.exe'))) { throw 'Independent package disappeared on reinstall.' }
    'Same installer reinstalled at Program Files.'
  }
  $results.gates.rollback = [ordered]@{status='NOT VERIFIED';detail='Application version rollback requires a matched prior binary; synthetic SQLite restore is covered by migration gate.'}
} catch {
  $results.error = $_.Exception.Message
  throw
} finally {
  if ($firewallRule) { Remove-NetFirewallRule -Name $firewallRule -ErrorAction SilentlyContinue }
  if ($testUser) { Remove-LocalUser -Name $testUser -ErrorAction SilentlyContinue }
  if ($syntheticTransitionCreated) {
    if (Test-Path -LiteralPath $syntheticUserKey) { Remove-Item -LiteralPath $syntheticUserKey -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $syntheticShortcut) { Remove-Item -LiteralPath $syntheticShortcut -Force -ErrorAction SilentlyContinue }
    $syntheticUserExe = Join-Path $syntheticUserInstall 'CivilDesk.exe'
    if (Test-Path -LiteralPath $syntheticUserExe) { Remove-Item -LiteralPath $syntheticUserExe -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $syntheticUserInstall) { Remove-Item -LiteralPath $syntheticUserInstall -Force -ErrorAction SilentlyContinue }
  }
  Save-Report
}
