import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ContainerTag = string;

export interface DocRec {
  id: string;
  containerTag: string;
  title: string;
  source: string;
  mime: string;
  text: string;
  createdAt: string;
  forgotten: boolean;
}

export interface ChunkRec {
  id: string;
  docId: string;
  containerTag: string;
  text: string;
  index: number;
  embedding: number[];
  hash: string;
  createdAt: string;
  forgotten: boolean;
  source: string;
}

export interface EntityRec {
  id: string;
  containerTag: string;
  name: string;
  type: string;
}

export interface TripleRec {
  id: string;
  containerTag: string;
  subject: string;
  predicate: string;
  object: string;
  evidence: string;
  isLatest: boolean;
  derived: boolean;
  validFrom: string;
  validTo: string | null;
  kind: 'update' | 'extend' | 'derive' | 'assert';
}

export interface ApiKeyRec {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: string;
  lastUsed: string | null;
  ownerUid?: string;
}

export interface RequestRec {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  type: string;
}

export interface EngineState {
  documents: DocRec[];
  chunks: ChunkRec[];
  entities: EntityRec[];
  triples: TripleRec[];
  apiKeys: ApiKeyRec[];
  requests: RequestRec[];
  jobs: { id: string; status: string; message: string; at: string; ownerUid?: string; containerTag?: string }[];
}

const DATA_DIR = process.env.K_SERVICE ? path.join('/tmp', 'rukmer-data') : path.join(process.cwd(), '.rukmer-data');
const DATA_FILE = path.join(DATA_DIR, 'engine.json');

function empty(): EngineState {
  return { documents: [], chunks: [], entities: [], triples: [], apiKeys: [], requests: [], jobs: [] };
}

let state: EngineState = empty();
let gcsTimer: ReturnType<typeof setTimeout> | null = null;

function gcsTarget() {
  const bucket = process.env.MEMORY_GCS_BUCKET || (process.env.K_SERVICE ? 'rukmer-saas-data' : '');
  const object = process.env.MEMORY_GCS_OBJECT || 'engine/engine.json';
  return bucket ? { bucket, object } : null;
}

async function pullGcs() {
  const target = gcsTarget();
  if (!target) return;
  try {
    const { Storage } = await import('@google-cloud/storage');
    const [buf] = await new Storage().bucket(target.bucket).file(target.object).download();
    state = { ...empty(), ...JSON.parse(buf.toString('utf8')) };
  } catch {
    /* first run or no object yet */
  }
}

async function pushGcs() {
  const target = gcsTarget();
  if (!target) return;
  try {
    const { Storage } = await import('@google-cloud/storage');
    await new Storage().bucket(target.bucket).file(target.object).save(JSON.stringify(state), {
      contentType: 'application/json',
    });
  } catch (err) {
    console.warn('memory gcs save skipped', (err as Error).message);
  }
}

export async function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = { ...empty(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
    }
  } catch {
    state = empty();
  }
  await pullGcs();
  state.triples = (state.triples || []).map(normalizeTriple);
}

export function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    /* Cloud Run disk can be read-only besides /tmp */
  }
  if (gcsTimer) clearTimeout(gcsTimer);
  gcsTimer = setTimeout(() => {
    void pushGcs();
  }, 250);
}

export function getState() {
  return state;
}

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function sha(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function normalizeTriple(
  t: Partial<TripleRec> & Pick<TripleRec, 'id' | 'containerTag' | 'subject' | 'predicate' | 'object' | 'evidence'>
): TripleRec {
  const now = t.validFrom || new Date().toISOString();
  return {
    id: t.id,
    containerTag: t.containerTag,
    subject: t.subject,
    predicate: t.predicate,
    object: t.object,
    evidence: t.evidence,
    isLatest: t.isLatest !== false,
    derived: !!t.derived,
    validFrom: now,
    validTo: t.validTo ?? null,
    kind: t.kind || (t.derived ? 'derive' : 'assert'),
  };
}

export function chunkText(text: string, size = 480, overlap = 90): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).length > size && buf) {
      out.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap)) + ' ' + s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function cosine(a: number[], b: number[]) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function bm25Scores(query: string, docs: { id: string; text: string }[]) {
  const qTokens = tokenize(query);
  const N = Math.max(docs.length, 1);
  const df = new Map<string, number>();
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const avgdl = docs.reduce((s, d) => s + tokenize(d.text).length, 0) / N;
  const k1 = 1.2, b = 0.75;
  return docs.map((d, i) => {
    const tf = tfs[i];
    const dl = Math.max(tokenize(d.text).length, 1);
    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      const n = df.get(qt) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
    }
    return { id: d.id, score };
  });
}

export function rrf(lists: { id: string; score: number }[][], k = 60) {
  const map = new Map<string, number>();
  for (const list of lists) {
    const ranked = [...list].sort((a, b) => b.score - a.score);
    ranked.forEach((item, i) => {
      map.set(item.id, (map.get(item.id) || 0) + 1 / (k + i + 1));
    });
  }
  return [...map.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function decayWeight(createdAt: string, halfLifeDays = 90) {
  const age = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return Math.exp(-age / halfLifeDays);
}

export function expandQuery(query: string) {
  const q = query.trim().replace(/\s+/g, ' ');
  const extras: string[] = [];
  const lower = q.toLowerCase();
  if (/\bme\b|\bmyself\b|\bi\b/.test(lower)) extras.push('profile user preferences about');
  if (/work|project|doing/.test(lower)) extras.push('tasks projects status');
  if (/coffee|drink|food/.test(lower)) extras.push('preferences likes');
  return { normalized: q, expanded: extras.length ? `${q} ${extras.join(' ')}` : q };
}

export function classifyIntent(query: string): 'profile' | 'lookup' | 'chat' {
  const q = query.toLowerCase();
  if (/what do you know about me|who am i|my preference/.test(q)) return 'profile';
  if (/find|search|where|when|list/.test(q)) return 'lookup';
  return 'chat';
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortestPath(triples: TripleRec[], from: string, to: string, tag: string) {
  const scoped = triples.filter((t) => t.containerTag === tag);
  const adj = new Map<string, string[]>();
  for (const t of scoped) {
    if (!adj.has(t.subject)) adj.set(t.subject, []);
    adj.get(t.subject)!.push(t.object);
  }
  const q = [[from]];
  const seen = new Set([from.toLowerCase()]);
  while (q.length) {
    const path = q.shift()!;
    const last = path[path.length - 1];
    if (last.toLowerCase() === to.toLowerCase()) return path;
    for (const nxt of adj.get(last) || []) {
      const key = nxt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      q.push([...path, nxt]);
    }
  }
  return null;
}
