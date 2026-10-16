import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-pressure-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.K_SERVICE;
process.env.MEMORY_REQUIRE_AUTH = '0';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures.push(detail ? `${name}: ${detail}` : name);
    console.log('FAIL', name, detail);
  } else {
    console.log('ok', name);
  }
}

const core = await import('./core.js');
const facts = await import('./facts.js');
const pipeline = await import('./pipeline.js');
const tenancy = await import('./tenancy.js');
const scopes = await import('./scopes.js');
const memory = await import('./memory.js');
const temporal = await import('./temporal.js');
const index = await import('./search-index.js');
const connectors = await import('./connectors.js');
const routes = await import('./routes.js');

const { getState, saveState, saveBlob, chunkCode, sha, DATA_DIR, uid } = core;
const { upsertFacts, deriveFacts } = facts;
const { searchMemory, ingestDocument, assertPublicHttpUrl, noteConversation, consolidationPasses, forgetById, flushConsolidation } = pipeline;

console.log('\n== Functional ==');
const codeParts = chunkCode('export function alpha() {\n  return 1;\n}\nexport function beta() {\n  return 2;\n}', 40);
check('code chunk splits functions', codeParts.length >= 2, String(codeParts.length));

const when = temporal.inferTemporal('lived in Austin in March 2020', '2026-10-11T00:00:00.000Z');
check('event time is past', when.temporal === 'past' && !!when.occurredAt);
check('future cue', temporal.inferTemporal('planning to launch tomorrow').temporal === 'future');
check('query past', temporal.queryTimeIntent('what happened in 2020') === 'past');
check('query present', temporal.queryTimeIntent('what do I currently prefer') === 'present');

try {
  assertPublicHttpUrl('http://127.0.0.1/secret');
  check('blocks loopback', false);
} catch {
  check('blocks loopback', true);
}
try {
  assertPublicHttpUrl('http://169.254.169.254/computeMetadata');
  check('blocks metadata host', false);
} catch {
  check('blocks metadata host', true);
}
check('allows public https', assertPublicHttpUrl('https://example.com/a').startsWith('https://example.com'));

let threw = false;
try {
  await saveBlob('../etc/passwd', Buffer.from('no'));
} catch {
  threw = true;
}
check('rejects path traversal file id', threw);
const blobId = uid('file');
await saveBlob(blobId, Buffer.from('hello'));
check('blob stays in data dir', fs.existsSync(path.join(DATA_DIR, 'files', blobId)));

console.log('\n== State ==');
const tag = tenancy.homeTag('usera');
upsertFacts(tag, [{ subject: 'User', predicate: 'prefers', object: 'tea' }], 'preferred tea in March 2024');
upsertFacts(tag, [{ subject: 'User', predicate: 'prefers', object: 'coffee', metadata: { channel: 'slack' } }], 'currently drinks coffee');
const prefs = getState().triples.filter((t) => t.containerTag === tag && t.predicate === 'prefers');
check('newer fact closes the old one', prefs.filter((t) => t.isLatest !== false).length === 1 && prefs.some((t) => t.isLatest === false && t.object === 'tea'));
check('current fact is coffee', prefs.find((t) => t.isLatest !== false)?.object === 'coffee');
check('metadata kept', prefs.find((t) => t.object === 'coffee')?.metadata?.channel === 'slack');
check('past fact has a time', prefs.find((t) => t.object === 'tea')?.temporal === 'past');

upsertFacts(tag, [
  { subject: 'User', predicate: 'works_at', object: 'Rukmer' },
  { subject: 'Rukmer', predicate: 'located_in', object: 'Austin' },
  { subject: 'User', predicate: 'reports_to', object: 'Mina' },
  { subject: 'Mina', predicate: 'works_at', object: 'Rukmer' },
  { subject: 'User', predicate: 'partner_of', object: 'Mina' },
]);
deriveFacts(tag);
const derivedLoc = getState().triples.some((t) => t.containerTag === tag && t.predicate === 'located_in' && t.subject === 'User' && t.object === 'Austin' && t.derived);
const derivedMember = getState().triples.some((t) => t.containerTag === tag && t.predicate === 'member_of' && t.object === 'Rukmer');
const symmetric = getState().triples.some((t) => t.containerTag === tag && t.predicate === 'partner_of' && t.subject === 'Mina' && t.object === 'User');
check('derives location from employer', derivedLoc);
check('derives org from manager', derivedMember);
check('derives symmetric partner', symmetric);
check('entities link shared names', getState().links.some((l) => l.containerTag === tag && l.reason === 'rukmer'));

