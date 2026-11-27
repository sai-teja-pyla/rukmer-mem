import dns from 'dns/promises';
import net from 'net';
import {
  bm25Scores,
  chunkCode,
  chunkText,
  classifyIntent,
  expandQuery,
  getState,
  htmlToText,
  sanitizeMeta,
  saveBlob,
  saveState,
  sha,
  shortestPath,
  uid,
  type ChunkRec,
  type DocRec,
} from './core.js';
import { EMBED_MODEL, embedMany, embedQuery, extractGraph, generateText, hasLlm, heuristicExtract, isNeuralEmbed, llmRerank, localQueryEmbed } from './llm.js';
import { deriveFacts, upsertFacts } from './facts.js';
import { looksLikePdf, textFromPdf, textFromPdfBase64 } from './pdf.js';
import { describeImage } from './vision.js';
import { isChatter, isUsefulFact, looksLikeDurableFact, sanitiseGraph } from './quality.js';
import { applyDecay } from './memory.js';
import { buildMemoryInjection } from './inject.js';
import { canAccessTag, homeTag, ownsTag, scopeFromTag, uidFromTag } from './tenancy.js';
import { readTagsFor, readableSpaces } from './spaces.js';
import { checkUpload, sanitizeName, sanitizePlain } from './security.js';
import { ensureIndex, rankTagged, relatedForMatches, tagCount, vectorDim, type MetaFilter, type Retrieval } from './search-index.js';
import { memoryTextKey, needsMemory, selectMemories } from './relevance.js';
import { assignGovernance, audit, canErase, canRead, eraseBulk, eraseMemory, findMemory, govOf, pickTeam, prepareWrite, teamContainer } from './governance.js';

export type SearchOpts = {
  containerTag?: string | null;
  topK?: number;
  strictness?: number;
  rerank?: boolean;
  rewrite?: boolean;
  includeForgotten?: boolean;
  includeChunks?: boolean;
  includeDocuments?: boolean;
  includeRelated?: boolean;
  filters?: MetaFilter;
  containerTags?: string[];
  retrieval?: Retrieval;
  actorId?: string;
  purpose?: string;
  author?: string;
  since?: string;
  until?: string;
  topic?: string;
};

function scopedChunks(tag?: string | null, includeForgotten = false) {
  if (!tag) return [];
  return getState().chunks.filter((c) => {
    if (c.containerTag !== tag) return false;
    if (!includeForgotten && c.forgotten) return false;
    return true;
  });
}

const SECRET_QUERY = /token|key|code|session|auth|password|secret|sig|signature/i;

