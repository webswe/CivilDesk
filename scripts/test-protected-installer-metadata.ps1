$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/protected-installer-metadata.ps1')
$identity = 'com.webswe.civildesk'
$valid = @'
!define INSTALLMODE "perMachine"
!define BUNDLEID "com.webswe.civildesk"
!define PRODUCTNAME "CivilDesk"
!if "${INSTALLMODE}" == "perMachine"
RequestExecutionLevel admin
StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
DeleteRegKey HKLM "${UNINSTKEY}"
'@
if (@(Test-ProtectedNsi -Script $valid -Identity $identity).Count) { throw 'Valid generated NSIS script fixture failed.' }
foreach ($case in @(
  @{ old='"perMachine"'; new='"currentUser"'; issue='install-mode' },
  @{ old='com.webswe.civildesk'; new='com.webswe.civildesk.acceptance'; issue='bundle-identity' },
  @{ old='RequestExecutionLevel admin'; new='RequestExecutionLevel user'; issue='admin-execution-level' },
  @{ old='$PROGRAMFILES64'; new='$LOCALAPPDATA'; issue='program-files-root' },
  @{ old='DeleteRegKey HKLM'; new='DeleteRegKey HKCU'; issue='hklm-uninstall' }
)) {
  $modified = $valid.Replace($case.old, $case.new)
  if ($case.issue -notin @(Test-ProtectedNsi -Script $modified -Identity $identity)) { throw "Missing $($case.issue) rejection." }
}
$version = [pscustomobject]@{ ProductName='CivilDesk'; ProductVersion='0.1.0'; FileVersion='0.1.0' }
if (@(Test-InstallerVersionMetadata -VersionInfo $version -ExpectedVersion '0.1.0').Count) { throw 'Valid PE metadata fixture failed.' }
$version.ProductName = 'CivilDesk Acceptance'
if ('pe-product-name' -notin @(Test-InstallerVersionMetadata -VersionInfo $version -ExpectedVersion '0.1.0')) { throw 'Wrong product was accepted.' }
'Protected installer metadata fixtures passed.'
