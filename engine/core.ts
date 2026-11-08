import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type ContainerTag = string;
export type MemoryScope = 'user' | 'session' | 'agent' | 'org';
export type TemporalKind = 'past' | 'present' | 'future' | 'undated';
export type Visibility = 'private' | 'team' | 'org';
export type MemoryKind = 'session' | 'working' | 'preference' | 'fact' | 'decision' | 'summary' | 'context';
export type RedactMode = 'drop' | 'mask' | 'allow';

/** Ownership and lifecycle stamped on every memory row. memory_id is the row id. */
export interface MemoryGov {
  ownerId: string;
  tenantId: string;
  visibility: Visibility;
  createdBy: string;
  sourceRef?: string;
  memoryKind: MemoryKind;
  extraction?: string;
  expiresAt?: string | null;
  archived?: boolean;
  deletedAt?: string | null;
  teamId?: string;
  redacted?: string[];
}

export interface DocRec {
  id: string;
  containerTag: string;
  title: string;
  source: string;
  mime: string;
  text: string;
  createdAt: string;
  forgotten: boolean;
  fileId?: string;
  metadata?: Record<string, string>;
  scope?: MemoryScope;
  gov?: MemoryGov;
}

export interface ChunkRec {
  id: string;
  docId: string;
  containerTag: string;
  text: string;
  index: number;
  embedding: number[];
  embeddingModel?: string;
  hash: string;
  createdAt: string;
  forgotten: boolean;
  source: string;
  metadata?: Record<string, string>;
  scope?: MemoryScope;
  gov?: MemoryGov;
}

export interface EntityRec {
  id: string;
  containerTag: string;
  name: string;
  type: string;
  memoryIds?: string[];
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
  recordedAt?: string;
  updatedAt?: string;
  embedding?: number[];
  kind: 'update' | 'extend' | 'derive' | 'assert';
  horizon?: 'long' | 'short';
  occurredAt?: string | null;
  temporal?: TemporalKind;
  metadata?: Record<string, string>;
  scope?: MemoryScope;
  gov?: MemoryGov;
}

export interface LinkRec {
  id: string;
  containerTag: string;
  fromId: string;
  toId: string;
  reason: string;
}

export interface OrgRec {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface OrgMemberRec {
  orgId: string;
  uid: string;
  role: 'owner' | 'member';
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
  ownerUid?: string;
}

export interface OauthClientRec {
  id: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OauthCodeRec {
  code: string;
  uid: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  method: string;
  exp: number;
}

export interface TeamRec {
  id: string;
  name: string;
  tenantId: string;
  createdBy: string;
  createdAt: string;
}

export interface TeamMemberRec {
  teamId: string;
  uid: string;
  role: 'owner' | 'member';
}

export interface RetentionPolicyRec {
  id: string;
  tenantId: string;
  memoryKind: MemoryKind | '*';
  ttlDays: number;
  action: 'archive' | 'purge';
}

export interface RedactionPolicyRec {
  tenantId: string;
  credentials: RedactMode;
  payment: RedactMode;
  sensitive: RedactMode;
}

export interface AuditRec {
  id: string;
  at: string;
  actorId: string;
  action: 'read' | 'write' | 'delete' | 'export' | 'retain' | 'preview';
  memoryId: string;
  tenantId: string;
  purpose?: string;
  detail?: string;
}

export interface ErasureRec {
  id: string;
  at: string;
  actorId: string;
  target: string;
  mode: 'memory' | 'owner' | 'tenant';
  dryRun: boolean;
  removed: number;
  completed: boolean;
}

export interface EngineState {
  documents: DocRec[];
  chunks: ChunkRec[];
  entities: EntityRec[];
  triples: TripleRec[];
  apiKeys: ApiKeyRec[];
  requests: RequestRec[];
  jobs: { id: string; status: string; message: string; at: string; ownerUid?: string; containerTag?: string }[];
  oauthClients: OauthClientRec[];
  oauthCodes: OauthCodeRec[];
  orgs: OrgRec[];
  orgMembers: OrgMemberRec[];
  links: LinkRec[];
  teams: TeamRec[];
  teamMembers: TeamMemberRec[];
  retentionPolicies: RetentionPolicyRec[];
  redactionPolicies: RedactionPolicyRec[];
  audit: AuditRec[];
  erasures: ErasureRec[];
  rev: number;
}

export const DATA_DIR = process.env.MEMORY_DATA_DIR || (process.env.K_SERVICE ? path.join('/tmp', 'rukmer-data') : path.join(process.cwd(), '.rukmer-data'));
const DATA_FILE = path.join(DATA_DIR, 'engine.json');

function empty(): EngineState {
  return {
    documents: [],
    chunks: [],
    entities: [],
    triples: [],
    apiKeys: [],
    requests: [],
    jobs: [],
    oauthClients: [],
    oauthCodes: [],
    orgs: [],
    orgMembers: [],
    links: [],
    teams: [],
    teamMembers: [],
    retentionPolicies: [],
    redactionPolicies: [],
    audit: [],
    erasures: [],
    rev: 0,
  };
}

function dataKey() {
  const raw = process.env.MEMORY_DATA_KEY || '';
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptionAtRest() {
  return !!dataKey();
}

/** Null when MEMORY_DATA_KEY is set. Encryption stays optional; the warning is the signal that the store is plaintext. */
export function encryptionWarning() {
  if (encryptionAtRest()) return null;
  return 'MEMORY_DATA_KEY is not set. The memory store is plaintext JSON on disk and in Cloud Storage. Set MEMORY_DATA_KEY (64 hex characters, or a passphrase) to encrypt it with AES-256-GCM.';
}

/** Whole-store AES-256-GCM. In memory the state stays plaintext so search can run. */
export function encodeState(value: unknown) {
  const json = JSON.stringify(value);
  const key = dataKey();
  if (!key) return json;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return JSON.stringify({
    enc: 'v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

export function decodeState(raw: string): Partial<EngineState> {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.enc !== 'v1') return parsed;
  const key = dataKey();
  if (!key) throw new Error('MEMORY_DATA_KEY required to read the encrypted store');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
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
    state = { ...empty(), ...decodeState(buf.toString('utf8')) };
  } catch {
    /* first run or no object yet */
  }
}

async function pushGcs() {
  const target = gcsTarget();
  if (!target) return;
  try {
    const { Storage } = await import('@google-cloud/storage');
    await new Storage().bucket(target.bucket).file(target.object).save(encodeState(state), {
      contentType: 'application/json',
    });
  } catch (err) {
    console.warn('memory gcs save skipped', (err as Error).message);
  }
}

export async function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = { ...empty(), ...decodeState(fs.readFileSync(DATA_FILE, 'utf8')) };
    }
  } catch {
    state = empty();
  }
  await pullGcs();
  state.triples = (state.triples || []).map(normalizeTriple);
  state.oauthClients = state.oauthClients || [];
  state.oauthCodes = state.oauthCodes || [];
  state.apiKeys = state.apiKeys || [];
  state.orgs = state.orgs || [];
  state.orgMembers = state.orgMembers || [];
  state.links = state.links || [];
  state.teams = state.teams || [];
  state.teamMembers = state.teamMembers || [];
  state.retentionPolicies = state.retentionPolicies || [];
  state.redactionPolicies = state.redactionPolicies || [];
  state.audit = state.audit || [];
  state.erasures = state.erasures || [];
  state.rev = state.rev || 0;
}

function writeLocal() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, encodeState(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    /* Cloud Run disk can be read-only besides /tmp */
  }
}

