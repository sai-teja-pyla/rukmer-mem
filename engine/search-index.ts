import { getState, sanitizeMeta, tokenize, type TemporalKind } from './core.js';
import { isRetired } from './governance.js';
import { isUsefulFact } from './quality.js';
import { memoryFactKey, memoryTextKey, relevanceScore } from './relevance.js';
import { queryTimeIntent, timeMultiplier } from './temporal.js';

export type MetaFilter = { all?: Record<string, string>; any?: Record<string, string> };

type Posting = { id: string; tf: number; len: number };
type Rec = {
  id: string;
  kind: 'chunk' | 'fact';
  tag: string;
  text: string;
  title: string;
  source: string;
  createdAt: string;
  docId: string;
  forgotten: boolean;
  isLatest: boolean;
  temporal: TemporalKind;
  occurredAt: string | null;
  metadata?: Record<string, string>;
  subject?: string;
  predicate?: string;
  object?: string;
  embedding?: Float32Array;
  len: number;
};

export type Retrieval = 'hybrid' | 'semantic' | 'keyword';

let builtRev = -1;
const postings = new Map<string, Map<string, Posting[]>>();
const idsByTag = new Map<string, string[]>();
const vectorIds = new Map<string, string[]>();
const records = new Map<string, Rec>();
const entityIds = new Map<string, Map<string, string[]>>();
const avgLen = new Map<string, number>();
const lsh = new Map<string, Map<string, string[]>>();
const planes = new Map<number, Float32Array[]>();

export let lastQueryStats = { vectorCompared: 0, keywordDocs: 0, tags: 0, indexed: 0 };

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function planesFor(dim: number) {
  let rows = planes.get(dim);
  if (rows) return rows;
  const rand = mulberry(0x51ed);
  rows = [];
  for (let i = 0; i < 12; i++) {
    const row = new Float32Array(dim);
    for (let j = 0; j < dim; j++) row[j] = rand() * 2 - 1;
    rows.push(row);
  }
  planes.set(dim, rows);
  return rows;
}

function lshKey(vec: ArrayLike<number>) {
  const rows = planesFor(vec.length);
  let bits = 0;
  for (let i = 0; i < rows.length; i++) {
    let dot = 0;
    const p = rows[i];
    for (let j = 0; j < vec.length; j++) dot += vec[j] * p[j];
    if (dot >= 0) bits |= 1 << i;
  }
  return bits;
}

function probe(bits: number) {
  const keys = [bits];
  for (let i = 0; i < 12; i++) keys.push(bits ^ (1 << i));
  return keys;
}

export function ensureIndex() {
  const rev = getState().rev || 0;
  if (builtRev === rev) return;
  rebuild();
  builtRev = rev;
}

function addText(tag: string, id: string, text: string) {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let inv = postings.get(tag);
  if (!inv) {
    inv = new Map();
    postings.set(tag, inv);
  }
  for (const [token, f] of tf) {
    const list = inv.get(token) || [];
    list.push({ id, tf: f, len: Math.max(tokens.length, 1) });
    inv.set(token, list);
  }
}

