/**
 * /v3/tags and /v4/graph return the caller's memories.
 * A storage read failure is a JSON error, and the process keeps serving.
 * Run: npm run graph-routes
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-graph-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.K_SERVICE;
delete process.env.MEMORY_GCS_BUCKET;
delete process.env.MEMORY_REQUIRE_AUTH;
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;

const { bootMemoryEngine, memoryErrorMiddleware, mountMemoryEngine } = await import('./routes.js');
const { getState, setMemoryStoreReaderForTests } = await import('./core.js');
const { homeTag } = await import('./tenancy.js');
delete process.env.K_SERVICE;
delete process.env.MEMORY_GCS_BUCKET;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const USER = 'khNHseed';
const tag = homeTag(USER);

await bootMemoryEngine();
const now = new Date().toISOString();
getState().documents.push({
  id: 'doc_nori',
  containerTag: tag,
  title: 'Nori note',
  source: 'memory',
  mime: 'text/plain',
  text: 'Nori keeps a private note about jasmine tea',
  createdAt: now,
  forgotten: false,
});
getState().chunks.push({
  id: 'chk_nori',
  docId: 'doc_nori',
  containerTag: tag,
  text: 'Nori keeps a private note about jasmine tea',
  index: 0,
  embedding: [],
  hash: 'h',
  createdAt: now,
  forgotten: false,
  source: 'memory',
});
getState().triples.push({
  id: 'trip_nori',
  containerTag: tag,
  subject: 'Nori',
  predicate: 'prefers',
  object: 'jasmine tea',
  evidence: 'seed',
  isLatest: true,
  derived: false,
  validFrom: now,
  validTo: null,
  kind: 'assert',
});

const app = express();
app.use(express.json());
mountMemoryEngine(app);
app.get('/v4/store-boom', (_req, _res, next) => {
  next(Object.assign(new Error("Couldn't read the memory store"), { status: 503, expose: true }));
});
app.use(memoryErrorMiddleware);
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;

async function hit(urlPath: string, user = '') {
  const headers = new Headers();
  if (user) headers.set('x-rukmer-user', user);
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 180) };
  }
  return { status: res.status, body, type: res.headers.get('content-type') || '' };
}

const started = Date.now();
const health = await hit('/health');
const healthMs = Date.now() - started;
check('health is ready without the memory text', health.status === 200 && health.body.ok === true && health.body.ready === true && health.body.dependencies?.memoryStore === 'ok');
check('health stays cheap', healthMs < 1000 && JSON.stringify(health.body).length < 4000 && !JSON.stringify(health.body).includes('jasmine'));
check(
  'health does not publish the store',
  !('store' in health.body) &&
    !('storeError' in health.body) &&
    !('providers' in health.body) &&
    typeof health.body.encryptionAtRest === 'boolean' &&
    typeof health.body.llm === 'boolean'
);

const tags = await hit('/v3/tags', USER);
const row = (tags.body.tags || []).find((item: { tag?: string }) => item.tag === tag);
check('tags returns the seeded user tag', tags.status === 200 && tags.type.includes('json') && !!row && Number(row.memories) >= 1 && Number(row.documents) >= 1, JSON.stringify(tags.body).slice(0, 240));

const graph = await hit('/v4/graph', USER);
const graphText = JSON.stringify(graph.body);
check(
  'graph returns the seeded nodes',
    graph.status === 200 &&
    graph.type.includes('json') &&
    Array.isArray(graph.body.nodes) &&
    graph.body.nodes.some((node: { label?: string }) => /Nori note|jasmine tea|Nori/.test(String(node.label || ''))) &&
    graphText.includes('jasmine tea')
);

const other = await hit('/v4/graph', 'someoneelse');
check('another user does not receive the seeded graph', other.status === 200 && !JSON.stringify(other.body).includes('jasmine tea'));

const boom = await hit('/v4/store-boom', USER);
const healthAfterBoom = await hit('/health');
check(
  'a thrown storage error is JSON and the server stays up',
  boom.status === 503 && boom.type.includes('json') && String(boom.body.error || '').includes('memory store') && !boom.body.raw && healthAfterBoom.status === 200
);

setMemoryStoreReaderForTests(async () => {
  throw Object.assign(new Error('simulated storage outage'), { code: 500 });
});
let failed = false;
try {
  await bootMemoryEngine();
} catch (err) {
  failed = String((err as Error).message || '').includes('memory store');
}
const brokenTags = await hit('/v3/tags', USER);
const brokenHealth = await hit('/health');
const stillUp = await hit('/v3/tags', USER);
check('storage failure is thrown from the reader', failed);
check(
  'storage failure returns JSON instead of crashing',
  brokenTags.status === 503 &&
    brokenTags.type.includes('json') &&
    String(brokenTags.body.error || '').includes('memory store') &&
    !brokenTags.body.raw &&
    !JSON.stringify(brokenTags.body).includes('jasmine') &&
    brokenHealth.status === 503 &&
    brokenHealth.body.ok === false &&
    brokenHealth.body.ready === false &&
    brokenHealth.body.dependencies?.memoryStore === 'error' &&
    !('store' in brokenHealth.body) &&
    !('storeError' in brokenHealth.body) &&
    !JSON.stringify(brokenHealth.body).includes('simulated storage outage') &&
    stillUp.status === 503 &&
    stillUp.type.includes('json')
);

server.close();

if (failures.length) {
  console.error(`\n${failures.length} graph route check(s) failed`);
  process.exit(1);
}
console.log('\ngraph route checks passed');
