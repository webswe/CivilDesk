$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/installation-transition.ps1')
$root = 'C:\Program Files\CivilDesk'
$acceptance = [pscustomobject]@{hive='HKCU';displayName='CivilDesk Acceptance';installLocation='C:\Acceptance'}
$user = [pscustomobject]@{hive='HKCU';displayName='CivilDesk';installLocation='C:\Users\A\AppData\Local\CivilDesk'}
$machine = [pscustomobject]@{hive='HKLM';displayName='CivilDesk';installLocation=$root}
if (@(Test-InstallationTransition -Entries @($acceptance) -ExpectedMachineRoot $root).Count) { throw 'Acceptance caused a conflict.' }
if (@(Test-InstallationTransition -Entries @($machine) -ExpectedMachineRoot $root).Count) { throw 'Expected machine entry failed.' }
$both = @(Test-InstallationTransition -Entries @($user,$machine) -ExpectedMachineRoot $root)
if ('duplicate-install-scopes' -notin $both -or -not @($both | Where-Object { $_ -like 'existing-current-user-install*' }).Count) {
  throw 'Mixed install scopes were not detected.'
}
$wrong = [pscustomobject]@{hive='HKLM';displayName='CivilDesk';installLocation='C:\Other'}
if ('unexpected-machine-location' -notin @(Test-InstallationTransition -Entries @($wrong) -ExpectedMachineRoot $root)) {
  throw 'Wrong machine location was accepted.'
}
'Installation transition fixtures: Acceptance isolation, HKCU/HKLM coexistence, and wrong root passed.'
