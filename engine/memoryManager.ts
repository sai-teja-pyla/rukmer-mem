/**
 * Signed-in memory manager: list, manual create, edit, soft delete, restore, and cleanup.
 * Hard purge stays on eraseIds / eraseMemory. Auto-save chatter filters are not applied here.
 */
import { cosine, getState, saveState, type DocRec, type MemoryKind, type TripleRec } from './core.js';
import { upsertFacts } from './facts.js';
import {
  audit,
  canErase,
  canRead,
  eraseIds,
  expiresOn,
  findMemory,
  govOf,
  isExpired,
  isRetired,
  prepareWrite,
} from './governance.js';
import { embedText, heuristicExtract } from './llm.js';
import { isUsefulFact, sanitiseGraph } from './quality.js';
import { memoryFactKey, memoryTextKey } from './relevance.js';
import { homeTag, ownsTag } from './tenancy.js';
import { readTagsFor } from './spaces.js';
import { ingestDocument, parseSince, replaceDocumentText } from './pipeline.js';

export const DUPLICATE_THRESHOLD = 0.92;
const PREVIEW_LEN = 180;
const JUNK_SOURCE = /^(gemini|openai|anthropic|grok)-router$/i;
const KINDS: MemoryKind[] = ['session', 'working', 'preference', 'fact', 'decision', 'summary', 'context'];
const FILE_MIME = /pdf|image\/|video\//i;

export type MemoryRecordType = 'document' | 'fact';

export type MemoryItem = {
  id: string;
  recordType: MemoryRecordType;
  title: string;
  text: string;
  preview: string;
  source: string;
  kind: MemoryKind | string;
  containerTag: string;
  visibility: string;
  teamId: string;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  archived: boolean;
  forgotten: boolean;
  deletedAt: string | null;
  canErase: boolean;
  canEdit: boolean;
};

type AnyRow = DocRec | TripleRec | { id: string; containerTag: string; forgotten?: boolean; gov?: DocRec['gov']; text?: string; embedding?: number[] };

function previewOf(text: string) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= PREVIEW_LEN) return clean;
  return `${clean.slice(0, PREVIEW_LEN - 1)}…`;
}

function fileBacked(doc: DocRec) {
  return !!doc.fileId || FILE_MIME.test(doc.mime || '');
}

function factText(fact: TripleRec) {
  const line = `${fact.subject} ${String(fact.predicate || '').replace(/_/g, ' ')} ${fact.object}`.trim();
  const evidence = String(fact.evidence || '').trim();
  if (!evidence || evidence === line) return line;
  return `${line}\n${evidence}`;
}

function stampGov(row: { containerTag: string; gov?: DocRec['gov'] }) {
  if (!row.gov) row.gov = { ...govOf(row) };
  return row.gov;
}

export function toMemoryItem(actor: string, row: DocRec | TripleRec): MemoryItem {
  const gov = govOf(row);
  const doc = 'title' in row ? (row as DocRec) : null;
  const fact = doc ? null : (row as TripleRec);
  const text = doc ? doc.text || '' : factText(fact!);
  const createdAt = doc ? doc.createdAt : fact?.recordedAt || fact?.validFrom || '';
  const erase = canErase(actor, row);
  const forgotten = !!(doc ? doc.forgotten : fact?.forgotten) || !!gov.deletedAt || !!gov.archived;
  return {
    id: row.id,
    recordType: doc ? 'document' : 'fact',
    title: doc ? doc.title || 'Untitled' : `${fact!.subject} ${String(fact!.predicate || '').replace(/_/g, ' ')} ${fact!.object}`.trim(),
    text,
    preview: previewOf(text || (doc?.title || '')),
    source: doc ? doc.source || 'memory' : 'fact',
    kind: gov.memoryKind || 'context',
    containerTag: row.containerTag,
    visibility: gov.visibility || 'private',
    teamId: gov.teamId || '',
    ownerId: gov.ownerId || '',
    createdBy: gov.createdBy || gov.ownerId || '',
    createdAt,
    expiresAt: gov.expiresAt ?? null,
    archived: !!gov.archived,
    forgotten,
    deletedAt: gov.deletedAt || null,
    canErase: erase,
    canEdit: erase && !(doc && fileBacked(doc)),
  };
}

