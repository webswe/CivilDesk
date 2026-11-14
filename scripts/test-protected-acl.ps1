$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/protected-acl.ps1')
$userSid = 'S-1-5-21-1000-1000-1000-1000'
function Record {
  param([string]$Path='C:\protected', [bool]$Protected=$true)
  return [pscustomobject]@{ path=$Path; exists=$true; protected=$Protected; reparse=$false;
    ownerSid='S-1-5-32-544'; aces=@([pscustomobject]@{sid='S-1-5-32-545';allow=$true;
      mask=1;inherited=$true;inheritOnly=$false}); probes=[pscustomobject]@{writeData=$false;delete=$false} }
}
function Expect-Issue {
  param([object]$Record, [string]$Pattern)
  $issues = @(Test-ProtectedAclRecords -Records @($Record) -CurrentUserSid $userSid -Elevated $false)
  if (-not @($issues | Where-Object { $_ -like $Pattern }).Count) { throw "Expected $Pattern; got $issues" }
}
$clean = Record
if (@(Test-ProtectedAclRecords -Records @($clean) -CurrentUserSid $userSid -Elevated $false).Count) { throw 'Clean ACL fixture failed.' }
$writable = Record; $writable.probes.writeData=$true
Expect-Issue $writable 'effective-writeData:*'
$manifest = Record 'C:\protected\manifest.json'; $manifest.aces[0].mask=2
Expect-Issue $manifest 'inherited-write:*'
$ancestor = Record 'C:\parent' $false; $ancestor.aces[0].mask=64
Expect-Issue $ancestor 'inherited-write:*'
$writableAncestor = Record 'C:\parent' $false; $writableAncestor.aces[0].mask=2
Expect-Issue $writableAncestor 'inherited-write:*'
$owned = Record; $owned.ownerSid=$userSid
Expect-Issue $owned 'untrusted-owner:*'
$missing = Record; $missing.exists=$false
Expect-Issue $missing 'missing:*'
$reparse = Record; $reparse.reparse=$true
Expect-Issue $reparse 'reparse:*'
$delete = Record; $delete.probes.delete=$true
Expect-Issue $delete 'effective-delete:*'
$permission = Record; $permission.aces[0].mask=262144
Expect-Issue $permission 'inherited-write:*'
if (-not @(Test-ProtectedAclRecords -Records @($clean) -CurrentUserSid $userSid -Elevated $true).Count) {
  throw 'Elevated-token limitation was not reported.'
}
'ACL policy fixtures: clean and 9 negative/limitation cases passed.'
