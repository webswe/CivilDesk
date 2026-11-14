$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/offline-policy.ps1')
$path = 'C:\Program Files\CivilDesk D2L-CLI\3ce1648\d2l.exe'
$valid = [pscustomobject]@{program=$path;enabled=$true;direction='Outbound';action='Block';
  profiles='Any';remoteAddress='Any';protocol='Any'}
if (@(Test-ScopeAOutboundRule -Rules @($valid) -ExpectedPath $path).Count) { throw 'Valid rule failed.' }
foreach ($change in @(
  @{program='C:\other\d2l.exe'}, @{enabled=$false}, @{direction='Inbound'},
  @{action='Allow'}, @{profiles='Private'}, @{remoteAddress='192.0.2.1'}, @{protocol='TCP'}
)) {
  $rule = $valid.PSObject.Copy()
  foreach ($key in $change.Keys) { $rule.$key = $change[$key] }
  if (-not @(Test-ScopeAOutboundRule -Rules @($rule) -ExpectedPath $path).Count) {
    throw "Invalid rule was accepted: $($change.Keys)"
  }
}
'Offline policy fixtures: valid all-profile block and 7 negative cases passed.'
