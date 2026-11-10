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

const { selectMemories } = await import('./relevance.js');
const { missingKeyMessage } = await import('./router.js');
const { MEMORY_TOOLS } = await import('./tools.js');
const { MCP_INSTRUCTIONS, CHATGPT_OPENAPI } = await import('./mcp.js');
const { homeTag } = await import('./tenancy.js');
const { commitImportantMemory, ingestDocument, searchMemory } = await import('./pipeline.js');
const { buildMemoryInjection } = await import('./inject.js');

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

const openaiMessage = missingKeyMessage('openai');
check('openai key message names OpenAI', openaiMessage.includes('OpenAI') && openaiMessage.includes('Settings') && !/\bopenai\b/.test(openaiMessage));
check('anthropic key message names Anthropic', missingKeyMessage('anthropic').includes('Anthropic') && !/\banthropic\b/.test(missingKeyMessage('anthropic').split('Anthropic').join('')));
check('grok key message names xAI', missingKeyMessage('grok').includes('xAI'));

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

if (failures.length) {
  console.error(`\n${failures.length} playground fix check(s) failed`);
  process.exit(1);
}
console.log('\nplayground fix checks passed');
