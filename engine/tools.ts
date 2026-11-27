import { commitImportantMemory, listAuthoredMemories, searchMemory } from './pipeline.js';
import { TOOL_ALLOWLIST } from './security.js';
import { readTagsFor } from './spaces.js';
import { homeTag, ownsTag } from './tenancy.js';

export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchMemories',
      description: 'Searches the signed-in user private memories and the team spaces they belong to. Returns matching text, author, and score.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text. Leave empty with author or since to list recent team memories.' },
          scope: { type: 'string', enum: ['all', 'private', 'team'], description: 'Which spaces to read. Defaults to all.' },
          teamId: { type: 'string', description: 'Optional team space. Must be a team the user belongs to.' },
          author: { type: 'string', description: 'Uid, email, or display name of an active teammate.' },
          since: { type: 'string', description: 'ISO date or a window such as 7d.' },
          until: { type: 'string', description: 'ISO date.' },
          topic: { type: 'string', description: 'Optional text that must appear in the memory.' },
          containerTag: { type: 'string', description: 'Optional private space the user owns.' },
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
        "Stores one memory. Use scope:'team' for work updates, decisions, campaigns, code changes, and customers. Personal or unsure → omit scope (private).",
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Memory content.' },
          title: { type: 'string', description: 'Optional short label.' },
          scope: { type: 'string', enum: ['private', 'team'], description: "Defaults to private. Use 'team' only for work the teammate should see." },
          teamId: { type: 'string', description: 'Team space when scope is team. Defaults to the one general team.' },
          containerTag: { type: 'string', description: 'Optional private space the user owns.' },
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
  const scope = args?.scope === 'private' || args?.scope === 'team' || args?.scope === 'all' ? args.scope : 'all';
  if (name === 'searchMemories') {
    const query = String(args?.query || '');
    if (!query.trim() && (args?.author || args?.since || args?.topic)) {
      return listAuthoredMemories(uid, {
        author: args?.author,
        since: args?.since,
        until: args?.until,
        topic: args?.topic,
        topK: 8,
        purpose: 'tool',
      });
    }
    const tags = readTagsFor(uid, { scope: scope === 'private' || scope === 'team' ? scope : 'all', teamId: args?.teamId, containerTag: args?.containerTag });
    return searchMemory(query, {
      containerTag: tags[0] || homeTag(uid),
      containerTags: tags,
      topK: 8,
      includeRelated: true,
      actorId: uid,
      purpose: 'tool',
      author: args?.author,
      since: args?.since,
      until: args?.until,
      topic: args?.topic,
    });
  }
  if (name === 'addMemory') {
    const writeScope = args?.scope === 'team' ? 'team' : 'private';
    const requested = String(args?.containerTag || '').trim();
    return commitImportantMemory({
      title: args?.title,
      text: String(args?.text || ''),
      containerTag: requested && ownsTag(uid, requested) ? requested : homeTag(uid),
      source: 'tool',
      actorId: uid,
      scope: writeScope,
      teamId: args?.teamId,
    });
  }
  throw new Error(`Unknown memory tool ${name}`);
}