function scopeTags(actor: string, scope: string, containerTag?: string) {
  const narrowed = scope === 'private' || scope === 'team' ? scope : 'all';
  let tags: string[] = [];
  try {
    tags = readTagsFor(actor, { scope: narrowed });
  } catch {
    tags = [];
  }
  if (narrowed !== 'team') {
    const extra = new Set(tags);
    const state = getState();
    for (const doc of state.documents) if (ownsTag(actor, doc.containerTag)) extra.add(doc.containerTag);
    for (const fact of state.triples) if (ownsTag(actor, fact.containerTag)) extra.add(fact.containerTag);
    tags = [...extra];
    if (narrowed === 'private') tags = tags.filter((tag) => ownsTag(actor, tag));
  }
  const wanted = String(containerTag || '').trim();
  if (!wanted) return tags;
  return tags.includes(wanted) ? [wanted] : [];
}

function rowVisible(actor: string, row: { containerTag: string; forgotten?: boolean; gov?: DocRec['gov'] }, includeDeleted: boolean) {
  if (canRead(actor, row)) return true;
  return includeDeleted && isRetired(row) && canErase(actor, row);
}

function decodeCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function listMemories(
  actor: string,
  query: {
    q?: string;
    source?: string;
    kind?: string;
    containerTag?: string;
    visibility?: string;
    scope?: string;
    from?: string;
    to?: string;
    recordType?: string;
    includeDeleted?: boolean;
    onlyDeleted?: boolean;
    limit?: number;
    cursor?: string;
  } = {}
) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const includeDeleted = !!query.includeDeleted || !!query.onlyDeleted;
  const tags = new Set(scopeTags(actor, query.scope || 'all', query.containerTag));
  const needle = String(query.q || '').trim().toLowerCase();
  const source = String(query.source || '').trim().toLowerCase();
  const kind = String(query.kind || '').trim().toLowerCase();
  const visibility = String(query.visibility || '').trim().toLowerCase();
  const recordType = query.recordType === 'document' || query.recordType === 'fact' ? query.recordType : 'all';
  const from = parseSince(query.from);
  const toRaw = String(query.to || '').trim();
  const to = toRaw ? parseSince(toRaw) || Date.parse(toRaw) : 0;
  const state = getState();
  const items: MemoryItem[] = [];
  if (recordType !== 'fact') {
    for (const doc of state.documents) {
      if (!tags.has(doc.containerTag) || !rowVisible(actor, doc, includeDeleted)) continue;
      if (query.onlyDeleted && !isRetired(doc)) continue;
      items.push(toMemoryItem(actor, doc));
    }
  }
  if (recordType !== 'document') {
    for (const fact of state.triples) {
      if (fact.isLatest === false && !fact.forgotten && !fact.gov?.deletedAt) continue;
      if (!tags.has(fact.containerTag) || !rowVisible(actor, fact, includeDeleted)) continue;
      if (query.onlyDeleted && !isRetired(fact)) continue;
      items.push(toMemoryItem(actor, fact));
    }
  }
  const filtered = items.filter((item) => {
    if (source && item.source.toLowerCase() !== source) return false;
    if (kind && String(item.kind).toLowerCase() !== kind) return false;
    if (visibility && item.visibility !== visibility) return false;
    const at = Date.parse(item.createdAt || '');
    if (from && (!Number.isFinite(at) || at < from)) return false;
    if (to && Number.isFinite(to) && (!Number.isFinite(at) || at > to)) return false;
    if (needle && !`${item.title} ${item.text} ${item.source}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 50)));
  const offset = decodeCursor(query.cursor);
  const page = filtered.slice(offset, offset + limit);
  const next = offset + limit < filtered.length ? encodeCursor(offset + limit) : null;
  return { memories: page, nextCursor: next, total: filtered.length };
}

export function getMemory(actor: string, id: string, includeDeleted = false) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const row = findOwnedRow(id);
  if (!row || !rowVisible(actor, row, includeDeleted)) throw Object.assign(new Error('Memory not found'), { status: 404 });
  if ('title' in row) return toMemoryItem(actor, row as DocRec);
  return toMemoryItem(actor, row as TripleRec);
}

function findOwnedRow(id: string): DocRec | TripleRec | null {
  const state = getState();
  return state.documents.find((doc) => doc.id === id) || state.triples.find((fact) => fact.id === id) || null;
}

export async function createManualMemory(
  actor: string,
  input: { text?: string; title?: string; kind?: string; containerTag?: string; visibility?: string; teamId?: string }
) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const text = String(input.text || '').trim();
  if (!text) throw Object.assign(new Error('Memory text is required'), { status: 400 });
  const tag = String(input.containerTag || '').trim() || homeTag(actor);
  const before = new Set(getState().triples.map((fact) => fact.id));
  const saved = await ingestDocument({
    title: String(input.title || text).slice(0, 80),
    text,
    originalText: text,
    containerTag: tag,
    source: 'user',
    mime: 'text/plain',
    task: 'memory',
    actorId: actor,
    visibility: input.visibility,
    teamId: input.teamId,
    memoryKind: input.kind,
    extraction: 'manual',
    durable: input.visibility === 'team',
  });
  const doc = saved.document;
  if (doc.gov) doc.gov.extraction = 'manual';
  const created = getState().triples.filter((fact) => !before.has(fact.id) && fact.containerTag === doc.containerTag);
  saveState();
  return { memories: [toMemoryItem(actor, doc), ...created.map((fact) => toMemoryItem(actor, fact))] };
}

function applyKind(row: { containerTag: string; gov?: DocRec['gov'] }, kind: string) {
  if (!KINDS.includes(kind as MemoryKind)) throw Object.assign(new Error('Unknown memory kind'), { status: 400 });
  const gov = stampGov(row);
  gov.memoryKind = kind as MemoryKind;
  gov.expiresAt = gov.visibility === 'team' ? null : expiresOn(gov.tenantId, gov.memoryKind);
  return gov;
}

function refreshFacts(doc: DocRec, previousText: string) {
  const state = getState();
  const now = new Date().toISOString();
  const previous = new Set([previousText, doc.originalText || ''].map((item) => item.trim()).filter(Boolean));
  for (const fact of state.triples) {
    if (fact.containerTag !== doc.containerTag || fact.isLatest === false) continue;
    if (!previous.has(String(fact.originalText || '').trim())) continue;
    fact.isLatest = false;
    fact.validTo = now;
    fact.forgotten = true;
    const gov = stampGov(fact);
    gov.deletedAt = now;
  }
  const graph = sanitiseGraph(heuristicExtract(doc.text));
  const triples = (graph.triples || []).filter(isUsefulFact);
  if (triples.length) upsertFacts(doc.containerTag, triples, doc.text.slice(0, 240), doc.gov, doc.text);
}

export async function updateManualMemory(
  actor: string,
  id: string,
  input: { text?: string; title?: string; kind?: string }
) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const state = getState();
  const doc = state.documents.find((row) => row.id === id) || null;
  const fact = doc ? null : state.triples.find((row) => row.id === id) || null;
  const row = doc || fact;
  if (!row) throw Object.assign(new Error('Memory not found'), { status: 404 });
  if (!canErase(actor, row)) throw Object.assign(new Error('You cannot edit this memory'), { status: 403 });
  if (doc && fileBacked(doc)) {
    throw Object.assign(new Error('This file memory cannot be edited. Delete it and import it again.'), { status: 409 });
  }
  const tenantId = govOf(row).tenantId;
  if (input.kind) applyKind(row, String(input.kind));
  if (doc && input.title != null) {
    const title = prepareWrite(tenantId, String(input.title));
    doc.title = title.text.trim() || 'Untitled';
  }
  if (input.text != null) {
    const cleaned = prepareWrite(tenantId, String(input.text));
    if (!cleaned.text.trim()) throw Object.assign(new Error('Nothing left to store after redaction'), { status: 422 });
    if (doc) {
      const previous = doc.text;
      if (cleaned.text !== doc.text) {
        await replaceDocumentText(doc, cleaned.text);
        for (const chunk of state.chunks) {
          if (chunk.docId === doc.id && !chunk.forgotten) chunk.gov = doc.gov ? { ...doc.gov } : chunk.gov;
        }
        refreshFacts(doc, previous);
      }
    } else if (fact) {
      fact.evidence = cleaned.text;
      fact.originalText = cleaned.text;
      fact.embedding = await embedText(factText(fact));
    }
  }
  if (doc && input.kind) {
    for (const chunk of state.chunks) {
      if (chunk.docId === doc.id && !chunk.forgotten && chunk.gov) chunk.gov = { ...doc.gov! };
    }
  }
  audit({
    actorId: actor,
    action: 'write',
    memoryId: id,
    tenantId,
    detail: 'edit',
  });
  saveState();
  return { memory: toMemoryItem(actor, (doc || fact)!) };
}

function linkedFacts(doc: DocRec) {
  const keys = new Set([doc.text, doc.originalText || ''].map((item) => item.trim()).filter(Boolean));
  return getState().triples.filter((fact) => fact.containerTag === doc.containerTag && keys.has(String(fact.originalText || '').trim()));
}

function markRetired(row: AnyRow, now: string) {
  row.forgotten = true;
  const gov = stampGov(row);
  gov.deletedAt = now;
}

function clearRetired(row: AnyRow, restoreExpired: boolean) {
  const gov = stampGov(row);
  if (gov.archived && !restoreExpired) {
    throw Object.assign(new Error('Retention archived this memory. Restore expired to bring it back.'), { status: 409 });
  }
  row.forgotten = false;
  gov.deletedAt = null;
  if (restoreExpired) gov.archived = false;
}

function expand(id: string): AnyRow[] {
  const state = getState();
  const doc = state.documents.find((row) => row.id === id);
  if (doc) return [doc, ...state.chunks.filter((chunk) => chunk.docId === doc.id), ...linkedFacts(doc)];
  const chunk = state.chunks.find((row) => row.id === id);
  if (chunk) return [chunk];
  const fact = state.triples.find((row) => row.id === id);
  if (fact) return [fact];
  return [];
}

export function retireMemories(actor: string, ids: string[], opts: { dryRun?: boolean; permanent?: boolean } = {}) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) throw Object.assign(new Error('Memory id required'), { status: 400 });
  for (const id of unique) {
    const row = findMemory(id);
    if (!row) throw Object.assign(new Error('Memory not found'), { status: 404 });
    if (!canErase(actor, row)) throw Object.assign(new Error('You cannot delete this memory'), { status: 403 });
  }
  if (opts.dryRun) {
    audit({ actorId: actor, action: 'preview', memoryId: unique[0] || '', tenantId: homeTag(actor), detail: `soft:${unique.length}` });
    saveState();
    return { ok: true, dryRun: true, permanent: false, count: unique.length, ids: unique, removed: 0 };
  }
  if (opts.permanent) {
    const out = eraseIds(unique, actor);
    return { ok: true, dryRun: false, permanent: true, count: unique.length, ids: unique, removed: out.removed };
  }
  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const id of unique) {
    for (const row of expand(id)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (!canErase(actor, row)) continue;
      markRetired(row, now);
      audit({ actorId: actor, action: 'delete', memoryId: row.id, tenantId: govOf(row).tenantId, detail: 'soft' });
    }
  }
  saveState();
  return { ok: true, dryRun: false, permanent: false, count: unique.length, ids: unique, removed: 0 };
}

export function restoreMemories(actor: string, ids: string[], opts: { restoreExpired?: boolean } = {}) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) throw Object.assign(new Error('Memory id required'), { status: 400 });
  for (const id of unique) {
    const row = findMemory(id);
    if (!row) throw Object.assign(new Error('Memory not found'), { status: 404 });
    if (!canErase(actor, row)) throw Object.assign(new Error('You cannot restore this memory'), { status: 403 });
    if (govOf(row).archived && !opts.restoreExpired) {
      throw Object.assign(new Error('Retention archived this memory. Restore expired to bring it back.'), { status: 409 });
    }
  }
  const restored: string[] = [];
  for (const id of unique) {
    for (const row of expand(id)) {
      if (!canErase(actor, row)) continue;
      clearRetired(row, !!opts.restoreExpired);
      restored.push(row.id);
    }
    audit({ actorId: actor, action: 'write', memoryId: id, tenantId: homeTag(actor), detail: 'restore' });
  }
  saveState();
  return { ok: true, ids: unique, restored: restored.length };
}

type MatchInput = {
  actor: string;
  query?: string;
  ids?: string[];
  source?: string;
  kind?: string;
  containerTag?: string;
  expired?: boolean;
  junk?: boolean;
  dryRun?: boolean;
  permanent?: boolean;
};

function haystack(row: DocRec | TripleRec | { text?: string }) {
  if ('title' in row && 'text' in row) return `${(row as DocRec).title} ${(row as DocRec).text} ${(row as DocRec).originalText || ''}`;
  const fact = row as TripleRec;
  return `${fact.subject || ''} ${fact.predicate || ''} ${fact.object || ''} ${fact.evidence || ''} ${fact.originalText || ''}`;
}

function selectable(input: MatchInput) {
  return !!(
    String(input.query || '').trim() ||
    (input.ids && input.ids.length) ||
    String(input.source || '').trim() ||
    String(input.kind || '').trim() ||
    input.expired ||
    input.junk
  );
}

export function forgetMemoriesMatching(input: MatchInput) {
  const actor = input.actor;
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  if (!selectable(input)) throw Object.assign(new Error('Say what to forget: a query, ids, source, kind, junk, or expired'), { status: 400 });
  const wanted = new Set((input.ids || []).map((id) => String(id || '').trim()).filter(Boolean));
  const q = String(input.query || '').trim().toLowerCase();
  const source = String(input.source || '').trim().toLowerCase();
  const kind = String(input.kind || '').trim().toLowerCase();
  const tag = String(input.containerTag || '').trim();
  const tags = tag ? scopeTags(actor, 'all', tag) : null;
  if (tag && tags && !tags.length) return { dryRun: !!input.dryRun, permanent: !!input.permanent, count: 0, ids: [] as string[], items: [] as MemoryItem[] };
  const state = getState();
  const hits: (DocRec | TripleRec)[] = [];
  const consider = (row: DocRec | TripleRec) => {
    if (tag && row.containerTag !== tag) return;
    if (tags && !tags.includes(row.containerTag)) return;
    if (wanted.size && !wanted.has(row.id)) return;
    if (!canErase(actor, row)) return;
    const gov = govOf(row);
    const rowSource = 'source' in row ? String((row as DocRec).source || '') : 'fact';
    if (input.junk && !JUNK_SOURCE.test(rowSource)) return;
    if (source && rowSource.toLowerCase() !== source) return;
    if (kind && String(gov.memoryKind || '').toLowerCase() !== kind) return;
    if (input.expired && !isExpired(gov.expiresAt)) return;
    if (q && !haystack(row).toLowerCase().includes(q)) return;
    hits.push(row);
  };
  for (const doc of state.documents) consider(doc);
  for (const fact of state.triples) {
    if (fact.isLatest === false && !fact.forgotten && !fact.gov?.deletedAt) continue;
    consider(fact);
  }
  const ids = hits.map((row) => row.id);
  const items = hits.map((row) => toMemoryItem(actor, row));
  if (input.dryRun) {
    audit({ actorId: actor, action: 'preview', memoryId: '', tenantId: homeTag(actor), detail: `forget-matching:${ids.length}` });
    saveState();
    return { dryRun: true, permanent: !!input.permanent, count: ids.length, ids, items };
  }
  if (!ids.length) return { dryRun: false, permanent: !!input.permanent, count: 0, ids, items };
  const out = retireMemories(actor, ids, { permanent: !!input.permanent });
  return { ...out, items };
}

type DupRow = {
  item: MemoryItem;
  key: string;
  factKey: string;
  embedding?: number[];
  createdAt: string;
  length: number;
};

function embeddingOf(row: DocRec | TripleRec) {
  if ('title' in row) {
    const chunk = getState().chunks.find((item) => item.docId === row.id && item.embedding && item.embedding.length);
    return chunk?.embedding;
  }
  return (row as TripleRec).embedding;
}

export function findDuplicateMemories(actor: string, opts: { dryRun?: boolean; threshold?: number; permanent?: boolean } = {}) {
  if (!actor) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  const threshold = Math.min(0.999, Math.max(0.5, Number(opts.threshold) || DUPLICATE_THRESHOLD));
  const state = getState();
  const rows: DupRow[] = [];
  const push = (row: DocRec | TripleRec) => {
    if (isRetired(row) || !canErase(actor, row)) return;
    const item = toMemoryItem(actor, row);
    const factKey = 'subject' in row ? memoryFactKey(row) : '';
    rows.push({
      item,
      key: memoryTextKey(item.text),
      factKey,
      embedding: embeddingOf(row),
      createdAt: item.createdAt,
      length: item.text.length,
    });
  };
  for (const doc of state.documents) push(doc);
  for (const fact of state.triples) if (fact.isLatest !== false) push(fact);
  const groups = new Map<string, DupRow[]>();
  for (const row of rows) {
    const bucket = `${row.item.containerTag}|${row.item.visibility}`;
    const list = groups.get(bucket) || [];
    list.push(row);
    groups.set(bucket, list);
  }
  const parent = rows.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const unite = (a: number, b: number) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent[right] = left;
  };
  const indexOf = new Map(rows.map((row, index) => [row.item.id, index]));
  for (const group of groups.values()) {
    const byText = new Map<string, number>();
    const byFact = new Map<string, number>();
    for (const row of group) {
      const index = indexOf.get(row.item.id)!;
      if (row.key) {
        const prev = byText.get(row.key);
        if (prev != null) unite(prev, index);
        else byText.set(row.key, index);
      }
      if (row.factKey) {
        const prev = byFact.get(row.factKey);
        if (prev != null) unite(prev, index);
        else byFact.set(row.factKey, index);
      }
    }
    const near = group.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 300);
    for (let i = 0; i < near.length; i += 1) {
      for (let j = i + 1; j < near.length; j += 1) {
        const left = near[i].embedding;
        const right = near[j].embedding;
        if (!left?.length || !right?.length) continue;
        const score = cosine(left, right);
        if (score < threshold) continue;
        unite(indexOf.get(near[i].item.id)!, indexOf.get(near[j].item.id)!);
      }
    }
  }
  const buckets = new Map<number, DupRow[]>();
  rows.forEach((row, index) => {
    const root = find(index);
    const list = buckets.get(root) || [];
    list.push(row);
    buckets.set(root, list);
  });
  const clusters: { reason: 'exact' | 'near'; score: number; keep: MemoryItem; drop: MemoryItem[] }[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const exact = group.some((row) => group.some((other) => other !== row && ((row.key && row.key === other.key) || (row.factKey && row.factKey === other.factKey))));
    let score = exact ? 1 : 0;
    if (!exact) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const left = group[i].embedding;
          const right = group[j].embedding;
          if (!left?.length || !right?.length) continue;
          score = Math.max(score, cosine(left, right));
        }
      }
    }
    const ordered = group.slice().sort((a, b) => {
      const time = String(b.createdAt).localeCompare(String(a.createdAt));
      if (time) return time;
      return b.length - a.length;
    });
    clusters.push({
      reason: exact ? 'exact' : 'near',
      score: Number(score.toFixed(4)),
      keep: ordered[0].item,
      drop: ordered.slice(1).map((row) => row.item),
    });
  }
  const dropIds = clusters.flatMap((cluster) => cluster.drop.map((item) => item.id));
  if (opts.dryRun !== false) {
    audit({ actorId: actor, action: 'preview', memoryId: '', tenantId: homeTag(actor), detail: `duplicates:${dropIds.length}` });
    saveState();
    return { dryRun: true, threshold, clusters, count: dropIds.length, removed: 0 };
  }
  if (!dropIds.length) return { dryRun: false, threshold, clusters, count: 0, removed: 0 };
  const out = retireMemories(actor, dropIds, { permanent: !!opts.permanent });
  return { dryRun: false, threshold, clusters, count: dropIds.length, removed: out.permanent ? out.removed : dropIds.length };
}

export function junkSource(source: string) {
  return JUNK_SOURCE.test(source || '');
}