export function scrubSavedUrl(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

async function attachChunks(doc: DocRec, text: string) {
  const state = getState();
  const code = /code|javascript|typescript|python|json|x-sh/.test(doc.mime) || /\.(ts|tsx|js|py|go|rs|java)$/i.test(doc.title);
  const pieces = code ? chunkCode(text) : chunkText(text);
  const fresh: { text: string; hash: string; index: number }[] = [];
  pieces.forEach((piece, index) => {
    const hash = sha(doc.containerTag + piece);
    if (state.chunks.some((c) => c.hash === hash && !c.forgotten)) return;
    fresh.push({ text: piece, hash, index });
  });
  const header = `[${doc.title} · ${doc.source}]`;
  const vectors = fresh.length ? await embedMany(fresh.map((p) => `${header}\n${p.text}`)) : [];
  return fresh.map((piece, i) => {
    const chunk: ChunkRec = {
      id: uid('chk'),
      docId: doc.id,
      containerTag: doc.containerTag,
      text: `${header}\n${piece.text}`,
      index: piece.index,
      embedding: vectors[i] || [],
      embeddingModel: isNeuralEmbed(vectors[i]) ? EMBED_MODEL : undefined,
      hash: piece.hash,
      createdAt: doc.createdAt,
      source: doc.source,
      forgotten: false,
      metadata: doc.metadata,
      scope: doc.scope,
      gov: doc.gov ? { ...doc.gov } : undefined,
    };
    state.chunks.push(chunk);
    return chunk;
  });
}

async function extractInto(tag: string, text: string, gov?: DocRec['gov'], originalText = '') {
  const state = getState();
  const graph = await extractGraph(text.slice(0, 8000));
  for (const e of graph.entities || []) {
    const name = String(e.name || '').trim();
    if (!name) continue;
    if (state.entities.some((x) => x.containerTag === tag && x.name.toLowerCase() === name.toLowerCase())) continue;
    state.entities.push({ id: uid('ent'), containerTag: tag, name, type: e.type || 'topic' });
  }
  upsertFacts(tag, graph.triples || [], text.slice(0, 240), gov, originalText || text);
  deriveFacts(tag);
}

export async function ingestDocument(input: {
  title: string;
  text: string;
  containerTag: string;
  source?: string;
  mime?: string;
  task?: 'memory' | 'rag';
  extract?: boolean;
  fileId?: string;
  metadata?: Record<string, string>;
  actorId?: string;
  visibility?: string;
  teamId?: string;
  memoryKind?: string;
  sourceRef?: string;
  extraction?: string;
  originalText?: string;
  durable?: boolean;
}) {
  const raw = sanitizePlain(input.text, 200000).trim();
  if (!raw) throw Object.assign(new Error('Empty document'), { status: 400 });
  let tag = input.containerTag;
  if (!tag) throw new Error('containerTag required');
  const actorId = input.actorId || uidFromTag(tag);
  const gov = actorId
    ? assignGovernance({
        actorId,
        containerTag: tag,
        visibility: input.visibility,
        teamId: input.teamId,
        memoryKind: input.memoryKind,
        sourceRef: input.sourceRef,
        extraction: input.extraction,
        durable: input.durable,
      })
    : undefined;
  if (gov?.visibility === 'team' && gov.teamId) tag = teamContainer(gov.teamId);
  const tenantId = gov?.tenantId || tag;
  const cleaned = prepareWrite(tenantId, raw);
  const titleClean = prepareWrite(tenantId, documentTitle(input.title, raw));
  const text = cleaned.text;
  const keptOriginal = input.originalText ? prepareWrite(tenantId, input.originalText).text.trim().slice(0, 4000) : '';
  if (!text.trim()) throw Object.assign(new Error('Nothing left to store after redaction'), { status: 422 });
  const redacted = [...new Set([...cleaned.redacted, ...titleClean.redacted])];
  if (gov && redacted.length) gov.redacted = redacted;
  const state = getState();
  const sourceRef = String(input.sourceRef || '').slice(0, 200);
  const contentHash = sha(text);
  const metadata = sanitizeMeta({
    ...(input.metadata || {}),
    ...(sourceRef ? { dedupeKey: sourceRef, contentHash } : {}),
  });
  if (metadata?.url) {
    const clean = scrubSavedUrl(metadata.url).slice(0, 200);
    if (clean) metadata.url = clean;
    else delete metadata.url;
  }
  const entityCount = () => getState().entities.filter((e) => e.containerTag === tag).length;
  if (sourceRef) {
    const existing = state.documents.find(
      (d) => !d.forgotten && d.containerTag === tag && (d.gov?.sourceRef === sourceRef || d.metadata?.dedupeKey === sourceRef)
    );
    if (existing) {
      if (actorId && !canErase(actorId, existing)) throw Object.assign(new Error('forbidden'), { status: 403 });
      if (existing.metadata?.contentHash === contentHash || existing.text === text) {
        return { document: existing, chunks: 0, entities: entityCount(), duplicate: true, updated: false, created: false };
      }
      existing.title = titleClean.text || 'Untitled';
      existing.text = text;
      if (keptOriginal) existing.originalText = keptOriginal;
      existing.source = input.source || existing.source;
      existing.mime = input.mime || existing.mime;
      existing.metadata = sanitizeMeta({ ...(existing.metadata || {}), ...(metadata || {}) });
      if (existing.gov) existing.gov.sourceRef = sourceRef;
      for (const chunk of state.chunks) {
        if (chunk.docId !== existing.id || chunk.forgotten) continue;
        chunk.forgotten = true;
        chunk.embedding = [];
        if (chunk.gov) chunk.gov.deletedAt = new Date().toISOString();
      }
      const chunks = await attachChunks(existing, text);
      if (input.task !== 'rag' && input.extract !== false) await extractInto(tag, text, existing.gov, existing.originalText || text);
      state.jobs.push({
        id: uid('job'),
        status: 'done',
        message: `Updated ${existing.title} (${chunks.length} chunks)`,
        at: new Date().toISOString(),
        ownerUid: uidFromTag(tag),
        containerTag: tag,
      });
      if (actorId) {
        audit({
          actorId,
          action: 'write',
          memoryId: existing.id,
          tenantId: existing.gov?.tenantId || tenantId,
          purpose: 'ingest',
          detail: 'updated',
        });
      }
      saveState();
      void embedMissingFacts(12).catch(() => undefined);
      return { document: existing, chunks: chunks.length, entities: entityCount(), duplicate: false, updated: true, created: false };
    }
  }
  const doc: DocRec = {
    id: uid('doc'),
    containerTag: tag,
    title: titleClean.text || 'Untitled',
    source: input.source || 'upload',
    mime: input.mime || 'text/plain',
    text,
    originalText: keptOriginal || undefined,
    createdAt: new Date().toISOString(),
    forgotten: false,
    fileId: input.fileId,
    metadata,
    scope: scopeFromTag(tag),
    gov: gov ? { ...gov } : undefined,
  };
  const chunks = await attachChunks(doc, text);
  state.documents.push(doc);

  if (input.task !== 'rag' && input.extract !== false) await extractInto(tag, text, doc.gov, doc.originalText || text);

  state.jobs.push({
    id: uid('job'),
    status: 'done',
    message: `Ingested ${doc.title} (${chunks.length} chunks)`,
    at: new Date().toISOString(),
    ownerUid: uidFromTag(tag),
    containerTag: tag,
  });
  if (actorId) {
    audit({
      actorId,
      action: 'write',
      memoryId: doc.id,
      tenantId: doc.gov?.tenantId || tenantId,
      purpose: 'ingest',
      detail: redacted.length ? `redacted:${redacted.join(',')}` : doc.gov?.visibility || 'legacy',
    });
  }
  saveState();
  void embedMissingFacts(12).catch(() => undefined);
  return { document: doc, chunks: chunks.length, entities: entityCount(), duplicate: false, updated: false, created: true };
}

const BLOCKED_IMPORT_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function importHost(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
}

function blockedImport(message = 'That host is not allowed') {
  return Object.assign(new Error(message), { status: 400 });
}

export function isBlockedImportAddress(ip: string) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) {
    const parts = ip.split('.').map((part) => Number(part));
    const [a, b, c] = parts;
    if ([a, b, c, parts[3]].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedImportAddress(dotted[1]);
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedImportAddress(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    if (/^fe[89ab]/.test(lower) || /^f[cd]/.test(lower) || lower.startsWith('ff')) return true;
    return false;
  }
  return true;
}

type ImportLookup = (host: string) => Promise<{ address: string }[]>;
let importLookup: ImportLookup = (host) => dns.lookup(host, { all: true, verbatim: true });

export function setImportLookupForTests(fn: ImportLookup | null) {
  importLookup = fn || ((host) => dns.lookup(host, { all: true, verbatim: true }));
}

export function assertPublicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (url.username || url.password) throw blockedImport();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('Only http(s) URLs can be imported'), { status: 400 });
  }
  const host = importHost(url.hostname);
  if (
    !host ||
    BLOCKED_IMPORT_HOSTS.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    isBlockedImportAddress(host)
  ) {
    throw blockedImport();
  }
  return url.toString();
}

export async function assertResolvedPublicUrl(raw: string) {
  const safe = assertPublicHttpUrl(raw);
  const host = importHost(new URL(safe).hostname);
  if (net.isIP(host)) return safe;
  let records: { address: string }[] = [];
  try {
    records = await importLookup(host);
  } catch {
    throw blockedImport();
  }
  if (!records.length || records.some((row) => isBlockedImportAddress(row.address))) throw blockedImport();
  return safe;
}

export async function fetchPublicUrl(raw: string, init: RequestInit = {}) {
  let current = await assertResolvedPublicUrl(raw);
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) throw blockedImport();
    current = await assertResolvedPublicUrl(new URL(location, current).toString());
  }
  throw blockedImport();
}

