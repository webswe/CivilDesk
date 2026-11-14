param([string]$ExpectedMachineRoot = 'C:\Program Files\CivilDesk')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/installation-transition.ps1')
$entries = @(
  foreach ($hive in @('HKCU','HKLM')) {
    $paths = if ($hive -eq 'HKCU') { @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') }
      else { @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall') }
    foreach ($base in $paths) {
      Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue | ForEach-Object {
        $entry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        if ($entry -and $entry.PSObject.Properties.Name -contains 'DisplayName' -and $entry.DisplayName -like 'CivilDesk*') {
          [pscustomobject]@{ hive=$hive; displayName=[string]$entry.DisplayName;
            installLocation=[string]$entry.InstallLocation; uninstallString=[string]$entry.UninstallString }
        }
      }
    }
  }
)
$entries | Format-Table hive,displayName,installLocation -AutoSize | Out-String | Write-Output
$issues = @(Test-InstallationTransition -Entries $entries -ExpectedMachineRoot $ExpectedMachineRoot)
if ($issues.Count) { $issues; exit 1 }
'No conflicting registered production installation found; portable copies and other users still require review.'
