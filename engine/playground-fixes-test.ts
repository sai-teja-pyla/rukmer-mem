/**
 * Playground retrieval, raw saves, provider names, MCP wording, graph counts.
 * Run: npm run playground-fixes
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { countMemories } from '../src/services/memoryCount.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-play-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.GROK_API_KEY;

const { needsMemory, selectMemories } = await import('./relevance.js');
const { completeChat, keyFor, missingKeyMessage, providerStatus } = await import('./router.js');
const { MEMORY_TOOLS } = await import('./tools.js');
const { MCP_INSTRUCTIONS, CHATGPT_OPENAPI } = await import('./mcp.js');
const { homeTag } = await import('./tenancy.js');
const { commitImportantMemory, graphPayload, ingestDocument, ingestPayload, keptRequests, listDocuments, listTags, rememberTranscript, searchMemory } = await import('./pipeline.js');
const { buildMemoryInjection } = await import('./inject.js');
const { upsertFacts } = await import('./facts.js');
const { pickReadyModel } = await import('../src/services/providerKeys.js');
const { friendlyModelError, isRawKeyError } = await import('../src/services/modelError.js');
const { threadTitle, titleAfterSend } = await import('../src/services/threadTitle.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const coffee = { id: 'coffee', title: 'Nori', text: 'Nori prefers black coffee', score: 0.2, source: 'profile' };
const siteA = { id: 'site-a', title: 'example.com', text: 'example.com says it is for publishing notes.', score: 0.4, source: 'web' };
const siteB = { id: 'site-b', title: 'example.com', text: 'example.com says it is for publishing notes.', score: 0.5, source: 'web' };
const query = 'What does example.com say it is for?';
const picked = selectMemories(query, [coffee, siteB, siteA, { ...siteA, id: 'site-c' }], { strictness: 0.4, topK: 8 });
check('unrelated memory stays out', !picked.some((hit) => /coffee/i.test(hit.text)));
check('relevant memory stays in', picked.some((hit) => /example\.com/i.test(hit.text)));
check('duplicate memories collapse', picked.filter((hit) => /publishing notes/i.test(hit.text)).length === 1);
const capped = selectMemories(query, Array.from({ length: 6 }, (_, i) => ({ ...siteA, id: `s${i}`, text: `example.com note ${i} is for publishing.` })), { strictness: 0.4, topK: 2 });
check('memories retrieved caps the list', capped.length === 2);
const likeHits = selectMemories(
  'what city do I like?',
  [
    { id: 'likely', title: 'rollout', text: 'The rollout is likely on Tuesday', score: 0.9 },
    { id: 'likes', title: 'coffee', text: 'Nori likes coffee in the morning', score: 0.9 },
    { id: 'lisbon', title: 'Lisbon', text: 'User likes the city of Lisbon', score: 0.2 },
  ],
  { strictness: 0.4, topK: 10 }
);
check('like does not match likely or likes', likeHits.length === 1 && likeHits[0].id === 'lisbon');
check('kept score is at least strictness', likeHits.every((hit) => Number(hit.score) >= 0.4));
const filler = selectMemories(
  'Can you tell me what you know?',
  [
    { id: 'unrelated', text: 'The rollout is likely on Tuesday', score: 0.9, vectorScore: 0.36 },
    { id: 'lisbon-know', text: 'User knows the city of Lisbon', score: 0.2, vectorScore: 0.29 },
  ],
  { strictness: 0.4, topK: 10 }
);
check('know and tell do not retrieve memories', filler.length === 0);
const spoDupes = selectMemories(
  'Lisbon',
  [
    { id: 'a', text: 'lives in Lisbon', subject: 'User', predicate: 'lives_in', object: 'Lisbon', score: 0.8 },
    { id: 'b', text: 'User lives in Lisbon', subject: 'User', predicate: 'lives in', object: 'Lisbon', score: 0.7 },
  ],
  { strictness: 0.4, topK: 8 }
);
check('same subject predicate object collapses', spoDupes.length === 1);

const openaiMessage = missingKeyMessage('openai');
check('openai key message names OpenAI', openaiMessage.includes('OpenAI') && openaiMessage.includes('Settings') && !/\bopenai\b/.test(openaiMessage));
check('anthropic key message names Anthropic', missingKeyMessage('anthropic').includes('Anthropic') && !/\banthropic\b/.test(missingKeyMessage('anthropic').split('Anthropic').join('')));
check('grok key message names xAI', missingKeyMessage('grok').includes('xAI'));
const rawOpenAi = 'Missing API key for openai. You can find your API key at https://platform.openai.com/account/api-keys.';
const friendlyOpenAi = friendlyModelError(rawOpenAi);
check('stored missing key is not a raw provider error', isRawKeyError(rawOpenAi) && !isRawKeyError(friendlyOpenAi) && friendlyOpenAi.includes('OpenAI'));
const messyTitle = 'Nori   test\nNori test Nori test Nori test and then more words';
const readableTitle = threadTitle(messyTitle);
const titleStem = readableTitle.endsWith('…') ? readableTitle.slice(0, -1) : readableTitle;
const collapsedTitle = messyTitle.replace(/\s+/g, ' ').trim();
check(
  'thread title stays readable',
  readableTitle === readableTitle.replace(/\s+/g, ' ') &&
    !readableTitle.includes('\n') &&
    collapsedTitle.startsWith(titleStem) &&
    (collapsedTitle[titleStem.length] === undefined || collapsedTitle[titleStem.length] === ' ')
);
check('short thread title stays whole', threadTitle('What coffee do I like?') === 'What coffee do I like?');
check('script paste is not the thread title', !/script|alert/i.test(threadTitle('<script>alert(1)</script> What is the capital of Mars?')));
check(
  'later sends keep the thread title',
  titleAfterSend({ title: readableTitle, messages: [{ role: 'user' }] }, 'A totally different second question') === readableTitle
);

const toolText = `${JSON.stringify(MEMORY_TOOLS)}\n${MCP_INSTRUCTIONS}\n${CHATGPT_OPENAPI.info.description}`;
check('mcp wording is not an instruction to the model', !/\b(always call|you must|ignore|before answering|required during|call this)\b/i.test(toolText));
check('mcp tools stay named', MEMORY_TOOLS.map((tool) => tool.function.name).join() === 'searchMemories,addMemory');

check('graph count matches container tag memories', countMemories([{ tag: 'u_a', memories: 1 }, { tag: 'u_b', memories: 2 }], 'all') === 3);
check('graph count follows the selected space', countMemories([{ tag: 'u_a', memories: 1 }, { tag: 'u_b', memories: 2 }], 'u_a') === 1);

const tag = homeTag('usera');
const saved = await commitImportantMemory({
  containerTag: tag,
  actorId: 'usera',
  title: 'Nori test',
  text: 'Nori test - ChatGPT connected on Nov 9',
  source: 'tool',
});
check('no-facts save is stored raw', saved.saved === true && saved.type === 'raw' && saved.facts === 0 && saved.skipped === false);
check('raw save keeps the text', String(saved.document?.text || '').includes('ChatGPT connected on Nov 9'));

const sentence = "Nori test - Nori's favourite test city is Lisbon";
const noted = await commitImportantMemory({
  containerTag: homeTag('noteuser'),
  actorId: 'noteuser',
  text: sentence,
  source: 'memory',
});
const noteDocs = listDocuments(homeTag('noteuser'), 'noteuser');
const noteGraph = graphPayload(homeTag('noteuser'), 'noteuser');
const noteCount = listTags('noteuser').find((row) => row.tag === homeTag('noteuser'));
check(
  'lisbon note keeps the original text',
  noted.type === 'raw' && noted.facts === 0 && noted.document?.originalText === sentence && noteDocs.some((doc) => doc.originalText === sentence)
);
check(
  'lisbon note is a graph memory',
  noteGraph.nodes.some((node) => node.kind === 'memory' && node.type === 'note' && node.originalText === sentence)
);
check('lisbon note counts as a memory', (noteCount?.memories || 0) >= 1);
const manyTag = homeTag('manyfacts');
for (let i = 0; i < 14; i += 1) {
  upsertFacts(manyTag, [{ subject: 'Nori', predicate: `notes_${i}`, object: `topic ${i}` }], `Nori notes topic ${i}`);
}
const manyGraph = graphPayload(manyTag, 'manyfacts');
const noriNodes = manyGraph.nodes.filter((node) => node.label === 'Nori');
const noriEdges = manyGraph.edges.filter((edge) => edge.subject === 'Nori' && String(edge.label).startsWith('notes_'));
check(
  'one entity node holds every fact',
  noriNodes.length === 1 && (noriNodes[0].facts || []).length === 14 && new Set((noriNodes[0].facts || []).map((fact) => fact.object)).size === 14
);
check('each fact is its own edge', noriEdges.length === 14 && new Set(noriEdges.map((edge) => edge.object)).size === 14);
const requestNow = Date.parse('2026-11-16T12:00:00Z');
const keptRequestRows = keptRequests(
  [{ at: '2026-11-15T12:00:00Z' }, { at: '2026-11-08T12:00:00Z' }],
  requestNow
);
check('yesterday stays in the request log', keptRequestRows.length === 1 && keptRequestRows[0].at.startsWith('2026-11-15'));
const pasteTag = homeTag('pasteuser');
const pasted = await ingestPayload({
  text: 'Nori test paste',
  title: 'Pasted note',
  containerTag: pasteTag,
  source: 'paste',
  actorId: 'pasteuser',
});
const pasteDocs = listDocuments(pasteTag, 'pasteuser');
check(
  'pasted text is listed',
  pasted.document?.text?.includes('Nori test paste') &&
    pasteDocs.some((doc) => doc.title === 'Pasted note' && doc.preview.includes('Nori test paste'))
);
const pasteSearch = await searchMemory('Nori test paste', {
  containerTag: pasteTag,
  actorId: 'pasteuser',
  topK: 8,
  strictness: 0.4,
});
check(
  'playground search finds pasted text',
  pasteSearch.matches.some((hit) => /Nori test paste/i.test(`${hit.title} ${hit.text}`))
);

await ingestDocument({
  title: 'example.com',
  text: 'example.com says it is for sharing a public homepage.',
  containerTag: tag,
  source: 'web',
  extract: false,
  actorId: 'usera',
});
const found = await searchMemory(query, { containerTag: tag, actorId: 'usera', topK: 8, strictness: 0.4 });
check('search keeps the site and drops the raw note', found.matches.some((hit) => /homepage/i.test(hit.text)) && !found.matches.some((hit) => /black coffee/i.test(hit.text)));
const injected = await buildMemoryInjection(query, tag, { topK: 8, strictness: 0.4, actorId: 'usera' });
check('prompt omits the unrelated note', !/ChatGPT connected/i.test(injected.injection) && /homepage/i.test(injected.injection));
check('prompt stays within the cap', injected.retrieved.matches.length <= 8);

const cityTag = homeTag('cityuser');
const strictness = 0.4;
const topK = 10;
upsertFacts(cityTag, [{ subject: 'User', predicate: 'lives_in', object: 'Lisbon' }], 'likes the city of Lisbon');
upsertFacts(cityTag, [{ subject: 'User', predicate: 'prefers', object: 'coffee' }], 'prefers coffee in the morning');
upsertFacts(cityTag, [{ subject: 'User', predicate: 'works_at', object: 'Rukmer' }], 'works at Rukmer on weekdays');
upsertFacts(cityTag, [{ subject: 'User', predicate: 'from', object: 'Portugal' }], 'likes the city of Lisbon');

function sameIds(a: { id: string }[], b: { id: string }[]) {
  const left = a.map((hit) => hit.id).sort();
  const right = b.map((hit) => hit.id).sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}
function uniqueTexts(rows: { text?: string }[]) {
  const texts = rows.map((row) => String(row.text || '').replace(/\s+/g, ' ').trim().toLowerCase());
  return new Set(texts).size === texts.length;
}

const bake = 'How do I bake sourdough bread?';
const bakeSearch = await searchMemory(bake, { containerTag: cityTag, actorId: 'cityuser', topK, strictness });
const bakeInjected = await buildMemoryInjection(bake, cityTag, { topK, strictness, actorId: 'cityuser' });
check('unrelated question injects nothing', bakeInjected.retrieved.matches.length === 0, String(bakeInjected.retrieved.matches.length));
check('unrelated question search is empty', bakeSearch.matches.length === 0);
check('unrelated question has no related facts', (bakeSearch.related || []).length === 0);
check('chat and search match for sourdough', sameIds(bakeInjected.retrieved.matches, bakeSearch.matches));

const cityQuery = 'what city do I like?';
const citySearch = await searchMemory(cityQuery, { containerTag: cityTag, actorId: 'cityuser', topK, strictness });
const cityInjected = await buildMemoryInjection(cityQuery, cityTag, { topK, strictness, actorId: 'cityuser' });
const cityRows = cityInjected.retrieved.matches;
check('city question returns memories', cityRows.length > 0);
check(
  'city question is only Lisbon',
  cityRows.every((hit) => /lisbon/i.test(`${hit.title} ${hit.text}`) && !/coffee|rukmer/i.test(`${hit.title} ${hit.text}`))
);
check(
  'city scores meet strictness',
  cityRows.every((hit) => Number(hit.score) >= strictness),
  cityRows.map((hit) => hit.score).join(',')
);
check('chat and search match for city', sameIds(cityRows, citySearch.matches));

const lisbonSearch = await searchMemory('Lisbon', { containerTag: cityTag, actorId: 'cityuser', topK, strictness });
const lisbonInjected = await buildMemoryInjection('Lisbon', cityTag, { topK, strictness, actorId: 'cityuser' });
check('chat and search match for Lisbon', sameIds(lisbonInjected.retrieved.matches, lisbonSearch.matches));
check('injected texts are unique', uniqueTexts(cityRows) && uniqueTexts(lisbonInjected.retrieved.matches));
check('Lisbon search drops the duplicate text', uniqueTexts(lisbonSearch.matches));
const lisbonRows = [...lisbonSearch.matches, ...(lisbonSearch.related || [])];
const lisbonLinked = (row: { subject?: string; object?: string; title?: string; text?: string }) =>
  /lisbon/i.test(`${row.subject || ''} ${row.object || ''} ${row.title || ''} ${row.text || ''}`);
check('Lisbon matches and related have unique texts', uniqueTexts(lisbonRows));
check('Lisbon matches and related stay on Lisbon', lisbonRows.length > 0 && lisbonRows.every(lisbonLinked));
check('Lisbon related stays within the cap', (lisbonSearch.related || []).length <= 5);

const relTag = homeTag('reluser');
upsertFacts(relTag, [{ subject: 'User', predicate: 'name', object: 'Nori' }], 'name is Nori');
upsertFacts(relTag, [{ subject: 'Nori', predicate: 'lives_in', object: 'Lisbon' }], 'likes the city of Lisbon');
upsertFacts(relTag, [{ subject: 'Nori', predicate: 'works_at', object: 'Rukmer' }], 'works at Rukmer on weekdays');
upsertFacts(relTag, [{ subject: 'Nori', predicate: 'from', object: 'Portugal' }], 'likes the city of Lisbon');
upsertFacts(relTag, [{ subject: 'Lisbon', predicate: 'known_for', object: 'trams' }], 'Lisbon is known for trams');
const namedBake = await searchMemory('How do I bake sourdough bread?', {
  containerTag: relTag,
  actorId: 'reluser',
  topK: 8,
  strictness: 0.4,
  includeRelated: true,
});
check('named-user sourdough has no matches', namedBake.matches.length === 0);
check('named-user sourdough has no related facts', (namedBake.related || []).length === 0);
const namedLisbon = await searchMemory('Lisbon', {
  containerTag: relTag,
  actorId: 'reluser',
  topK: 8,
  strictness: 0.4,
  includeRelated: true,
});
const namedRows = [...namedLisbon.matches, ...(namedLisbon.related || [])];
check('named-user Lisbon texts are unique', uniqueTexts(namedRows));
check(
  'named-user Lisbon drops work and name facts',
  namedRows.length > 0 && namedRows.every(lisbonLinked) && !namedRows.some((row) => /rukmer|name is nori/i.test(`${row.subject} ${row.object} ${row.text}`))
);
const { runMemoryTool } = await import('./tools.js');
const toolBake = await runMemoryTool('searchMemories', { query: 'How do I bake sourdough bread?' }, 'reluser');
const toolLisbon = await runMemoryTool('searchMemories', { query: 'Lisbon' }, 'reluser');
const toolRows = [...(toolLisbon.matches || []), ...(toolLisbon.related || [])];
check('searchMemories sourdough is empty', toolBake.matches.length === 0 && (toolBake.related || []).length === 0);
check('searchMemories Lisbon texts are unique', uniqueTexts(toolRows));
check('searchMemories Lisbon stays on Lisbon', toolRows.length > 0 && toolRows.every(lisbonLinked));

const express = (await import('express')).default;
const { mountMemoryEngine } = await import('./routes.js');
const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as { port: number }).port;
async function searchV4(q: string) {
  const res = await fetch(`http://127.0.0.1:${port}/v4/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rukmer-user': 'cityuser' },
    body: JSON.stringify({ query: q, containerTag: cityTag, memoriesRetrieved: topK, matchStrictness: strictness }),
  });
  const body = await res.json();
  return { status: res.status, matches: (body.matches || []) as { id: string; score?: number; text?: string }[] };
}
const bakeHttp = await searchV4(bake);
const cityHttp = await searchV4(cityQuery);
const lisbonHttp = await searchV4('Lisbon');
const logged = await fetch(`http://127.0.0.1:${port}/v3/requests`, { headers: { 'x-rukmer-user': 'cityuser' } });
const loggedBody = await logged.json();
const liveFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello.' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return liveFetch(url, init);
}) as typeof fetch;
const chatLog = await liveFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-rukmer-user': 'cityuser', 'x-rukmer-memory': 'off' },
  body: JSON.stringify({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'hello' }], containerTag: cityTag }),
});
await chatLog.text();
globalThis.fetch = liveFetch;
const loggedAfter = await fetch(`http://127.0.0.1:${port}/v3/requests`, { headers: { 'x-rukmer-user': 'cityuser' } });
const loggedAfterBody = await loggedAfter.json();
server.close();
check('logged search appears for the signed-in user', logged.status === 200 && (loggedBody.requests || []).some((row: { type?: string; path?: string }) => row.type === 'search' && row.path === '/v4/search'));
check('logged chat appears for the signed-in user', (loggedAfterBody.requests || []).some((row: { type?: string; path?: string }) => row.type === 'chat' && String(row.path || '').includes('chat')));
check('v4 search accepts the playground settings', bakeHttp.status === 200 && cityHttp.status === 200 && lisbonHttp.status === 200);
check('chat and v4 search match for sourdough', sameIds(bakeInjected.retrieved.matches, bakeHttp.matches));
check('chat and v4 search match for city', sameIds(cityRows, cityHttp.matches));
check('chat and v4 search match for Lisbon', sameIds(lisbonInjected.retrieved.matches, lisbonHttp.matches));
check(
  'v4 search scores meet strictness',
  [...bakeHttp.matches, ...cityHttp.matches, ...lisbonHttp.matches].every((hit) => Number(hit.score) >= strictness)
);

const modelCatalog = [
  { id: 'gemini-3.8-flash', provider: 'gemini' },
  { id: 'gpt-4o-mini', provider: 'openai' },
  { id: 'claude-sonnet-4-5', provider: 'anthropic' },
  { id: 'grok-3-mini', provider: 'grok' },
];
check('server gemini key stays the default model', pickReadyModel(modelCatalog, { gemini: true })?.id === 'gemini-3.8-flash');
check('default model skips a provider with no key', pickReadyModel(modelCatalog, { openai: true })?.id === 'gpt-4o-mini');
check('no ready model leaves chat without a default', pickReadyModel(modelCatalog, {}) === null);
process.env.GEMINI_API_KEY = 'server-gemini';
const withServerGemini = keyFor('gemini', { headers: {} } as any);
check('server gemini key matches health', providerStatus().gemini === true && withServerGemini === 'server-gemini');
check(
  'user gemini key is preferred over the server key',
  keyFor('gemini', { headers: { 'x-gemini-key': 'user-gemini' } } as any) === 'user-gemini'
);
delete process.env.GEMINI_API_KEY;
check('missing gemini key is not ready', providerStatus().gemini === false && keyFor('gemini', { headers: {} } as any) === '');

const coffeeTag = homeTag('coffeeuser');
upsertFacts(coffeeTag, [{ subject: 'Nori', predicate: 'prefers', object: 'black coffee' }], 'Nori prefers black coffee');
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'You like black coffee.' }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(url, init);
}) as typeof fetch;
process.env.GEMINI_API_KEY = 'server-gemini';
const coffeeReq = {
  body: {
    model: 'gemini-3.8-flash',
    messages: [{ role: 'user', content: 'What coffee do I like?' }],
    containerTag: coffeeTag,
    memoriesRetrieved: 10,
    matchStrictness: 0.4,
    memoryMode: 'agentic',
    compareWithoutMemory: false,
  },
  headers: { 'x-rukmer-memory': 'on', 'x-rukmer-mode': 'agentic', 'x-container-tag': coffeeTag },
  memoryUser: { uid: 'coffeeuser' },
  params: {},
};
let coffeeBody: any = null;
const coffeeRes = {
  statusCode: 0,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: any) {
    coffeeBody = payload;
    return this;
  },
};
await completeChat(coffeeReq as any, coffeeRes as any);
const coffeeCitations = coffeeBody?.rukmer?.citations || [];
check(
  'coffee question cites black coffee',
  coffeeCitations.length >= 1 && coffeeCitations.some((hit: { title?: string; text?: string }) => /black coffee/i.test(`${hit.title || ''} ${hit.text || ''}`)),
  JSON.stringify(coffeeCitations.map((hit: { title?: string; text?: string; score?: number }) => ({ title: hit.title, text: hit.text, score: hit.score })))
);
coffeeReq.body = { ...coffeeReq.body, compareWithoutMemory: true };
coffeeReq.headers = { ...coffeeReq.headers, 'x-rukmer-memory': 'off' };
let offBody: any = null;
await completeChat(coffeeReq as any, { status() { return this; }, json(payload: any) { offBody = payload; return this; } } as any);
check('memory off explains empty citations', offBody?.rukmer?.citations?.length === 0 && offBody?.rukmer?.debug?.reason === 'memory off');

check('mongolia does not need memory', needsMemory("what's the capital of Mongolia?") === false);
check('australia prefix does not need memory', needsMemory("Nori test: what's the capital of Australia?") === false);
check('thanks does not need memory', needsMemory('thanks') === false && needsMemory('hello') === false);
check('personal questions still need memory', needsMemory('What city do I like?') && needsMemory('What coffee do I prefer?') && needsMemory('What do you know about me?') && needsMemory('Lisbon') && needsMemory('favourite city'));
const padded = selectMemories(
  "what's the capital of Mongolia?",
  [
    { id: 'lisbon', text: 'User likes the city of Lisbon', vectorScore: 0.74 },
    { id: 'coffee', text: 'Nori prefers black coffee', vectorScore: 0.66 },
    { id: 'dump', text: 'Prior grocery list and a train ticket from last spring', vectorScore: 0.71, source: 'gemini-router' },
  ],
  { strictness: 0.4, topK: 10 }
);
check('mid cosine without overlap stays out', padded.length === 0);
const noiseTag = homeTag('noiseuser');
await ingestDocument({ title: 'Lisbon', text: 'User likes the city of Lisbon', containerTag: noiseTag, source: 'memory', actorId: 'noiseuser', extract: false });
await ingestDocument({ title: 'Coffee', text: 'Nori prefers black coffee', containerTag: noiseTag, source: 'memory', actorId: 'noiseuser', extract: false });
await ingestDocument({
  title: 'Prior chat',
  text: 'User: what is the capital?\n\nAgreed: The capital of Mongolia is Ulaanbaatar.',
  containerTag: noiseTag,
  source: 'gemini-router',
  actorId: 'noiseuser',
  extract: false,
});
const noiseQuery = "what's the capital of Mongolia?";
const noiseSearch = await searchMemory(noiseQuery, { containerTag: noiseTag, actorId: 'noiseuser', topK: 10, strictness: 0.4 });
const noiseInjected = await buildMemoryInjection(noiseQuery, noiseTag, { topK: 10, strictness: 0.4, actorId: 'noiseuser' });
const noiseBlob = `${JSON.stringify(noiseSearch.matches)} ${noiseInjected.injection}`;
check('mongolia search stays at zero', noiseSearch.matches.length === 0 && noiseSearch.skipReason === 'no-memory-needed');
check('mongolia injection skips the store', !/lisbon|coffee|ulaanbaatar/i.test(noiseBlob) && noiseInjected.retrieved.matches.length === 0);
const australia = await searchMemory("Nori test: what's the capital of Australia?", { containerTag: noiseTag, actorId: 'noiseuser', topK: 10, strictness: 0.4 });
check('australia search stays at zero', australia.matches.length === 0);

const beforeDump = listDocuments(noiseTag, 'noiseuser').map((doc) => doc.id);
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'The capital of Mongolia is Ulaanbaatar. It is a long factual reply.' }] } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  return originalFetch(url, init);
}) as typeof fetch;
await completeChat(
  {
    body: {
      model: 'gemini-3.8-flash',
      messages: [{ role: 'user', content: noiseQuery }],
      containerTag: noiseTag,
      memoriesRetrieved: 10,
      matchStrictness: 0.4,
    },
    headers: { 'x-rukmer-memory': 'on', 'x-container-tag': noiseTag },
    memoryUser: { uid: 'noiseuser' },
    params: {},
  } as any,
  { status() { return this; }, json() { return this; } } as any
);
const afterDump = listDocuments(noiseTag, 'noiseuser');
check(
  'assistant answer is not stored',
  afterDump.length === beforeDump.length && !afterDump.some((doc) => /Ulaanbaatar/i.test(`${doc.title} ${doc.preview}`) && !beforeDump.includes(doc.id))
);
check('chat does not create a router memory', !afterDump.some((doc) => doc.source === 'gemini-router' && !beforeDump.includes(doc.id)));

const milkTag = homeTag('milkuser');
const milkMessages = [
  { role: 'user', content: 'Remember that I prefer oat milk' },
  { role: 'assistant', content: 'You prefer oat milk, and that paraphrase should not become its own memory.' },
];
const firstMilk = await rememberTranscript({ containerTag: milkTag, source: 'conversation', actorId: 'milkuser', messages: milkMessages });
const secondMilk = await rememberTranscript({ containerTag: milkTag, source: 'conversation', actorId: 'milkuser', messages: milkMessages });
const milkDocs = listDocuments(milkTag, 'milkuser');
check('oat milk is stored once', firstMilk.skipped !== true && milkDocs.length === 1 && secondMilk.skipped === true);
check('assistant paraphrase is not its own memory', !milkDocs.some((doc) => /paraphrase|should not become/i.test(`${doc.title} ${doc.preview} ${doc.originalText || ''}`)));

globalThis.fetch = originalFetch;
delete process.env.GEMINI_API_KEY;

if (failures.length) {
  console.error(`\n${failures.length} playground fix check(s) failed`);
  process.exit(1);
}
console.log('\nplayground fix checks passed');
