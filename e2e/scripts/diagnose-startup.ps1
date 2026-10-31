# Standalone startup diagnostic. Runs BEFORE WebDriver, never fails the job, and always cleans up.
# It only ever starts, inspects and stops the isolated com.webswe.civildesk.e2e binary and the processes
# that binary spawned. It never touches any other process, and never opens production or Acceptance data.
param(
  [string]$Binary = 'src-tauri/target/debug/civildesk-e2e.exe',
  [string]$OutDir = 'e2e/results/diagnostics',
  [int]$ObserveSeconds = 30,
  [int]$DebugPort = 9222
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$report = [ordered]@{}
$notes = New-Object System.Collections.Generic.List[string]
function Note($m) { $notes.Add($m); Write-Host $m }

# Safety: only the dedicated E2E binary may be launched.
$full = (Resolve-Path $Binary).Path
if ((Split-Path $full -Leaf) -ne 'civildesk-e2e.exe') { throw "Refusing to launch $full" }

# Environment facts
$os = Get-CimInstance Win32_OperatingSystem
$report.runnerImage = "$($env:ImageOS) $($env:ImageVersion)"
$report.windows = "$($os.Caption) build $($os.BuildNumber)"
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
$report.webview2Runtime = $wv.pv
$drv = Get-Command msedgedriver.exe -ErrorAction SilentlyContinue
$report.msedgedriver = if ($drv) { (& $drv.Source --version) -join ' ' } else { 'not found on PATH' }
$report.interactive = [Environment]::UserInteractive
$report.e2eDataPath = Join-Path $env:APPDATA 'com.webswe.civildesk.e2e'
$report.e2eWebviewPath = Join-Path $env:LOCALAPPDATA 'com.webswe.civildesk.e2e'
Note "Runner: $($report.runnerImage) | $($report.windows) | WebView2 $($report.webview2Runtime) | $($report.msedgedriver)"

function Descendants([int]$rootPid) {
  $all = Get-CimInstance Win32_Process
  $found = @(); $queue = @($rootPid)
  while ($queue.Count) {
    $next = @()
    foreach ($p in $queue) { foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $p })) { $found += $c; $next += $c.ProcessId } }
    $queue = $next
  }
  return $found
}

$proc = $null
$previous = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
  # Scoped to this launch only; restored in finally so it cannot leak into the WebDriver session.
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$DebugPort"
  $out = Join-Path $OutDir 'app-stdout.txt'; $err = Join-Path $OutDir 'app-stderr.txt'
  $proc = Start-Process -FilePath $full -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $report.processStarted = $true
  $report.pid = $proc.Id
  Note "Started civildesk-e2e.exe, PID $($proc.Id)"
} catch {
  $report.processStarted = $false
  $report.startError = $_.Exception.Message
  Note "FAILED to start the process: $($_.Exception.Message)"
} finally {
  if ($null -eq $previous) { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue } else { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previous }
}

