Set-StrictMode -Version Latest

function Test-InstallationTransition {
  param([object[]]$Entries, [string]$ExpectedMachineRoot)
  $issues = [System.Collections.Generic.List[string]]::new()
  $production = @($Entries | Where-Object { $_.displayName -eq 'CivilDesk' })
  $user = @($production | Where-Object { $_.hive -eq 'HKCU' })
  $machine = @($production | Where-Object { $_.hive -eq 'HKLM' })
  if ($user.Count) { $issues.Add('existing-current-user-install: supervised transition required') }
  if ($user.Count -and $machine.Count) { $issues.Add('duplicate-install-scopes') }
  if ($machine.Count -gt 1) { $issues.Add('duplicate-machine-entries') }
  foreach ($entry in $machine) {
    if ($entry.installLocation.Trim('"').TrimEnd('\') -ine $ExpectedMachineRoot.TrimEnd('\')) {
      $issues.Add('unexpected-machine-location')
    }
  }
  return $issues.ToArray()
}