export async function ingestUrl(url: string, containerTag: string, task?: 'memory' | 'rag') {
  const safe = await assertResolvedPublicUrl(url);
  const res = await fetchPublicUrl(safe, { headers: { 'User-Agent': 'RukmerMemory/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const ctype = res.headers.get('content-type') || '';
  if (looksLikePdf(url, ctype)) {
    const buf = Buffer.from(await res.arrayBuffer());
    const pdf = await textFromPdf(buf);
    return ingestDocument({
      title: safe.split('/').pop() || safe,
      text: pdf.text.slice(0, 200000),
      containerTag,
      source: 'web-pdf',
      mime: 'application/pdf',
      task,
    });
  }
  const raw = await res.text();
  const text = htmlToText(raw).slice(0, 40000);
  return ingestDocument({ title: safe, text, containerTag, source: 'web', mime: 'text/html', task });
}

export async function ingestPayload(item: {
  title?: string;
  name?: string;
  text?: string;
  content?: string;
  pdfBase64?: string;
  imageBase64?: string;
  mime?: string;
  source?: string;
  containerTag: string;
  task?: 'memory' | 'rag';
  metadata?: Record<string, string>;
  videoBase64?: string;
  actorId?: string;
  visibility?: string;
  teamId?: string;
  memoryKind?: string;
  sourceRef?: string;
}) {
  const title = sanitizeName(item.title || item.name || 'Untitled');
  let text = sanitizePlain(item.text || item.content || '', 200000);
  let mime = item.mime || 'text/plain';
  let fileId: string | undefined;
  const image = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp)$/i.test(title);
  const video = /^video\//.test(mime) || /\.(mp4|webm|mov)$/i.test(title);
  if (item.videoBase64 || video) {
    if (!item.videoBase64) throw new Error(`Video ${title} is missing file data`);
    const raw = item.videoBase64.includes(',') ? item.videoBase64.slice(item.videoBase64.indexOf(',') + 1) : item.videoBase64;
    const bytes = Buffer.from(raw, 'base64');
    mime = checkUpload(mime.startsWith('video/') ? mime : 'video/mp4', bytes);
    fileId = uid('file');
    await saveBlob(fileId, bytes, mime);
    text = await describeImage(raw, mime);
  } else if (item.imageBase64 || image) {
    if (!item.imageBase64) throw new Error(`Image ${title} is missing file data`);
    const raw = item.imageBase64.includes(',') ? item.imageBase64.slice(item.imageBase64.indexOf(',') + 1) : item.imageBase64;
    const bytes = Buffer.from(raw, 'base64');
    mime = checkUpload(mime.startsWith('image/') ? mime : 'image/png', bytes);
    fileId = uid('file');
    await saveBlob(fileId, bytes, mime);
    text = await describeImage(raw, mime);
  } else if (item.pdfBase64 || looksLikePdf(title, item.mime)) {
    if (!item.pdfBase64) throw Object.assign(new Error(`PDF ${title} is missing file data`), { status: 400 });
    const raw = item.pdfBase64.includes(',') ? item.pdfBase64.slice(item.pdfBase64.indexOf(',') + 1) : item.pdfBase64;
    const bytes = Buffer.from(raw, 'base64');
    mime = checkUpload('application/pdf', bytes);
    fileId = uid('file');
    await saveBlob(fileId, bytes, 'application/pdf');
    const pdf = await textFromPdfBase64(item.pdfBase64);
    text = pdf.text.slice(0, 200000);
    mime = 'application/pdf';
  }
  return ingestDocument({
    title,
    text,
    containerTag: item.containerTag,
    source: item.source || (mime === 'application/pdf' ? 'pdf' : video ? 'video' : image ? 'image' : 'upload'),
    mime,
    task: item.task,
    fileId,
    metadata: sanitizeMeta(item.metadata),
    actorId: item.actorId,
    visibility: item.visibility,
    teamId: item.teamId,
    memoryKind: item.memoryKind,
    sourceRef: item.sourceRef,
  });
}

function retrievalOf(value?: string): Retrieval {
  return value === 'semantic' || value === 'keyword' ? value : 'hybrid';
}

export async function embedMissingFacts(limit = 16) {
  const state = getState();
  const pending = state.triples.filter((t) => isUsefulFact(t) && !isNeuralEmbed(t.embedding)).slice(0, limit);
  if (!pending.length) return 0;
  const vecs = await embedMany(
    pending.map((t) => `${t.subject} ${t.predicate.replace(/_/g, ' ')} ${t.object}. ${t.evidence || ''}`.slice(0, 1000))
  );
  let wrote = 0;
  pending.forEach((t, i) => {
    if (isNeuralEmbed(vecs[i])) {
      t.embedding = vecs[i];
      wrote += 1;
    }
  });
  if (wrote) saveState();
  return wrote;
}

async function embedMissingChunks(limit = 12) {
  const state = getState();
  const pending = state.chunks.filter((c) => !c.forgotten && c.embeddingModel !== EMBED_MODEL).slice(0, limit);
  if (!pending.length) return 0;
  const vecs = await embedMany(pending.map((c) => c.text.slice(0, 2000)));
  let wrote = 0;
  pending.forEach((c, i) => {
    if (isNeuralEmbed(vecs[i])) {
      c.embedding = vecs[i];
      c.embeddingModel = EMBED_MODEL;
      wrote += 1;
    }
  });
  if (wrote) saveState();
  return wrote;
}

export async function warmFactEmbeddings() {
  for (let i = 0; i < 8; i++) {
    const chunks = await embedMissingChunks(12);
    const facts = await embedMissingFacts(12);
    if (!chunks && !facts) break;
  }
}

function attributionFor(id: string, containerTag?: string) {
  const row = findMemory(id);
  const gov = govOf(row || { containerTag: containerTag || '' });
  const team = gov.teamId ? getState().teams.find((item) => item.id === gov.teamId) : undefined;
  const authorUid = gov.createdBy || gov.ownerId || '';
  const member = team ? getState().teamMembers.find((item) => item.teamId === team.id && item.uid === authorUid) : undefined;
  const space = gov.visibility === 'team' ? 'team' : gov.visibility === 'org' ? 'org' : 'private';
  const authoredAt =
    (row && 'createdAt' in row && row.createdAt) ||
    (row && 'recordedAt' in row && row.recordedAt) ||
    (row && 'validFrom' in row && row.validFrom) ||
    '';
  return {
    space,
    spaceName: space === 'team' ? team?.name || 'Team' : space === 'org' ? gov.tenantId : 'Private',
    teamId: gov.teamId,
    authorUid,
    authorName: member?.displayName || member?.email || authorUid,
    authoredAt: String(authoredAt || ''),
  };
}

export function parseSince(value?: string, now = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const days = /^(\d+)d$/.exec(raw);
  if (days) return now - Number(days[1]) * 86400000;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveTeammate(actor: string, author?: string) {
  const needle = String(author || '').trim().toLowerCase();
  if (!needle) return '';
  if (needle === actor.toLowerCase()) return actor;
  const state = getState();
  const mine = new Set(state.teamMembers.filter((row) => row.uid === actor && row.status !== 'removed').map((row) => row.teamId));
  const match = state.teamMembers.find((row) => {
    if (!mine.has(row.teamId) || row.status === 'removed') return false;
    return [row.uid, row.displayName, row.email].some((value) => String(value || '').trim().toLowerCase() === needle);
  });
  return match?.uid || '';
}

export function listAuthoredMemories(actor: string, opts: SearchOpts = {}) {
  const tags = new Set(readTagsFor(actor, { scope: 'team' }));
  const author = resolveTeammate(actor, opts.author) || actor;
  const since = parseSince(opts.since);
  const until = opts.until ? Date.parse(opts.until) : Number.POSITIVE_INFINITY;
  const topic = String(opts.topic || '').trim().toLowerCase();
  const rows = getState().documents.filter((doc) => {
    if (!tags.has(doc.containerTag) || !canRead(actor, doc)) return false;
    const gov = govOf(doc);
    if (gov.visibility !== 'team') return false;
    if (opts.author && (gov.createdBy || gov.ownerId) !== author) return false;
    const at = Date.parse(doc.createdAt || '');
    if (since && (!Number.isFinite(at) || at < since)) return false;
    if (Number.isFinite(until) && at > until) return false;
    if (topic && !`${doc.title} ${doc.text}`.toLowerCase().includes(topic)) return false;
    return true;
  });
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const matches = rows.slice(0, opts.topK || 10).map((doc) => ({
    id: doc.id,
    title: doc.title,
    text: doc.text,
    score: 1,
    source: doc.source,
    containerTag: doc.containerTag,
    ...attributionFor(doc.id, doc.containerTag),
  }));
  if (matches.length) {
    audit({
      actorId: actor,
      action: 'read',
      memoryId: matches[0].id,
      tenantId: readableSpaces(actor).find((space) => space.kind === 'org')?.orgId || homeTag(actor),
      purpose: opts.purpose || 'search',
      detail: matches
        .slice(0, 25)
        .map((match) => match.id)
        .join(','),
    });
  }
  return { query: '', matches, related: [] as [], tookMs: 0 };
}

export function documentTitle(title: string | undefined, text: string) {
  const given = String(title || '').trim();
  if (given) return given.slice(0, 120);
  const line = String(text || '').split(/\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  return line || 'Note';
}

const AUTO_SAVE_SOURCES = new Set(['gemini-router', 'openai-router', 'anthropic-router', 'grok-router', 'playground', 'conversation']);

function sameStoredText(tag: string, text: string) {
  const key = memoryTextKey(text);
  if (!key) return false;
  return getState().documents.some(
    (doc) => doc.containerTag === tag && !doc.forgotten && (memoryTextKey(doc.text) === key || memoryTextKey(doc.originalText || '') === key)
  );
}

function emptySearch(query: string, started: number, skipReason: string) {
  return {
    query,
    intent: classifyIntent(query),
    matches: [] as {
      id: string;
      docId?: string;
      title: string;
      text: string;
      score: number;
      vectorScore?: number;
      source?: string;
      containerTag?: string;
      createdAt?: string;
      temporal?: string;
      occurredAt?: string | null;
    }[],
    related: [] as [],
    tookMs: Date.now() - started,
    embedMs: 0,
    mode: 'empty',
    channels: { semantic: false, keyword: false, graph: false },
    stats: { chunks: 0, documents: 0 },
    retrievedCount: 0,
    scores: [] as number[],
    tokensInjected: 0,
    skipReason,
  };
}

export async function searchMemory(query: string, opts: SearchOpts = {}) {
  const started = Date.now();
  const retrieval = retrievalOf(opts.retrieval);
  const qRaw = sanitizePlain(query, 2000);
  if (!needsMemory(qRaw)) return emptySearch(qRaw, started, 'no-memory-needed');
  const { normalized, expanded } = expandQuery(qRaw);
  const shortFavourite = /\bfavou?rites?\b|\bfavorites?\b/i.test(normalized) && normalized.split(/\s+/).filter(Boolean).length <= 4;
  const q = opts.rewrite || shortFavourite ? expanded : normalized;
  const topK = opts.topK ?? 10;
  const strict = opts.strictness ?? 0.4;
  const requested = (opts.containerTags?.length ? opts.containerTags : [opts.containerTag]).filter((t): t is string => !!t);
  const tags = opts.actorId
    ? requested.filter((tag) => ownsTag(opts.actorId || '', tag) || readableSpaces(opts.actorId || '').some((space) => space.tag === tag))
    : requested;
  for (const tag of tags) applyDecay(tag);
  const wantVector = retrieval !== 'keyword';
  const embedP = wantVector ? embedQuery(q, retrieval === 'semantic' ? 1800 : 1200) : Promise.resolve([] as number[]);
  ensureIndex();
  const live = getState();
  const has = tags.some((tag) => tagCount(tag) > 0);
  if (!tags.length || !has) {
    void embedP.then(() => undefined).catch(() => undefined);
    return emptySearch(q, started, 'below-threshold');
  }
  const embedStarted = Date.now();
  let qVec = await embedP;
  const dim = wantVector ? vectorDim(tags) : 0;
  if (dim > 256) {
    if (qVec.length !== dim) qVec = [];
  } else if (dim === 256 && qVec.length !== 256) {
    qVec = localQueryEmbed(q);
  } else if (dim && qVec.length && qVec.length !== dim) {
    qVec = [];
  }
  const embedMs = wantVector ? Date.now() - embedStarted : 0;
  const visible = opts.actorId
    ? (id: string) => {
        const row = findMemory(id);
        return !!row && canRead(opts.actorId || '', row);
      }
    : undefined;
  let ranked = rankTagged(q, tags, qVec, {
    topK,
    strict,
    filter: opts.filters,
    includeForgotten: opts.includeForgotten,
    retrieval,
    visible,
  });
  if (opts.rerank && ranked.ranked.length) {
    const llm = await llmRerank(
      q,
      ranked.ranked.slice(0, 8).map((r) => ({ id: r.id, text: r.text }))
    );
    const map = new Map(llm.map((x: { id: string; score: number }) => [x.id, Number(x.score) || 0]));
    ranked = {
      ...ranked,
      ranked: [...ranked.ranked]
        .map((r) => ({ ...r, score: r.score * 0.6 + (map.get(r.id) || 0) * 0.4 }))
        .sort((a, b) => b.score - a.score),
    };
  }
  const rankedMatches = ranked.ranked.map((r) => ({
    id: r.id,
    docId: r.docId,
    title: r.title || 'Untitled',
    text: r.text,
    score: Number(r.score.toFixed(4)),
    vectorScore: Number(r.vectorScore.toFixed(4)),
    source: r.source,
    containerTag: r.tag,
    createdAt: r.createdAt,
    temporal: r.temporal,
    occurredAt: r.occurredAt,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
  }));
  const matches = selectMemories(qRaw || q, rankedMatches, { strictness: strict, topK }).map((match) => ({
    ...match,
    ...attributionFor(match.id, match.containerTag),
  }));
  if (opts.actorId && matches.length) {
    const teamHit = matches.find((match) => match.space === 'team');
    audit({
      actorId: opts.actorId,
      action: 'read',
      memoryId: matches[0].id,
      tenantId: teamHit?.teamId ? readableSpaces(opts.actorId).find((space) => space.teamId === teamHit.teamId)?.orgId || homeTag(opts.actorId) : homeTag(opts.actorId),
      purpose: opts.purpose || 'search',
      detail: matches
        .slice(0, 25)
        .map((match) => match.id)
        .join(','),
    });
  }
  const related = opts.includeRelated === false || !matches.length ? [] : relatedForMatches(matches, { visible });
  const scores = matches.map((match) => Number(match.score) || 0);
  return {
    query: q,
    intent: classifyIntent(q),
    timeIntent: ranked.intent,
    matches,
    related,
    tookMs: Date.now() - started,
    embedMs,
    mode: retrieval === 'hybrid' && !qVec.length ? 'keyword' : retrieval,
    channels: ranked.channels,
    stats: {
      chunks: tags.reduce((n, tag) => n + live.chunks.filter((c) => c.containerTag === tag && !c.forgotten).length, 0),
      documents: tags.reduce((n, tag) => n + live.documents.filter((d) => d.containerTag === tag && !d.forgotten).length, 0),
      ...ranked.stats,
    },
    retrievedCount: matches.length,
    scores,
    tokensInjected: Math.ceil(matches.reduce((n, match) => n + String(match.text || '').length, 0) / 4),
    skipReason: matches.length ? '' : 'below-threshold',
  };
}

export type ChatTurn = { role: 'user' | 'assistant' | 'system'; content: string };

export async function commitImportantMemory(input: {
  containerTag: string;
  source?: string;
  title?: string;
  text: string;
  actorId?: string;
  visibility?: string;
  scope?: string;
  teamId?: string;
  metadata?: Record<string, string>;
}) {
  const scope = input.scope === 'team' || input.visibility === 'team' ? 'team' : 'private';
  const team = scope === 'team' && input.actorId ? pickTeam(input.actorId, input.teamId) : undefined;
  const tag = team ? teamContainer(team.id) : input.containerTag;
  const raw = String(input.text || '').trim();
  if (!tag) throw new Error('containerTag required');
  if (!raw) return { skipped: true, reason: 'empty', facts: 0, document: null };
  if (isChatter(raw) && !looksLikeDurableFact(raw)) {
    return { skipped: true, reason: 'not-durable', facts: 0, document: null };
  }
  const quick = sanitiseGraph(heuristicExtract(raw));
  const graph = quick.triples.length ? quick : await extractGraph(raw).catch(() => quick);
  if (quick.triples.length) {
    void extractGraph(raw)
      .then((rich) => upsertFacts(tag, rich.triples || [], raw.slice(0, 240), undefined, raw))
      .catch(() => undefined);
  }
  const triples = (graph.triples || []).filter(isUsefulFact);
  const autoSave = AUTO_SAVE_SOURCES.has(String(input.source || ''));
  if (!triples.length) {
    if (autoSave) return { skipped: true, reason: 'not-durable', facts: 0, document: null };
    if (sameStoredText(tag, raw)) return { skipped: true, reason: 'duplicate', facts: 0, document: null };
    const doc = await ingestDocument({
      title: input.title || raw.slice(0, 80),
      text: raw,
      originalText: raw,
      containerTag: tag,
      source: input.source || 'memory',
      mime: 'text/plain',
      task: 'memory',
      extract: false,
      actorId: input.actorId,
      visibility: scope === 'team' ? 'team' : input.visibility,
      teamId: team?.id,
      memoryKind: scope === 'team' || input.source === 'tool' ? (scope === 'team' ? 'decision' : 'fact') : 'context',
      durable: scope === 'team' || input.source === 'tool',
      metadata: input.metadata,
    });
    if (!autoSave) noteConversation(tag, raw);
    return { saved: true, skipped: false, type: 'raw', facts: 0, document: doc.document, chunks: doc.chunks };
  }
  const text = triples
    .map((t) => `${t.subject} ${String(t.predicate).replace(/_/g, ' ')} ${t.object}.`)
    .join('\n');
  const state = getState();
  for (const e of graph.entities || []) {
    const name = String(e.name || '').trim();
    if (!name || !triples.some((t) => t.subject === name || t.object === name)) continue;
    if (state.entities.some((x) => x.containerTag === tag && x.name.toLowerCase() === name.toLowerCase())) continue;
    state.entities.push({ id: uid('ent'), containerTag: tag, name, type: e.type || 'topic' });
  }
  const saved = upsertFacts(
    tag,
    triples,
    text.slice(0, 240),
    input.actorId
      ? assignGovernance({
          actorId: input.actorId,
          containerTag: tag,
          visibility: scope === 'team' ? 'team' : input.visibility,
          teamId: team?.id,
          memoryKind: 'fact',
          durable: scope === 'team' || input.source === 'tool',
        })
      : undefined,
    raw
  );
  deriveFacts(tag);
  if (sameStoredText(tag, text) || sameStoredText(tag, raw)) {
    return { skipped: true, reason: 'duplicate', facts: triples.length, triples, saved, document: null };
  }
  const doc = await ingestDocument({
    title: input.title || text.split('\n')[0].slice(0, 80),
    text,
    originalText: raw,
    containerTag: tag,
    source: input.source || 'memory',
    mime: 'text/plain',
    task: 'memory',
    extract: false,
    actorId: input.actorId,
    visibility: scope === 'team' ? 'team' : input.visibility,
    teamId: team?.id,
    memoryKind: 'fact',
    durable: scope === 'team' || input.source === 'tool',
    metadata: input.metadata,
  });
  noteConversation(tag, raw);
  return { skipped: false, facts: triples.length, triples, saved, document: doc.document, chunks: doc.chunks };
}

const convoBuf = new Map<string, string[]>();
export let consolidationPasses = 0;

export function noteConversation(tag: string, text: string) {
  const body = String(text || '');
  if (!body.trim() || /\bassistant\s*:/i.test(body) || body.includes('\nAgreed:\n')) return;
  const buf = convoBuf.get(tag) || [];
  buf.push(body.slice(0, 2000));
  if (buf.length > 12) buf.shift();
  convoBuf.set(tag, buf);
  if (buf.length >= 4) {
    const blob = buf.join('\n');
    convoBuf.set(tag, []);
    void flushConsolidation(tag, blob).catch(() => undefined);
  }
}

export async function flushConsolidation(tag: string, preset?: string) {
  const blob = preset ?? (convoBuf.get(tag) || []).join('\n');
  if (!preset) convoBuf.set(tag, []);
  if (!blob.trim()) return { facts: 0 };
  consolidationPasses += 1;
  const quick = sanitiseGraph(heuristicExtract(blob));
  const graph =
    process.env.RUKMER_LOCAL_EXTRACT === '1' || !hasLlm()
      ? quick
      : await extractGraph(blob.slice(0, 12000)).catch(() => quick);
  const triples = (graph.triples?.length ? graph.triples : quick.triples).filter(isUsefulFact);
  if (!triples.length) return { facts: 0, passes: consolidationPasses };
  const saved = upsertFacts(tag, triples, blob.slice(0, 400));
  deriveFacts(tag);
  return { facts: triples.length, saved, passes: consolidationPasses };
}

export async function rememberTranscript(input: {
  containerTag?: string;
  source?: string;
  title?: string;
  messages: { role?: string; content?: string; text?: string }[];
  actorId?: string;
  visibility?: string;
  teamId?: string;
}) {
  const tag = input.containerTag;
  if (!tag) throw new Error('containerTag required');
  const turns = (input.messages || [])
    .map((m) => ({ role: String(m.role || 'user'), text: String(m.content || m.text || '').trim() }))
    .filter((m) => m.text);
  if (!turns.length) throw new Error('No messages to remember');
  const userText = turns
    .filter((m) => m.role === 'user' || m.role === 'human')
    .map((m) => m.text)
    .join('\n')
    .trim();
  if (!userText || !looksLikeDurableFact(userText)) {
    return { skipped: true, reason: 'not-durable', facts: 0, document: null };
  }
  const source = String(input.source || 'conversation');
  return commitImportantMemory({
    containerTag: tag,
    source: /-router$/.test(source) ? 'conversation' : source,
    title: input.title,
    text: userText.slice(0, 4000),
    actorId: input.actorId,
    visibility: input.visibility,
    teamId: input.teamId,
    scope: input.visibility === 'team' ? 'team' : undefined,
    metadata: { extractedFrom: 'user' },
  });
}

export async function chatWithMemory(
  query: string,
  opts: SearchOpts & { history?: ChatTurn[]; remember?: boolean; source?: string } = {}
) {
  const tag = opts.containerTag;
  if (!tag) throw new Error('containerTag required');
  const mem = await buildMemoryInjection(query, tag, { ...opts, topK: opts.topK ?? 8 });
  const retrieved = mem.retrieved;
  const history = (opts.history || [])
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  let answer: string;
  if (hasLlm()) {
    try {
      answer = await generateText(
        `${mem.injection}\n\nConversation so far:\n${history || '(new thread)'}\n\nLatest user message: ${query}`,
        mem.system
      );
    } catch (e: any) {
      answer = retrieved.matches.length
        ? `Model call failed (${e.message}). From memory:\n\n${retrieved.matches.map((m) => `• ${m.text.slice(0, 280)}`).join('\n\n')}`
        : `I couldn't reach Gemini (${e.message}).`;
    }
  } else if (retrieved.matches.length) {
    answer = `Here's what I found in memory:\n\n${retrieved.matches.map((m) => `• ${m.text.slice(0, 280)}`).join('\n\n')}`;
  } else {
    answer = 'The memory engine is up, but no LLM key is configured yet, so I can only search stored text. Add GEMINI_API_KEY or import documents.';
  }

  if (opts.remember !== false && query.trim()) {
    void rememberTranscript({
      containerTag: tag,
      source: opts.source && !/-router$/.test(opts.source) ? opts.source : 'conversation',
      messages: [{ role: 'user', content: query }],
      actorId: opts.actorId,
    }).catch(() => undefined);
  }
  return { answer, retrieved, injection: mem.injection, graph: graphPayload(tag, opts.actorId) };
}

function summarizeTag(tag: string, uid?: string) {
  const state = getState();
  const docs = state.documents.filter((d) => d.containerTag === tag && !d.forgotten && (!uid || canRead(uid, d)));
  const sites = new Set<string>();
  let browserItems = 0;
  for (const doc of docs) {
    if (doc.source === 'gmail') sites.add('gmail');
    if (doc.source !== 'browser-extension') continue;
    browserItems += 1;
    sites.add(doc.metadata?.site || 'browser');
  }
  return {
    tag,
    documents: docs.length,
    memories: state.chunks.filter((c) => c.containerTag === tag && !c.forgotten && (!uid || canRead(uid, c))).length,
    activity: docs.map((d) => d.createdAt).sort().pop(),
    browserItems,
    sites: [...sites],
  };
}

export function listTags(uid?: string, scope: 'all' | 'private' | 'team' = 'all') {
  const state = getState();
  const spaces = uid ? readableSpaces(uid) : [];
  const scoped = spaces.filter((space) => scope === 'all' || (scope === 'private' ? space.kind === 'private' : space.kind === 'team'));
  const allowed = new Set(scoped.map((space) => space.tag));
  const visible = (tag: string) => {
    if (!uid) return true;
    if (scope === 'private') return ownsTag(uid, tag);
    if (scope === 'team') return allowed.has(tag);
    return ownsTag(uid, tag) || allowed.has(tag);
  };
  const tags = [
    ...new Set([
      ...allowed,
      ...state.documents.map((d) => d.containerTag),
    ]),
  ].filter(visible);
  const rows = tags.map((tag) => summarizeTag(tag, uid));
  if (uid && scope !== 'team') {
    const home = homeTag(uid);
    if (!rows.some((r) => r.tag === home)) rows.unshift({ tag: home, documents: 0, memories: 0, activity: undefined, browserItems: 0, sites: [] });
  }
  return rows;
}

export function readDocument(id: string, uid?: string) {
  const doc = getState().documents.find((d) => d.id === id && !d.forgotten);
  if (!doc) return null;
  if (uid && !canRead(uid, doc)) return null;
  if (uid) audit({ actorId: uid, action: 'read', memoryId: doc.id, tenantId: govOf(doc).tenantId, purpose: 'document' });
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    mime: doc.mime,
    createdAt: doc.createdAt,
    containerTag: doc.containerTag,
    chars: (doc.text || '').length,
    folder: folderOf(doc),
    text: String(doc.text || '').slice(0, 20000),
    originalText: doc.originalText || '',
  };
}

export function listDocuments(containerTag?: string | null, uid?: string) {
  return getState()
    .documents.filter((d) => {
      if (containerTag && d.containerTag !== containerTag) return false;
      if (uid && !canRead(uid, d)) return false;
      if (!uid && d.forgotten) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      mime: d.mime,
      createdAt: d.createdAt,
      containerTag: d.containerTag,
      fileId: d.fileId,
      chars: (d.text || '').length,
      folder: folderOf(d),
      preview: String(d.text || '').slice(0, 4000),
      originalText: d.originalText || '',
    }));
}

export function folderOf(d: { source?: string; mime?: string; title?: string; containerTag?: string }) {
  if (d.source === 'pdf' || d.mime === 'application/pdf') return 'PDFs';
  if (d.source === 'image' || String(d.mime || '').startsWith('image/')) return 'Images';
  if (d.source === 'video' || String(d.mime || '').startsWith('video/')) return 'Videos';
  if (d.source === 'browser-extension') return 'Browser';
  if (d.source === 'gmail') return 'Gmail';
  if (d.source === 'github' || d.source === 'notion' || d.source === 's3' || d.source === 'web') return 'Connectors';
  if (d.source === 'conversation' || d.source === 'playground' || d.source === 'memory') return 'Chats';
  if (/\.(ts|tsx|js|py|go|rs|java)$/i.test(d.title || '') || /code|javascript|typescript|python/.test(d.mime || '')) return 'Code';
  return d.containerTag?.includes('--') ? 'Projects' : 'Documents';
}

function addedAt(facts: { recordedAt?: string; updatedAt?: string; validFrom?: string }[]) {
  const stamped = facts.flatMap((f) => [f.recordedAt, f.updatedAt]).filter(Boolean) as string[];
  const basis = stamped.length ? stamped : (facts.map((f) => f.validFrom).filter(Boolean) as string[]);
  return basis.sort().at(-1);
}

export function graphPayload(containerTag?: string | null, uid?: string, scope: 'all' | 'private' | 'team' = 'all') {
  const state = getState();
  const tags = new Set<string>();
  const spaceOk = (kind: string) => scope === 'all' || (scope === 'private' ? kind === 'private' : kind === 'team');
  const kindOf = (tag: string) => (tag.startsWith('tm_') ? 'team' : tag.startsWith('org_') ? 'org' : 'private');
  if (containerTag) {
    if ((!uid || canAccessTag(uid, containerTag)) && spaceOk(kindOf(containerTag))) tags.add(containerTag);
  } else if (uid) {
    for (const space of readableSpaces(uid)) if (spaceOk(space.kind)) tags.add(space.tag);
    if (scope !== 'team') {
      for (const d of state.documents) if (ownsTag(uid, d.containerTag)) tags.add(d.containerTag);
    }
  }
  if (!tags.size) return { nodes: [], edges: [], pathExample: null, tags: [] as string[] };
  const inScope = (tag: string) => tags.has(tag);
  const triples = state.triples.filter((t) => inScope(t.containerTag) && (!uid || canRead(uid, t)));
  const keep = new Set(triples.flatMap((t) => [t.subject.toLowerCase(), t.object.toLowerCase()]));
  const entities = state.entities.filter((e) => inScope(e.containerTag) && (keep.size === 0 || keep.has(e.name.toLowerCase())));
  const docs = state.documents.filter((d) => inScope(d.containerTag) && (!uid || canRead(uid, d)) && (uid || !d.forgotten));

  const byName = new Map<string, string>();
  for (const e of entities) {
    const key = e.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, e.id);
  }

  const extraNodes: { id: string; label: string; kind: 'memory'; type: string }[] = [];
  const nodeIdFor = (name: string) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return '';
    if (byName.has(key)) return byName.get(key)!;
    const id = `lit_${sha(key).slice(0, 12)}`;
    byName.set(key, id);
    extraNodes.push({ id, label: name, kind: 'memory', type: 'mention' });
    return id;
  };

  const factRow = (t: (typeof triples)[number]) => ({
    id: t.id,
    subject: t.subject,
    predicate: t.predicate,
    object: t.object,
    evidence: t.evidence,
    originalText: t.originalText || '',
    isLatest: t.isLatest !== false,
    derived: !!t.derived,
    containerTag: t.containerTag,
    horizon: t.horizon,
    validFrom: t.validFrom,
    validTo: t.validTo,
    recordedAt: t.recordedAt,
    updatedAt: t.updatedAt,
  });

  const factsAbout = (name: string) => {
    const key = String(name || '').trim().toLowerCase();
    return triples.filter((t) => t.subject.toLowerCase() === key || t.object.toLowerCase() === key).map(factRow);
  };

  const edges = triples
    .map((t) => {
      const source = nodeIdFor(t.subject);
      const target = nodeIdFor(t.object);
      if (!source || !target || source === target) return null;
      return {
        id: t.id,
        source,
        target,
        label: t.predicate,
        isLatest: t.isLatest !== false,
        derived: !!t.derived,
        subject: t.subject,
        object: t.object,
        evidence: t.evidence,
        containerTag: t.containerTag,
      };
    })
    .filter(Boolean) as {
      id: string;
      source: string;
      target: string;
      label: string;
      isLatest: boolean;
      derived: boolean;
      subject: string;
      object: string;
      evidence: string;
      containerTag: string;
    }[];

  for (const doc of docs.slice(0, 12)) {
    const hay = `${doc.title}\n${doc.text}`.toLowerCase();
    for (const e of entities) {
      if (e.name.length > 3 && hay.includes(e.name.toLowerCase())) {
        edges.push({
          id: `docent_${doc.id}_${e.id}`,
          source: doc.id,
          target: e.id,
          label: 'mentions',
          isLatest: true,
          derived: false,
          subject: doc.title,
          object: e.name,
          evidence: '',
          containerTag: doc.containerTag,
        });
      }
    }
  }

  return {
    nodes: [
      ...docs.map((d) => ({
        id: d.id,
        label: d.title,
        kind: 'document' as const,
        source: d.source,
        mime: d.mime,
        site: d.metadata?.site || '',
        browser: d.metadata?.browser || '',
        captureType: d.metadata?.capture_type || '',
        containerTag: d.containerTag,
        createdAt: d.createdAt,
        text: String(d.text || '').slice(0, 4000),
        originalText: d.originalText || '',
        facts: factsAbout(d.title),
      })),
      ...docs
        .filter((d) => {
          const original = String(d.originalText || '').trim();
          if (!original) return false;
          return !triples.some((t) => t.containerTag === d.containerTag && String(t.originalText || '').trim() === original);
        })
        .map((d) => ({
          id: `note_${d.id}`,
          label: documentTitle('', String(d.originalText || d.text || '')),
          kind: 'memory' as const,
          type: 'note',
          source: d.source,
          containerTag: d.containerTag,
          createdAt: d.createdAt,
          text: d.originalText || '',
          originalText: d.originalText || '',
          facts: [] as ReturnType<typeof factRow>[],
        })),
      ...entities.map((e) => {
        const facts = factsAbout(e.name);
        return {
          id: e.id,
          label: e.name,
          kind: 'memory' as const,
          type: e.type,
          containerTag: e.containerTag,
          createdAt: addedAt(facts),
          text: '',
          originalText: facts.find((f) => f.originalText)?.originalText || '',
          facts,
        };
      }),
      ...extraNodes.map((n) => {
        const facts = factsAbout(n.label);
        return {
          ...n,
          containerTag: facts[0]?.containerTag,
          createdAt: addedAt(facts),
          originalText: facts.find((f) => f.originalText)?.originalText || '',
          facts,
        };
      }),
    ],
    edges,
    pathExample: triples[0] ? shortestPath(triples, triples[0].subject, triples[0].object, triples[0].containerTag) : null,
    tags: [...tags],
  };
}

