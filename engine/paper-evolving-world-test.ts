/**
 * Paper checks: Evolving World, divestment, deconfliction, and unlearning.
 * Run: npm run paper
 * No API keys. LLM baselines and the "Level 1 handles 90%" figure are not in this suite.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-paper-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.GROK_API_KEY;
delete process.env.RUKMER_IMPORTANCE_PRUNE;
delete process.env.MEMORY_DATA_KEY;

const { upsertFacts } = await import('./facts.js');
const { ingestDocument, searchMemory, forgetById, forgetMatching, forgetOwner } = await import('./pipeline.js');
const { buildMemoryInjection } = await import('./inject.js');
const { getState, saveState, importanceOf } = await import('./core.js');
const { homeTag } = await import('./tenancy.js');
const { pruneLowImportance, runRetentionSweep } = await import('./governance.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const actor = 'paperuser';
const tag = homeTag(actor);
const letters = 'DEFGHIJKLMN'.split('');
const fillerEvents = ['appointed a CFO', 'opened an office in Denver', 'launched product Atlas', 'reported revenue growth', 'signed a supply contract'];

function sessionDate(n: number) {
  if (n === 4) return '2021-04-15T00:00:00.000Z';
  if (n === 50) return '2025-03-15T00:00:00.000Z';
  const start = Date.parse('2020-01-15T00:00:00.000Z');
  return new Date(start + (n - 1) * 18 * 86400000).toISOString();
}

const docs = new Map<number, string>();
for (let n = 1; n <= 100; n++) {
  let text = '';
  let facts: { subject: string; predicate: string; object: string }[] = [];
  if (n === 4) {
    text = 'Company A acquires Company B.';
    facts = [
      { subject: 'Company A', predicate: 'acquired', object: 'Company B' },
      { subject: 'Company B', predicate: 'owned_by', object: 'Company A' },
    ];
  } else if (n === 50) {
    text = 'Company A divests Company B and merges with Company C.';
    facts = [
      { subject: 'Company A', predicate: 'divested', object: 'Company B' },
      { subject: 'Company A', predicate: 'merged_with', object: 'Company C' },
    ];
  } else if (n === 20) {
    text = 'Company G acquired Company H.';
    facts = [{ subject: 'Company G', predicate: 'acquired', object: 'Company H' }];
  } else if (n === 70) {
    text = 'Company K acquired Company L.';
    facts = [{ subject: 'Company K', predicate: 'acquired', object: 'Company L' }];
  } else {
    const company = `Company ${letters[(n - 1) % letters.length]}`;
    const event = fillerEvents[n % fillerEvents.length];
    text = `${company} ${event}.`;
    const predicate = event.startsWith('appointed')
      ? 'appointed_cfo'
      : event.startsWith('opened')
        ? 'opened_office'
        : event.startsWith('launched')
          ? 'launched_product'
          : event.startsWith('reported')
            ? 'reported_growth'
            : 'signed_contract';
    const object = event.startsWith('opened') ? 'Denver' : event.startsWith('launched') ? 'Atlas' : event.startsWith('appointed') ? 'CFO' : event.startsWith('reported') ? 'growth' : 'supply';
    facts = [{ subject: company, predicate, object }];
  }
  const stored = await ingestDocument({
    title: `Session ${n}`,
    text,
    containerTag: tag,
    source: 'memory',
    mime: 'text/plain',
    task: 'memory',
    extract: false,
    actorId: actor,
  });
  docs.set(n, stored.document.id);
  for (const fact of facts) {
    const line = `${fact.subject} ${fact.predicate.replace(/_/g, ' ')} ${fact.object}`;
    upsertFacts(tag, [{ ...fact, validFrom: sessionDate(n), sourceDocId: stored.document.id }], line, undefined, line);
  }
}

const triples = () => getState().triples.filter((row) => row.containerTag === tag);
const current = (subject: string, predicate: string, object: string) =>
  triples().some(
    (row) =>
      row.isLatest !== false &&
      row.subject === subject &&
      row.predicate === predicate &&
      row.object === object
  );
const closed = triples().filter(
  (row) =>
    row.isLatest === false &&
    ((row.subject === 'Company B' && row.predicate === 'owned_by' && row.object === 'Company A') ||
      (row.subject === 'Company A' && row.predicate === 'acquired' && row.object === 'Company B'))
);
check('divestment closes current ownership and acquisition', !current('Company B', 'owned_by', 'Company A') && !current('Company A', 'acquired', 'Company B'));
check(
  'closed ownership rows end in 2025',
  closed.length === 2 && closed.every((row) => String(row.validTo || '').startsWith('2025'))
);

function ownsNow(rows: { subject?: string; predicate?: string; object?: string; isLatest?: boolean }[]) {
  return rows.some((row) => {
    if (row.isLatest === false) return false;
    const pred = String(row.predicate || '');
    return (
      (row.subject === 'Company A' && (pred === 'owns' || pred === 'acquired') && row.object === 'Company B') ||
      (row.subject === 'Company B' && pred === 'owned_by' && row.object === 'Company A')
    );
  });
}

async function ask(query: string) {
  const found = await searchMemory(query, { containerTag: tag, topK: 6, includeRelated: true, retrieval: 'hybrid', strictness: 0.4 });
  const blob = [...found.matches.map((row) => `${row.title || ''} ${row.text || ''} ${row.predicate || ''}`), ...found.related.map((row) => `${row.predicate} ${row.text}`)]
    .join('\n')
    .toLowerCase();
  return { found, blob };
}

for (const query of ["Who owns Company B's assets now?", 'Does Company A currently own Company B?', 'Which company is liable for Company B today?']) {
  const { found, blob } = await ask(query);
  const liveIds = new Set(triples().filter((row) => row.isLatest !== false).map((row) => row.id));
  const stated = ownsNow([
    ...found.matches.filter((row) => liveIds.has(row.id)),
    ...found.related.filter((row) => row.isLatest !== false),
  ]);
  check(`${query} mentions the divestment`, blob.includes('divest') && !stated, blob.slice(0, 180));
  const injected = await buildMemoryInjection(query, tag, { topK: 6, includeRelated: true, retrieval: 'hybrid' });
  check(
    `${query} injection names the divestment`,
    injected.injection.toLowerCase().includes('divest') && !injected.injection.includes('PASSAGES FOR THIS QUESTION:\n(none)')
  );
}

const past = await ask('Who acquired Company B in 2021?');
check('2021 acquisition is still retrievable', /acquir/.test(past.blob));

const linked = await ask('Is Company C connected to Company B?');
const mergerFact = linked.found.matches.some((row) => row.source === 'fact' && /merged/.test(`${row.title || ''} ${row.predicate || ''} ${row.text || ''}`));
const mergerRelated = linked.found.related.some((row) => row.predicate === 'merged_with');
check('Company C connects to Company B through the merger fact', mergerFact || mergerRelated, linked.blob.slice(0, 180));

const still = triples().filter((row) => row.sourceDocId === docs.get(50) && row.isLatest !== false);
check(
  'entity state does not decay',
  still.some((row) => row.predicate === 'divested') && still.some((row) => row.predicate === 'merged_with')
);

const orderTag = homeTag('orderuser');
upsertFacts(orderTag, [{ subject: 'User', predicate: 'lives_in', object: 'Seattle', validFrom: '2026-06-01T00:00:00.000Z' }]);
upsertFacts(orderTag, [{ subject: 'User', predicate: 'lives_in', object: 'Boston', validFrom: '2019-05-01T00:00:00.000Z' }]);
const lives = getState().triples.filter((row) => row.containerTag === orderTag && row.predicate === 'lives_in');
check(
  'an older dated write stays historical',
  lives.find((row) => row.object === 'Seattle')?.isLatest !== false &&
    lives.find((row) => row.object === 'Boston')?.isLatest === false &&
    String(lives.find((row) => row.object === 'Boston')?.validTo || '').startsWith('2026')
);

for (const query of ["What's the capital of Australia?", 'How do I bake sourdough?', 'hello']) {
  const injected = await buildMemoryInjection(query, tag, { topK: 6 });
  check(`${query} injects nothing`, injected.retrieved.retrievedCount === 0 && injected.injection.includes('(none)'));
}

const queries = [
  "Who owns Company B's assets now?",
  'Does Company A currently own Company B?',
  'Which company is liable for Company B today?',
  'Who acquired Company B in 2021?',
  'Is Company C connected to Company B?',
];
const searchTimes: number[] = [];
const injectTimes: number[] = [];
for (let run = 0; run < 20; run++) {
  for (const query of queries) {
    const started = performance.now();
    await searchMemory(query, { containerTag: tag, topK: 6, includeRelated: true, retrieval: 'hybrid' });
    searchTimes.push(performance.now() - started);
    const injectStarted = performance.now();
    await buildMemoryInjection(query, tag, { topK: 4, includeRelated: true, retrieval: 'hybrid' });
    injectTimes.push(performance.now() - injectStarted);
  }
}
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
console.log(
  `latency search p50=${percentile(searchTimes, 50).toFixed(1)}ms p95=${percentile(searchTimes, 95).toFixed(1)}ms inject p50=${percentile(injectTimes, 50).toFixed(1)}ms p95=${percentile(injectTimes, 95).toFixed(1)}ms`
);

const beforeDocs = getState().documents.filter((row) => row.containerTag === tag && row.id !== docs.get(50)).map((row) => row.id).sort();
const beforeChunks = getState().chunks.filter((row) => row.containerTag === tag && row.docId !== docs.get(50)).map((row) => row.id).sort();
const beforeFacts = getState().triples.filter((row) => row.containerTag === tag && row.sourceDocId !== docs.get(50)).map((row) => row.id).sort();
const removed = forgetById(docs.get(50) || '', actor);
check('session 50 document is erased', removed.removed > 0 && !getState().documents.some((row) => row.id === docs.get(50)));
const afterDocs = getState().documents.filter((row) => row.containerTag === tag).map((row) => row.id).sort();
const afterChunks = getState().chunks.filter((row) => row.containerTag === tag).map((row) => row.id).sort();
const afterFacts = getState().triples.filter((row) => row.containerTag === tag).map((row) => row.id).sort();
check('the other 98 sessions stay', afterDocs.join() === beforeDocs.join() && afterChunks.join() === beforeChunks.join() && afterFacts.join() === beforeFacts.join());
saveState();
const plain = JSON.parse(fs.readFileSync(path.join(dir, 'engine.json'), 'utf8'));
const tagRows = [...(plain.documents || []), ...(plain.chunks || []), ...(plain.triples || [])].filter((row) => row.containerTag === tag);
check('divestment text is gone from the tag', !JSON.stringify(tagRows).toLowerCase().includes('divest'));

const legacyActor = 'legacyuser';
const legacyTag = homeTag(legacyActor);
upsertFacts(legacyTag, [{ subject: 'Company B', predicate: 'owned_by', object: 'Legacy Holder' }], 'legacy-residue-memo-company-b');
const legacy = getState().triples.find((row) => row.containerTag === legacyTag && row.evidence.includes('legacy-residue-memo-company-b'));
check('legacy fact has no governance stamp', !!legacy && !legacy.gov);
const forgotten = forgetMatching('company b', legacyTag, false, legacyActor);
check('legacy fact is forgotten', forgotten.count > 0);
const pastLegacy = await searchMemory('Who previously owned Company B?', { containerTag: legacyTag, topK: 6, retrieval: 'hybrid', strictness: 0.1 });
check('a forgotten legacy fact stays out of past queries', pastLegacy.matches.length === 0 && pastLegacy.related.length === 0);
saveState();
const afterForget = fs.readFileSync(path.join(dir, 'engine.json'), 'utf8');
check('forgotten text is not left on disk', !afterForget.includes('legacy-residue-memo-company-b'));

const aged = await ingestDocument({
  title: 'old episode',
  text: 'An old episode about a warehouse move.',
  containerTag: tag,
  task: 'memory',
  extract: false,
  actorId: actor,
});
const agedChunk = getState().chunks.find((row) => row.docId === aged.document.id);
const agedFact = getState().triples.find((row) => row.containerTag === tag && row.isLatest !== false);
if (agedChunk) agedChunk.createdAt = new Date(Date.now() - 400 * 86400000).toISOString();
if (agedFact) agedFact.validFrom = new Date(Date.now() - 400 * 86400000).toISOString();
const preview = pruneLowImportance({ dryRun: true, tag });
check('importance prune lists only chunks', !!agedChunk && preview.ids.includes(agedChunk.id) && !preview.ids.includes(agedFact?.id || 'missing-fact'));
const keptText = agedChunk?.text || '';
runRetentionSweep();
check('retention leaves importance pruning off by default', getState().chunks.find((row) => row.id === agedChunk?.id)?.text === keptText);

const now = Date.parse('2026-06-01T00:00:00.000Z');
const created = new Date(now - 90 * 86400000).toISOString();
const weight = importanceOf({ createdAt: created }, now);
check('importance is one half after one half-life', Math.abs(weight - 0.5) < 0.001, String(weight));

const eraseActor = 'eraseuser';
const eraseTag = homeTag(eraseActor);
const phrase = 'erase-phrase-quartz-91';
await ingestDocument({
  title: 'sealed',
  text: `Keep ${phrase} in the vault.`,
  containerTag: eraseTag,
  task: 'memory',
  extract: false,
  actorId: eraseActor,
});
const wiped = forgetOwner(eraseActor, eraseActor);
check('owner erasure removes that owner', wiped.removed > 0 && !getState().documents.some((row) => row.containerTag === eraseTag) && !getState().triples.some((row) => row.containerTag === eraseTag));
process.env.MEMORY_DATA_KEY = 'ab'.repeat(32);
saveState();
const sealed = fs.readFileSync(path.join(dir, 'engine.json'), 'utf8');
check('encryption at rest hides plaintext', sealed.includes('"enc":"v1"') && !sealed.includes(phrase) && !sealed.includes('Company A'));

console.log(failures.length ? `\n${failures.length} failed` : '\npaper checks passed');
process.exit(failures.length ? 1 : 0);
