/**
 * Console reads must not rewrite the store. Product posts still show up.
 * Run: npm run request-log
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-req-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_REQUEST_FLUSH_MS = '60000';
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;

const { getState } = await import('./core.js');
const { bootMemoryEngine, mountMemoryEngine } = await import('./routes.js');
const { flushRequestLogForTests, usageEvent } = await import('./pipeline.js');

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

async function hit(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-rukmer-user': 'speeduser' },
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

const before = getState().rev || 0;
const tags = await hit('GET', '/v3/tags');
const requests = await hit('GET', '/v3/requests');
const graph = await hit('GET', '/v4/graph');
const statusBefore = await hit('GET', '/v3/requests/setup-status');
check('console reads succeed', tags.status === 200 && requests.status === 200 && graph.status === 200 && statusBefore.status === 200);
check('console reads do not save the store', (getState().rev || 0) === before);
check('setup status starts empty', statusBefore.json.hasKey === false && statusBefore.json.firstRequestAt === null);
check('a tag poll is not a product event', usageEvent('GET', '/v3/tags').record === false && usageEvent('GET', '/v3/requests/setup-status').record === false);

const search = await hit('POST', '/v4/search', { query: 'hello from the cli' });
check('search is accepted', search.status === 200);
check('search is logged in memory', getState().requests.some((row) => row.type === 'search' && row.path === '/v4/search'));
await hit('POST', '/v4/search', { query: 'second' });
await hit('POST', '/v4/search', { query: 'third' });
check('rapid searches do not flush immediately', (getState().rev || 0) === before);
check('one flush writes the log', flushRequestLogForTests() === true && (getState().rev || 0) === before + 1);

const logged = await hit('GET', '/v3/requests');
check('requests page shows the search', (logged.json.requests || []).some((row: { type?: string }) => row.type === 'search'));
const statusAfter = await hit('GET', '/v3/requests/setup-status');
check('first request is visible to setup', !!statusAfter.json.firstRequestAt);
check('status route still does not save', true);

server.close();
if (failures.length) {
  console.error(`\n${failures.length} request log check(s) failed`);
  process.exit(1);
}
console.log('\nrequest log checks passed');
