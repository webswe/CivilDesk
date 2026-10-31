// Shared helpers. Selectors use roles, labels and visible text only: no coordinates.
import { browser, $, $$ } from '@wdio/globals';

export const NAV = '//nav[@aria-label="Main navigation"]';
export const DIALOG = '//dialog[@open]';
const q = text => (text.includes('"') ? `concat("${text.split('"').join('", \'"\', "')}")` : `"${text}"`);

export const navButton = label => $(`${NAV}//button[normalize-space(.)=${q(label)}]`);
export const button = name => $(`//button[normalize-space(@aria-label)=${q(name)} or normalize-space(.)=${q(name)}]`);
export const dialogButton = name => $(`${DIALOG}//button[normalize-space(.)=${q(name)}]`);
export const heading = text => $(`//h1[normalize-space(.)=${q(text)}]`);
export const textOf = text => $(`//*[normalize-space(text())=${q(text)}]`);

export async function waitReady() {
  await browser.waitUntil(async () => (await $('#display-name').isExisting()) || (await $(NAV).isExisting()), { timeout: 60000, timeoutMsg: 'CivilDesk did not render onboarding or the main navigation.' });
}
export async function onboard(name = 'E2E Tester') {
  await waitReady();
  if (await $('#display-name').isExisting()) {
    await $('#display-name').setValue(name);
    await $('button*=Enter CivilDesk').click();
  }
  await $(NAV).waitForDisplayed({ timeout: 30000 });
}
/** Restart the real application against the same profile, then wait for it to render. */
export async function restartApp() {
  await browser.reloadSession();
  await waitReady();
}
export async function reloadView() { await browser.refresh(); await waitReady(); }
export async function go(label) { const item = navButton(label); await item.waitForClickable(); await item.click(); }

/** React-safe value setter for inputs, selects and textareas (date inputs ignore typed keys). */
export async function setField(element, value) {
  await browser.execute((el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, element, value);
}
export const field = (label, tag = 'input') => $(`${DIALOG}//label[starts-with(normalize-space(.),${q(label)})]//${tag}`);

export function localDate(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export async function addTask({ title, area, due }) {
  await button('New task').click();
  await $(DIALOG).waitForDisplayed();
  await field('Title').setValue(title);
  if (area) await setField(await field('Area', 'select'), area);
  if (due) await setField(await field('Due date'), due);
  await dialogButton('Save task').click();
  await taskRow(title).waitForDisplayed({ timeoutMsg: 'Task "' + title + '" did not appear after saving.' });
}
export const taskRow = title => $(`//article[contains(@class,"task-row")][.//strong[normalize-space(.)=${q(title)}]]`);
export async function taskTitles() {
  // WebdriverIO's ElementArray is array-like but not iterable, so index it explicitly.
  const rows = await $$('//article[contains(@class,"task-row")]//strong');
  const titles = [];
  for (let i = 0; i < rows.length; i++) titles.push(await rows[i].getText());
  return titles;
}

/** Call a Tauri command through the app's own IPC bridge, to create predictable fixture data. */
export async function invoke(command, args) {
  const result = await browser.executeAsync((cmd, a, done) => {
    window.__TAURI_INTERNALS__.invoke(cmd, a).then(value => done({ ok: true, value }), e => done({ ok: false, error: String(e) }));
  }, command, args);
  if (!result.ok) throw new Error(command + ' failed: ' + result.error);
  return result.value;
}
/**
 * Read-your-writes barrier before restarting the app. The Rust side serialises database access, so once a
 * read through the app's own IPC shows the change, it is committed. If it never appears, the backend did not
 * persist it, which is reported as a failure rather than hidden by a longer sleep.
 */
export async function waitForPersisted(command, predicate, description) {
  await browser.waitUntil(async () => predicate(await invoke(command, {})), { timeout: 15000, interval: 200, timeoutMsg: 'Backend never persisted: ' + description });
}
export const taskFixture = (over = {}) => ({ id: crypto.randomUUID(), title: 'Fixture task', description: '', category: 'Personal', priority: 'normal', dueDate: null, dueTime: null, subtasks: [], reminderOffsetMinutes: null, ...over });
export const eventFixture = (over = {}) => ({ id: crypto.randomUUID(), title: 'Fixture event', description: '', startDate: localDate(), startTime: null, endDate: localDate(), endTime: null, allDay: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, startAtMs: null, endAtMs: null, reminderOffsetMinutes: null, ...over });
export async function seedTask(over) { const task = taskFixture(over); await invoke('save_task', { task }); return task; }
export async function seedEvent(over) { const event = eventFixture(over); await invoke('save_event', { event }); return event; }