if ($proc) {
  $started = Get-Date
  $report.windowAppeared = $false; $report.debugEndpoint = $false; $report.exited = $false
  for ($i = 0; $i -lt $ObserveSeconds; $i++) {
    Start-Sleep -Seconds 1
    $proc.Refresh()
    if ($proc.HasExited) { $report.exited = $true; $report.exitCode = $proc.ExitCode; $report.lifetimeSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); Note "Process EXITED with code $($proc.ExitCode) after $($report.lifetimeSeconds)s"; break }
    if (-not $report.windowAppeared -and $proc.MainWindowHandle -ne 0) { $report.windowAppeared = $true; $report.windowTitle = $proc.MainWindowTitle; $report.windowAfterSeconds = $i + 1; Note "Window appeared after $($i + 1)s: '$($proc.MainWindowTitle)'" }
    if (-not $report.debugEndpoint) {
      try { $r = Invoke-WebRequest "http://127.0.0.1:$DebugPort/json/version" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $report.debugEndpoint = $true; $report.debugVersion = $r.Content; Note "Debug endpoint answered after $($i + 1)s" } } catch { }
    }
    if ($report.windowAppeared -and $report.debugEndpoint -and $i -ge 8) { break }
  }
  if (-not $report.exited) { $report.lifetimeSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); Note "Process still running after $($report.lifetimeSeconds)s" }
  if (-not $report.windowAppeared) { Note 'No main window handle was observed.' }
  if (-not $report.debugEndpoint) { Note "Debug endpoint on 127.0.0.1:$DebugPort did not answer (not conclusive: Tauri/WebView2 may override the environment arguments)." }

  # Processes spawned by OUR process only (WebView2 browser, renderer, GPU, ...).
  $kids = @(Descendants $proc.Id)
  $report.childProcesses = @($kids | ForEach-Object { [ordered]@{ pid = $_.ProcessId; name = $_.Name; commandLine = $_.CommandLine } })
  $report.webview2ChildCount = @($kids | Where-Object { $_.Name -like 'msedgewebview2*' }).Count
  Note "Spawned processes: $($kids.Count) ($($report.webview2ChildCount) WebView2)"
  $browser = $kids | Where-Object { $_.Name -like 'msedgewebview2*' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  if ($browser) {
    $report.webview2BrowserCommandLine = $browser.CommandLine
    $report.browserHasRemoteDebugging = [bool]($browser.CommandLine -match '--remote-debugging-port')
    Note "WebView2 browser process has --remote-debugging-port: $($report.browserHasRemoteDebugging)"
  }

  # Where did WebView2 put its profile, and did it write DevToolsActivePort?
  $report.dataFolderExists = Test-Path $report.e2eDataPath
  $report.databaseCreated = Test-Path (Join-Path $report.e2eDataPath 'civildesk.sqlite3')
  $report.webviewFolderExists = Test-Path $report.e2eWebviewPath
  $ports = @(Get-ChildItem -Path $report.e2eWebviewPath, $report.e2eDataPath -Recurse -Filter DevToolsActivePort -Force -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $report.devToolsActivePortFiles = $ports
  Note "SQLite created: $($report.databaseCreated); DevToolsActivePort files: $($ports.Count)"

  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $OutDir 'desktop-with-app.png'))
  } catch { Note "Screenshot failed: $($_.Exception.Message)" }

  # Event log entries for our binary (application crashes, WebView2 failures).
  try {
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $started.AddMinutes(-1) } -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match 'civildesk-e2e|msedgewebview2|WebView2' } | Select-Object -First 10 TimeCreated, ProviderName, Id, Message
    $report.eventLog = @($events | ForEach-Object { "$($_.TimeCreated) [$($_.ProviderName) $($_.Id)] $(($_.Message -split "`n")[0])" })
  } catch { }

  # Cleanup: only the process we started and its own descendants.
  foreach ($k in (@(Descendants $proc.Id) | Sort-Object ProcessId -Descending)) { Stop-Process -Id $k.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  $proc.WaitForExit(10000) | Out-Null
  Start-Sleep -Seconds 2
  $leftover = @(Descendants $proc.Id)
  $report.cleanedUp = $proc.HasExited
  Note "Diagnostic process terminated: $($proc.HasExited)"
}

# The WebDriver session must start from a clean state: remove only the E2E identity folders this diagnostic created.
foreach ($dir in @($report.e2eDataPath, $report.e2eWebviewPath)) {
  if ((Split-Path $dir -Leaf) -eq 'com.webswe.civildesk.e2e' -and (Test-Path $dir)) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}
$report.notes = $notes
$report | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $OutDir 'startup-diagnostic.json') -Encoding utf8
if ($env:GITHUB_STEP_SUMMARY) {
  Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ("### Native startup diagnostic`n" + (($notes | ForEach-Object { "- $_" }) -join "`n"))
}
exit 0
