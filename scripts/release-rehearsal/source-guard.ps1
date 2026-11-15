function Assert-ExactSource {
  param([Parameter(Mandatory)][string]$Destination,[Parameter(Mandatory)][string]$ExpectedSha)
  if ($ExpectedSha -notmatch '^[a-f0-9]{40}$') { throw 'Expected source SHA is invalid.' }
  $actual = (git -C $Destination rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actual -cne $ExpectedSha) { throw 'Unexpected Git source commit.' }
  if (@(git -C $Destination remote).Count -ne 0) { throw 'A source remote was unexpectedly configured.' }
  if (@(git -C $Destination status --porcelain=v1).Count -ne 0) { throw 'Source checkout is not clean.' }
}
