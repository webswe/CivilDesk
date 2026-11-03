// A deterministic, loopback-only stand-in for the Notion API, used by the native E2E suite.
// A spec starts it in-process (createNotionMock().start()) and reads/sets .state directly; there is no control endpoint.
//
// Safety properties (each is asserted in notion-mock.test.mjs):
//  * it only listens on 127.0.0.1 and has NO outbound networking code, so it cannot forward anything to Notion;
//  * the application under test can only reach it because the E2E binary is built with the `notion-mock` feature
//    and CIVILDESK_NOTION_MOCK_URL points here; every other build is hard-wired to the real Notion host;
//  * it never stores or logs the credential, only whether a plausible fake token was presented;
//  * it records every request so a spec can prove the app only issued allowlisted read requests.
import http from 'node:http';

export const MOCK_PORT = 4455;
export const API_VERSION = '2026-03-11';
export const FAKE_TOKEN_PREFIX = 'ntn_e2e_fake_';

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
export const IDS = { database: id(1), dataSource: id(2), notes: id(3), hostile: id(4), entry1: id(5), entry2: id(6), workspace: id(7), bot: id(8), secondDataSource: id(9), child: id(10), nestedBlock: id(106), subBlock: id(160) };
const rt = text => [{ type: 'text', plain_text: text, text: { content: text } }];
const pageObject = (pid, title, extra = {}) => ({ object: 'page', id: pid, created_time: '2026-01-01T00:00:00.000Z', last_edited_time: '2026-03-01T12:00:00.000Z', in_trash: false, parent: { type: 'workspace', workspace: true }, properties: { Name: { id: 'title', type: 'title', title: rt(title) } }, ...extra });
const dataSource = (dsid, title) => ({ object: 'data_source', id: dsid, title: rt(title), last_edited_time: '2026-03-02T09:00:00.000Z', in_trash: false, parent: { type: 'database_id', database_id: IDS.database }, database_parent: { type: 'workspace', workspace: true }, properties: {
  Name: { id: 'title', name: 'Name', type: 'title', title: {} },
  Status: { id: 's', name: 'Status', type: 'status', status: { options: [{ name: 'Not started' }, { name: 'Done' }], groups: [] } },
  Due: { id: 'd', name: 'Due', type: 'date', date: {} },
  Tags: { id: 't', name: 'Tags', type: 'multi_select', multi_select: { options: [{ name: 'Lab' }] } },
  Total: { id: 'r', name: 'Total', type: 'rollup', rollup: {} },
} });
const entry = (eid, title, status) => pageObject(eid, title, { parent: { type: 'data_source_id', data_source_id: IDS.dataSource }, properties: {
  Name: { id: 'title', type: 'title', title: rt(title) }, Status: { id: 's', type: 'status', status: { name: status } },
  Due: { id: 'd', type: 'date', date: { start: '2026-04-01', end: null } }, Tags: { id: 't', type: 'multi_select', multi_select: [{ name: 'Lab' }] },
  Total: { id: 'r', type: 'rollup', rollup: { type: 'number', number: 4 } } } });
const block = (n, type, body, extra = {}) => ({ object: 'block', id: id(100 + n), type, has_children: false, in_trash: false, [type]: body, ...extra });
const filler = Array.from({ length: 25 }, (_, i) => pageObject(id(200 + i), `E2E Filler ${String(i + 1).padStart(2, '0')}`));
const everything = [dataSource(IDS.dataSource, 'E2E Assignments'), pageObject(IDS.notes, 'E2E Notes'), pageObject(IDS.hostile, '<img src=x onerror=alert(1)> E2E Hostile'), ...filler];

const HOSTILE = '<img src=x onerror="window.__e2ePwned=1"><script>window.__e2ePwned=2</script>';
const HOSTILE_LINK = 'https://example.com/e2e-link';
const blocksFor = pid => {
  if (pid === IDS.hostile) return [block(1, 'paragraph', { rich_text: rt(HOSTILE) }), block(2, 'bookmark', { url: 'javascript:window.__e2ePwned=3', caption: [] })];
  if (pid === IDS.nestedBlock) return [block(60, 'paragraph', { rich_text: rt('E2E nested detail') })];
  if (pid === IDS.child) return [block(70, 'paragraph', { rich_text: rt('E2E sub page body') })];
  if (pid === IDS.entry1 || pid === IDS.entry2) return [block(80, 'paragraph', { rich_text: rt('E2E entry body') })];
  if (pid !== IDS.notes) return [];
  return [block(1, 'heading_1', { rich_text: rt('E2E Heading') }), block(2, 'paragraph', { rich_text: rt('Plain paragraph from the mock Notion.') }),
     block(3, 'to_do', { rich_text: rt('Mock to-do'), checked: true }), block(4, 'image', { type: 'file', file: { url: 'https://example.invalid/never-loaded.png?sig=SECRET' }, caption: rt('Site photo') }),
     block(5, 'table', { table_width: 2 }),
     block(6, 'bulleted_list_item', { rich_text: rt('E2E nested bullet') }, { has_children: true }),
     block(7, 'numbered_list_item', { rich_text: rt('E2E first step') }), block(8, 'numbered_list_item', { rich_text: rt('E2E second step') }),
     block(9, 'paragraph', { rich_text: [{ type: 'text', plain_text: 'E2E link text', text: { content: 'E2E link text' }, href: HOSTILE_LINK }] }),
     { object: 'block', id: IDS.child, type: 'child_page', has_children: true, in_trash: false, child_page: { title: 'E2E Sub page' } }];
};
const subPage = pageObject(IDS.child, 'E2E Sub page', { parent: { type: 'page_id', page_id: IDS.notes } });

