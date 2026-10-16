import { commitImportantMemory, searchMemory } from './pipeline.js';
import { resolveOwnedTag } from './tenancy.js';

export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchMemories',
      description:
        'Search this user\'s long-term memory before answering anything about their preferences, plans, people, projects, or past decisions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          containerTag: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addMemory',
      description:
        'REQUIRED during chat. Save one important fact from the latest user message: decisions, plans, preferences, people, deadlines, constraints. Pass only the fact, never the whole transcript. Call this in the same turn the fact is said.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          title: { type: 'string' },
          containerTag: { type: 'string' },
        },
        required: ['text'],
      },
    },
  },
];

export async function runMemoryTool(name: string, args: any, uid?: string) {
  if (!uid) throw new Error('Sign in required');
  const tag = resolveOwnedTag(uid, args?.containerTag);
  if (!tag) throw new Error('containerTag required');
  if (name === 'searchMemories') {
    return searchMemory(String(args?.query || ''), { containerTag: tag, topK: 8, includeRelated: true });
  }
  if (name === 'addMemory') {
    return commitImportantMemory({
      title: args?.title,
      text: String(args?.text || ''),
      containerTag: tag,
      source: 'tool',
    });
  }
  throw new Error(`Unknown memory tool ${name}`);
}