const profile = memory.buildProfile(tag);
check('profile bucket preferences', (profile.buckets.preferences || []).some((t) => t.object === 'coffee'));
check('profile bucket work', (profile.buckets.work || []).some((t) => t.object === 'Rukmer'));

const nowHit = await searchMemory('what do I currently prefer to drink', { containerTag: tag, topK: 5 });
const nowBlob = nowHit.matches.map((m) => `${m.title} ${m.text}`).join('\n').toLowerCase();
check('present query keeps coffee', nowBlob.includes('coffee'));
check('present query drops closed tea', !nowBlob.includes('tea'), nowBlob.slice(0, 180));

const pastHit = await searchMemory('what happened in March 2024', { containerTag: tag, topK: 8 });
check('past query can see closed tea', pastHit.matches.some((m) => /tea/i.test(`${m.title} ${m.text}`)));

const linked = await searchMemory('where is Rukmer based', { containerTag: tag, topK: 5, includeRelated: true });
check('entity query finds Austin', linked.matches.some((m) => /austin/i.test(`${m.title} ${m.text}`)) || (linked.related || []).some((r) => /austin/i.test(r.object)));

await ingestDocument({
  title: 'notes.md',
  text: 'The deploy window is Friday for the maple project.',
  containerTag: tag,
  source: 'upload',
  metadata: { channel: 'slack' },
});
const filtered = await searchMemory('deploy window maple', { containerTag: tag, filters: { all: { channel: 'slack' } }, topK: 5 });
check('metadata filter hits', filtered.matches.some((m) => m.text.includes('deploy window')));
const missed = await searchMemory('deploy window maple', { containerTag: tag, filters: { all: { channel: 'nope' } }, topK: 5 });
check('metadata filter excludes', missed.matches.length === 0);
const anyHit = await searchMemory('deploy window maple', { containerTag: tag, filters: { any: { channel: 'slack', team: 'other' } }, topK: 5 });
check('metadata any filter hits', anyHit.matches.length > 0);
check('chunk metadata stored', getState().chunks.some((c) => c.metadata?.channel === 'slack' && c.text.includes('deploy window')));

console.log('\n== Scopes ==');
const session = tenancy.sessionTag('usera', 'task-9');
const agent = tenancy.agentTag('usera', 'planner');
upsertFacts(session, [{ subject: 'User', predicate: 'plans', object: 'close the books' }], 'session only close the books');
upsertFacts(agent, [{ subject: 'User', predicate: 'building', object: 'agent scratch' }], 'agent scratch pad');
const homeOnly = await searchMemory('close the books', { containerTag: tag, topK: 5 });
check('session fact stays out of home', !homeOnly.matches.some((m) => /close the books/i.test(`${m.title} ${m.text}`)));
const sessionHit = await searchMemory('close the books', { containerTag: session, topK: 3 });
check('session search finds session fact', sessionHit.matches.some((m) => /close the books/i.test(`${m.title} ${m.text}`)));
scopes.closeSession('usera', 'task-9');
const afterClose = await searchMemory('close the books', { containerTag: session, topK: 3 });
check('closed session drops the task', afterClose.matches.length === 0);

const oldSession = tenancy.sessionTag('usera', 'stale');
upsertFacts(oldSession, [{ subject: 'User', predicate: 'plans', object: 'old task' }], 'old task');
const stale = getState().triples.find((t) => t.containerTag === oldSession && t.isLatest !== false);
if (stale) stale.validFrom = new Date(Date.now() - 13 * 3600000).toISOString();
saveState();
memory.applyDecay(oldSession);
check('session ttl closes stale facts', getState().triples.find((t) => t.containerTag === oldSession)?.isLatest === false);

const org = scopes.createOrg('usera', 'Rukmer Lab');
scopes.addOrgMember('usera', org.id, 'userb');
upsertFacts(org.id, [{ subject: 'Rukmer', predicate: 'building', object: 'company brain' }], 'shared company brain');
let outsider = false;
try {
  tenancy.resolveScopeTag('userc', { orgId: org.id });
} catch (err) {
  outsider = (err as { status?: number }).status === 403;
}
check('outsider cannot open org', outsider);
check('member can open org', tenancy.resolveScopeTag('userb', { orgId: org.id }) === org.id);
const orgHit = await searchMemory('company brain', { containerTag: org.id, topK: 3 });
check('org search finds shared fact', orgHit.matches.some((m) => /company brain/i.test(`${m.title} ${m.text}`)));
check('home tag does not own org', !tenancy.ownsTag('usera', org.id));