function unit(vec: ArrayLike<number>) {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  const out = new Float32Array(vec.length);
  if (!n) return out;
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function indexVector(tag: string, id: string, vec: Float32Array) {
  const ids = vectorIds.get(tag) || [];
  ids.push(id);
  vectorIds.set(tag, ids);
  let table = lsh.get(tag);
  if (!table) {
    table = new Map();
    lsh.set(tag, table);
  }
  const key = String(lshKey(vec));
  const bucket = table.get(key) || [];
  bucket.push(id);
  table.set(key, bucket);
}

function rebuild() {
  postings.clear();
  idsByTag.clear();
  vectorIds.clear();
  records.clear();
  entityIds.clear();
  avgLen.clear();
  lsh.clear();
  const state = getState();
  const lenSum = new Map<string, { n: number; sum: number }>();
  for (const c of state.chunks) {
    const tokens = tokenize(c.text);
    const rec: Rec = {
      id: c.id,
      kind: 'chunk',
      tag: c.containerTag,
      text: c.text,
      title: '',
      source: c.source,
      createdAt: c.createdAt,
      docId: c.docId,
      forgotten: !!c.forgotten,
      isLatest: true,
      temporal: 'undated',
      occurredAt: null,
      metadata: c.metadata,
      embedding: c.embedding?.length ? unit(c.embedding) : undefined,
      len: Math.max(tokens.length, 1),
    };
    const retired = isRetired(c);
    rec.forgotten = retired;
    records.set(c.id, rec);
    const ids = idsByTag.get(c.containerTag) || [];
    ids.push(c.id);
    idsByTag.set(c.containerTag, ids);
    if (!retired) {
      addText(c.containerTag, c.id, c.text);
      const acc = lenSum.get(c.containerTag) || { n: 0, sum: 0 };
      acc.n += 1;
      acc.sum += rec.len;
      lenSum.set(c.containerTag, acc);
    }
    if (rec.embedding && !retired) indexVector(c.containerTag, c.id, rec.embedding);
  }
  const titleByDoc = new Map(state.documents.map((d) => [d.id, d.title]));
  for (const rec of records.values()) {
    if (rec.kind === 'chunk' && !rec.title) {
      rec.title = titleByDoc.get(rec.docId) || 'Untitled';
      if (!rec.forgotten && rec.title && rec.title !== 'Untitled') addText(rec.tag, rec.id, rec.title);
    }
  }
  for (const [tag, acc] of lenSum) avgLen.set(tag, acc.sum / Math.max(acc.n, 1));
  for (const t of state.triples) {
    if (!isUsefulFact(t)) continue;
    const text = `${t.subject} ${t.predicate.replace(/_/g, ' ')} ${t.object} ${t.evidence || ''}`;
    const rec: Rec = {
      id: t.id,
      kind: 'fact',
      tag: t.containerTag,
      text: t.evidence || text,
      title: `${t.subject} ${t.predicate.replace(/_/g, ' ')} ${t.object}`,
      source: 'fact',
      createdAt: t.validFrom,
      docId: t.id,
      forgotten: false,
      isLatest: t.isLatest !== false,
      temporal: t.temporal || 'undated',
      occurredAt: t.occurredAt ?? null,
      metadata: t.metadata,
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      embedding: t.embedding?.length ? unit(t.embedding) : undefined,
      len: Math.max(tokenize(text).length, 1),
    };
    const retired = isRetired({ forgotten: false, gov: t.gov }) || t.isLatest === false && !!t.gov?.deletedAt;
    rec.forgotten = retired;
    records.set(t.id, rec);
    if (rec.embedding && !retired && t.isLatest !== false) indexVector(t.containerTag, t.id, rec.embedding);
    const ids = idsByTag.get(t.containerTag) || [];
    ids.push(t.id);
    idsByTag.set(t.containerTag, ids);
    if (!retired) addText(t.containerTag, t.id, text);
  }
  for (const e of state.entities) {
    const key = e.name.trim().toLowerCase();
    if (key.length < 2 || key === 'user') continue;
    let table = entityIds.get(e.containerTag);
    if (!table) {
      table = new Map();
      entityIds.set(e.containerTag, table);
    }
    table.set(key, e.memoryIds || []);
  }
  for (const link of state.links) {
    let table = entityIds.get(link.containerTag);
    if (!table) {
      table = new Map();
      entityIds.set(link.containerTag, table);
    }
    const ids = new Set(table.get(link.reason) || []);
    ids.add(link.fromId);
    ids.add(link.toId);
    table.set(link.reason, [...ids]);
  }
}

const SYN: Record<string, string[]> = {
  favourite: ['prefers', 'prefer', 'favorite', 'like'],
  favorite: ['prefers', 'prefer', 'favourite', 'like'],
  prefer: ['prefers', 'favourite', 'favorite', 'like'],
  prefers: ['prefer', 'favourite', 'favorite', 'like'],
  like: ['likes', 'prefer', 'prefers', 'favourite'],
  likes: ['like', 'prefer', 'favourite'],
  work: ['works', 'job'],
  works: ['work', 'job'],
  live: ['lives', 'based'],
  lives: ['live', 'based'],
  name: ['called'],
};

function queryTokens(query: string) {
  const base = [...new Set(tokenize(query))];
  const extra: string[] = [];
  for (const token of base) {
    for (const alt of SYN[token] || []) {
      if (!base.includes(alt) && extra.length < 4) extra.push(alt);
    }
  }
  return [...base, ...extra];
}

export function tagCount(tag: string) {
  ensureIndex();
  return (idsByTag.get(tag) || []).reduce((n, id) => n + (records.get(id)?.forgotten ? 0 : 1), 0);
}

export function vectorDim(tags: string[]) {
  ensureIndex();
  let local = 0;
  for (const tag of tags) {
    for (const id of vectorIds.get(tag) || []) {
      const dim = records.get(id)?.embedding?.length || 0;
      if (dim > 256) return dim;
      if (dim === 256) local = 256;
    }
  }
  return local;
}

function keywordSearch(tag: string, query: string) {
  const inv = postings.get(tag);
  if (!inv) return [];
  const qTokens = queryTokens(query);
  const N = Math.max(new Set(idsByTag.get(tag) || []).size, 1);
  const scores = new Map<string, number>();
  const k1 = 1.2;
  const b = 0.75;
  const avg = avgLen.get(tag) || 40;
  for (const qt of qTokens) {
    const byId = new Map<string, { tf: number; len: number }>();
    for (const posting of inv.get(qt) || []) {
      const prev = byId.get(posting.id);
      if (prev) prev.tf += posting.tf;
      else byId.set(posting.id, { tf: posting.tf, len: posting.len });
    }
    const n = byId.size;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (const [id, posting] of byId) {
      const score = idf * ((posting.tf * (k1 + 1)) / (posting.tf + k1 * (1 - b + b * (posting.len / avg))));
      scores.set(id, (scores.get(id) || 0) + score);
    }
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).filter((x) => x.score > 0);
}

function vectorSearch(tag: string, qVec: Float32Array) {
  const ids = vectorIds.get(tag) || [];
  if (!ids.length || !qVec.length) return [];
  let pool = ids;
  if (ids.length > 3000) {
    const table = lsh.get(tag);
    const hit = new Set<string>();
    if (table) {
      for (const key of probe(lshKey(qVec))) {
        for (const id of table.get(String(key)) || []) hit.add(id);
      }
    }
    if (hit.size >= 12) pool = [...hit];
  }
  const out: { id: string; score: number }[] = [];
  const dim = qVec.length;
  for (const id of pool) {
    const rec = records.get(id);
    const vec = rec?.embedding;
    if (!rec || rec.forgotten || !vec || vec.length !== dim) continue;
    const score = dot(qVec, vec);
    if (score > 0.05) out.push({ id, score });
  }
  lastQueryStats.vectorCompared += pool.length;
  return out;
}

function entitySearch(tag: string, query: string) {
  const table = entityIds.get(tag);
  if (!table) return [];
  const q = query.toLowerCase();
  const scores = new Map<string, number>();
  for (const [name, ids] of table) {
    if (name.length < 3 || !q.includes(name)) continue;
    for (const id of ids) scores.set(id, (scores.get(id) || 0) + 1);
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score }));
}

