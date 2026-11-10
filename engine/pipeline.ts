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
import { checkUpload, sanitizeName, sanitizePlain } from './security.js';
import { ensureIndex, rankTagged, tagCount, vectorDim, type MetaFilter, type Retrieval } from './search-index.js';
import { selectMemories } from './relevance.js';
import { assignGovernance, audit, canRead, eraseBulk, eraseMemory, findMemory, govOf, prepareWrite, teamContainer } from './governance.js';

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
};

function scopedChunks(tag?: string | null, includeForgotten = false) {
  if (!tag) return [];
  return getState().chunks.filter((c) => {
    if (c.containerTag !== tag) return false;
    if (!includeForgotten && c.forgotten) return false;
    return true;
  });
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
}) {
  const raw = sanitizePlain(input.text, 200000).trim();
  if (!raw) throw new Error('Empty document');
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
      })
    : undefined;
  if (gov?.visibility === 'team' && gov.teamId) tag = teamContainer(gov.teamId);
  const tenantId = gov?.tenantId || tag;
  const cleaned = prepareWrite(tenantId, raw);
  const titleClean = prepareWrite(tenantId, input.title || 'Untitled');
  const text = cleaned.text;
  if (!text.trim()) throw Object.assign(new Error('Nothing left to store after redaction'), { status: 422 });
  const redacted = [...new Set([...cleaned.redacted, ...titleClean.redacted])];
  if (gov && redacted.length) gov.redacted = redacted;
  const state = getState();
  const doc: DocRec = {
    id: uid('doc'),
    containerTag: tag,
    title: titleClean.text || 'Untitled',
    source: input.source || 'upload',
    mime: input.mime || 'text/plain',
    text,
    createdAt: new Date().toISOString(),
    forgotten: false,
    fileId: input.fileId,
    metadata: sanitizeMeta(input.metadata),
    scope: scopeFromTag(tag),
    gov: gov ? { ...gov } : undefined,
  };
  const code = /code|javascript|typescript|python|json|x-sh/.test(doc.mime) || /\.(ts|tsx|js|py|go|rs|java)$/i.test(doc.title);
  const pieces = code ? chunkCode(text) : chunkText(text);
  const fresh: { text: string; hash: string; index: number }[] = [];
  pieces.forEach((piece, index) => {
    const hash = sha(tag + piece);
    if (state.chunks.some((c) => c.hash === hash && !c.forgotten)) return;
    fresh.push({ text: piece, hash, index });
  });
  const header = `[${doc.title} · ${doc.source}]`;
  const vectors = fresh.length ? await embedMany(fresh.map((p) => `${header}\n${p.text}`)) : [];
  const chunks: ChunkRec[] = fresh.map((piece, i) => ({
    id: uid('chk'),
    docId: doc.id,
    containerTag: tag,
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
  }));
  state.documents.push(doc);
  state.chunks.push(...chunks);

  if (input.task !== 'rag' && input.extract !== false) {
    const graph = await extractGraph(text.slice(0, 8000));
    for (const e of graph.entities || []) {
      const name = String(e.name || '').trim();
      if (!name) continue;
      if (state.entities.some((x) => x.containerTag === tag && x.name.toLowerCase() === name.toLowerCase())) continue;
      state.entities.push({ id: uid('ent'), containerTag: tag, name, type: e.type || 'topic' });
    }
    upsertFacts(tag, graph.triples || [], text.slice(0, 240), doc.gov);
    deriveFacts(tag);
  }

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
  return { document: doc, chunks: chunks.length, entities: getState().entities.filter((e) => e.containerTag === tag).length };
}

export function assertPublicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('Only http(s) URLs can be imported'), { status: 400 });
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === 'metadata.google.internal' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.|::1$)/.test(host);
  if (blocked) throw Object.assign(new Error('That host is not allowed'), { status: 400 });
  return url.toString();
}

