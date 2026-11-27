/**
 * Tier 1 acceptance: OAuth scope, stable injection, searchable ingest, cursors, connector requests.
 * Run: npm run tier1-upgrades
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-tier1-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
process.env.MEMORY_RATE_LIMIT = '100000';
delete process.env.GEMINI_API_KEY;

const { getState } = await import('./core.js');
const { bootMemoryEngine, mountMemoryEngine } = await import('./routes.js');
const { stableMemoryOrder } = await import('./inject.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

await bootMemoryEngine();
const express = (await import('express')).default;
const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;

async function hit(method: string, urlPath: string, body?: unknown, headers: Record<string, string> = {}, user = 'tier1') {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-rukmer-user': user } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const ordered = stableMemoryOrder([
  { id: 'b', createdAt: '2020-01-02', score: 0.99 },
  { id: 'a', createdAt: '2020-01-01', score: 0.1 },
]);
check('stable sort ignores score', ordered.map((row) => row.id).join(',') === 'a,b');

const redirect = 'http://127.0.0.1:9/callback';
const registered = await hit('POST', '/oauth/register', { redirect_uris: [redirect] });
const code = await hit('POST', '/oauth/code', {
  client_id: registered.json.client_id,
  redirect_uri: redirect,
  state: 'abc',
  code_challenge: 'plain-verifier',
  code_challenge_method: 'PLAIN',
  connector: 'cursor',
  scope: 'memory:read',
  containerTags: ['u_tier1'],
});
const token = await hit('POST', '/oauth/token', {
  grant_type: 'authorization_code',
  code: code.json.code,
  redirect_uri: redirect,
  code_verifier: 'plain-verifier',
});
check('token is read-only and refreshable', token.status === 200 && String(token.json.access_token || '').startsWith('rk_live_') && token.json.scope === 'memory:read' && !!token.json.refresh_token);
const agents = await hit('GET', '/v4/agents');
check('cursor key is grouped as coding', (agents.json.agents || []).some((row: { connector?: string; group?: string; readOnly?: boolean }) => row.connector === 'cursor' && row.group === 'coding' && row.readOnly));
const keys = await hit('GET', '/v3/keys?source=oauth');
check('oauth key lists its creator', (keys.json.keys || []).some((row: { source?: string; createdBy?: { uid?: string } }) => row.source === 'oauth' && row.createdBy?.uid === 'tier1'));
const auth = { authorization: `Bearer ${token.json.access_token}` };
const searchOk = await hit('POST', '/v4/search', { query: 'notebook' }, auth, '');
const writeBlocked = await hit('POST', '/v3/documents', { text: 'should not land', title: 'blocked' }, auth, '');
const toolBlocked = await hit('POST', '/v4/tools/execute', { name: 'addMemory', arguments: { text: 'I work at SecretCo' } }, auth, '');
check('read-only key can search and cannot write', searchOk.status === 200 && writeBlocked.status === 403 && toolBlocked.status === 403, `${searchOk.status}/${writeBlocked.status}/${toolBlocked.status}`);
const refreshed = await hit('POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: token.json.refresh_token }, {}, '');
check('non-browser refresh rotates the key', refreshed.status === 200 && String(refreshed.json.access_token || '').startsWith('rk_live_') && refreshed.json.access_token !== token.json.access_token);
const stale = await hit('POST', '/v4/search', { query: 'notebook' }, auth, '');
check('rotated key no longer authenticates', stale.status === 401, String(stale.status));

const own = await hit('POST', '/v3/keys', { name: 'full-key' });
const fullAuth = { authorization: `Bearer ${own.json.secret}` };
const me = await hit('GET', '/v3/me', undefined, fullAuth, '');
const fullSearch = await hit('POST', '/v4/search', { query: 'hello' }, fullAuth, '');
check('existing unscoped key still has full access', me.status === 200 && fullSearch.status === 200 && String(own.json.secret || '').startsWith('rk_live_'));

const outsider = await hit('POST', '/v3/documents', { text: 'Private Lisbon drawer belonging only to the other user.', title: 'Other drawer' }, {}, 'otheruser');
const scopedCode = await hit('POST', '/oauth/code', {
  client_id: registered.json.client_id,
  redirect_uri: redirect,
  code_challenge: 'tag-verifier',
  code_challenge_method: 'PLAIN',
  connector: 'cli',
  containerTags: ['u_tier1'],
});
const scoped = await hit('POST', '/oauth/token', {
  grant_type: 'authorization_code',
  code: scopedCode.json.code,
  redirect_uri: redirect,
  code_verifier: 'tag-verifier',
});
const foreignRead = await hit('GET', `/v3/documents/${outsider.json.document.id}`, undefined, { authorization: `Bearer ${scoped.json.access_token}` }, '');
const foreignTag = await hit('POST', '/v3/documents/list', { containerTag: 'u_otheruser' }, { authorization: `Bearer ${scoped.json.access_token}` }, '');
check('tag scope cannot read another private tag', foreignRead.status === 404 && (foreignTag.status === 403 || foreignTag.status === 400), `${foreignRead.status}/${foreignTag.status}`);

const team = await hit('POST', '/v4/governance/teams', { name: 'Platform' }, {}, 'owner1');
await hit('POST', '/v4/governance/teams/members', { teamId: team.json.id, uid: 'member1' }, {}, 'owner1');
const memberKey = await hit('POST', '/v3/keys', { name: 'member-plugin', teamId: team.json.id }, {}, 'member1');
const ownerList = await hit('GET', '/v3/keys', undefined, {}, 'owner1');
const memberDenied = await hit('DELETE', `/v3/keys/${own.json.id}`, undefined, {}, 'member1');
const ownerRevoke = await hit('DELETE', `/v3/keys/${memberKey.json.id}`, undefined, {}, 'owner1');
check(
  'team admin lists and revokes a member key',
  (ownerList.json.keys || []).some((row: { id?: string }) => row.id === memberKey.json.id) && (memberDenied.status === 403 || memberDenied.status === 404) && ownerRevoke.status === 200,
  `${memberDenied.status}/${ownerRevoke.status}`
);

const firstDoc = await hit('POST', '/v3/documents', { text: 'The blue notebook stays in the drawer for Nori.', title: 'Notebook' });
check('ingest answers searchable before extract', firstDoc.status === 200 && firstDoc.json.document?.processingStatus === 'searchable', firstDoc.json.document?.processingStatus);
let finished = firstDoc.json.document;
for (let i = 0; i < 20 && finished?.processingStatus !== 'done'; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
  finished = (await hit('GET', `/v3/documents/${firstDoc.json.document.id}`)).json;
}
check('extract finishes as done', finished?.processingStatus === 'done', finished?.processingStatus);
const bare = await hit('POST', '/v3/documents', { text: 'hello', title: 'Bare' });
let bareDoc = bare.json.document;
for (let i = 0; i < 20 && bareDoc?.processingStatus !== 'done'; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
  bareDoc = (await hit('GET', `/v3/documents/${bare.json.document.id}`)).json;
}
check('a doc with no facts records the reason', bareDoc?.processingStatus === 'done' && bareDoc?.memoryStatusReason === 'No durable facts found', bareDoc?.memoryStatusReason);

await hit('POST', '/v3/documents', { text: 'I prefer oat milk and I live in Lisbon.', title: 'Facts' });
await new Promise((resolve) => setTimeout(resolve, 80));
const entities = await hit('GET', '/v4/entities?sort=degree&limit=20');
const degrees = (entities.json.entities || []).map((row: { degree?: number }) => Number(row.degree || 0));
const sorted = [...degrees].sort((a, b) => b - a).every((value, index) => value === degrees[index]);
const sources = (entities.json.entities || []).filter((row: { sourceDocuments?: { createdAt?: string }[] }) => (row.sourceDocuments || []).length > 1);
const newestFirst = sources.every((row: { sourceDocuments: { createdAt?: string }[] }) =>
  row.sourceDocuments.every((doc, index, all) => index === 0 || String(all[index - 1].createdAt) >= String(doc.createdAt))
);
check('entities sort by degree and sources are newest first', entities.status === 200 && sorted && newestFirst, `n=${degrees.length}`);
const graph = await hit('GET', '/v4/graph?sort=degree');
check('graph entities carry degree and sources', (graph.json.nodes || []).filter((node: { degree?: number }) => node.degree != null).every((node: { sourceDocuments?: unknown }) => Array.isArray(node.sourceDocuments)));

const coffee = await hit('POST', '/v3/documents', { text: 'Nori prefers black coffee every morning.', title: 'Coffee' }, {}, 'injectuser');
let coffeeDoc = coffee.json.document;
for (let i = 0; i < 20 && coffeeDoc?.processingStatus !== 'done'; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 25));
  coffeeDoc = (await hit('GET', `/v3/documents/${coffee.json.document.id}`, undefined, {}, 'injectuser')).json;
}
const turn1 = await hit('POST', '/v4/inject', { query: 'What coffee do I prefer?', sessionId: 'sess-a', topK: 8 }, {}, 'injectuser');
await hit('POST', '/v3/documents', { text: 'Nori prefers black coffee with a blue mug.', title: 'Mug' }, {}, 'injectuser');
await new Promise((resolve) => setTimeout(resolve, 50));
const turn2 = await hit('POST', '/v4/inject', { query: 'What coffee do I prefer?', sessionId: 'sess-a', topK: 8 }, {}, 'injectuser');
check('session prefix is a leading byte range', String(turn2.json.injection || '').startsWith(String(turn2.json.stablePrefix || 'missing')));
check(
  'turn 2 keeps the first passages and can append',
  (turn1.json.newMemoryIds || []).length > 0 && String(turn1.json.injection || '').includes('black coffee') && (turn2.json.reusedMemoryIds || []).length >= (turn1.json.newMemoryIds || []).length,
  `t1=${JSON.stringify(turn1.json.newMemoryIds)} reused=${JSON.stringify(turn2.json.reusedMemoryIds)} new=${JSON.stringify(turn2.json.newMemoryIds)} skip=${turn1.json.skipReason}`
);
const sameOrder = stableMemoryOrder([
  { id: 'later', createdAt: '2024-02-01', score: 0.2 },
  { id: 'earlier', createdAt: '2024-01-01', score: 0.9 },
]);
check('same id set ignores score order', sameOrder.map((row) => row.id).join(',') === 'earlier,later');
const empty = await hit('POST', '/v4/inject', { query: 'what is the capital of mongolia', sessionId: 'sess-empty' });
check('empty retrieval stays empty', (empty.json.newMemoryIds || []).length === 0 && !String(empty.json.injection || '').includes('blue notebook'));

for (let i = 0; i < 60; i += 1) await hit('POST', '/v3/documents', { text: `Paging note ${i} ${'x'.repeat(20)}`, title: `Page ${i}` });
const seen = new Set<string>();
let cursor = '';
let issued = '';
let pages = 0;
let lastMore = true;
while (lastMore && pages < 5) {
  const page = await hit('POST', '/v3/documents/list', { limit: 20, cursor });
  if (pages === 0) {
    issued = page.json.nextCursor || '';
    check('first page keeps documents, tags, and home', page.status === 200 && Array.isArray(page.json.documents) && Array.isArray(page.json.tags) && !!page.json.homeTag, `${page.status} ${JSON.stringify(page.json).slice(0, 180)}`);
  }
  for (const row of page.json.documents || []) {
    if (seen.has(row.id)) check('pages do not repeat a document', false, row.id);
    seen.add(row.id);
  }
  lastMore = page.json.hasMore === true;
  cursor = page.json.nextCursor || '';
  pages += 1;
  if (!lastMore) check('last page reports no more', page.json.hasMore === false);
}
check('three pages cover at least 60 new notes', seen.size >= 60, String(seen.size));
const foreignCursor = await hit('POST', '/v3/documents/list', { limit: 20, cursor: issued }, {}, 'otheruser');
check('another user cannot walk this cursor', foreignCursor.status === 400 || (foreignCursor.json.documents || []).length === 0, String(foreignCursor.status));

const badRequest = await hit('POST', '/v4/connectors/request', { tool: '', useCase: '' });
const savedRequest = await hit('POST', '/v4/connectors/request', { tool: 'Linear', useCase: 'link issues to memory' });
const signedOut = await hit('POST', '/v4/connectors/request', { tool: 'Linear', useCase: 'notes' }, {}, '');
check('connector request validates', badRequest.status === 400 && savedRequest.status === 200 && signedOut.status === 401 && (getState().connectorRequests || []).some((row) => row.tool === 'Linear'));

server.close();
if (failures.length) {
  console.error(`\n${failures.length} tier 1 check(s) failed`);
  process.exit(1);
}
console.log('\ntier 1 checks passed');