export function forgetById(id: string, uid?: string) {
  if (!uid) {
    const row = findMemory(id);
    if (!row) return { ok: true, removed: 0 };
    const out = eraseMemory(uidFromTag(row.containerTag) || 'system', id);
    for (const tag of out.tags || []) convoBuf.delete(tag);
    return { ok: out.ok, error: out.error, removed: out.removed };
  }
  const out = eraseMemory(uid, id);
  for (const tag of out.tags || []) convoBuf.delete(tag);
  return { ok: out.ok, error: out.error, removed: out.removed };
}

export function forgetOwner(actor: string, ownerId: string, dryRun = false) {
  const out = eraseBulk(actor, 'owner', ownerId, dryRun);
  for (const tag of out.tags || []) convoBuf.delete(tag);
  return out;
}

export function forgetTenant(actor: string, tenantId: string, dryRun = false) {
  const out = eraseBulk(actor, 'tenant', tenantId, dryRun);
  for (const tag of out.tags || []) convoBuf.delete(tag);
  return out;
}

export function forgetMatching(query: string, containerTag?: string | null, dryRun = false, actor = '') {
  const q = query.trim().toLowerCase();
  if (!q) throw Object.assign(new Error('query required'), { status: 400 });
  if (!actor) throw Object.assign(new Error('Sign in required'), { status: 401 });
  if (!containerTag) return { count: 0, ids: [] as string[], dryRun };
  const chunks = scopedChunks(containerTag, false).filter((c) => c.text.toLowerCase().includes(q) && canErase(actor, c));
  const facts = getState().triples.filter(
    (t) =>
      t.containerTag === containerTag &&
      t.isLatest !== false &&
      canErase(actor, t) &&
      `${t.subject} ${t.predicate} ${t.object} ${t.evidence}`.toLowerCase().includes(q)
  );
  if (!dryRun) {
    chunks.forEach((c) => {
      c.forgotten = true;
      c.embedding = [];
      if (c.gov) c.gov.deletedAt = new Date().toISOString();
    });
    const now = new Date().toISOString();
    for (const fact of facts) {
      fact.isLatest = false;
      fact.validTo = now;
      fact.embedding = [];
      if (fact.gov) fact.gov.deletedAt = now;
    }
    saveState();
  }
  const ids = [...chunks.map((c) => c.id), ...facts.map((t) => t.id)];
  return { count: ids.length, ids, dryRun };
}

