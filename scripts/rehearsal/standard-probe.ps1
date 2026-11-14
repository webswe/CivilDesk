param(
  [Parameter(Mandatory)][string]$Application,
  [Parameter(Mandatory)][string]$SyntheticRoot,
  [Parameter(Mandatory)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ standard_user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; elevated = $false; checks = [ordered]@{} }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$result.elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($result.elevated) { throw 'Standard probe received an administrator token.' }
function Denied([string]$name, [scriptblock]$attempt) {
  try { & $attempt; $result.checks[$name] = 'FAIL' }
  catch [UnauthorizedAccessException] { $result.checks[$name] = 'PASS' }
  catch [IO.IOException] { $result.checks[$name] = 'PASS' }
  catch { $result.checks[$name] = 'FAIL' }
}
$file = Join-Path $SyntheticRoot 'd2l.exe'
$parent = Split-Path -Parent $SyntheticRoot
Add-Type -TypeDefinition @'
using System;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class CivilDeskSyntheticAccessProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr templateFile);
  public static bool CanOpen(string name, uint access) {
    using (var handle = CreateFileW(name, access, 7, IntPtr.Zero, 3, 0, IntPtr.Zero))
      return !handle.IsInvalid;
  }
}
'@
$result.checks.read_execute = if ((Test-Path -LiteralPath $file) -and
  [CivilDeskSyntheticAccessProbe]::CanOpen($file, [uint32]0x80000000) -and
  [CivilDeskSyntheticAccessProbe]::CanOpen($file, [uint32]0x20000000)) { 'PASS' } else { 'FAIL' }
Denied 'write' { [IO.File]::WriteAllText($file, 'changed') }
Denied 'replace' { [IO.File]::Move($file, (Join-Path $SyntheticRoot 'replacement.exe')) }
Denied 'delete' { [IO.File]::Delete($file); if (-not (Test-Path -LiteralPath $file)) { return } else { throw 'Still present' } }
Denied 'create' { [IO.File]::WriteAllText((Join-Path $SyntheticRoot 'created.exe'), 'changed') }
Denied 'parent_modify' { [IO.File]::WriteAllText((Join-Path $parent 'escape.exe'), 'changed') }
Denied 'acl_change' { $acl = Get-Acl -LiteralPath $file; Set-Acl -LiteralPath $file -AclObject $acl -ErrorAction Stop }
Denied 'ownership_change' { $acl = Get-Acl -LiteralPath $file; $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User); Set-Acl -LiteralPath $file -AclObject $acl -ErrorAction Stop }
$result.checks.application_launch = 'NOT VERIFIED'
try {
  $dataRoot = Join-Path $env:APPDATA 'com.webswe.civildesk'
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  $marker = Join-Path $dataRoot 'rehearsal-synthetic-marker.txt'
  [IO.File]::WriteAllText($marker, 'synthetic-preserve')
  $result.data_marker = $marker
  $process = Start-Process -FilePath $Application -PassThru -ErrorAction Stop
  Start-Sleep -Seconds 5
  if (-not $process.HasExited) { $result.checks.application_launch = 'PASS'; Stop-Process -Id $process.Id -Force -ErrorAction Stop }
  else { $result.checks.application_launch = 'FAIL' }
} catch { $result.checks.application_launch = 'FAIL' }
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
if (@($result.checks.Values | Where-Object { $_ -eq 'FAIL' }).Count) { exit 1 }
