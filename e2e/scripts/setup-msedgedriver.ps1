param(
  [string]$ExistingDriverPath = '',
  [string]$ExpectedDriverSha256 = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WebView2's installed version determines the exact official driver release.
$key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
if (-not (Test-Path -LiteralPath $key)) { throw 'WebView2 Runtime is not installed.' }
$runtimeVersion = [string](Get-ItemProperty -LiteralPath $key).pv
if ($runtimeVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'WebView2 Runtime version is invalid.' }
if ($ExpectedDriverSha256 -and $ExpectedDriverSha256 -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'Expected driver SHA-256 is invalid.'
}
if ($env:CI -eq 'true' -and $ExistingDriverPath) {
  throw 'CI must acquire the driver from the official Microsoft endpoint.'
}

$tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$directory = Join-Path $tempBase ('civildesk-e2e-webdriver-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
$driver = Join-Path $directory 'msedgedriver.exe'

if ($ExistingDriverPath) {
  # Offline local verification reuses a previously authorized binary. CI never takes this path.
  $source = (Resolve-Path -LiteralPath $ExistingDriverPath -ErrorAction Stop).Path
  if ([System.IO.Path]::GetFileName($source) -ne 'msedgedriver.exe') {
    throw 'The supplied offline test driver has the wrong filename.'
  }
  Copy-Item -LiteralPath $source -Destination $driver -ErrorAction Stop
} else {
  $archivePath = Join-Path $directory 'edgedriver_win64.zip'
  $url = "https://msedgedriver.microsoft.com/$runtimeVersion/edgedriver_win64.zip"
  Invoke-WebRequest -Uri $url -OutFile $archivePath -MaximumRedirection 5 -ErrorAction Stop
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Output "Microsoft download: $url"
  Write-Output "Archive SHA-256 (observed, not independently pinned): $archiveHash"
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'msedgedriver.exe' })
    if ($entries.Count -ne 1) { throw 'The driver archive has no unique root msedgedriver.exe.' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $driver, $false)
  } finally {
    $archive.Dispose()
  }
}

# SHA-256 records the bytes used in this run. Publisher trust comes from the
# Windows Authenticode chain and the Microsoft signer, not from that observed hash.
$signature = Get-AuthenticodeSignature -LiteralPath $driver
if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
  throw 'Microsoft Edge WebDriver signature is invalid or missing.'
}
$publisher = $signature.SignerCertificate.GetNameInfo(
  [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false
)
if ($publisher -cne 'Microsoft Corporation') { throw 'Microsoft Edge WebDriver signer is not Microsoft Corporation.' }

$driverHash = (Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedDriverSha256 -and $driverHash -cne $ExpectedDriverSha256.ToLowerInvariant()) {
  throw 'WebDriver SHA-256 does not match the separately supplied expected digest.'
}

$versionOutput = (& $driver --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^Microsoft Edge WebDriver (\d+\.\d+\.\d+\.\d+)(\s|$)') {
  throw 'Microsoft Edge WebDriver did not report a valid version.'
}
$driverVersion = $Matches[1]
if ($driverVersion -cne $runtimeVersion) {
  throw "WebDriver $driverVersion does not exactly match WebView2 $runtimeVersion."
}
Write-Output "WebView2 version: $runtimeVersion"
Write-Output "WebDriver version: $driverVersion"
Write-Output "WebDriver signer: $publisher (Authenticode valid)"
Write-Output "WebDriver SHA-256 (observed): $driverHash"
Write-Output "Isolated WebDriver path: $driver"
if ($env:GITHUB_ENV) {
  "CIVILDESK_E2E_DRIVER_PATH=$driver" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
}
if ($env:GITHUB_STEP_SUMMARY) {
  "WebView2/WebDriver: $runtimeVersion; Microsoft Authenticode valid; driver SHA-256 (observed): $driverHash" |
    Out-File -LiteralPath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}