export function stats(uid?: string) {
  const s = getState();
  const mine = (row: { containerTag: string; forgotten?: boolean; gov?: DocRec['gov'] }) => !uid || canRead(uid, row);
  return {
    documents: s.documents.filter((d) => mine(d)).length,
    chunks: s.chunks.filter((c) => mine(c)).length,
    entities: s.entities.filter((e) => !uid || canAccessTag(uid, e.containerTag)).length,
    triples: s.triples.filter((t) => mine(t)).length,
    latestFacts: s.triples.filter((t) => t.isLatest !== false && mine(t)).length,
    embeddings: s.chunks.filter((c) => c.embedding.length && mine(c)).length,
    requests: uid ? s.requests.filter((r) => r.ownerUid === uid).length : s.requests.length,
    llm: hasLlm(),
  };
}

const REQUEST_WINDOW_MS = 7 * 86400000;

export function keptRequests<T extends { at: string }>(rows: T[], now = Date.now()) {
  const cutoff = now - REQUEST_WINDOW_MS;
  return rows
    .filter((row) => {
      const at = Date.parse(row.at);
      return Number.isFinite(at) && at >= cutoff;
    })
    .slice(0, 4000);
}

const CONSOLE_READS = new Set([
  '/v3/tags',
  '/v3/stats',
  '/v3/insights',
  '/v3/jobs',
  '/v3/requests',
  '/v3/keys',
  '/v3/me',
  '/v4/graph',
  '/v4/security',
  '/v4/profile',
  '/v4/protocol',
  '/v4/tools',
  '/v4/governance',
  '/v4/governance/audit',
  '/v4/teams',
  '/v4/connectors/apps',
  '/v4/connectors/browser',
  '/v4/client',
  '/v4/path',
  '/v4/orgs',
]);

