/**
 * Rukmer Memory Protocol
 * Same data pattern as typical memory layers (ingest → retrieve → inject → extract):
 * Rukmer stores processed memory. Gemini / GPT / Claude / Grok still generate the answer.
 */
export const MEMORY_PROTOCOL = {
  name: 'Rukmer Memory Protocol',
  version: '1.0',
  stores: {
    chunks: 'Semantic passages with embeddings for hybrid search (vector + BM25).',
    facts: 'Durable triples only (prefers, works_at, lives_in, …) with isLatest / validFrom / validTo.',
    scope: 'containerTag = user or workspace. Not mixed into the provider account.',
  },
  doesNotStore: [
    'The LLM itself or its weights',
    'Your ChatGPT / Claude / Grok account history',
    'Every chat turn as a graph node (questions and filler are skipped)',
  ],
  connect: {
    userFacing: 'Connect Claude, ChatGPT, Gemini, or Grok as MCP / custom connectors. No provider API keys.',
    cannot: 'Those products do not expose chat-session or history APIs, so Rukmer cannot import old threads. Memory is written going forward when the app calls searchMemories / addMemory.',
    playground: 'Chat inside Rukmer Playground uses Rukmer-hosted model keys when configured. That is a new session, not their website history.',
  },
  flow: [
    { step: 'ingest', detail: 'Documents, PDFs, and stated facts are chunked and embedded.' },
    { step: 'extract', detail: 'Only durable profile facts go on the graph. Updates close old isLatest rows.' },
    { step: 'query', detail: 'Incoming prompt is analyzed, then hybrid-retrieved in that containerTag.' },
    { step: 'inject', detail: 'Current facts + top passages are written into the system prompt.' },
    { step: 'generate', detail: 'The user’s chosen model (Gemini, GPT, Claude, Grok) produces the reply.' },
    { step: 'commit', detail: 'If the user stated a new durable fact, it is saved in the background.' },
  ],
} as const;
