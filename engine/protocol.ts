/**
 * Rukmer Memory Protocol
 * Same data pattern as typical memory layers (ingest → retrieve → inject → extract):
 * Rukmer stores processed memory. Gemini / GPT / Claude / Grok still generate the answer.
 */
export const MEMORY_PROTOCOL = {
  name: 'Rukmer Memory Protocol',
  version: '1.2',
  stores: {
    files: 'Original PDFs and images are kept beside the index. Search uses the extracted text, not the raw bytes.',
    chunks: 'Passages with a document header, embedded for hybrid search (vector + keyword + graph).',
    longTerm: 'Stable profile facts (name, work, home, preferences) stay until a newer fact replaces them.',
    shortTerm: 'Recent decisions, plans, and deadlines stay about 21 days, then drop out of the live profile.',
    scope: 'Memory is scoped to a user, a session, an agent, or a shared org. A session can be closed. An org is visible only to its members.',
    index: 'Hybrid search fuses semantic vectors, keyword rank, and the fact graph. Semantic search ranks by meaning. Small spaces are scored directly so latency stays on the embedding call.',
    time: 'Facts keep when they happened, not only when they were written, so current and past questions rank differently.',
    filters: 'Search accepts metadata filters (all / any) and profiles are split into topic buckets.',
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
    { step: 'ingest', detail: 'Text, PDFs, and images enter through the API, import, or MCP. The original file is stored. Vision or PDF text is what gets indexed.' },
    { step: 'extract', detail: 'Long-term profile facts and short-term context are written as triples. A newer fact closes the old one.' },
    { step: 'query', detail: 'The question is matched with embeddings, keywords, and the fact graph inside that containerTag.' },
    { step: 'inject', detail: 'Only the long-term profile, recent context, and a few matching passages go into the prompt.' },
    { step: 'generate', detail: 'The user’s chosen model (Gemini, GPT, Claude, Grok) produces the reply.' },
    { step: 'commit', detail: 'If the user stated a new durable fact, it is saved in the background.' },
  ],
} as const;
