import {
  bm25Scores,
  chunkText,
  classifyIntent,
  cosine,
  decayWeight,
  expandQuery,
  getState,
  htmlToText,
  rrf,
  saveState,
  sha,
  shortestPath,
  uid,
  type ChunkRec,
  type DocRec,
} from './core.js';
import { embedQuery, embedText, extractGraph, generateText, hasLlm, llmRerank } from './llm.js';
import { deriveFacts, upsertFacts } from './facts.js';
import { looksLikePdf, textFromPdf, textFromPdfBase64 } from './pdf.js';
import { looksLikeDurableFact, isUsefulFact } from './quality.js';
import { buildMemoryInjection } from './inject.js';
import { homeTag, ownsTag, uidFromTag } from './tenancy.js';

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
}) {
  const text = input.text.trim();
  if (!text) throw new Error('Empty document');
  const tag = input.containerTag;
  if (!tag) throw new Error('containerTag required');
  const state = getState();
  const doc: DocRec = {
    id: uid('doc'),
    containerTag: tag,
    title: input.title || 'Untitled',
    source: input.source || 'upload',
    mime: input.mime || 'text/plain',
    text,
    createdAt: new Date().toISOString(),
    forgotten: false,
  };
  const pieces = chunkText(text);
  const chunks: ChunkRec[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const hash = sha(tag + pieces[i]);
    if (state.chunks.some((c) => c.hash === hash && !c.forgotten)) continue;
    const embedding = await embedText(pieces[i]);
    chunks.push({
      id: uid('chk'),
      docId: doc.id,
      containerTag: tag,
      text: pieces[i],
      index: i,
      embedding,
      hash,
      createdAt: doc.createdAt,
      source: doc.source,
      forgotten: false,
    });
  }
  state.documents.push(doc);
  state.chunks.push(...chunks);

  if (input.task !== 'rag') {
    const graph = await extractGraph(text.slice(0, 8000));
    for (const e of graph.entities || []) {
      const name = String(e.name || '').trim();
      if (!name) continue;
      if (state.entities.some((x) => x.containerTag === tag && x.name.toLowerCase() === name.toLowerCase())) continue;
      state.entities.push({ id: uid('ent'), containerTag: tag, name, type: e.type || 'topic' });
    }
    upsertFacts(tag, graph.triples || [], text.slice(0, 240));
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
  saveState();
  return { document: doc, chunks: chunks.length, entities: getState().entities.filter((e) => e.containerTag === tag).length };
}

export async function ingestUrl(url: string, containerTag: string, task?: 'memory' | 'rag') {
  const res = await fetch(url, { headers: { 'User-Agent': 'RukmerMemory/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const ctype = res.headers.get('content-type') || '';
  if (looksLikePdf(url, ctype)) {
    const buf = Buffer.from(await res.arrayBuffer());
    const pdf = await textFromPdf(buf);
    return ingestDocument({
      title: url.split('/').pop() || url,
      text: pdf.text.slice(0, 200000),
      containerTag,
      source: 'web-pdf',
      mime: 'application/pdf',
      task,
    });
  }
  const raw = await res.text();
  const text = htmlToText(raw).slice(0, 40000);
  return ingestDocument({ title: url, text, containerTag, source: 'web', mime: 'text/html', task });
}

export async function ingestPayload(item: {
  title?: string;
  name?: string;
  text?: string;
  content?: string;
  pdfBase64?: string;
  mime?: string;
  source?: string;
  containerTag: string;
  task?: 'memory' | 'rag';
}) {
  const title = item.title || item.name || 'Untitled';
  let text = String(item.text || item.content || '');
  let mime = item.mime || 'text/plain';
  if (item.pdfBase64 || looksLikePdf(title, item.mime)) {
    if (!item.pdfBase64) throw new Error(`PDF ${title} is missing file data`);
    const pdf = await textFromPdfBase64(item.pdfBase64);
    text = pdf.text.slice(0, 200000);
    mime = 'application/pdf';
  }
  return ingestDocument({
    title,
    text,
    containerTag: item.containerTag,
    source: item.source || (mime === 'application/pdf' ? 'pdf' : 'upload'),
    mime,
    task: item.task,
  });
}

export async function searchMemory(query: string, opts: SearchOpts = {}) {
  const started = Date.now();
  const { normalized, expanded } = expandQuery(query);
  const q = opts.rewrite ? expanded : normalized;
  const intent = classifyIntent(q);
  const topK = opts.topK ?? 10;
  const strict = opts.strictness ?? 0.4;
  const chunks = scopedChunks(opts.containerTag, opts.includeForgotten);
  if (!chunks.length) {
    return { query: q, intent, matches: [], tookMs: Date.now() - started, mode: 'empty' };
  }

  const qVec = await embedQuery(q);
  const vector = chunks.map((c) => ({
    id: c.id,
    score: cosine(qVec, c.embedding) * decayWeight(c.createdAt),
  }));
  const bm25 = bm25Scores(
    q,
    chunks.map((c) => ({ id: c.id, text: c.text }))
  );
  const fused = rrf([vector, bm25]);
  let ranked = fused
    .map((r) => {
      const chunk = chunks.find((c) => c.id === r.id)!;
      const v = vector.find((x) => x.id === r.id)?.score || 0;
      return { ...r, chunk, vectorScore: v };
    })
    .filter((r) => r.vectorScore >= strict * 0.15 || r.score > 0.01)
    .slice(0, Math.max(topK * 2, 12));

  if (opts.rerank && ranked.length) {
    const llm = await llmRerank(
      q,
      ranked.slice(0, 12).map((r) => ({ id: r.id, text: r.chunk.text }))
    );
    const map = new Map(llm.map((x: any) => [x.id, Number(x.score) || 0]));
    ranked = ranked
      .map((r) => ({ ...r, score: r.score * 0.6 + (map.get(r.id) || 0) * 0.4 }))
      .sort((a, b) => b.score - a.score);
  }

  const matches = ranked.slice(0, topK).map((r) => {
    const doc = getState().documents.find((d) => d.id === r.chunk.docId);
    return {
      id: r.chunk.id,
      docId: r.chunk.docId,
      title: doc?.title || 'Untitled',
      text: r.chunk.text,
      score: Number(r.score.toFixed(4)),
      vectorScore: Number(r.vectorScore.toFixed(4)),
      source: r.chunk.source,
      containerTag: r.chunk.containerTag,
      createdAt: r.chunk.createdAt,
    };
  });

  const related = opts.includeRelated
    ? getState()
        .triples.filter(
          (t) =>
            t.containerTag === opts.containerTag &&
            t.isLatest !== false &&
            isUsefulFact(t)
        )
        .slice(0, 6)
        .map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object, isLatest: t.isLatest, derived: t.derived }))
    : [];

  return {
    query: q,
    intent,
    matches,
    related,
    tookMs: Date.now() - started,
    mode: hasLlm() ? 'hybrid+llm' : 'hybrid-local',
    stats: { chunks: chunks.length, documents: getState().documents.filter((d) => d.containerTag === opts.containerTag).length },
  };
}

export type ChatTurn = { role: 'user' | 'assistant' | 'system'; content: string };

export async function rememberTranscript(input: {
  containerTag?: string;
  source?: string;
  title?: string;
  messages: { role?: string; content?: string; text?: string }[];
}) {
  const tag = input.containerTag;
  if (!tag) throw new Error('containerTag required');
  const userText = (input.messages || [])
    .filter((m) => String(m.role || 'user') === 'user')
    .map((m) => String(m.content || m.text || '').trim())
    .filter(Boolean)
    .join('\n');
  const lines = (input.messages || [])
    .map((m) => {
      const role = String(m.role || 'user');
      const text = String(m.content || m.text || '').trim();
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean);
  if (!lines.length) throw new Error('No messages to remember');
  if (!looksLikeDurableFact(userText)) {
    return { skipped: true, reason: 'not-durable', chunks: 0, document: null };
  }
  return ingestDocument({
    title: input.title || `Fact ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    text: userText,
    containerTag: tag,
    source: input.source || 'conversation',
    mime: 'text/plain',
    task: 'memory',
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
    }).catch(() => undefined);
  }
  return { answer, retrieved, injection: mem.injection, graph: graphPayload(tag) };
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
  const tags = [...new Set(state.documents.map((d) => d.containerTag))].filter((tag) => !uid || ownsTag(uid, tag));
  const rows = tags.map(summarizeTag);
  if (uid) {
    const home = homeTag(uid);
    if (!rows.some((r) => r.tag === home)) rows.unshift({ tag: home, documents: 0, memories: 0, activity: undefined as any });
  }
  return rows;
}

export function listDocuments(containerTag?: string | null) {
  if (!containerTag) return [];
  return getState()
    .documents.filter((d) => d.containerTag === containerTag)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function graphPayload(containerTag?: string | null, uid?: string) {
  const state = getState();
  const tags = new Set<string>();
  if (containerTag) tags.add(containerTag);
  if (uid) {
    for (const d of state.documents) if (ownsTag(uid, d.containerTag)) tags.add(d.containerTag);
    for (const t of state.triples) if (ownsTag(uid, t.containerTag)) tags.add(t.containerTag);
    for (const e of state.entities) if (ownsTag(uid, e.containerTag)) tags.add(e.containerTag);
  }
  if (!tags.size) return { nodes: [], edges: [], pathExample: null, tags: [] as string[] };
  const inScope = (tag: string) => tags.has(tag);
  const triples = state.triples.filter((t) => inScope(t.containerTag));
  const keep = new Set(triples.flatMap((t) => [t.subject.toLowerCase(), t.object.toLowerCase()]));
  const entities = state.entities.filter((e) => inScope(e.containerTag) && (keep.size === 0 || keep.has(e.name.toLowerCase())));
  const docs = state.documents.filter((d) => inScope(d.containerTag) && !d.forgotten);

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
      ...entities.map((e) => ({
        id: e.id,
        label: e.name,
        kind: 'memory' as const,
        type: e.type,
        containerTag: e.containerTag,
        facts: factsAbout(e.name),
      })),
      ...extraNodes.map((n) => ({ ...n, facts: factsAbout(n.label) })),
    ],
    edges,
    pathExample: triples[0] ? shortestPath(triples, triples[0].subject, triples[0].object, triples[0].containerTag) : null,
    tags: [...tags],
  };
}

export function forgetById(id: string, uid?: string) {
  const state = getState();
  const chunk = state.chunks.find((c) => c.id === id);
  if (chunk) {
    if (uid && !ownsTag(uid, chunk.containerTag)) return { ok: false, error: 'forbidden' };
    chunk.forgotten = true;
  }
  const doc = state.documents.find((d) => d.id === id);
  if (doc) {
    if (uid && !ownsTag(uid, doc.containerTag)) return { ok: false, error: 'forbidden' };
    doc.forgotten = true;
    state.chunks.filter((c) => c.docId === id).forEach((c) => (c.forgotten = true));
  }
  saveState();
  return { ok: true };
}

export function forgetMatching(query: string, containerTag?: string | null, dryRun = false) {
  if (!containerTag) return { count: 0, ids: [] as string[], dryRun };
  const chunks = scopedChunks(containerTag, true).filter((c) => c.text.toLowerCase().includes(query.toLowerCase()));
  if (!dryRun) {
    chunks.forEach((c) => (c.forgotten = true));
    saveState();
  }
  return { count: chunks.length, ids: chunks.map((c) => c.id), dryRun };
}

export function stats(uid?: string) {
  const s = getState();
  const mine = (tag: string) => !uid || ownsTag(uid, tag);
  return {
    documents: s.documents.filter((d) => !d.forgotten && mine(d.containerTag)).length,
    chunks: s.chunks.filter((c) => !c.forgotten && mine(c.containerTag)).length,
    entities: s.entities.filter((e) => mine(e.containerTag)).length,
    triples: s.triples.filter((t) => mine(t.containerTag)).length,
    latestFacts: s.triples.filter((t) => t.isLatest !== false && mine(t.containerTag)).length,
    embeddings: s.chunks.filter((c) => c.embedding.length && mine(c.containerTag)).length,
    requests: s.requests.length,
    llm: hasLlm(),
  };
}

export function logRequest(rec: { method: string; path: string; status: number; ms: number; type: string }) {
  const s = getState();
  s.requests.unshift({ id: uid('req'), at: new Date().toISOString(), ...rec });
  s.requests = s.requests.slice(0, 500);
  saveState();
}

export function insights(uid?: string) {
  const s = getState();
  const tags = listTags(uid);
  const mine = (tag: string) => !uid || ownsTag(uid, tag);
  return {
    activeUsers: 1,
    memories: s.chunks.filter((c) => !c.forgotten && mine(c.containerTag)).length,
    queries: s.requests.filter((r) => r.path.includes('search') || r.path.includes('chat')).length,
    tags,
  };
}
