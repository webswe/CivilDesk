// Read-only native command probe of the *installed production-identity binary*.
// Its temporary WebView2 debugging port exists only in the disposable hosted runner.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { assertHostedTarget } from './fixture.mjs';

const [database, attachment, challengeId, portText] = process.argv.slice(2);
assertHostedTarget(database, attachment);
assert.match(challengeId, /^[a-zA-Z0-9_-]{1,100}$/);
const port = Number(portText);
assert.ok(Number.isInteger(port) && port >= 9228 && port <= 9250);

let page;
for (let attempt = 0; attempt < 60 && !page; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response.ok) page = (await response.json()).find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  } catch { /* app is still starting */ }
  if (!page) await delay(500);
}
assert.ok(page, 'Installed app did not expose its temporary loopback diagnostic page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebView2 debugging connection timed out')), 10000);
  ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView2 debugging connection failed')); }, { once: true });
});
const expression = `(async () => {
  const call = name => window.__TAURI_INTERNALS__.invoke(name);
  const [snapshot, projects, workspace, challenges, portfolio] = await Promise.all([
    call('load_snapshot'), call('load_projects'), call('load_workspace'), call('load_challenges'), call('load_portfolio')
  ]);
  return {
    name: snapshot.preferences.displayName,
    project: projects.projects.find(x => x.id === 'release-project')?.title,
    milestone: projects.milestones.find(x => x.id === 'release-milestone')?.projectId,
    file: projects.files.find(x => x.id === 'release-file')?.missing,
    task: workspace.tasks.find(x => x.id === 'release-task')?.projectId,
    event: workspace.events.find(x => x.id === 'release-event')?.title,
    challenge: challenges.progress.find(x => x.challengeId === ${JSON.stringify(challengeId)})?.status,
    challengeProject: challenges.projects.some(x => x.challengeId === ${JSON.stringify(challengeId)} && x.projectId === 'release-project'),
    portfolio: portfolio.studies.some(x => x.projectId === 'release-project')
  };
})()`;
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Installed app native-command probe timed out')), 20000);
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    resolve(message);
  });
  ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView2 diagnostic socket failed')); });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
ws.close();
if (result.result?.exceptionDetails) throw new Error('Installed app native command failed');
const actual = result.result?.result?.value;
assert.deepEqual(actual, {
  name: 'Release Rehearsal', project: 'Synthetic footbridge', milestone: 'release-project', file: false,
  task: 'release-project', event: 'Synthetic site visit', challenge: 'In Progress', challengeProject: true, portfolio: true,
});
console.log('Installed CivilDesk native commands returned the expected synthetic records.');
