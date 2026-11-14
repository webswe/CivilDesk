param(
  [Parameter(Mandatory)][string]$RuleName,
  [Parameter(Mandatory)][string]$ExpectedExecutablePath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/offline-policy.ps1')
if (-not [IO.Path]::IsPathFullyQualified($ExpectedExecutablePath)) { throw 'Expected path must be absolute.' }
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop |
  Where-Object { $_.Name -in @('Domain','Private','Public') })
if ($profiles.Count -ne 3 -or @($profiles | Where-Object { $_.Enabled -ne 'True' }).Count) {
  Write-Output 'Firewall protection is disabled or unavailable for a required profile.'
  exit 1
}
$rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $RuleName -ErrorAction SilentlyContinue | ForEach-Object {
  $app = $_ | Get-NetFirewallApplicationFilter
  $address = $_ | Get-NetFirewallAddressFilter
  $port = $_ | Get-NetFirewallPortFilter
  [pscustomobject]@{ program=$app.Program; enabled=$_.Enabled -eq 'True';
    direction=[string]$_.Direction; action=[string]$_.Action; profiles=[string]$_.Profile;
    remoteAddress=[string]$address.RemoteAddress; protocol=[string]$port.Protocol;
    source=[string]$_.PolicyStoreSourceType }
})
$issues = @(Test-ScopeAOutboundRule -Rules $rules -ExpectedPath $ExpectedExecutablePath)
if ($issues.Count) { $issues; exit 1 }
"Outbound block present for $ExpectedExecutablePath (all profiles)."
