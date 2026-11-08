import { commitImportantMemory, searchMemory } from './pipeline.js';
import { TOOL_ALLOWLIST } from './security.js';
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