function matchMeta(meta: Record<string, string> | undefined, filter?: MetaFilter) {
  if (!filter) return true;
  const m = meta || {};
  const all = sanitizeMeta(filter.all) || {};
  const any = sanitizeMeta(filter.any) || {};
  for (const [k, v] of Object.entries(all)) if ((m[k] || '') !== v) return false;
  const entries = Object.entries(any);
  if (entries.length && !entries.some(([k, v]) => (m[k] || '') === v)) return false;
  return true;
}

const SELF_NODES = new Set(['user', 'i', 'me', 'myself', 'mine', 'someone', 'something', 'it', 'they', 'them']);
const RELATED_CAP = 4;

export type RelatedFact = {
  subject: string;
  predicate: string;
  object: string;
  isLatest: boolean;
  derived: boolean;
  text: string;
};

function entityKey(value?: string) {
  return String(value || '').trim().toLowerCase();
}

function userNodes(tag: string) {
  const names = new Set(SELF_NODES);
  const facts = [...records.values()].filter((rec) => rec.tag === tag && rec.kind === 'fact' && !rec.forgotten);
  const namePred = /^(name|full_name|called|aka|named|is_named)$/;
  let grew = true;
  while (grew) {
    grew = false;
    for (const rec of facts) {
      if (!namePred.test(entityKey(rec.predicate).replace(/\s+/g, '_'))) continue;
      const subject = entityKey(rec.subject);
      const object = entityKey(rec.object);
      if (subject && names.has(subject) && object && !names.has(object)) {
        names.add(object);
        grew = true;
      }
    }
  }
  const counts = new Map<string, number>();
  for (const rec of facts) {
    const subject = entityKey(rec.subject);
    if (subject.length < 2) continue;
    counts.set(subject, (counts.get(subject) || 0) + 1);
  }
  let top = '';
  let topN = 0;
  for (const [name, count] of counts) {
    if (count > topN) {
      top = name;
      topN = count;
    }
  }
  if (top && topN >= 2 && topN * 2 >= facts.length) names.add(top);
  return names;
}

