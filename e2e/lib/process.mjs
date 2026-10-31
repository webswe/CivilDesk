// Shutdown verification. The E2E application is started by tauri-driver, not by us, so its identity is the exact
// executable path of the E2E build (not just an image name). This module only observes: it never terminates anything.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = [
  '$target = [System.IO.Path]::GetFullPath($env:CIVILDESK_E2E_BINARY)',
  '$found = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ([string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $target, [System.StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; executable = $_.ExecutablePath } })',
  'ConvertTo-Json -InputObject $found -Compress',
].join('; ');

/** Processes whose executable is exactly `binaryPath`. Empty on non-Windows hosts. */
export function listAppProcesses(binaryPath, run = execFileSync) {
  if (process.platform !== 'win32') return [];
  const text = String(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { env: { ...process.env, CIVILDESK_E2E_BINARY: path.resolve(binaryPath) }, encoding: 'utf8', windowsHide: true })).trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Waits (bounded) until no process runs the E2E binary.
 * @returns {Promise<{exited:boolean, remaining:{pid:number}[], waitedMs:number}>}
 */
export async function waitForAppExit({ binaryPath, timeoutMs = 20000, intervalMs = 250, list = listAppProcesses, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  const start = now();
  for (;;) {
    const remaining = list(binaryPath);
    if (remaining.length === 0) return { exited: true, remaining: [], waitedMs: now() - start };
    if (now() - start >= timeoutMs) return { exited: false, remaining, waitedMs: now() - start };
    await sleep(intervalMs);
  }
}
