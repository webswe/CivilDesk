param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') { throw 'Hosted Windows runner required.' }
$sourceUrl = 'https://github.com/webswe/CivilDesk.git'
# Public source only. This step fails closed if CivilDesk becomes private.
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = 'NUL'
$env:GIT_CONFIG_COUNT = '0'
$env:GIT_CONFIG_PARAMETERS = $null
$env:GIT_PROXY_COMMAND = $null
$env:GIT_HTTP_PROXY = $null
$env:GIT_HTTPS_PROXY = $null
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:ALL_PROXY = $null
$env:GIT_SSL_NO_VERIFY = $null
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'
$env:GIT_ASKPASS = ''
$env:SSH_ASKPASS = ''
$env:GITHUB_TOKEN = $null
$env:GH_TOKEN = $null
$env:GH_ENTERPRISE_TOKEN = $null
$gitOptions = @('-c','credential.helper=','-c','core.askPass=','-c','http.extraheader=','-c','http.sslVerify=true')
. (Join-Path $PSScriptRoot 'source-guard.ps1')
foreach ($item in @(@{Name='baseline';Sha='7d293bbc61dce674d796220e3241571a9f15aa6b';Version='0.1.0'},@{Name='candidate';Sha='4cce3c6def9ceedbecae852dfd4b6860137910da';Version='0.1.1'})) {
  $destination = 'source-' + $item.Name
  if (Test-Path -LiteralPath $destination) { throw "Source destination already exists: $destination" }
  git init --quiet $destination
  if ($LASTEXITCODE -ne 0) { throw 'Could not initialize isolated source checkout.' }
  git -C $destination @gitOptions fetch --no-tags --depth=1 $sourceUrl $item.Sha
  if ($LASTEXITCODE -ne 0) { throw "Public exact-SHA retrieval failed for $($item.Name); no credential fallback is allowed." }
  $fetched = (git -C $destination rev-parse FETCH_HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $fetched -cne $item.Sha) { throw "Unexpected Git source for $($item.Name)." }
  git -C $destination checkout --quiet --detach $item.Sha
  if ($LASTEXITCODE -ne 0) { throw "Checkout failed for $($item.Name)." }
  Assert-ExactSource -Destination $destination -ExpectedSha $item.Sha
  $config = Get-Content -LiteralPath (Join-Path $destination 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
  if ($config.identifier -cne 'com.webswe.civildesk' -or $config.version -cne $item.Version -or $config.bundle.windows.nsis.installMode -cne 'currentUser' -or $config.bundle.windows.webviewInstallMode.type -cne 'offlineInstaller') { throw "Ordinary installer configuration changed for $($item.Name)." }
  "Source $($item.Name) $fetched verified without credential persistence."
}