/** Neighbors of matches that already passed strictness. Empty when nothing was kept. */
export function relatedForMatches(
  matches: { id: string; text?: string; subject?: string; predicate?: string; object?: string; containerTag?: string }[],
  opts: { visible?: (id: string) => boolean } = {}
): RelatedFact[] {
  if (!matches.length) return [];
  ensureIndex();
  const tags = new Set<string>();
  for (const match of matches) {
    if (match.containerTag) tags.add(match.containerTag);
    const rec = records.get(match.id);
    if (rec) tags.add(rec.tag);
  }
  const self = new Set<string>();
  for (const tag of tags) for (const name of userNodes(tag)) self.add(name);
  const anchors = new Set<string>();
  for (const match of matches) {
    const rec = records.get(match.id);
    for (const name of [match.subject || rec?.subject, match.object || rec?.object]) {
      const key = entityKey(name);
      if (key.length < 2 || self.has(key)) continue;
      anchors.add(key);
    }
  }
  if (!anchors.size) return [];

  const seenId = new Set<string>();
  const seenText = new Set<string>();
  const seenSpo = new Set<string>();
  for (const match of matches) {
    const rec = records.get(match.id);
    if (match.id) seenId.add(match.id);
    const text = memoryTextKey(match.text || rec?.text || '');
    if (text) seenText.add(text);
    const spo = memoryFactKey({
      subject: match.subject || rec?.subject,
      predicate: match.predicate || rec?.predicate,
      object: match.object || rec?.object,
    });
    if (spo) seenSpo.add(spo);
  }

  const related: RelatedFact[] = [];
  for (const rec of records.values()) {
    if (rec.kind !== 'fact' || rec.forgotten || !rec.isLatest || !tags.has(rec.tag)) continue;
    if (opts.visible && !opts.visible(rec.id)) continue;
    const subject = entityKey(rec.subject);
    const object = entityKey(rec.object);
    if (!anchors.has(subject) && !anchors.has(object)) continue;
    if (seenId.has(rec.id)) continue;
    const text = memoryTextKey(rec.text || rec.title);
    const spo = memoryFactKey(rec);
    if ((text && seenText.has(text)) || (spo && seenSpo.has(spo))) continue;
    seenId.add(rec.id);
    if (text) seenText.add(text);
    if (spo) seenSpo.add(spo);
    related.push({
      subject: rec.subject || '',
      predicate: rec.predicate || '',
      object: rec.object || '',
      isLatest: rec.isLatest,
      derived: false,
      text: rec.text,
    });
    if (related.length >= RELATED_CAP) break;
  }
  return related;
}

