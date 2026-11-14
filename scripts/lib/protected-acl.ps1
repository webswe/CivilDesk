Set-StrictMode -Version Latest

# Inspect normalized ACL records. Live collection additionally probes access with the caller's
# unelevated token; this DACL rule is deliberately conservative for other ordinary users.
function Test-ProtectedAclRecords {
  param([object[]]$Records, [string]$CurrentUserSid, [bool]$Elevated)
  $issues = [System.Collections.Generic.List[string]]::new()
  if ($Elevated) { $issues.Add('elevated-token: ordinary-user effective access cannot be measured') }
  $trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  # WRITE_DATA, APPEND_DATA, WRITE_EA, WRITE_ATTRIBUTES, DELETE, WRITE_DAC,
  # WRITE_OWNER and DELETE_CHILD. Parent ancestors need only be substitution-safe.
  $writeMask = [int64]0x000D0156
  # Also reject creation/writes on ancestors, even where the root itself exists.
  $substituteMask = $writeMask
  foreach ($record in $Records) {
    if (-not $record.exists) { $issues.Add("missing:$($record.path)"); continue }
    if ($record.reparse) { $issues.Add("reparse:$($record.path)") }
    if ($record.ownerSid -notin $trusted) { $issues.Add("untrusted-owner:$($record.path):$($record.ownerSid)") }
    $mask = if ($record.protected) { $writeMask } else { $substituteMask }
    foreach ($ace in $record.aces) {
      if ($ace.allow -and -not $ace.inheritOnly -and $ace.sid -notin $trusted -and (([int64]$ace.mask -band $mask) -ne 0)) {
        $kind = if ($ace.inherited) { 'inherited-write' } else { 'untrusted-write' }
        $issues.Add("${kind}:$($record.path):$($ace.sid)")
      }
    }
    if (-not $Elevated) {
      foreach ($probe in $record.probes.PSObject.Properties) {
        if ($probe.Value) { $issues.Add("effective-$($probe.Name):$($record.path):$CurrentUserSid") }
      }
    }
  }
  return $issues.ToArray()
}
