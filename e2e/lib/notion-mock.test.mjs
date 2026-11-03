import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_VERSION, createNotionMock, FAKE_TOKEN_PREFIX, IDS } from './notion-mock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = FAKE_TOKEN_PREFIX + 'unit';
let mock; let base;
beforeAll(async () => { mock = createNotionMock({ port: 0 }); base = 'http://127.0.0.1:' + await mock.start(); });
afterAll(() => mock.stop());
const call = (method, p, { body, token = TOKEN, version = API_VERSION } = {}) => fetch(base + p, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'notion-version': version, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const id0 = () => '99999999-0000-4000-8000-000000000000';

describe('notion mock (E2E support)', () => {
  it('has no outbound networking, so it cannot forward to a live workspace', () => {
    const source = fs.readFileSync(path.join(here, 'notion-mock.mjs'), 'utf8');
    for (const forbidden of [/\bfetch\s*\(/, /http\.request\s*\(/, /https\.request\s*\(/, /from 'node:https'/, /net\.connect/, /api\.notion\.com/, /\.get\s*\(\s*['"`]http/]) expect(source).not.toMatch(forbidden);
    expect(source).toContain("'127.0.0.1'");
  });

  it('accepts only the fixed API version and a fake token', async () => {
    expect((await call('GET', '/v1/users/me')).status).toBe(200);
    expect((await call('GET', '/v1/users/me', { version: '2022-06-28' })).status).toBe(400);
    expect((await call('GET', '/v1/users/me', { token: null })).status).toBe(401);
    expect((await call('GET', '/v1/users/me', { token: 'ntn_real_looking_token' })).status).toBe(401);
  });

  it('rejects and records every non-read request', async () => {
    mock.state.violations.length = 0;
    expect((await call('PATCH', `/v1/pages/${IDS.notes}`, { body: { archived: true } })).status).toBe(405);
    expect((await call('DELETE', `/v1/blocks/${IDS.notes}`)).status).toBe(405);
    expect((await call('POST', '/v1/pages', { body: {} })).status).toBe(405);
    expect(mock.state.violations).toHaveLength(3);
    mock.state.violations.length = 0;
  });

  it('paginates search and supports data-source query', async () => {
    const first = await (await call('POST', '/v1/search', { body: { page_size: 25 } })).json();
    expect(first.results).toHaveLength(25); expect(first.has_more).toBe(true);
    const second = await (await call('POST', '/v1/search', { body: { page_size: 25, start_cursor: first.next_cursor } })).json();
    expect(second.has_more).toBe(false); expect(first.results.length + second.results.length).toBe(28);
    const q = await (await call('POST', `/v1/data_sources/${IDS.dataSource}/query`, { body: { page_size: 10 } })).json();
    expect(q.results).toHaveLength(2);
  });

  it('serves sub-pages, database rows, nested blocks and links for the workspace specs, read-only', async () => {
    const sub = await (await call('GET', `/v1/pages/${IDS.child}`)).json();
    expect(sub.parent).toEqual({ type: 'page_id', page_id: IDS.notes });
    const row = await (await call('GET', `/v1/pages/${IDS.entry1}`)).json();
    expect(row.parent.type).toBe('data_source_id');
    const notes = await (await call('GET', `/v1/blocks/${IDS.notes}/children`)).json();
    expect(notes.results.some(b => b.type === 'child_page' && b.id === IDS.child)).toBe(true);
    expect(notes.results.find(b => b.id === IDS.nestedBlock).has_children).toBe(true);
    expect(JSON.stringify(notes.results)).toContain('https://example.com/e2e-link');
    const nested = await (await call('GET', `/v1/blocks/${IDS.nestedBlock}/children`)).json();
    expect(nested.results).toHaveLength(1);
    expect((await call('GET', `/v1/pages/${id0()}`)).status).toBe(404);
  });

  it('never records the credential', async () => {
    expect(JSON.stringify(mock.state.requests)).not.toContain(TOKEN);
  });

  it('can simulate an unreachable service by closing its listener', async () => {
    const local = createNotionMock({ port: 0 });
    const url = 'http://127.0.0.1:' + await local.start();
    await local.stop();
    await expect(fetch(url + '/v1/users/me')).rejects.toBeTruthy();
  });
});
