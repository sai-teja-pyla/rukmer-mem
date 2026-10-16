import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-eval-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;

const { upsertFacts, deriveFacts } = await import('./facts.js');
const { searchMemory } = await import('./pipeline.js');
const { EVAL_CASES } = await import('./eval-set.js');
const { heuristicExtract } = await import('./llm.js');

let hits = 0;
const lines: string[] = [];
for (const item of EVAL_CASES) {
  const tag = `u_evaluser--${item.id}`;
  for (const fact of item.facts) {
    upsertFacts(tag, [{ subject: fact.subject, predicate: fact.predicate, object: fact.object }], fact.evidence);
  }
  deriveFacts(tag);
  const out = await searchMemory(item.query, { containerTag: tag, topK: 5, includeRelated: true });
  const blob = out.matches.map((m) => `${m.title}\n${m.text}`).join('\n').toLowerCase();
  const ok = blob.includes(item.expect.toLowerCase());
  const leaked = item.id === 'preference-now' && item.reject ? blob.includes(item.reject) : false;
  if (ok && !leaked) hits += 1;
  lines.push(`${ok && !leaked ? 'hit' : 'miss'} ${item.id} matches=${out.matches.length}`);
}

const extracted = heuristicExtract('Please remember that I work at Rukmer and I live in Seattle.');
const extractionOk = extracted.triples.some((t) => t.predicate === 'works_at' && /rukmer/i.test(t.object));
const score = hits / EVAL_CASES.length;
console.log(lines.join('\n'));
console.log(`retrieval ${hits}/${EVAL_CASES.length} (${score.toFixed(2)}) extraction ${extractionOk ? 'hit' : 'miss'}`);
if (score < 1 || !extractionOk) process.exit(1);
