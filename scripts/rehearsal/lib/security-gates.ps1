Set-StrictMode -Version Latest

function New-RehearsalAccountName {
  param([Parameter(Mandatory)][string]$Suffix, [string[]]$ExistingNames = @())
  if ($Suffix -cnotmatch '^[0-9a-f]{12}$') { throw 'Account suffix must be twelve lowercase hexadecimal characters.' }
  $name = 'CDR' + $Suffix
  if ($name.Length -gt 20) { throw 'Generated account name exceeds the Windows limit.' }
  if ($name -in $ExistingNames) { throw 'Generated account name collides with an existing account.' }
  return $name
}

function Test-RehearsalToken {
  param(
    [Parameter(Mandatory)][string]$ExpectedSid,
    [Parameter(Mandatory)][string]$ActualSid,
    [Parameter(Mandatory)][string]$ParentSid,
    [Parameter(Mandatory)][bool]$Administrator,
    [bool]$AdministratorGroupMember = $false,
    [Parameter(Mandatory)][bool]$Elevated,
    [string[]]$PrivilegeNames = @()
  )
  $issues = [System.Collections.Generic.List[string]]::new()
  if ($ExpectedSid -notmatch '^S-1-' -or $ActualSid -cne $ExpectedSid) { $issues.Add('wrong-token-sid') }
  if ($ActualSid -ceq $ParentSid) { $issues.Add('parent-token-reused') }
  if ($Administrator) { $issues.Add('administrator-token') }
  if ($AdministratorGroupMember) { $issues.Add('administrator-group-member') }
  if ($Elevated) { $issues.Add('elevated-token') }
  $dangerous = @('SeDebugPrivilege','SeTcbPrivilege','SeTakeOwnershipPrivilege',
    'SeBackupPrivilege','SeRestorePrivilege','SeSecurityPrivilege','SeLoadDriverPrivilege')
  foreach ($name in $PrivilegeNames) { if ($name -in $dangerous) { $issues.Add("privilege:$name") } }
  return $issues.ToArray()
}

function Test-ExpectedAccessDenied {
  param([Parameter(Mandatory)][object]$Failure)
  $exception = if ($Failure -is [System.Management.Automation.ErrorRecord]) { $Failure.Exception } else { $Failure }
  while ($exception) {
    if ($exception -is [UnauthorizedAccessException]) { return $true }
    if ($exception -is [System.ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 5) { return $true }
    if ($exception -is [IO.IOException] -and $exception.HResult -eq -2147024891) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}

function Test-ProbeTarget {
  param([Parameter(Mandatory)][string]$Path, [switch]$Directory)
  if ($Directory) { return (Test-Path -LiteralPath $Path -PathType Container) }
  return (Test-Path -LiteralPath $Path -PathType Leaf)
}

function Get-RehearsalExitFailure {
  param([string]$PrimaryFailure, [string[]]$CleanupFailures = @())
  if ($PrimaryFailure) { return $PrimaryFailure }
  if ($CleanupFailures.Count) { return ($CleanupFailures -join '; ') }
  return $null
}

function Invoke-RehearsalCleanup {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][System.Collections.IDictionary]$Gates,
    [Parameter(Mandatory)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Failures,
    [Parameter(Mandatory)][scriptblock]$Body
  )
  try {
    $detail = & $Body
    $Gates[$Name] = [ordered]@{status='PASS';detail=$detail}
  } catch {
    $Gates[$Name] = [ordered]@{status='FAIL';detail=$_.Exception.Message}
    $Failures.Add("${Name}: $($_.Exception.Message)")
  }
}
