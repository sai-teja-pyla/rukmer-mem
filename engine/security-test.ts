/**
 * Request controls: identity, IDOR, uploads, rate limits, admin, injection.
 * Run: npm run security
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-sec-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.MEMORY_DATA_KEY;
delete process.env.MEMORY_RATE_LIMIT;
delete process.env.SLACK_SIGNING_SECRET;
delete process.env.SLACK_ALLOW_UNSIGNED;

const { mountMemoryEngine } = await import('./routes.js');
const { securityMiddleware, checkUpload, slackSignatureOk, resetRateLimits } = await import('./security.js');
const { homeTag } = await import('./tenancy.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const app = express();
app.use(securityMiddleware);
app.use(express.json({ limit: '2mb' }));
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function hit(urlPath: string, init: RequestInit = {}, user = '') {
  const headers = new Headers(init.headers);
  if (user) headers.set('x-rukmer-user', user);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { ...init, headers });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, headers: res.headers };
}

const health = await hit('/health');
check('security status is public', health.status === 200 && health.body.rateLimiting === true && health.body.corsMode === 'allowlist');
check('health sets frame denial', health.headers.get('x-frame-options') === 'DENY');
check('health sets nosniff', health.headers.get('x-content-type-options') === 'nosniff');
const open = await hit('/v4/security');
check('control report is public', open.status === 200 && open.body.identity === 'session' && open.body.debugMode === true);

const evil = await hit('/health', { headers: { Origin: 'https://evil.example' } });
check('unknown origin is not echoed', !evil.headers.get('access-control-allow-origin'));
const local = await hit('/health', { headers: { Origin: 'http://localhost:5173' } });
check('local console origin is allowed', local.headers.get('access-control-allow-origin') === 'http://localhost:5173');

const anon = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'tea', uid: 'usera' }) });
check('anonymous search is rejected', anon.status === 401);

const saved = await hit('/v3/documents', {
  method: 'POST',
  body: JSON.stringify({ title: 'note', text: 'User A keeps amber-quartz in a tin.\u0000<script>alert(1)</script>' }),
}, 'usera');
const docId = saved.body.document?.id || '';
check('owner can write', saved.status === 200 && !!docId);
check('null byte is stripped', !String(saved.body.document?.text || '').includes('\u0000'));

const override = await hit('/v4/search', {
  method: 'POST',
  body: JSON.stringify({ query: 'amber-quartz', uid: 'userb', actorId: 'userb', userId: 'userb' }),
}, 'usera');
check('client identity is ignored', override.status === 403);

const own = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'amber-quartz' }) }, 'usera');
check('owner search still works', own.status === 200 && /amber-quartz/i.test(JSON.stringify(own.body.matches || [])));
const other = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'amber-quartz' }) }, 'userb');
check('other user search misses it', other.status === 200 && !(other.body.matches || []).some((m: { text?: string; title?: string }) => /amber-quartz/i.test(`${m.title || ''} ${m.text || ''}`)));
const opened = await hit(`/v3/documents/${docId}`, {}, 'userb');
check('other user cannot open the document', opened.status === 404);
const wiped = await hit(`/v4/governance/memories/${docId}`, { method: 'DELETE' }, 'userb');
check('other user cannot delete the document', wiped.status === 403);
const bulk = await hit('/v4/governance/forget', { method: 'POST', body: JSON.stringify({ ownerId: 'usera' }) }, 'userb');
check('other user cannot erase the owner', bulk.status === 403);

const injected = await hit('/v4/search', {
  method: 'POST',
  body: JSON.stringify({ query: "amber'); DROP TABLE documents;--", filters: { all: { $where: '1' } } }),
}, 'usera');
check('injection-style search is data', injected.status === 200);
const still = await hit(`/v3/documents/${docId}`, {}, 'usera');
check('injection did not remove the document', still.status === 200);

const upload = await hit('/v3/documents', {
  method: 'POST',
  body: JSON.stringify({ title: 'dot.png', mime: 'image/png', imageBase64: PNG.toString('base64') }),
}, 'usera');
const fileId = upload.body.document?.fileId || '';
check('png upload is stored', upload.status === 200 && !!fileId);
const fileAnon = await hit(`/v3/files/${fileId}`);
check('file requires auth', fileAnon.status === 401);
const fileOther = await hit(`/v3/files/${fileId}`, {}, 'userb');
check('file requires ownership', fileOther.status === 404);
const fileOwn = await hit(`/v3/files/${fileId}`, {}, 'usera');
check('owner can fetch the file', fileOwn.status === 200 && fileOwn.headers.get('content-type') === 'image/png');
const svg = await hit('/v3/documents', {
  method: 'POST',
  body: JSON.stringify({ title: 'x.svg', mime: 'image/svg+xml', imageBase64: Buffer.from('<svg></svg>').toString('base64') }),
}, 'usera');
check('svg upload is rejected', svg.status === 415);
let tooBig = false;
try {
  checkUpload('image/png', Buffer.alloc(8 * 1024 * 1024 + 1));
} catch (err) {
  tooBig = (err as { status?: number }).status === 413;
}
check('oversized upload is rejected', tooBig);

const admin = await hit('/v4/governance/retention', {
  method: 'PUT',
  body: JSON.stringify({ tenantId: homeTag('usera'), memoryKind: 'context', ttlDays: 1, action: 'purge' }),
}, 'userb');
check('non-admin cannot change retention', admin.status === 403);
const ownerPolicy = await hit('/v4/governance/retention', {
  method: 'PUT',
  body: JSON.stringify({ tenantId: homeTag('usera'), memoryKind: 'context', ttlDays: 9, action: 'archive' }),
}, 'usera');
check('owner can change own retention', ownerPolicy.status === 200);

const fence = await hit('/v4/inject', { method: 'POST', body: JSON.stringify({ query: 'amber-quartz' }) }, 'usera');
const blob = `${fence.body.system || ''}\n${fence.body.injection || ''}`;
check('retrieved memory is fenced', fence.status === 200 && blob.includes('<<<MEMORY>>>') && blob.includes('<<<END MEMORY>>>') && /untrusted/i.test(blob));

const tool = await hit('/v4/tools/execute', { method: 'POST', body: JSON.stringify({ name: 'deleteMemory', arguments: { text: 'wipe' } }) }, 'usera');
check('unlisted tool is rejected', tool.status === 403);

check('unsigned webhook is rejected', slackSignatureOk('{}', '1', 'v0=nope') === false);
process.env.SLACK_SIGNING_SECRET = 'slack-test-secret';
const ts = String(Math.floor(Date.now() / 1000));
const mac = crypto.createHmac('sha256', 'slack-test-secret').update(`v0:${ts}:{}`).digest('hex');
check('valid webhook signature is accepted', slackSignatureOk('{}', ts, `v0=${mac}`) === true);
check('wrong webhook signature is rejected', slackSignatureOk('{}', ts, 'v0=deadbeef') === false);

resetRateLimits();
process.env.MEMORY_RATE_LIMIT = '2';
const first = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'amber' }) }, 'usera');
const second = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'amber' }) }, 'usera');
const third = await hit('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'amber' }) }, 'usera');
check('rate limit allows the budget', first.status === 200 && second.status === 200);
check('rate limit returns 429', third.status === 429 && Number(third.headers.get('retry-after')) > 0);

server.close();
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nsecurity checks passed');