console.log('\n== Index ==');
const other = tenancy.homeTag('userb');
const state = getState();
for (let i = 0; i < 600; i++) {
  const embedding = Array.from({ length: 16 }, (_, n) => Math.sin(i + n));
  state.chunks.push({
    id: uid('chk'),
    docId: 'bulk',
    containerTag: other,
    text: `noise alpha ${i}`,
    index: i,
    embedding,
    hash: `h${i}`,
    createdAt: new Date().toISOString(),
    forgotten: false,
    source: 'upload',
  });
}
state.chunks.push({
  id: 'chk_maple',
  docId: 'maple',
  containerTag: tag,
  text: 'quarterly maple budget review',
  index: 0,
  embedding: Array.from({ length: 16 }, () => 0.2),
  hash: 'maple',
  createdAt: new Date().toISOString(),
  forgotten: false,
  source: 'upload',
});
saveState();
const ranked = index.rankTagged('quarterly maple budget', [tag], Array.from({ length: 16 }, () => 0.2), { topK: 5, strict: 0.1 });
check('vector compare stays inside the tag', index.lastQueryStats.vectorCompared > 0 && index.lastQueryStats.vectorCompared < 40, String(index.lastQueryStats.vectorCompared));
check('keyword hits stay inside the tag', index.lastQueryStats.keywordDocs < 10, String(index.lastQueryStats.keywordDocs));
check('index returns maple', ranked.ranked.some((r) => r.text.includes('maple')));

console.log('\n== Consolidation ==');
const beforePasses = pipeline.consolidationPasses;
for (let i = 0; i < 4; i++) noteConversation(tag, `I work at Rukmer. Note ${i}. I live in Seattle.`);
await new Promise((r) => setTimeout(r, 30));
check('four notes become one pass', pipeline.consolidationPasses === beforePasses + 1, String(pipeline.consolidationPasses));
const flushed = await flushConsolidation(tag, 'Please remember that I prefer dark mode.');
check('explicit flush stores a fact', (flushed.facts || 0) > 0);

console.log('\n== Security ==');
const foreign = await searchMemory('company brain', { containerTag: tag, topK: 5 });
check('user search does not leak org fact', !foreign.matches.some((m) => /company brain/i.test(`${m.title} ${m.text}`)));
const secretId = getState().triples.find((t) => t.containerTag === org.id)?.id || '';
check('member can forget org fact', forgetById(secretId, 'userb').ok === true);
check('stranger cannot forget home chunk', forgetById('chk_maple', 'userc').ok === false);

process.env.MEMORY_REQUIRE_AUTH = '1';
getState().apiKeys.push({
  id: 'k1',
  name: 'pressure',
  prefix: 'rk_live_',
  hash: sha('rk_live_pressurekey123'),
  createdAt: new Date().toISOString(),
  lastUsed: null,
  ownerUid: 'usera',
});
saveState();
const app = express();
app.use(express.json({ limit: '1mb' }));
routes.mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as { port: number }).port;
async function hit(urlPath: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as { error?: string; version?: string; matches?: unknown[] } };
}
const health = await hit('/health');
check('health is public', health.status === 200);
const protocol = await hit('/v4/protocol');
check('protocol published', protocol.body.version === '1.2');
const openSearch = await hit('/v4/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'maple' }) });
check('search requires auth', openSearch.status === 401);
const devHeader = await hit('/v4/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-rukmer-user': 'usera' },
  body: JSON.stringify({ query: 'maple' }),
});
check('dev header rejected when auth required', devHeader.status === 401);
const badKey = await hit('/v4/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rk_live_nope' },
  body: JSON.stringify({ query: 'maple' }),
});
check('invalid key rejected', badKey.status === 401);
const good = await hit('/v4/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rk_live_pressurekey123' },
  body: JSON.stringify({ query: 'quarterly maple', containerTag: other }),
});
check('valid key searches own tag', good.status === 200);
check('valid key cannot read the other home', !(good.body.matches || []).some((m) => JSON.stringify(m).includes('noise alpha')));
const deniedOrg = await hit('/v4/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer rk_live_pressurekey123' },
  body: JSON.stringify({ query: 'brain', orgId: 'org_does_not_exist' }),
});
check('unknown org is forbidden', deniedOrg.status === 403);