export async function ingestUrl(url: string, containerTag: string, task?: 'memory' | 'rag') {
  const safe = assertPublicHttpUrl(url);
  const res = await fetch(safe, { headers: { 'User-Agent': 'RukmerMemory/1.0' } });
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
    if (!item.pdfBase64) throw new Error(`PDF ${title} is missing file data`);
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

export async function searchMemory(query: string, opts: SearchOpts = {}) {
  const started = Date.now();
  const retrieval = retrievalOf(opts.retrieval);
  const qRaw = sanitizePlain(query, 2000);
  const { normalized, expanded } = expandQuery(qRaw);
  const q = opts.rewrite ? expanded : normalized;
  const topK = opts.topK ?? 10;
  const strict = opts.strictness ?? 0.4;
  const tags = (opts.containerTags?.length ? opts.containerTags : [opts.containerTag]).filter((t): t is string => !!t);
  for (const tag of tags) applyDecay(tag);
  const wantVector = retrieval !== 'keyword';
  const embedP = wantVector ? embedQuery(q, retrieval === 'semantic' ? 1800 : 1200) : Promise.resolve([] as number[]);
  ensureIndex();
  const live = getState();
  const has = tags.some((tag) => tagCount(tag) > 0);
  if (!tags.length || !has) {
    void embedP.then(() => undefined).catch(() => undefined);
    return {
      query: q,
      intent: classifyIntent(q),
      matches: [],
      tookMs: Date.now() - started,
      embedMs: 0,
      mode: 'empty',
      channels: { semantic: false, keyword: false, graph: false },
      stats: { chunks: 0, documents: 0 },
    };
  }
  const embedStarted = Date.now();
  let qVec = await embedP;
  if (!qVec.length && wantVector && vectorDim(tags) === 256) qVec = localQueryEmbed(q);
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
  }));
  const matches = selectMemories(qRaw || q, rankedMatches, { strictness: strict, topK });
  if (opts.actorId) {
    for (const match of matches.slice(0, 25)) {
      audit({
        actorId: opts.actorId,
        action: 'read',
        memoryId: match.id,
        tenantId: govOf({ containerTag: match.containerTag }).tenantId,
        purpose: opts.purpose || 'search',
      });
    }
  }
  return {
    query: q,
    intent: classifyIntent(q),
    timeIntent: ranked.intent,
    matches,
    related: opts.includeRelated === false ? [] : ranked.related,
    tookMs: Date.now() - started,
    embedMs,
    mode: retrieval === 'hybrid' && !qVec.length ? 'keyword' : retrieval,
    channels: ranked.channels,
    stats: {
      chunks: tags.reduce((n, tag) => n + live.chunks.filter((c) => c.containerTag === tag && !c.forgotten).length, 0),
      documents: tags.reduce((n, tag) => n + live.documents.filter((d) => d.containerTag === tag && !d.forgotten).length, 0),
      ...ranked.stats,
    },
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
}) {
  const tag = input.containerTag;
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
      .then((rich) => upsertFacts(tag, rich.triples || [], raw.slice(0, 240)))
      .catch(() => undefined);
  }
  const triples = (graph.triples || []).filter(isUsefulFact);
  if (!triples.length) {
    const doc = await ingestDocument({
      title: input.title || raw.slice(0, 80),
      text: raw,
      containerTag: tag,
      source: input.source || 'memory',
      mime: 'text/plain',
      task: 'memory',
      extract: false,
      actorId: input.actorId,
      visibility: input.visibility,
      memoryKind: 'context',
    });
    noteConversation(tag, raw);
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
  const saved = upsertFacts(tag, triples, text.slice(0, 240), input.actorId ? assignGovernance({ actorId: input.actorId, containerTag: tag, visibility: input.visibility, memoryKind: 'fact' }) : undefined);
  deriveFacts(tag);
  const doc = await ingestDocument({
    title: input.title || text.split('\n')[0].slice(0, 80),
    text,
    containerTag: tag,
    source: input.source || 'memory',
    mime: 'text/plain',
    task: 'memory',
    extract: false,
    actorId: input.actorId,
    visibility: input.visibility,
    memoryKind: 'fact',
  });
  noteConversation(tag, raw);
  return { skipped: false, facts: triples.length, triples, saved, document: doc.document, chunks: doc.chunks };
}

const convoBuf = new Map<string, string[]>();
export let consolidationPasses = 0;

