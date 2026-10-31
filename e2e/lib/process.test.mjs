import { describe, expect, it } from 'vitest';
import { listAppProcesses, waitForAppExit } from './process.mjs';

const clock = () => { let t = 0; return { now: () => t, sleep: async ms => { t += ms; } }; };

describe('application shutdown verification', () => {
  it('returns as soon as no process runs the E2E binary', async () => {
    const answers = [[{ pid: 7 }], [{ pid: 7 }], []];
    const result = await waitForAppExit({ binaryPath: 'x.exe', timeoutMs: 5000, intervalMs: 100, list: () => answers.shift() ?? [], ...clock() });
    expect(result).toMatchObject({ exited: true, remaining: [] });
    expect(result.waitedMs).toBe(200);
  });
  it('reports a timeout, with the offending processes, when the application never exits', async () => {
    const result = await waitForAppExit({ binaryPath: 'x.exe', timeoutMs: 1000, intervalMs: 250, list: () => [{ pid: 42, executable: 'x.exe' }], ...clock() });
    expect(result.exited).toBe(false);
    expect(result.remaining).toEqual([{ pid: 42, executable: 'x.exe' }]);
    expect(result.waitedMs).toBeGreaterThanOrEqual(1000);
  });
  it('never terminates anything: it only lists', async () => {
    const calls = [];
    await waitForAppExit({ binaryPath: 'x.exe', timeoutMs: 0, list: p => { calls.push(p); return []; }, ...clock() });
    expect(calls).toEqual(['x.exe']);
  });
  it.runIf(process.platform === 'win32')('matches by the exact executable path passed to PowerShell, not by image name', () => {
    let seen;
    const run = (cmd, args, options) => { seen = { cmd, args, options }; return JSON.stringify({ pid: 5, executable: 'C:\\x\\civildesk-e2e.exe' }); };
    expect(listAppProcesses('C:\\x\\civildesk-e2e.exe', run)).toEqual([{ pid: 5, executable: 'C:\\x\\civildesk-e2e.exe' }]);
    expect(seen.options.env.CIVILDESK_E2E_BINARY).toBe('C:\\x\\civildesk-e2e.exe');
    expect(seen.args.join(' ')).toContain('ExecutablePath');
    expect(seen.args.join(' ')).not.toMatch(/Stop-Process|taskkill|\.Kill\(/i);
    expect(listAppProcesses('C:\\x\\civildesk-e2e.exe', () => '[]')).toEqual([]);
    expect(listAppProcesses('C:\\x\\civildesk-e2e.exe', () => '')).toEqual([]);
  });
});
