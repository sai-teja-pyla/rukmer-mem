/**
 * Tier 1: OAuth agents, stable injection, document status, pagination, connector requests.
 * Run: npm run tier1-upgrades
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-tier1-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;

const { getState } = await import('./core.js');
const { bootMemoryEngine, mountMemoryEngine } = await import('./routes.js');

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

async function hit(method: string, urlPath: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-rukmer-user': 'tier1', ...headers },
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
});
check('oauth code is issued for cursor', code.status === 200 && !!code.json.code, String(code.status));
const token = await hit('POST', '/oauth/token', {
  grant_type: 'authorization_code',
  code: code.json.code,
  redirect_uri: redirect,
  code_verifier: 'plain-verifier',
});
check('token returns a read-only key', token.status === 200 && String(token.json.access_token || '').startsWith('rk_live_') && token.json.scope === 'memory:read');
const agents = await hit('GET', '/v4/agents');
check('agents lists the cursor connection', (agents.json.agents || []).some((row: { connector?: string; readOnly?: boolean }) => row.connector === 'cursor' && row.readOnly === true));
const blocked = await hit('POST', '/v3/documents', { text: 'should not land', title: 'blocked' }, { authorization: `Bearer ${token.json.access_token}` });
check('read-only key cannot write', blocked.status === 403, String(blocked.status));

const added = await hit('POST', '/v3/documents', { text: 'Nori keeps the blue notebook in the drawer.', title: 'Notebook' });
await hit('POST', '/v3/documents', { text: 'A second note so the list can page.', title: 'Second' });
check('document is accepted', added.status === 200 && !!added.json.document?.id, String(added.status));
const listed = await hit('POST', '/v3/documents/list', { limit: 1 });
check('document list is cursor paged', listed.status === 200 && listed.json.hasMore === true && !!listed.json.nextCursor);
const nextPage = await hit('POST', '/v3/documents/list', { limit: 1, cursor: listed.json.nextCursor });
check('next document page differs', nextPage.status === 200 && (nextPage.json.documents || [])[0]?.id !== (listed.json.documents || [])[0]?.id);
const doc = await hit('GET', `/v3/documents/${added.json.document.id}`);
check('document reports a processing status', ['queued', 'searchable', 'done'].includes(doc.json.processingStatus), doc.json.processingStatus);

const first = await hit('POST', '/v4/inject', { query: 'blue notebook', sessionId: 'sess-1' });
const second = await hit('POST', '/v4/inject', { query: 'blue notebook', sessionId: 'sess-1' });
check('injection returns a prefix hash', !!first.json.prefixHash && !!second.json.prefixHash);
check('second inject adds nothing new', Array.isArray(second.json.newMemoryIds) && second.json.newMemoryIds.length === 0, JSON.stringify(second.json.newMemoryIds));
check('unchanged session keeps the same injection', second.json.fullHash === first.json.fullHash);

const entities = await hit('GET', '/v4/entities?sort=degree&limit=5');
check('entities endpoint pages by degree', entities.status === 200 && Array.isArray(entities.json.entities));
const chunks = await hit('GET', `/v4/chunks?docId=${added.json.document.id}&limit=5`);
check('chunks endpoint pages a document', chunks.status === 200 && Array.isArray(chunks.json.chunks));
const memories = await hit('GET', '/v4/memories?limit=1');
check('memories endpoint is cursor paged', memories.status === 200 && Array.isArray(memories.json.memories));

const ask = await hit('POST', '/v4/connectors/request', { tool: 'Linear', useCase: 'link issues to memory' });
check('connector request is stored', ask.status === 200 && (getState().connectorRequests || []).some((row) => row.tool === 'Linear'));

server.close();
if (failures.length) {
  console.error(`\n${failures.length} tier 1 check(s) failed`);
  process.exit(1);
}
console.log('\ntier 1 checks passed');