export function noteConversation(tag: string, text: string) {
  const buf = convoBuf.get(tag) || [];
  buf.push(text.slice(0, 2000));
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
}) {
  const tag = input.containerTag;
  if (!tag) throw new Error('containerTag required');
  const turns = (input.messages || [])
    .map((m) => ({ role: String(m.role || 'user'), text: String(m.content || m.text || '').trim() }))
    .filter((m) => m.text);
  if (!turns.length) throw new Error('No messages to remember');
  const userText = turns.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
  const assistantText = turns
    .filter((m) => m.role === 'assistant')
    .map((m) => m.text)
    .filter((t) => looksLikeDurableFact(t))
    .join('\n')
    .slice(0, 1200);
  if (isChatter(userText) && !assistantText) {
    return { skipped: true, reason: 'not-durable', facts: 0, document: null };
  }
  const dialogue = [`User:\n${userText.slice(0, 4000)}`, assistantText ? `Agreed:\n${assistantText}` : '']
    .filter(Boolean)
    .join('\n\n');
  return commitImportantMemory({
    containerTag: tag,
    source: input.source || 'conversation',
    title: input.title,
    text: dialogue,
    actorId: input.actorId,
    visibility: input.visibility,
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
      source: opts.source || 'playground',
      messages: [
        { role: 'user', content: query },
        { role: 'assistant', content: answer },
      ],
      actorId: opts.actorId,
    }).catch(() => undefined);
  }
  return { answer, retrieved, injection: mem.injection, graph: graphPayload(tag, opts.actorId) };
}

function summarizeTag(tag: string) {
  const state = getState();
  return {
    tag,
    documents: state.documents.filter((d) => d.containerTag === tag && !d.forgotten).length,
    memories: state.chunks.filter((c) => c.containerTag === tag && !c.forgotten).length,
    activity: state.documents
      .filter((d) => d.containerTag === tag)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt,
  };
}

export function listTags(uid?: string) {
  const state = getState();
  const tags = [...new Set(state.documents.map((d) => d.containerTag))].filter((tag) => !uid || canAccessTag(uid, tag));
  const rows = tags.map(summarizeTag);
  if (uid) {
    const home = homeTag(uid);
    if (!rows.some((r) => r.tag === home)) rows.unshift({ tag: home, documents: 0, memories: 0, activity: undefined as any });
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
    }));
}

export function folderOf(d: { source?: string; mime?: string; title?: string; containerTag?: string }) {
  if (d.source === 'pdf' || d.mime === 'application/pdf') return 'PDFs';
  if (d.source === 'image' || String(d.mime || '').startsWith('image/')) return 'Images';
  if (d.source === 'video' || String(d.mime || '').startsWith('video/')) return 'Videos';
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

export function graphPayload(containerTag?: string | null, uid?: string) {
  const state = getState();
  const tags = new Set<string>();
  if (containerTag) {
    if (!uid || canAccessTag(uid, containerTag)) tags.add(containerTag);
  } else if (uid) {
    for (const d of state.documents) if (canAccessTag(uid, d.containerTag)) tags.add(d.containerTag);
    for (const t of state.triples) if (canAccessTag(uid, t.containerTag)) tags.add(t.containerTag);
    for (const e of state.entities) if (canAccessTag(uid, e.containerTag)) tags.add(e.containerTag);
    tags.add(homeTag(uid));
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
        containerTag: d.containerTag,
        createdAt: d.createdAt,
        text: String(d.text || '').slice(0, 4000),
        facts: factsAbout(d.title),
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
          facts,
        };
      }),
      ...extraNodes.map((n) => {
        const facts = factsAbout(n.label);
        return {
          ...n,
          containerTag: facts[0]?.containerTag,
          createdAt: addedAt(facts),
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

export function forgetMatching(query: string, containerTag?: string | null, dryRun = false) {
  if (!containerTag) return { count: 0, ids: [] as string[], dryRun };
  const q = query.toLowerCase();
  const chunks = scopedChunks(containerTag, false).filter((c) => c.text.toLowerCase().includes(q));
  const facts = getState().triples.filter(
    (t) =>
      t.containerTag === containerTag &&
      t.isLatest !== false &&
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

export function logRequest(rec: { method: string; path: string; status: number; ms: number; type: string; ownerUid?: string }) {
  const s = getState();
  s.requests.unshift({ id: uid('req'), at: new Date().toISOString(), ...rec });
  s.requests = s.requests.slice(0, 500);
  saveState();
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
