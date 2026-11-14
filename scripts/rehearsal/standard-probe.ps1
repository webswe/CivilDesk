param(
  [Parameter(Mandatory)][string]$Application,
  [Parameter(Mandatory)][string]$SyntheticRoot,
  [Parameter(Mandatory)][string]$ResultPath,
  [Parameter(Mandatory)][string]$ExpectedSid,
  [Parameter(Mandatory)][string]$ParentSid,
  [Parameter(Mandatory)][string]$ParentProfile
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/security-gates.ps1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CivilDeskStandardTokenProbe {
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] private static extern bool GetTokenInformation(IntPtr token, int infoClass, out int value, int length, out int returned);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr templateFile);
  public static bool IsElevated() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      int value, returned;
      if (!GetTokenInformation(token, 20, out value, 4, out returned)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return value != 0;
    } finally { CloseHandle(token); }
  }
  public static bool CanOpen(string name, uint access) {
    using (var handle = CreateFileW(name, access, 7, IntPtr.Zero, 3, 0, IntPtr.Zero))
      return !handle.IsInvalid;
  }
}
'@
$privText = & whoami.exe /priv
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect standard-user token privileges.' }
$privileges = @([regex]::Matches(($privText -join "`n"), '\bSe[A-Za-z]+Privilege\b') | ForEach-Object { $_.Value } | Select-Object -Unique)
$actualSid = $identity.User.Value
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$adminGroupMember = @($identity.Groups | Where-Object { $_.Value -eq 'S-1-5-32-544' }).Count -gt 0
$isElevated = [CivilDeskStandardTokenProbe]::IsElevated()
$issues = @(Test-RehearsalToken -ExpectedSid $ExpectedSid -ActualSid $actualSid -ParentSid $ParentSid -Administrator $isAdmin -AdministratorGroupMember $adminGroupMember -Elevated $isElevated -PrivilegeNames $privileges)
$result = [ordered]@{ token_sid=$actualSid; expected_sid=$ExpectedSid; administrator=$isAdmin;
  administrator_group_member=$adminGroupMember; elevated=$isElevated; privileges=$privileges; identity_status='NOT VERIFIED'; checks=[ordered]@{} }
if ($issues.Count) {
  $result.identity_status = 'FAIL'
  $result.identity_issues = $issues
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  exit 1
}
$profileKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$actualSid"
$profile = [Environment]::ExpandEnvironmentVariables([string](Get-ItemProperty -LiteralPath $profileKey -Name ProfileImagePath -ErrorAction Stop).ProfileImagePath)
$profile = [IO.Path]::GetFullPath($profile).TrimEnd('\')
if (-not (Test-Path -LiteralPath $profile -PathType Container) -or $profile -ieq $ParentProfile.TrimEnd('\')) {
  $result.identity_status = 'FAIL'
  $result.identity_issues = @('profile-not-distinct')
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  exit 1
}
# Start-Process -Credential can inherit the caller's environment. Set the child
# environment from the actual token's loaded Windows profile before app launch.
$env:USERPROFILE = $profile
$env:APPDATA = Join-Path $profile 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $profile 'AppData\Local'
$env:HOMEDRIVE = [IO.Path]::GetPathRoot($profile).TrimEnd('\')
$env:HOMEPATH = $profile.Substring($env:HOMEDRIVE.Length)
$result.identity_status = 'PASS'
$file = Join-Path $SyntheticRoot 'd2l.exe'
$parent = Split-Path -Parent $SyntheticRoot
$result.checks.read_execute = if ((Test-ProbeTarget -Path $file) -and
  [CivilDeskStandardTokenProbe]::CanOpen($file, [uint32]0x80000000) -and
  [CivilDeskStandardTokenProbe]::CanOpen($file, [uint32]0x20000000)) { 'PASS' } else { 'FAIL:read-or-execute' }
function Denied([string]$name, [string]$target, [bool]$directory, [scriptblock]$attempt) {
  if (-not (Test-ProbeTarget -Path $target -Directory:$directory)) { $result.checks[$name] = 'FAIL:missing-target'; return }
  try { & $attempt; $result.checks[$name] = 'FAIL:operation-succeeded' }
  catch {
    if (Test-ExpectedAccessDenied -Failure $_) { $result.checks[$name] = 'PASS' }
    else { $result.checks[$name] = "FAIL:unexpected-$($_.Exception.GetType().Name)" }
  }
}
Denied 'write' $file $false { [IO.File]::WriteAllText($file, 'changed') }
Denied 'replace' $file $false {
  $destination = Join-Path $SyntheticRoot 'replacement.exe'
  if (Test-Path -LiteralPath $destination) { throw 'Replacement destination already exists.' }
  [IO.File]::Move($file, $destination)
}
Denied 'delete' $file $false { [IO.File]::Delete($file) }
Denied 'create' $SyntheticRoot $true { [IO.File]::WriteAllText((Join-Path $SyntheticRoot 'created.exe'), 'changed') }
Denied 'parent_modify' $parent $true { [IO.File]::WriteAllText((Join-Path $parent 'escape.exe'), 'changed') }
Denied 'acl_change' $file $false { $acl = Get-Acl -LiteralPath $file; Set-Acl -LiteralPath $file -AclObject $acl -ErrorAction Stop }
Denied 'ownership_change' $file $false {
  $acl = Get-Acl -LiteralPath $file
  $acl.SetOwner($identity.User)
  Set-Acl -LiteralPath $file -AclObject $acl -ErrorAction Stop
}
$result.checks.application_launch = 'NOT VERIFIED'
try {
  $dataRoot = Join-Path $env:APPDATA 'com.webswe.civildesk'
  if (Test-Path -LiteralPath $dataRoot) { throw 'Synthetic profile already has CivilDesk data.' }
  New-Item -ItemType Directory -Path $dataRoot -ErrorAction Stop | Out-Null
  $marker = Join-Path $dataRoot 'rehearsal-synthetic-marker.txt'
  [IO.File]::WriteAllText($marker, 'synthetic-preserve')
  $result.data_marker = $marker
  $process = Start-Process -FilePath $Application -PassThru -ErrorAction Stop
  Start-Sleep -Seconds 5
  if (-not $process.HasExited) { $result.checks.application_launch = 'PASS'; Stop-Process -Id $process.Id -Force -ErrorAction Stop }
  else { $result.checks.application_launch = 'FAIL:early-exit' }
} catch { $result.checks.application_launch = "FAIL:$($_.Exception.GetType().Name)" }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
if (@($result.checks.Values | Where-Object { $_ -cne 'PASS' }).Count) { exit 1 }