export function rankTagged(
  query: string,
  tags: string[],
  qVec: number[],
  opts: { topK: number; strict: number; filter?: MetaFilter; includeForgotten?: boolean; retrieval?: Retrieval; visible?: (id: string) => boolean }
) {
  ensureIndex();
  const retrieval: Retrieval = opts.retrieval || 'hybrid';
  const intent = queryTimeIntent(query);
  const useVec = retrieval !== 'keyword' && qVec.length > 0;
  const useKw = retrieval !== 'semantic';
  const useEnt = retrieval === 'hybrid';
  const qUnit = useVec ? unit(qVec) : new Float32Array();
  lastQueryStats = { vectorCompared: 0, keywordDocs: 0, tags: tags.length, indexed: records.size };
  const kwMap = new Map<string, number>();
  const vecMap = new Map<string, number>();
  const entMap = new Map<string, number>();
  for (const tag of tags) {
    if (useKw) for (const row of keywordSearch(tag, query)) kwMap.set(row.id, (kwMap.get(row.id) || 0) + row.score);
    if (useVec) for (const row of vectorSearch(tag, qUnit)) vecMap.set(row.id, Math.max(vecMap.get(row.id) || 0, row.score));
    if (useEnt) for (const row of entitySearch(tag, query)) entMap.set(row.id, (entMap.get(row.id) || 0) + row.score);
  }
  lastQueryStats.keywordDocs = kwMap.size;
  const lists: { id: string; score: number }[][] = [];
  if (vecMap.size) lists.push([...vecMap].map(([id, score]) => ({ id, score })));
  if (kwMap.size) lists.push([...kwMap].map(([id, score]) => ({ id, score })));
  if (entMap.size) lists.push([...entMap].map(([id, score]) => ({ id, score })));
  const fused = rrf(lists);
  const ranked = fused
    .map((row) => {
      const rec = records.get(row.id);
      if (!rec) return null;
      if (rec.forgotten && !opts.includeForgotten) return null;
      if (opts.visible && !opts.visible(row.id)) return null;
      if (!matchMeta(rec.metadata, opts.filter)) return null;
      if (rec.kind === 'fact' && !rec.isLatest && intent !== 'past') return null;
      const vectorScore = vecMap.get(row.id) || 0;
      const relevance = relevanceScore(query, {
        id: rec.id,
        text: rec.text,
        title: rec.title,
        vectorScore,
        subject: rec.subject,
        predicate: rec.predicate,
        object: rec.object,
      });
      if (opts.strict > 0 && relevance < opts.strict) return null;
      return { ...rec, score: Number(relevance.toFixed(4)), vectorScore };
    })
    .filter((r): r is Rec & { score: number; vectorScore: number } => !!r)
    .sort(
      (a, b) =>
        b.score * timeMultiplier(intent, b.temporal, b.isLatest) - a.score * timeMultiplier(intent, a.temporal, a.isLatest) ||
        b.score - a.score
    )
    .slice(0, Math.max(opts.topK * 3, opts.topK));

  return {
    intent,
    ranked: ranked.slice(0, opts.topK),
    related: [] as RelatedFact[],
    channels: { semantic: useVec, keyword: useKw, graph: useEnt },
    stats: { ...lastQueryStats },
  };
}

function rrf(lists: { id: string; score: number }[][], k = 60) {
  const map = new Map<string, number>();
  for (const list of lists) {
    const ranked = [...list].sort((a, b) => b.score - a.score);
    ranked.forEach((item, i) => {
      map.set(item.id, (map.get(item.id) || 0) + 1 / (k + i + 1));
    });
  }
  return [...map.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function indexSize() {
  ensureIndex();
  return { records: records.size, tags: idsByTag.size };
}
