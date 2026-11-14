Set-StrictMode -Version Latest

# Normalized, read-only policy evaluation. A matching rule restricts this executable path,
# not its children or copies launched from another path.
function Test-ScopeAOutboundRule {
  param([object[]]$Rules, [string]$ExpectedPath)
  $issues = [System.Collections.Generic.List[string]]::new()
  $matching = @($Rules | Where-Object { $_.program -ieq $ExpectedPath })
  if (-not $matching.Count) { return @('missing-program-rule') }
  $valid = @($matching | Where-Object {
    $rule = $_
    $profiles = @($rule.profiles -split ',\s*')
    $allProfiles = $rule.profiles -eq 'Any' -or
      @(@('Domain','Private','Public') | Where-Object { $_ -notin $profiles }).Count -eq 0
    $rule.enabled -and $rule.direction -eq 'Outbound' -and $rule.action -eq 'Block' -and
    $allProfiles -and $rule.remoteAddress -eq 'Any' -and $rule.protocol -eq 'Any'
  })
  if (-not $valid.Count) { $issues.Add('no-unconditional-all-profile-block') }
  return $issues.ToArray()
}
