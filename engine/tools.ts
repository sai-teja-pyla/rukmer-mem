import { getState } from './core.js';
import { canRead } from './governance.js';
import { commitImportantMemory, listAuthoredMemories, searchMemory } from './pipeline.js';
import { readTagsFor, readableSpaces } from './spaces.js';
import { TOOL_ALLOWLIST } from './security.js';
import { canAccessTag, homeTag, ownsTag } from './tenancy.js';

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
  {
    type: 'function',
    function: {
      name: 'copyMemoryToSpace',
      description: 'Copies a memory the user already owns into another space. Personal to team requires confirm:true. Does not reveal hidden text first.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          containerTag: { type: 'string', description: 'Destination space tag.' },
          confirm: { type: 'boolean', description: 'Required true when copying Personal into a team or organization space.' },
        },
        required: ['memoryId', 'containerTag'],
      },
    },
  },
];

export async function runMemoryTool(name: string, args: any, uid?: string, access?: { readOnly?: boolean; containerTags?: string[] }) {
  if (!uid) throw Object.assign(new Error('Sign in required'), { status: 401 });
  if (!TOOL_ALLOWLIST.includes(name as (typeof TOOL_ALLOWLIST)[number])) {
    throw Object.assign(new Error('Tool is not allowed'), { status: 403 });
  }
  if (access?.readOnly && name !== 'searchMemories') throw Object.assign(new Error('Read-only key'), { status: 403 });
  if (access?.containerTags?.length && args?.containerTag && !access.containerTags.includes(String(args.containerTag))) {
    throw Object.assign(new Error('Tag is outside this key'), { status: 403 });
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
    let tags = readTagsFor(uid, { scope: scope === 'private' || scope === 'team' ? scope : 'all', teamId: args?.teamId, containerTag: args?.containerTag });
    if (access?.containerTags?.length) tags = tags.filter((tag) => access.containerTags!.includes(tag));
    const knowable = access?.containerTags?.length
      ? readTagsFor(uid, { scope: 'all' }).filter((tag) => access.containerTags!.includes(tag))
      : readTagsFor(uid, { scope: 'all' });
    const found = await searchMemory(query, {
      containerTag: tags[0] || homeTag(uid),
      containerTags: tags,
      probeTags: knowable.filter((tag) => !tags.includes(tag)),
      topK: 8,
      includeRelated: true,
      actorId: uid,
      purpose: 'tool',
      author: args?.author,
      since: args?.since,
      until: args?.until,
      topic: args?.topic,
    });
    const docs = new Map(getState().documents.map((doc) => [doc.id, doc]));
    const matches = (found.matches || []).map((match) => {
      const doc = docs.get(String(match.docId || match.id || ''));
      return {
        ...match,
        processingStatus: doc?.processingStatus || 'done',
        memoryStatusReason: doc?.memoryStatusReason || '',
      };
    });
    const pending = matches.some((match) => match.processingStatus !== 'done');
    return { ...found, matches, memoryExtraction: pending ? 'in_progress' : 'complete' };
  }
  if (name === 'addMemory') {
    const writeScope = args?.scope === 'team' ? 'team' : 'private';
    const requested = String(args?.containerTag || '').trim();
    const assigned = access?.containerTags?.length === 1 ? access.containerTags[0] : '';
    const target = requested || assigned;
    const containerTag = target && (ownsTag(uid, target) || canAccessTag(uid, target)) ? target : homeTag(uid);
    const saved = await commitImportantMemory({
      title: args?.title,
      text: String(args?.text || ''),
      containerTag,
      source: 'tool',
      actorId: uid,
      scope: containerTag.startsWith('tm_') ? 'team' : writeScope,
      teamId: args?.teamId,
    });
    const status = saved.document?.processingStatus || (saved.skipped ? 'done' : 'searchable');
    return {
      ...saved,
      processingStatus: status,
      memoryStatusReason: saved.document?.memoryStatusReason || '',
      memoryExtraction: status === 'done' ? 'complete' : 'in_progress',
    };
  }
  if (name === 'copyMemoryToSpace') {
    const id = String(args?.memoryId || '');
    const dest = String(args?.containerTag || '');
    if (!dest || !canAccessTag(uid, dest)) throw Object.assign(new Error('Destination space is not available'), { status: 403 });
    if (access?.containerTags?.length && !access.containerTags.includes(dest)) {
      throw Object.assign(new Error('Tag is outside this key'), { status: 403 });
    }
    const state = getState();
    const doc = state.documents.find((row) => row.id === id && !row.forgotten) || state.documents.find((row) => state.chunks.some((chunk) => chunk.id === id && chunk.docId === row.id));
    if (!doc || !canRead(uid, doc)) throw Object.assign(new Error('Memory not found'), { status: 404 });
    const personalToTeam = !doc.containerTag.startsWith('tm_') && dest.startsWith('tm_');
    if (personalToTeam && args?.confirm !== true) {
      const from = readableSpaces(uid).find((row) => row.tag === doc.containerTag);
      return {
        copied: false,
        requiresConfirmation: true,
        otherSpaceHint: {
          found: true,
          spaceKind: 'personal',
          spaceLabel: 'Personal',
          spaceTag: from?.tag || doc.containerTag,
          canSwitch: true,
          canCopy: true,
          requiresConfirmation: true,
        },
      };
    }
    const copied = await commitImportantMemory({
      title: doc.title,
      text: doc.originalText || doc.text,
      containerTag: dest,
      source: 'tool',
      actorId: uid,
      scope: dest.startsWith('tm_') ? 'team' : 'private',
      teamId: dest.startsWith('tm_') ? dest.replace(/^tm_/, '') : undefined,
      metadata: { copiedFrom: doc.id },
    });
    return { copied: copied.skipped !== true, documentId: copied.document?.id, requiresConfirmation: false };
  }
  throw new Error(`Unknown memory tool ${name}`);
}
