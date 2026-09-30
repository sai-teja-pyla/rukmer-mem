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
import { looksLikePdf, textFromPdf, textFromPdfBase64 } from './pdf.js';

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
  return getState().chunks.filter((c) => {
    if (tag && c.containerTag !== tag) return false;
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
  const tag = input.containerTag || 'default';
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
    for (const t of graph.triples || []) {
      if (!t.subject || !t.object) continue;
      state.triples.push({
        id: uid('trp'),
        containerTag: tag,
        subject: String(t.subject),
        predicate: String(t.predicate || 'related_to'),
        object: String(t.object),
        evidence: text.slice(0, 240),
      });
    }
  }

  state.jobs.push({
    id: uid('job'),
    status: 'done',
    message: `Ingested ${doc.title} (${chunks.length} chunks)`,
    at: new Date().toISOString(),
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
        .triples.filter((t) => !opts.containerTag || t.containerTag === opts.containerTag)
        .slice(0, 8)
        .map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object }))
    : [];

  return {
    query: q,
    intent,
    matches,
    related,
    tookMs: Date.now() - started,
    mode: hasLlm() ? 'hybrid+llm' : 'hybrid-local',
    stats: { chunks: chunks.length, documents: getState().documents.filter((d) => !opts.containerTag || d.containerTag === opts.containerTag).length },
  };
}

export async function chatWithMemory(query: string, opts: SearchOpts = {}) {
  const retrieved = await searchMemory(query, { ...opts, topK: opts.topK ?? 8 });
  const context = retrieved.matches.map((m, i) => `[${i + 1}] (${m.title}) ${m.text}`).join('\n\n');
  const profile = getState()
    .triples.filter((t) => (!opts.containerTag || t.containerTag === opts.containerTag) && /prefer|like|is|works/i.test(t.predicate))
    .slice(0, 12)
    .map((t) => `${t.subject} ${t.predicate} ${t.object}`)
    .join('\n');

  let answer: string;
  if (!retrieved.matches.length) {
    answer = "I don't have memories for this yet. Import documents in the Import tab, then ask again.";
  } else if (!hasLlm()) {
    answer = `Here's what I found in memory:\n\n${retrieved.matches.map((m) => `• ${m.text.slice(0, 280)}`).join('\n\n')}`;
  } else {
    answer = await generateText(
      `User question: ${query}\n\nProfile facts:\n${profile || '(none)'}\n\nRetrieved memories:\n${context}\n\nAnswer using only this memory. If unknown, say so. Cite titles in parentheses.`,
      'You are Rukmer Memory, a precise workplace memory assistant.'
    );
  }
  return { answer, retrieved };
}

export function listTags() {
  const state = getState();
  const tags = [...new Set(state.documents.map((d) => d.containerTag))];
  return tags.map((tag) => ({
    tag,
    documents: state.documents.filter((d) => d.containerTag === tag && !d.forgotten).length,
    memories: state.chunks.filter((c) => c.containerTag === tag && !c.forgotten).length,
    activity: state.documents
      .filter((d) => d.containerTag === tag)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt,
  }));
}

export function listDocuments(containerTag?: string | null) {
  return getState()
    .documents.filter((d) => !containerTag || d.containerTag === containerTag)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function graphPayload(containerTag?: string | null) {
  const state = getState();
  const entities = state.entities.filter((e) => !containerTag || e.containerTag === containerTag);
  const triples = state.triples.filter((t) => !containerTag || t.containerTag === containerTag);
  const docs = state.documents.filter((d) => !containerTag || d.containerTag === containerTag);
  return {
    nodes: [
      ...docs.map((d) => ({ id: d.id, label: d.title, kind: 'document' as const })),
      ...entities.map((e) => ({ id: e.id, label: e.name, kind: 'memory' as const, type: e.type })),
    ],
    edges: triples.map((t) => ({
      id: t.id,
      source: t.subject,
      target: t.object,
      label: t.predicate,
    })),
    pathExample: triples[0] ? shortestPath(triples, triples[0].subject, triples[0].object, triples[0].containerTag) : null,
  };
}

export function forgetById(id: string) {
  const state = getState();
  const chunk = state.chunks.find((c) => c.id === id);
  if (chunk) chunk.forgotten = true;
  const doc = state.documents.find((d) => d.id === id);
  if (doc) {
    doc.forgotten = true;
    state.chunks.filter((c) => c.docId === id).forEach((c) => (c.forgotten = true));
  }
  saveState();
  return { ok: true };
}

export function forgetMatching(query: string, containerTag?: string | null, dryRun = false) {
  const chunks = scopedChunks(containerTag, true).filter((c) => c.text.toLowerCase().includes(query.toLowerCase()));
  if (!dryRun) {
    chunks.forEach((c) => (c.forgotten = true));
    saveState();
  }
  return { count: chunks.length, ids: chunks.map((c) => c.id), dryRun };
}

export function stats() {
  const s = getState();
  return {
    documents: s.documents.filter((d) => !d.forgotten).length,
    chunks: s.chunks.filter((c) => !c.forgotten).length,
    entities: s.entities.length,
    triples: s.triples.length,
    embeddings: s.chunks.filter((c) => c.embedding.length).length,
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

export function insights() {
  const s = getState();
  const tags = listTags();
  return {
    activeUsers: 1,
    memories: s.chunks.filter((c) => !c.forgotten).length,
    queries: s.requests.filter((r) => r.path.includes('search') || r.path.includes('chat')).length,
    tags,
  };
}