export function saveState() {
  state.rev = (state.rev || 0) + 1;
  writeLocal();
  if (gcsTimer) clearTimeout(gcsTimer);
  gcsTimer = setTimeout(() => {
    void pushGcs();
  }, 250);
}

export async function persistNow() {
  writeLocal();
  if (gcsTimer) {
    clearTimeout(gcsTimer);
    gcsTimer = null;
  }
  await pushGcs();
}

export function getState() {
  return state;
}

export async function saveBlob(id: string, bytes: Buffer, mime = 'application/octet-stream') {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid file id');
  const dir = path.join(DATA_DIR, 'files');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), bytes);
  const target = gcsTarget();
  if (!target) return;
  try {
    const { Storage } = await import('@google-cloud/storage');
    await new Storage().bucket(target.bucket).file(`engine/files/${id}`).save(bytes, { contentType: mime });
  } catch (err) {
    console.warn('file blob gcs skipped', (err as Error).message);
  }
}

export function deleteBlob(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return;
  const file = path.join(DATA_DIR, 'files', id);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* blob already gone */
  }
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
    recordedAt: t.recordedAt,
    updatedAt: t.updatedAt,
    embedding: Array.isArray(t.embedding) && t.embedding.length ? t.embedding : undefined,
    kind: t.kind || (t.derived ? 'derive' : 'assert'),
    horizon: t.horizon === 'short' ? 'short' : t.horizon === 'long' ? 'long' : undefined,
    occurredAt: t.occurredAt ?? null,
    temporal: t.temporal === 'past' || t.temporal === 'present' || t.temporal === 'future' || t.temporal === 'undated' ? t.temporal : undefined,
    metadata: t.metadata,
    scope: t.scope,
    gov: t.gov,
  };
}

export function sanitizeMeta(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_.:-]{1,40}$/.test(k)) continue;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
    out[k] = String(v).slice(0, 200);
    if (Object.keys(out).length >= 20) break;
  }
  return Object.keys(out).length ? out : undefined;
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

export function chunkCode(text: string, size = 900): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  const parts = clean
    .split(/\n(?=(?:export\s+)?(?:async\s+)?(?:function|class|def|interface|type|const|let)\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const part of parts.length ? parts : [clean]) {
    if ((buf + '\n' + part).length > size && buf) {
      out.push(buf.trim());
      buf = part;
    } else {
      buf = buf ? `${buf}\n${part}` : part;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
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
