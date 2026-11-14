param(
  [Parameter(Mandatory)][string]$Root,
  [Parameter(Mandatory)][string]$Boundary
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/protected-acl.ps1')

# CreateFile with OPEN_EXISTING only: requested access is checked without writing data or ACLs.
Add-Type -TypeDefinition @'
using System;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class CivilDeskAclProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr templateFile);
  public static bool CanOpen(string name, uint access) {
    using (var handle = CreateFileW(name, access, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
      return !handle.IsInvalid;
  }
}
'@

$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$boundaryPath = [IO.Path]::GetFullPath($Boundary).TrimEnd('\')
if (-not $rootPath.StartsWith($boundaryPath + '\', [StringComparison]::OrdinalIgnoreCase) -and
    $rootPath -ine $boundaryPath) { throw 'Root must be within the stated boundary.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$paths = [System.Collections.Generic.List[string]]::new()
$current = $rootPath
while ($true) {
  $paths.Add($current)
  if ($current -ieq $boundaryPath) { break }
  $parent = [IO.Path]::GetDirectoryName($current)
  if (-not $parent -or $parent -eq $current) { throw 'Boundary not reached.' }
  $current = $parent
}
if (Test-Path -LiteralPath $rootPath -PathType Container) {
  Get-ChildItem -LiteralPath $rootPath -Recurse -Force -ErrorAction Stop |
    ForEach-Object { $paths.Add($_.FullName) }
}
$records = foreach ($item in $paths) {
  $exists = Test-Path -LiteralPath $item
  if (-not $exists) {
    [pscustomobject]@{ path=$item; exists=$false; protected=$item -ieq $rootPath; reparse=$false;
      ownerSid=''; aces=@(); probes=[pscustomobject]@{} }
    continue
  }
  $entry = Get-Item -LiteralPath $item -Force
  $acl = Get-Acl -LiteralPath $item
  $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $aces = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
    [pscustomobject]@{ sid=$_.IdentityReference.Value; allow=$_.AccessControlType -eq 'Allow';
      mask=[int64]$_.FileSystemRights; inherited=$_.IsInherited;
      inheritOnly=($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0 }
  })
  $protected = $item -ieq $rootPath -or $item.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)
  $wanted = [ordered]@{writeData=2; appendData=4; writeEa=16; writeAttributes=256;
    delete=65536; writeDac=262144; writeOwner=524288; deleteChild=64}
  $probes = [ordered]@{}
  foreach ($name in $wanted.Keys) { $probes[$name] = [CivilDeskAclProbe]::CanOpen($item,[uint32]$wanted[$name]) }
  [pscustomobject]@{ path=$item; exists=$true; protected=$protected;
    reparse=($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0;
    ownerSid=$ownerSid; aces=$aces; probes=[pscustomobject]$probes }
}
$issues = @(Test-ProtectedAclRecords -Records $records -CurrentUserSid $identity.User.Value -Elevated $elevated)
foreach ($issue in $issues) { Write-Output $issue }
if ($issues.Count) { exit 1 }
Write-Output 'Protected ownership, ACL policy, and caller effective-access probes passed.'
