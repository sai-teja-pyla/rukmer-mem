/**
 * Live durability pass against the running engine + Vite app.
 * Usage: npx tsx engine/durability-test.ts
 */
import { jsPDF } from 'jspdf';
import { isUsefulFact, looksLikeDurableFact, normalizePredicate } from './quality.js';

const ENGINE = process.env.ENGINE_URL || 'http://127.0.0.1:5001';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const TAG = `durability-${Date.now()}`;
const MARKER = `DurabilityTea${Date.now().toString(36)}`;

type Result = { name: string; ok: boolean; detail: string; ms: number };

const results: Result[] = [];

async function json(path: string, init?: RequestInit) {
  const res = await fetch(`${ENGINE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

async function check(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const detail = (await fn()) || 'ok';
    results.push({ name, ok: true, detail: String(detail), ms: Date.now() - t0 });
  } catch (e: any) {
    results.push({ name, ok: false, detail: e.message || String(e), ms: Date.now() - t0 });
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

await check('quality: reject related_to junk', async () => {
  assert(!isUsefulFact({ subject: 'The', predicate: 'related_to', object: 'Container' }), 'junk accepted');
  assert(!isUsefulFact({ subject: 'Saiteja', predicate: 'related_to', object: 'Rukmer' }), 'related_to still allowed');
  assert(normalizePredicate('favorite drink') === 'prefers', `pred=${normalizePredicate('favorite drink')}`);
  assert(isUsefulFact({ subject: 'Saiteja', predicate: 'prefers', object: 'double espresso' }), 'good fact rejected');
  assert(!looksLikeDurableFact('Thanks that was helpful'), 'thanks stored as fact');
  assert(looksLikeDurableFact('Please remember that I work at Rukmer'), 'please remember missed');
});

await check('engine health', async () => {
  const { status, data } = await json('/health');
  assert(status === 200 && data.ok, `status=${status}`);
  assert(data.stats?.llm === true, 'llm false');
  assert(data.engine === 'rukmer-open-core', 'wrong engine');
});

await check('vite app', async () => {
  const pages = ['/', '/login', '/playground', '/import', '/memory-graph', '/agents-mcp', '/overview', '/connectors'];
  for (const p of pages) {
    const res = await fetch(`${APP}${p}`);
    assert(res.ok, `${p} -> ${res.status}`);
  }
  return pages.join(', ');
});

await check('vite proxies /health', async () => {
  const res = await fetch(`${APP}/health`);
  const data = await res.json();
  assert(res.ok && data.ok, `proxy ${res.status}`);
});

await check('GET /v1/models', async () => {
  const { status, data } = await json('/v1/models');
  assert(status === 200 && Array.isArray(data.data) && data.data.length >= 4, JSON.stringify(data).slice(0, 120));
});

await check('GET /v4/tools', async () => {
  const { data } = await json('/v4/tools');
  const names = (data.tools || []).map((t: any) => t.function?.name);
  assert(names.includes('searchMemories') && names.includes('addMemory'), String(names));
});

await check('empty ingest rejected', async () => {
  const { status, data } = await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'empty', text: '   ', containerTag: TAG }),
  });
  assert(status === 400 && data.error, `status=${status}`);
});

await check('PDF missing bytes rejected', async () => {
  const { status } = await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'x.pdf', mime: 'application/pdf', containerTag: TAG }),
  });
  assert(status === 400, `status=${status}`);
});

await check('ingest durable document (RAG + graph)', async () => {
  const { status, data } = await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: `Durability profile ${MARKER}`,
      containerTag: TAG,
      task: 'memory',
      text: `Saiteja prefers ${MARKER} as a test beverage.
Saiteja works at Rukmer.
Saiteja lives in Boston.`,
    }),
  });
  assert(status === 200 && data.chunks >= 1, JSON.stringify(data).slice(0, 200));
  return `chunks=${data.chunks}`;
});

await check('batch ingest', async () => {
  const { status, data } = await json('/v3/documents/batch', {
    method: 'POST',
    body: JSON.stringify({
      containerTag: TAG,
      task: 'rag',
      documents: [
        { title: `note-a-${MARKER}`, text: `Project DurabilityAlpha uses hybrid retrieval.` },
        { title: `note-b-${MARKER}`, text: `Project DurabilityBeta stores only durable facts.` },
      ],
    }),
  });
  assert(status === 200 && data.count === 2, JSON.stringify(data).slice(0, 200));
});

await check('PDF ingest', async () => {
  const doc = new jsPDF();
  doc.text(`Durability PDF marker ${MARKER} sesame-free.`, 10, 20);
  const b64 = doc.output('datauristring').split(',')[1];
  const { status, data } = await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: `durability-${MARKER}.pdf`,
      pdfBase64: b64,
      mime: 'application/pdf',
      containerTag: TAG,
      task: 'rag',
    }),
  });
  assert(status === 200 && data.document?.mime === 'application/pdf', JSON.stringify(data).slice(0, 240));
});

await check('list documents + tags', async () => {
  const list = await json('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag: TAG }) });
  assert(list.status === 200 && (list.data.documents || []).length >= 3, `docs=${list.data.documents?.length}`);
  const tags = await json('/v3/tags');
  assert((tags.data.tags || []).some((t: any) => t.tag === TAG), 'tag missing');
});

await check('hybrid search finds marker', async () => {
  const { status, data } = await json('/v4/search', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG, memoriesRetrieved: 8 }),
  });
  assert(status === 200, `status=${status}`);
  assert(String(data.mode || '').includes('hybrid') || data.matches?.length, `mode=${data.mode}`);
  const hit = (data.matches || []).some((m: any) => String(m.text).includes(MARKER) || String(m.title).includes(MARKER));
  assert(hit, `no marker in ${data.matches?.length} matches mode=${data.mode}`);
  assert(!(data.related || []).some((r: any) => r.predicate === 'related_to'), 'related_to leaked');
  return `${data.mode} n=${data.matches.length} ${data.tookMs}ms`;
});

await check('v3 search alias', async () => {
  const { status, data } = await json('/v3/search', {
    method: 'POST',
    body: JSON.stringify({ query: 'DurabilityAlpha', containerTag: TAG }),
  });
  assert(status === 200 && (data.matches || []).length >= 1, `n=${data.matches?.length}`);
});

await check('graph has no related_to junk', async () => {
  const { data } = await json(`/v4/graph?containerTag=${encodeURIComponent(TAG)}`);
  const edges = data.edges || [];
  assert(!edges.some((e: any) => e.label === 'related_to'), `labels=${edges.map((e: any) => e.label)}`);
  const nodes = data.nodes || [];
  assert(!nodes.some((n: any) => /^(The|Container|Pref)$/i.test(n.label)), `labels=${nodes.map((n: any) => n.label)}`);
  return `nodes=${nodes.length} edges=${edges.length}`;
});

await check('inject is high-signal', async () => {
  const { data } = await json('/v4/inject', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG }),
  });
  const inj = String(data.injection || '');
  assert(inj.includes('High-signal') || inj.includes('CURRENT FACTS'), inj.slice(0, 120));
  assert(!/related_to/.test(inj), 'related_to in injection');
  const current = data.current || [];
  assert(current.length <= 8, `too many facts ${current.length}`);
});

await check('question remember does not pollute graph', async () => {
  const before = await json(`/v4/graph?containerTag=${encodeURIComponent(TAG)}`);
  const n = (before.data.edges || []).length;
  const rem = await json('/v4/remember', {
    method: 'POST',
    body: JSON.stringify({
      containerTag: TAG,
      source: 'durability',
      messages: [{ role: 'user', content: 'What coffee do I prefer today?' }],
    }),
  });
  assert(rem.status === 200, rem.data.error || rem.status);
  const after = await json(`/v4/graph?containerTag=${encodeURIComponent(TAG)}`);
  assert((after.data.edges || []).length === n, `edges ${n} -> ${after.data.edges?.length}`);
});

await check('durable remember adds prefers', async () => {
  const rem = await json('/v4/remember', {
    method: 'POST',
    body: JSON.stringify({
      containerTag: TAG,
      source: 'durability',
      messages: [{ role: 'user', content: `I prefer ${MARKER} in the morning as my test drink.` }],
    }),
  });
  assert(rem.status === 200, rem.data.error || String(rem.status));
  const inj = await json('/v4/inject', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG }),
  });
  const hay = JSON.stringify(inj.data.current || []) + (inj.data.injection || '');
  assert(hay.toLowerCase().includes(MARKER.toLowerCase()) || /prefer/i.test(hay), hay.slice(0, 300));
});

await check('playground chat uses memory', async () => {
  const { status, data } = await json('/v4/chat', {
    method: 'POST',
    body: JSON.stringify({
      query: `What test beverage is associated with ${MARKER}?`,
      containerTag: TAG,
      remember: false,
    }),
  });
  assert(status === 200 && data.answer, data.error || status);
  assert(/espresso|tea|beverage|prefer|marker|durability/i.test(data.answer) || data.retrieved?.matches?.length, data.answer?.slice(0, 200));
  return data.answer.slice(0, 120);
});

await check('unified Gemini complete + memory', async () => {
  const { status, data } = await json('/v1/chat/completions', {
    method: 'POST',
    headers: { 'x-container-tag': TAG, 'x-rukmer-memory': 'on' },
    body: JSON.stringify({
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: `Name the durability marker drink ${MARKER} if you know it.` }],
    }),
  });
  assert(status === 200, data.error || JSON.stringify(data).slice(0, 180));
  assert(data.rukmer?.injected === true, `injected=${data.rukmer?.injected}`);
  assert(data.rukmer?.provider === 'gemini', `provider=${data.rukmer?.provider}`);
  assert(data.answer, 'empty answer');
  return String(data.answer).slice(0, 140);
});

await check('missing OpenAI key fails cleanly', async () => {
  const { status, data } = await json('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert(status === 401 && data.provider === 'openai', `status=${status} ${JSON.stringify(data).slice(0, 120)}`);
});

await check('tools searchMemories + addMemory', async () => {
  const add = await json('/v4/tools/execute', {
    method: 'POST',
    body: JSON.stringify({
      name: 'addMemory',
      arguments: { containerTag: TAG, title: 'tool-fact', text: `I work at DurabilityLabs on ${MARKER}.` },
    }),
  });
  assert(add.status === 200 && add.data.chunks >= 1, add.data.error);
  const search = await json('/v4/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name: 'searchMemories', arguments: { containerTag: TAG, query: 'DurabilityLabs' } }),
  });
  assert(search.status === 200 && (search.data.matches || []).length >= 1, `n=${search.data.matches?.length}`);
});

await check('unknown tool rejected', async () => {
  const { status } = await json('/v4/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ name: 'dropDatabase', arguments: {} }),
  });
  assert(status === 400, `status=${status}`);
});

await check('stats insights jobs requests keys', async () => {
  for (const p of ['/v3/stats', '/v3/insights', '/v3/jobs', '/v3/requests', '/v3/keys']) {
    const { status, data } = await json(p);
    assert(status === 200, `${p} ${status}`);
    assert(data && typeof data === 'object', `${p} empty`);
  }
  const created = await json('/v3/keys', { method: 'POST', body: JSON.stringify({ name: 'durability' }) });
  assert(created.status === 200 && String(created.data.secret || '').startsWith('rk_live_'), 'key secret');
});

await check('forget matching dry-run then apply', async () => {
  const dry = await json('/v4/memories/forget-matching', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG, dryRun: true }),
  });
  assert(dry.status === 200 && dry.data.count >= 1, `dry=${dry.data.count}`);
  const real = await json('/v4/memories/forget-matching', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG, dryRun: false }),
  });
  assert(real.status === 200 && real.data.count >= 1, `real=${real.data.count}`);
});

await check('search after forget excludes marker chunks', async () => {
  const { data } = await json('/v4/search', {
    method: 'POST',
    body: JSON.stringify({ query: MARKER, containerTag: TAG, include: { forgotten: false } }),
  });
  const live = (data.matches || []).filter((m: any) => String(m.text).includes(MARKER));
  assert(live.length === 0, `still ${live.length} live marker chunks`);
});

await check('GET /v4/protocol', async () => {
  const { status, data } = await json('/v4/protocol');
  assert(status === 200 && data.name, JSON.stringify(data).slice(0, 120));
  assert(data.connect?.cannot || (data.doesNotStore || []).length, 'protocol missing connect/store rules');
});

await check('MCP initialize + tools', async () => {
  const init = await json('/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert(init.status === 200 && init.data.result?.serverInfo?.name === 'rukmer-memory', JSON.stringify(init.data).slice(0, 160));
  const tools = await json('/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  const names = (tools.data.result?.tools || []).map((t: any) => t.name);
  assert(names.includes('searchMemories') && names.includes('addMemory'), String(names));
});

await check('chit-chat is not stored as memory', async () => {
  const chatTag = `${TAG}-chat`;
  const filler = [
    'hey',
    'Thanks that was really helpful!',
    'What should I have for lunch today?',
    'ok cool',
    'can you summarize this thread again?',
  ];
  for (const content of filler) {
    const rem = await json('/v4/remember', {
      method: 'POST',
      body: JSON.stringify({ containerTag: chatTag, messages: [{ role: 'user', content }, { role: 'assistant', content: 'Sure.' }] }),
    });
    assert(rem.status === 200, rem.data.error || rem.status);
    assert(rem.data.skipped === true || rem.data.chunks === 0, `stored filler: ${content} -> ${JSON.stringify(rem.data).slice(0, 160)}`);
  }
  const list = await json('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag: chatTag }) });
  const docs = list.data.documents || [];
  assert(docs.length === 0, `stored ${docs.length} conversation dumps`);
  const graph = await json(`/v4/graph?containerTag=${encodeURIComponent(chatTag)}`);
  assert((graph.data.edges || []).length === 0, `graph edges=${graph.data.edges?.length}`);
});

await check('only durable facts are stored from a mixed session', async () => {
  const mix = `${TAG}-mix`;
  await json('/v4/remember', {
    method: 'POST',
    body: JSON.stringify({
      containerTag: mix,
      messages: [
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: 'Hello! How can I help?' },
      ],
    }),
  });
  const fact = await json('/v4/remember', {
    method: 'POST',
    body: JSON.stringify({
      containerTag: mix,
      messages: [
        { role: 'user', content: `Please remember that I prefer ${MARKER}-only as my test drink.` },
        { role: 'assistant', content: 'Got it, I will remember that long reply about lunch and the weather too.' },
      ],
    }),
  });
  assert(fact.status === 200 && fact.data.skipped !== true, JSON.stringify(fact.data).slice(0, 200));
  const list = await json('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag: mix }) });
  const texts = (list.data.documents || []).map((d: any) => d.title + ' ' + (d.preview || d.text || '')).join('\n');
  const search = await json('/v4/search', {
    method: 'POST',
    body: JSON.stringify({ query: 'lunch weather hello', containerTag: mix }),
  });
  const hay = JSON.stringify(search.data.matches || []) + texts;
  assert(!/Hello! How can I help/i.test(hay), 'assistant chit-chat stored');
  assert(!/long reply about lunch/i.test(hay), 'assistant filler stored');
  const inj = await json('/v4/inject', { method: 'POST', body: JSON.stringify({ query: MARKER, containerTag: mix }) });
  const blob = JSON.stringify(inj.data.current || []) + (inj.data.injection || '');
  assert(blob.toLowerCase().includes(MARKER.toLowerCase()) || /prefer/i.test(blob), blob.slice(0, 280));
});

await check('temporal fact update closes old value', async () => {
  const ttag = `${TAG}-time`;
  await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'job-1',
      containerTag: ttag,
      task: 'memory',
      text: 'Alex works at AcmeCorp as a designer.',
    }),
  });
  await json('/v3/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'job-2',
      containerTag: ttag,
      task: 'memory',
      text: 'Alex works at Rukmer as a designer.',
    }),
  });
  const inj = await json('/v4/inject', {
    method: 'POST',
    body: JSON.stringify({ query: 'where does Alex work', containerTag: ttag }),
  });
  const blob = JSON.stringify(inj.data.current || []) + (inj.data.injection || '');
  assert(/rukmer/i.test(blob), blob.slice(0, 280));
  const { data } = await json(`/v4/graph?containerTag=${encodeURIComponent(ttag)}`);
  return `edges=${(data.edges || []).length} injectHasRukmer=${/rukmer/i.test(blob)}`;
});

const USERS = 100;
const loadTag = (i: number) => `${TAG}-u${String(i).padStart(3, '0')}`;

await check(`100-user isolation (${USERS} containerTags)`, async () => {
  const t0 = Date.now();
  const ids = Array.from({ length: USERS }, (_, i) => i);
  const batch = 10;
  for (let i = 0; i < ids.length; i += batch) {
    await Promise.all(
      ids.slice(i, i + batch).map((n) =>
        json('/v3/documents', {
          method: 'POST',
          body: JSON.stringify({
            title: `user-${n}`,
            containerTag: loadTag(n),
            task: 'rag',
            text: `Secret${n} lives only in workspace ${n}. UniqueToken${n} must never leak.`,
          }),
        }).then((r) => {
          if (r.status !== 200) throw new Error(`user ${n} ingest ${r.status} ${r.data.error || ''}`);
        })
      )
    );
  }
  const probes = [0, 7, 42, 99];
  for (const n of probes) {
    const hit = await json('/v4/search', {
      method: 'POST',
      body: JSON.stringify({ query: `UniqueToken${n}`, containerTag: loadTag(n), memoriesRetrieved: 5 }),
    });
    const texts = (hit.data.matches || []).map((m: any) => m.text).join(' ');
    assert(texts.includes(`UniqueToken${n}`), `user ${n} missed own secret`);
    const leak = await json('/v4/search', {
      method: 'POST',
      body: JSON.stringify({ query: `UniqueToken${n}`, containerTag: loadTag((n + 1) % USERS), memoriesRetrieved: 8 }),
    });
    const other = (leak.data.matches || []).map((m: any) => m.text).join(' ');
    assert(!other.includes(`UniqueToken${n}`), `user ${n} leaked into ${(n + 1) % USERS}`);
  }
  const open = await json('/v4/search', {
    method: 'POST',
    body: JSON.stringify({ query: 'UniqueToken42', memoriesRetrieved: 8 }),
  });
  return `ingest+probe ${Date.now() - t0}ms; unscoped search n=${(open.data.matches || []).length} (API has no user auth)`;
});

await check('100-user concurrent search', async () => {
  const t0 = Date.now();
  const searches = await Promise.all(
    Array.from({ length: 20 }, (_, i) => i * 5).map((n) =>
      json('/v4/search', {
        method: 'POST',
        body: JSON.stringify({ query: `UniqueToken${n}`, containerTag: loadTag(n) }),
      })
    )
  );
  assert(searches.every((s) => s.status === 200), 'search failed under concurrency');
  return `20 parallel searches ${Date.now() - t0}ms`;
});

const gaps: string[] = [];
await check('gap inventory (recorded, does not hide failures)', async () => {
  const unauth = await json('/v4/search', {
    method: 'POST',
    body: JSON.stringify({ query: 'UniqueToken42', containerTag: loadTag(42) }),
  });
  if (unauth.status === 200) gaps.push('Memory API (/v3 /v4 /mcp) has no Firebase/API-key auth — any client can read a known containerTag.');
  const unscoped = await json('/v4/search', { method: 'POST', body: JSON.stringify({ query: 'UniqueToken7' }) });
  if ((unscoped.data.matches || []).some((m: any) => String(m.text).includes('UniqueToken7'))) {
    gaps.push('Search without containerTag can scan the shared store (default tag only or all tags depending on path).');
  }
  const health = await json('/health');
  gaps.push('Single in-process JSON store (engine.json / GCS). Fine for ~100 light users on one Cloud Run instance; not multi-region HA or per-tenant DBs.');
  gaps.push('Playground/chat still uses one default tag unless the UI sets containerTag; signed-in uid is not auto-bound.');
  gaps.push('Drive/Gmail/Slack OAuth rows in Connectors are still Upgrade placeholders, not live sync.');
  gaps.push('MCP has no OAuth consent yet; ChatGPT/Claude custom connectors need that for production.');
  gaps.push('No rate limits, quotas, or per-user storage caps on the memory engine.');
  gaps.push(`Hosted Gemini for Playground: ${health.data.providers?.gemini ? 'yes' : 'no'}; OpenAI/Claude/Grok keys: ${health.data.providers?.openai ? 'openai ' : ''}${health.data.providers?.anthropic ? 'anthropic ' : ''}${health.data.providers?.grok ? 'grok' : 'not on server'}.`);
  return gaps.length + ' gaps listed';
});

const failed = results.filter((r) => !r.ok);
console.log('\nRukmer durability results\n');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.ms.toString().padStart(5)}ms  ${r.name}${r.ok ? '' : ' — ' + r.detail}`);
  if (r.ok && r.detail && r.detail !== 'ok') console.log(`       ${r.detail}`);
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed  tag=${TAG}`);
if (gaps.length) {
  console.log('\nGaps / not ready for production 100 paying users:');
  for (const g of gaps) console.log(`- ${g}`);
}
if (failed.length) {
  console.error('\nFailures:');
  for (const f of failed) console.error(`- ${f.name}: ${f.detail}`);
  process.exit(1);
}
