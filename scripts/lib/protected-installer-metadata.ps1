Set-StrictMode -Version Latest

function Test-ProtectedNsi {
  param([string]$Script, [string]$Identity)
  $issues = [System.Collections.Generic.List[string]]::new()
  if ($Script -cnotmatch '(?m)^!define INSTALLMODE "perMachine"\s*$') { $issues.Add('install-mode') }
  if ($Script -cnotmatch ('(?m)^!define BUNDLEID "' + [regex]::Escape($Identity) + '"\s*$')) { $issues.Add('bundle-identity') }
  if ($Script -cnotmatch '(?m)^!define PRODUCTNAME "CivilDesk"\s*$') { $issues.Add('product-name') }
  if ($Script -cnotmatch '(?m)^\s*RequestExecutionLevel admin\s*$') { $issues.Add('admin-execution-level') }
  if ($Script -cnotmatch '(?m)^\s*StrCpy \$INSTDIR "\$PROGRAMFILES64\\\$\{PRODUCTNAME\}"\s*$') { $issues.Add('program-files-root') }
  if ($Script -cnotmatch '(?m)^\s*DeleteRegKey HKLM "\$\{UNINSTKEY\}"\s*$') { $issues.Add('hklm-uninstall') }
  return $issues.ToArray()
}

function Test-InstallerVersionMetadata {
  param([object]$VersionInfo, [string]$ExpectedVersion)
  $issues = [System.Collections.Generic.List[string]]::new()
  if ($VersionInfo.ProductName -cne 'CivilDesk') { $issues.Add('pe-product-name') }
  if ($VersionInfo.ProductVersion -cne $ExpectedVersion) { $issues.Add('pe-product-version') }
  if ($VersionInfo.FileVersion -cne $ExpectedVersion) { $issues.Add('pe-file-version') }
  return $issues.ToArray()
}