export function createNotionMock({ port = MOCK_PORT } = {}) {
  const state = { mode: 'ok', requests: [], violations: [], listening: false, server: null };
  const allowed = [
    ['GET', /^\/v1\/users\/me$/], ['POST', /^\/v1\/search$/], ['GET', /^\/v1\/databases\/[0-9a-f-]{36}$/], ['GET', /^\/v1\/data_sources\/[0-9a-f-]{36}$/],
    ['POST', /^\/v1\/data_sources\/[0-9a-f-]{36}\/query$/], ['GET', /^\/v1\/pages\/[0-9a-f-]{36}$/], ['GET', /^\/v1\/blocks\/[0-9a-f-]{36}\/children$/],
  ];
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const error = (res, status, code, message, headers) => send(res, status, { object: 'error', status, code, message }, headers);
  const paged = (items, body, size) => {
    const start = body?.start_cursor ? Number(String(body.start_cursor).replace('cursor-', '')) : 0;
    const slice = items.slice(start, start + size); const next = start + size;
    return { object: 'list', results: slice, next_cursor: next < items.length ? `cursor-${next}` : null, has_more: next < items.length, type: 'page_or_data_source', page_or_data_source: {} };
  };

  const handle = (req, res, raw) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const entryLog = { method: req.method, path: url.pathname, version: req.headers['notion-version'] ?? null, authorized: typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ' + FAKE_TOKEN_PREFIX), bodyKeys: [] };
    let body = {};
    if (raw) { try { body = JSON.parse(raw); entryLog.bodyKeys = Object.keys(body); } catch { /* ignored */ } }
    state.requests.push(entryLog);
    if (!allowed.some(([m, re]) => m === req.method && re.test(url.pathname))) { state.violations.push(`${req.method} ${url.pathname}`); return error(res, 405, 'invalid_request_url', 'Not allowed by the E2E mock.'); }
    if (entryLog.version !== API_VERSION) return error(res, 400, 'validation_error', 'Wrong Notion-Version.');
    if (state.mode === 'ratelimit') return error(res, 429, 'rate_limited', 'slow down', { 'retry-after': '60' });
    if (state.mode === 'unauthorized' || !entryLog.authorized) return error(res, 401, 'unauthorized', 'API token is invalid.');
    if (state.mode === 'forbidden') return error(res, 403, 'restricted_resource', 'No read capability.');
    const p = url.pathname;
    if (p === '/v1/users/me') return send(res, 200, { object: 'user', id: IDS.bot, type: 'bot', name: 'CivilDesk E2E', bot: { owner: { type: 'workspace', workspace: true }, workspace_id: IDS.workspace, workspace_name: 'E2E Mock Workspace', workspace_limits: { max_file_upload_size_in_bytes: 5242880 } } });
    if (p === '/v1/search') {
      let items = everything;
      const filter = body.filter?.value; if (filter) items = items.filter(i => i.object === filter);
      const q = String(body.query ?? '').toLowerCase(); if (q) items = items.filter(i => JSON.stringify(i.title ?? i.properties.Name.title).toLowerCase().includes(q));
      return send(res, 200, paged(items, body, Math.min(Number(body.page_size) || 25, 25)));
    }
    let m;
    if ((m = p.match(/^\/v1\/databases\/(.+)$/))) return m[1] === IDS.database ? send(res, 200, { object: 'database', id: IDS.database, title: rt('E2E Coursework'), data_sources: [{ id: IDS.dataSource, name: 'E2E Assignments' }, { id: IDS.secondDataSource, name: 'E2E Archive' }] }) : error(res, 404, 'object_not_found', 'x');
    if ((m = p.match(/^\/v1\/data_sources\/([^/]+)\/query$/))) return m[1] === IDS.dataSource ? send(res, 200, paged([entry(IDS.entry1, 'E2E Entry One', 'Not started'), entry(IDS.entry2, 'E2E Entry Two', 'Done')], body, Number(body.page_size) || 10)) : error(res, 404, 'object_not_found', 'x');
    if ((m = p.match(/^\/v1\/data_sources\/(.+)$/))) return m[1] === IDS.dataSource ? send(res, 200, dataSource(IDS.dataSource, 'E2E Assignments')) : error(res, 404, 'object_not_found', 'x');
    if ((m = p.match(/^\/v1\/pages\/(.+)$/))) { const page = [...everything, subPage, entry(IDS.entry1, 'E2E Entry One', 'Not started'), entry(IDS.entry2, 'E2E Entry Two', 'Done')].find(i => i.object === 'page' && i.id === m[1]); return page ? send(res, 200, page) : error(res, 404, 'object_not_found', 'x'); }
    if ((m = p.match(/^\/v1\/blocks\/([^/]+)\/children$/))) return send(res, 200, { object: 'list', type: 'block', block: {}, results: blocksFor(m[1]), next_cursor: null, has_more: false });
    return error(res, 404, 'object_not_found', 'x');
  };

  function start() {
    return new Promise((resolve, reject) => {
      state.server = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8'))); });
      state.server.once('error', reject);
      // Loopback only.
      state.server.listen(port, '127.0.0.1', () => { state.listening = true; resolve(state.server.address().port); });
    });
  }
  function stop() { return new Promise(resolve => { if (!state.server || !state.listening) return resolve(); state.listening = false; state.server.closeAllConnections?.(); state.server.close(() => resolve()); }); }
  return { start, stop, state };
}