/** Customer usage. Page loads are not requests the user made. */
export function usageEvent(method: string, path: string) {
  const verb = String(method || 'GET').toUpperCase();
  const clean = String(path || '').split('?')[0];
  if (verb === 'GET' && (CONSOLE_READS.has(clean) || clean.startsWith('/v4/teams/'))) return { record: false, type: 'read' };
  let type = 'other';
  if (clean.includes('/search')) type = 'search';
  else if (clean.includes('/chat') || clean.includes('/completions') || clean.includes('/messages') || clean.includes('generateContent')) type = 'chat';
  else if (verb !== 'GET' && (clean.includes('/document') || clean.includes('/remember') || clean.includes('/import'))) type = 'ingest';
  else if (verb === 'GET') type = 'read';
  return { record: true, type };
}

export function logRequest(rec: { method: string; path: string; status: number; ms: number; type: string; ownerUid?: string }) {
  const s = getState();
  s.requests.unshift({ id: uid('req'), at: new Date().toISOString(), ...rec });
  s.requests = keptRequests(s.requests);
  saveState();
}

export function moveMemory(actor: string, id: string, to: 'private' | 'team', teamId?: string) {
  const state = getState();
  const doc = state.documents.find((row) => row.id === id) || null;
  const triple = !doc ? state.triples.find((row) => row.id === id) : null;
  const row = doc || triple;
  if (!row) throw Object.assign(new Error('Memory not found'), { status: 404 });
  const gov = govOf(row);
  if (gov.createdBy !== actor && gov.ownerId !== actor) throw Object.assign(new Error('Only the author can move this memory'), { status: 403 });
  const from = row.containerTag;
  const team = to === 'team' ? pickTeam(actor, teamId) : undefined;
  const target = to === 'private' ? homeTag(actor) : teamContainer(team!.id);
  const nextGov = assignGovernance({
    actorId: actor,
    containerTag: ownsTag(actor, from) ? from : target,
    visibility: to,
    teamId: team?.id,
    memoryKind: gov.memoryKind,
    sourceRef: gov.sourceRef,
    durable: true,
  });
  const blob = doc ? `${doc.title}\n${doc.text}\n${doc.originalText || ''}` : `${triple?.subject} ${triple?.object} ${triple?.evidence}`;
  const moved: string[] = [];
  const retag = (item: { id: string; containerTag: string; gov?: DocRec['gov'] }) => {
    item.containerTag = target;
    item.gov = { ...nextGov };
    moved.push(item.id);
  };
  if (doc) {
    retag(doc);
    for (const chunk of state.chunks) if (chunk.docId === doc.id) retag(chunk);
  }
  for (const fact of state.triples) {
    if (fact.containerTag !== from && fact.id !== triple?.id) continue;
    const factText = `${fact.subject} ${fact.object} ${fact.evidence} ${fact.originalText || ''}`;
    if (fact.id === triple?.id || (doc && (fact.originalText === doc.originalText || (factText && blob.includes(fact.object))))) retag(fact);
  }
  for (const entity of state.entities) {
    if (entity.containerTag === from && entity.memoryIds?.some((memoryId) => moved.includes(memoryId))) entity.containerTag = target;
  }
  audit({ actorId: actor, action: 'move', memoryId: id, tenantId: nextGov.tenantId, detail: `${from}->${target}` });
  saveState();
  return { id, from, tag: target, moved: moved.length };
}

