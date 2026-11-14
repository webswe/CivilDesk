param(
  [Parameter(Mandatory)][string]$SourceSha,
  [Parameter(Mandatory)][string]$TargetDirectory,
  [Parameter(Mandatory)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/protected-installer-metadata.ps1')

if ($SourceSha -cnotmatch '^[0-9a-f]{40}$') { throw 'Source SHA must be a full lowercase Git commit hash.' }
if ((git rev-parse HEAD).Trim() -cne $SourceSha) { throw 'Checkout does not match the requested source SHA.' }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$target = (Resolve-Path -LiteralPath $TargetDirectory).Path
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
foreach ($item in @($target,$evidence)) {
  if (-not $item.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build outputs must remain under the checked-out repository.'
  }
}
if (Test-Path -LiteralPath $evidence) { throw 'Evidence directory already exists; refusing to overwrite a prior build.' }

$base = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$overlay = Get-Content -LiteralPath (Join-Path $repo 'src-tauri/tauri.protected.conf.json') -Raw | ConvertFrom-Json
if ($base.identifier -cne 'com.webswe.civildesk' -or $base.bundle.windows.nsis.installMode -cne 'currentUser' -or
    $overlay.bundle.windows.nsis.installMode -cne 'perMachine') { throw 'NSIS configuration or application identity changed.' }
$version = [string]$base.version
$tauri = Get-Content -LiteralPath (Join-Path $repo 'node_modules/@tauri-apps/cli/package.json') -Raw | ConvertFrom-Json
$arch = (rustc -vV | Select-String '^host:').ToString().Split(':',2)[1].Trim()
if ($arch -cne 'x86_64-pc-windows-msvc') { throw "Unexpected build target: $arch" }

$nsis = Join-Path $target 'release/nsis/x64/installer.nsi'
if (-not (Test-Path -LiteralPath $nsis -PathType Leaf)) { throw "Missing generated NSIS script: $nsis" }
$nsiText = Get-Content -LiteralPath $nsis -Raw -Encoding UTF8
$nsiIssues = @(Test-ProtectedNsi -Script $nsiText -Identity $base.identifier)
if ($nsiIssues.Count) { throw "Generated NSIS script failed: $($nsiIssues -join ', ')" }

$bundleDir = Join-Path $target 'release/bundle/nsis'
$installers = @(Get-ChildItem -LiteralPath $bundleDir -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected one protected NSIS installer; found $($installers.Count)." }
$expectedName = "CivilDesk_${version}_x64-setup.exe"
if ($installers[0].Name -cne $expectedName) { throw "Unexpected installer name: $($installers[0].Name)" }
$peIssues = @(Test-InstallerVersionMetadata -VersionInfo $installers[0].VersionInfo -ExpectedVersion $version)
if ($peIssues.Count) { throw "Installer PE metadata failed: $($peIssues -join ', ')" }
$originalHash = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = (Get-AuthenticodeSignature -LiteralPath $installers[0].FullName).Status.ToString()

New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
$labelledName = "CivilDesk_${version}_x64-perMachine-setup.exe"
$labelled = Join-Path $evidence $labelledName
Copy-Item -LiteralPath $installers[0].FullName -Destination $labelled -ErrorAction Stop
if ((Get-FileHash -LiteralPath $labelled -Algorithm SHA256).Hash.ToLowerInvariant() -cne $originalHash) {
  throw 'Variant-labelled copy differs from the generated installer.'
}
$metadata = [ordered]@{
  source_sha = $SourceSha
  configuration_variant = 'src-tauri/tauri.protected.conf.json'
  tauri_cli_version = [string]$tauri.version
  target_architecture = $arch
  application_identity = [string]$base.identifier
  expected_install_mode = 'perMachine'
  generated_installer_filename = $installers[0].Name
  labelled_installer_filename = $labelledName
  installer_sha256 = $originalHash
  generated_nsi_sha256 = (Get-FileHash -LiteralPath $nsis -Algorithm SHA256).Hash.ToLowerInvariant()
  installer_bytes = $installers[0].Length
  authenticode_status = $signature
  installed_or_published = $false
}
$json = $metadata | ConvertTo-Json -Depth 3
$json | Set-Content -LiteralPath (Join-Path $evidence 'metadata.json') -Encoding UTF8
$json | Write-Output
if ($env:GITHUB_STEP_SUMMARY) {
  @(
    '### Protected NSIS build-only verification',
    '',
    '| Field | Value |',
    '| --- | --- |',
    "| Source SHA | ``$SourceSha`` |",
    '| Variant | `perMachine` |',
    "| Tauri CLI | ``$($tauri.version)`` |",
    "| Target | ``$arch`` |",
    "| Installer | ``$labelledName`` |",
    "| SHA-256 | ``$originalHash`` |",
    "| Generated NSIS SHA-256 | ``$($metadata.generated_nsi_sha256)`` |",
    "| Authenticode | ``$signature`` |",
    '',
    'The installer remained on this ephemeral runner. It was not installed, uploaded, or released.'
  ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
