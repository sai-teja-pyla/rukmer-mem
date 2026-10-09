import { ingestDocument, searchMemory } from './pipeline.js';
import { resolveOwnedTag } from './tenancy.js';

export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchMemories',
      description: 'Search Rukmer long-term memory (vector + keyword + graph) for this user/container.',
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
      description: 'Commit an important fact, note, or conversation excerpt into Rukmer memory.',
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
    return ingestDocument({
      title: args?.title || 'Agent memory',
      text: String(args?.text || ''),
      containerTag: tag,
      source: 'tool',
      mime: 'text/plain',
      task: 'memory',
    });
  }
  throw new Error(`Unknown memory tool ${name}`);
}