export function exportMine(uid: string) {
  const s = getState();
  const mine = (row: { containerTag: string; forgotten?: boolean; gov?: DocRec['gov'] }) => canRead(uid, row);
  audit({ actorId: uid, action: 'export', memoryId: '', tenantId: homeTag(uid), purpose: 'export' });
  return {
    exportedAt: new Date().toISOString(),
    documents: s.documents
      .filter((d) => mine(d))
      .map((d) => ({
        id: d.id,
        title: d.title,
        source: d.source,
        mime: d.mime,
        containerTag: d.containerTag,
        createdAt: d.createdAt,
        text: String(d.text || '').slice(0, 8000),
      })),
    facts: s.triples
      .filter((t) => t.isLatest !== false && mine(t))
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        predicate: t.predicate,
        object: t.object,
        evidence: t.evidence,
        containerTag: t.containerTag,
      })),
  };
}

export function resetMine(uid: string) {
  const s = getState();
  const mine = (row: { containerTag: string; gov?: DocRec['gov'] }) => ownsTag(uid, row.containerTag) || govOf(row).ownerId === uid;
  const documents = s.documents.filter(mine).length;
  const facts = s.triples.filter(mine).length;
  forgetOwner(uid, uid, false);
  return { ok: true, documents, facts };
}

export function insights(uid?: string) {
  const s = getState();
  const tags = listTags(uid);
  const mine = (tag: string) => !uid || canAccessTag(uid, tag);
  return {
    activeUsers: 1,
    memories: s.chunks.filter((c) => !c.forgotten && mine(c.containerTag)).length,
    queries: s.requests.filter((r) => r.ownerUid === uid && (r.path.includes('search') || r.path.includes('chat'))).length,
    documents: listDocuments(undefined, uid),
    folders: folderSummary(uid),
    tags,
  };
}

function folderSummary(uid?: string) {
  const docs = listDocuments(undefined, uid);
  const map = new Map<string, number>();
  for (const d of docs) map.set(d.folder, (map.get(d.folder) || 0) + 1);
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
