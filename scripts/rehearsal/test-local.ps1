$ErrorActionPreference = 'Stop'
foreach ($name in @('run.ps1','standard-probe.ps1')) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw "$name has PowerShell syntax errors: $($errors -join '; ')" }
}
try {
  & (Join-Path $PSScriptRoot 'run.ps1') -SourceSha ('a' * 40) -TargetDirectory $PSScriptRoot
  throw 'Runner guard accepted a local execution.'
} catch {
  if ($_.Exception.Message -notlike '*Disposable GitHub-hosted rehearsal guard failed*') { throw }
}
'PowerShell syntax and local execution guard passed.'