const origFetch = global.fetch;
global.fetch = (async (url: string) => {
  if (String(url).includes('api.github.com/user/repos')) {
    return new Response(JSON.stringify([{ full_name: 'rukmer/mem' }]), { status: 200 });
  }
  if (String(url).includes('/readme')) return new Response('# Maple budget notes', { status: 200 });
  return new Response('no', { status: 404 });
}) as typeof fetch;
const imported = await connectors.importConnector({ provider: 'github', containerTag: tag, token: 'ghp_pressuretokenvalue123456' });
global.fetch = origFetch;
check('github import reads readme', imported.imported === 1);
check('github token is not stored', !JSON.stringify(getState()).includes('ghp_pressuretokenvalue123456'));

console.log('\n== Load / stress / endurance ==');
const heapBefore = process.memoryUsage().heapUsed;
const stressTag = tenancy.homeTag('stress');
const planted: { subject: string; predicate: string; object: string }[] = [];
for (let i = 0; i < 2000; i++) planted.push({ subject: 'User', predicate: 'owns', object: `item${i}` });
planted.push({ subject: 'User', predicate: 'owns', object: 'cedar-keepsake' });
const stressStarted = Date.now();
upsertFacts(stressTag, planted, 'inventory');
const stressSearch = await searchMemory('cedar-keepsake', { containerTag: stressTag, topK: 3 });
check('stress search finds planted fact', stressSearch.matches.some((m) => /cedar-keepsake/i.test(`${m.title} ${m.text}`)));
check('stress search under 2s', Date.now() - stressStarted < 2000, String(Date.now() - stressStarted));

const loadStarted = Date.now();
const load = await Promise.all(Array.from({ length: 25 }, () => searchMemory('coffee', { containerTag: tag, topK: 3 })));
check('load 25 searches succeed', load.every((r) => Array.isArray(r.matches)));
check('load batch under 3s', Date.now() - loadStarted < 3000, String(Date.now() - loadStarted));

for (let i = 0; i < 80; i++) {
  upsertFacts(tag, [{ subject: 'User', predicate: 'building', object: `endurance ${i}` }], `endurance ${i}`);
}
const heapAfter = process.memoryUsage().heapUsed;
check('endurance heap growth under 250mb', heapAfter - heapBefore < 250 * 1024 * 1024, String(heapAfter - heapBefore));

const huge = await ingestDocument({ title: 'big.txt', text: 'word '.repeat(250000), containerTag: tag, source: 'upload' });
check('huge text is capped', huge.document.text.length <= 200000);

saveState();
const onDisk = fs.readFileSync(path.join(DATA_DIR, 'engine.json'), 'utf8');
check('state file contains the planted fact', onDisk.includes('cedar-keepsake'));
await core.loadState();
const reloaded = await searchMemory('cedar-keepsake', { containerTag: stressTag, topK: 3 });
check('reload keeps the planted fact', reloaded.matches.some((m) => /cedar-keepsake/i.test(`${m.title} ${m.text}`)));

console.log('\n== Pipeline / UX ==');
const docker = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
check('image uses node 22', docker.includes('node:22'));
check('image starts the server', docker.includes('npm", "start"') || docker.includes("npm start") || docker.includes('CMD ["npm", "start"]'));
const ui = fs.readFileSync(path.join(process.cwd(), 'src/pages/console/ConnectorsPage.tsx'), 'utf8');
check('connector actions have names', ui.includes('aria-label'));
check('import form is labeled', ui.includes('htmlFor="connector-provider"'));
check('sdk typescript client exists', fs.existsSync(path.join(process.cwd(), 'sdk/typescript/client.ts')));
check('sdk python client exists', fs.existsSync(path.join(process.cwd(), 'sdk/python/rukmer.py')));
check('sdk ai wrapper exists', fs.existsSync(path.join(process.cwd(), 'sdk/typescript/ai.ts')));
check('eval set exists', fs.existsSync(path.join(process.cwd(), 'engine/eval-set.ts')));

server.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall pressure checks passed');
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
