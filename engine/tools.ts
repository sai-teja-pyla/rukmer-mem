import { commitImportantMemory, searchMemory } from './pipeline.js';
import { TOOL_ALLOWLIST } from './security.js';
import { resolveOwnedTag } from './tenancy.js';

export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchMemories',
      description: 'Searches stored memories for the signed-in user. Returns matching text, source, and score.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          containerTag: { type: 'string', description: 'Optional memory space. Defaults to the signed-in user.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addMemory',
      description: 'Stores one memory for the signed-in user. Saves the text even when no structured facts are extracted.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Memory content.' },
          title: { type: 'string', description: 'Optional short label.' },
          containerTag: { type: 'string', description: 'Optional memory space. Defaults to the signed-in user.' },
        },
        required: ['text'],
      },
    },
  },
];

export async function runMemoryTool(name: string, args: any, uid?: string) {
  if (!uid) throw Object.assign(new Error('Sign in required'), { status: 401 });
  if (!TOOL_ALLOWLIST.includes(name as (typeof TOOL_ALLOWLIST)[number])) {
    throw Object.assign(new Error('Tool is not allowed'), { status: 403 });
  }
  const tag = resolveOwnedTag(uid, args?.containerTag);
  if (!tag) throw new Error('containerTag required');
  if (name === 'searchMemories') {
    return searchMemory(String(args?.query || ''), { containerTag: tag, topK: 8, includeRelated: true, actorId: uid, purpose: 'tool' });
  }
  if (name === 'addMemory') {
    return commitImportantMemory({
      title: args?.title,
      text: String(args?.text || ''),
      containerTag: tag,
      source: 'tool',
      actorId: uid,
    });
  }
  throw new Error(`Unknown memory tool ${name}`);
}
