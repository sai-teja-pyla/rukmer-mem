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
  originalText?: string;
  createdAt: string;
  forgotten: boolean;
  fileId?: string;
  metadata?: Record<string, string>;
  scope?: MemoryScope;
  gov?: MemoryGov;
  processingStatus?: 'queued' | 'searchable' | 'done';
  memoryStatusReason?: string;
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
  originalText?: string;
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
  role: 'owner' | 'admin' | 'member';
  status?: 'active' | 'removed';
  joinedAt?: string;
}

export interface ApiKeyRec {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: string;
  lastUsed: string | null;
  ownerUid?: string;
  connector?: string;
  source?: 'console' | 'oauth' | 'cli' | 'mcp' | 'plugin';
  createdBy?: { uid: string; email?: string; name?: string };
  orgId?: string;
  teamId?: string;
  readOnly?: boolean;
  containerTags?: string[];
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
  label?: string;
  connector?: string;
  teamId?: string;
  orgId?: string;
  readOnly?: boolean;
  containerTags?: string[];
  scope?: string;
}

export interface OauthRefreshRec {
  hash: string;
  keyHash: string;
  uid: string;
  exp: number;
}

export interface BrowserPairRec {
  hash: string;
  uid: string;
  exp: number;
}

export interface TeamRec {
  id: string;
  name: string;
  tenantId: string;
  orgId?: string;
  kind?: 'general' | 'custom';
  slug?: string;
  archivedAt?: string | null;
  createdBy: string;
  createdAt: string;
  requireApproval?: boolean;
}

export interface TeamMemberRec {
  teamId: string;
  uid: string;
  role: 'owner' | 'admin' | 'member';
  status?: 'active' | 'removed' | 'pending';
  joinedAt?: string;
  removedAt?: string;
  displayName?: string;
  email?: string;
  lastActiveAt?: string;
}

export interface TeamInviteRec {
  id: string;
  teamId: string;
  orgId: string;
  createdBy: string;
  tokenHash: string;
  codeHash: string;
  role: 'owner' | 'admin' | 'member';
  expiresAt: string;
  maxUses: number;
  uses?: number;
  status: 'pending' | 'accepted' | 'confirmed' | 'expired' | 'revoked';
  inviteeUid?: string;
  inviteeEmail?: string;
  inviteeName?: string;
  inviterKey?: string;
  inviteeKey?: string;
  sas?: string;
  sasDigits?: string;
  inviterConfirmedAt?: string;
  inviteeConfirmedAt?: string;
  createdAt: string;
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
  action: 'read' | 'write' | 'delete' | 'export' | 'retain' | 'preview' | 'move' | 'invite' | 'join' | 'leave' | 'revoke';
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
  oauthRefreshes: OauthRefreshRec[];
  browserPairs: BrowserPairRec[];
  orgs: OrgRec[];
  orgMembers: OrgMemberRec[];
  links: LinkRec[];
  teams: TeamRec[];
  teamMembers: TeamMemberRec[];
  teamInvites: TeamInviteRec[];
  retentionPolicies: RetentionPolicyRec[];
  redactionPolicies: RedactionPolicyRec[];
  audit: AuditRec[];
  erasures: ErasureRec[];
  connectorRequests?: { id: string; at: string; uid: string; email?: string; tool: string; useCase: string }[];
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
    oauthRefreshes: [],
    browserPairs: [],
    orgs: [],
    orgMembers: [],
    links: [],
    teams: [],
    teamMembers: [],
    teamInvites: [],
    retentionPolicies: [],
    redactionPolicies: [],
    audit: [],
    erasures: [],
    connectorRequests: [],
    rev: 0,
  };
}

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

function productionRuntime() {
  return process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
}

/** 64 hex is the key. Local dev may still hash a passphrase. Production never does. */
function keyMaterial(name: 'MEMORY_DATA_KEY' | 'MEMORY_DATA_KEY_PREVIOUS') {
  const raw = (process.env[name] || '').trim();
  if (!raw) return null;
  if (HEX_KEY.test(raw)) return Buffer.from(raw, 'hex');
  if (productionRuntime()) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function keyId(key: Buffer) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function encryptionAtRest() {
  return !!keyMaterial('MEMORY_DATA_KEY');
}

/** Null when a usable data key is set. The text stays off the public health body. */
export function encryptionWarning() {
  if (encryptionAtRest()) return null;
  const raw = (process.env.MEMORY_DATA_KEY || '').trim();
  if (raw) return 'MEMORY_DATA_KEY must be 64 hex characters.';
  return 'MEMORY_DATA_KEY is not set.';
}

type StoreEnvelope = { enc?: string; kid?: string; iv?: string; tag?: string; data?: string };

function decryptEnvelope(parsed: StoreEnvelope, key: Buffer): Partial<EngineState> {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(parsed.iv || ''), 'base64'));
  decipher.setAuthTag(Buffer.from(String(parsed.tag || ''), 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(String(parsed.data || ''), 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function envelopeOpens(parsed: StoreEnvelope, key: Buffer) {
  try {
    decryptEnvelope(parsed, key);
    return true;
  } catch {
    return false;
  }
}

/** Whole-store AES-256-GCM under the current key. In memory the state stays plaintext so search can run. */
export function encodeState(value: unknown) {
  const json = JSON.stringify(value);
  const key = keyMaterial('MEMORY_DATA_KEY');
  if (!key) return json;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return JSON.stringify({
    enc: 'v1',
    kid: keyId(key),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

export function decodeState(raw: string): Partial<EngineState> {
  const parsed = JSON.parse(raw) as StoreEnvelope;
  if (!parsed || parsed.enc !== 'v1') return parsed as Partial<EngineState>;
  const keys = [];
  const currentKey = keyMaterial('MEMORY_DATA_KEY');
  const previousKey = keyMaterial('MEMORY_DATA_KEY_PREVIOUS');
  if (currentKey) keys.push(currentKey);
  if (previousKey) keys.push(previousKey);
  if (!keys.length) throw new Error('MEMORY_DATA_KEY required to read the encrypted store');
  let last: unknown;
  for (const key of keys) {
    try {
      return decryptEnvelope(parsed, key);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('MEMORY_DATA_KEY required to read the encrypted store');
}

let storeNeedsRewrite = false;

function noteRawStore(raw: string) {
  let parsed: StoreEnvelope | null = null;
  try {
    parsed = JSON.parse(raw) as StoreEnvelope;
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.enc !== 'v1') {
    storeNeedsRewrite = true;
    return;
  }
  const current = keyMaterial('MEMORY_DATA_KEY');
  if (current && envelopeOpens(parsed, current)) return;
  const previous = keyMaterial('MEMORY_DATA_KEY_PREVIOUS');
  if (previous && envelopeOpens(parsed, previous)) storeNeedsRewrite = true;
}

export function loadedStoreNeedsReencrypt() {
  return storeNeedsRewrite;
}

/** Production boot refuses a missing bucket or a key that is not 64 hex characters. */
export function assertProductionSecrets() {
  if (!productionRuntime()) return;
  const raw = (process.env.MEMORY_DATA_KEY || '').trim();
  if (!HEX_KEY.test(raw)) {
    throw Object.assign(new Error('MEMORY_DATA_KEY must be 64 hex characters'), { status: 503 });
  }
  const previous = (process.env.MEMORY_DATA_KEY_PREVIOUS || '').trim();
  if (previous && !HEX_KEY.test(previous)) {
    throw Object.assign(new Error('MEMORY_DATA_KEY_PREVIOUS must be 64 hex characters'), { status: 503 });
  }
  resolveGcsTarget();
}

let state: EngineState = empty();
let gcsTimer: ReturnType<typeof setTimeout> | null = null;
let gcsGeneration = 0;
let gcsMergeAt = 0;
let storeSource: 'gcs' | 'local' | 'memory' | 'error' = 'memory';
let storeProblem = '';
let storeReader: null | (() => Promise<string | null>) = null;

export function setMemoryStoreReaderForTests(reader: (() => Promise<string | null>) | null) {
  storeReader = reader;
}

export function memoryStoreSource() {
  return storeSource;
}

export function memoryStoreProblem() {
  return storeProblem;
}

export function noteMemoryStoreProblem(message: string) {
  storeProblem = message;
  storeSource = 'error';
}

function isMissingStore(err: unknown) {
  return Number((err as { code?: number }).code || 0) === 404;
}

export type GcsSaveOptions = {
  contentType: string;
  cacheControl: 'private, no-store';
  metadata: { contentType: string; cacheControl: 'private, no-store' };
  resumable?: false;
  preconditionOpts?: { ifGenerationMatch: number };
};

/** Object metadata the library actually writes. No ACL fields. */
export function gcsSaveOptions(contentType: string, generation?: number): GcsSaveOptions {
  const options: GcsSaveOptions = {
    contentType,
    cacheControl: 'private, no-store',
    metadata: { contentType, cacheControl: 'private, no-store' },
  };
  if (generation !== undefined) {
    options.resumable = false;
    options.preconditionOpts = { ifGenerationMatch: generation };
  }
  return options;
}

type GcsFileHandle = {
  save: (data: string | Buffer, opts: GcsSaveOptions) => Promise<void>;
  download: () => Promise<[Buffer]>;
  getMetadata: () => Promise<[{ generation?: number | string }]>;
};

type GcsBucketHandle = { file: (name: string) => GcsFileHandle };

let testBucketFactory: ((bucket: string) => GcsBucketHandle) | null = null;

export function setGcsClientForTests(factory: ((bucket: string) => GcsBucketHandle) | null) {
  testBucketFactory = factory;
}

async function openBucket(name: string): Promise<GcsBucketHandle> {
  if (testBucketFactory) return testBucketFactory(name);
  if (process.env.NODE_ENV === 'test') throw new Error('Refusing to contact Cloud Storage from a test');
  const { Storage } = await import('@google-cloud/storage');
  return new Storage().bucket(name) as unknown as GcsBucketHandle;
}

/** Production requires MEMORY_GCS_BUCKET. There is no built-in bucket name. */
export function resolveGcsTarget(): { bucket: string; object: string } | null {
  const bucket = (process.env.MEMORY_GCS_BUCKET || '').trim();
  const object = (process.env.MEMORY_GCS_OBJECT || 'engine/engine.json').trim() || 'engine/engine.json';
  if (object.includes('..') || object.startsWith('/') || object.includes('\\')) {
    throw new Error('MEMORY_GCS_OBJECT is invalid');
  }
  if (!bucket) {
    if (productionRuntime()) throw new Error('MEMORY_GCS_BUCKET is required in production');
    return null;
  }
  return { bucket, object };
}

function gcsFile() {
  const target = resolveGcsTarget();
  if (!target) return null;
  return openBucket(target.bucket).then((bucket) => bucket.file(target.object));
}

export type StoreProbe = (input: { url: string; method: 'HEAD' | 'GET' }) => Promise<{ status: number }>;

let storeProbe: StoreProbe | null = null;

export function setStoreProbeForTests(probe: StoreProbe | null) {
  storeProbe = probe;
}

function anonymousObjectUrl(bucket: string, object: string) {
  const name = object.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name}`;
}

function anonymousListUrl(bucket: string) {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?maxResults=1&fields=kind`;
}

async function defaultStoreProbe(input: { url: string; method: 'HEAD' | 'GET' }) {
  const res = await fetch(input.url, { method: input.method, redirect: 'manual' });
  await res.body?.cancel?.();
  return { status: res.status };
}

/** Unauthenticated HEAD/list. Status 200 fails production boot. The body is never read. */
export async function assertStoreNotPublic() {
  if (!productionRuntime()) return;
  const target = resolveGcsTarget();
  if (!target) return;
  const probe = storeProbe || defaultStoreProbe;
  let objectStatus = 0;
  try {
    objectStatus = (await probe({ url: anonymousObjectUrl(target.bucket, target.object), method: 'HEAD' })).status;
  } catch {
    objectStatus = 0;
  }
  if (objectStatus === 200) {
    console.error('CRITICAL memory store object is anonymously readable');
    throw Object.assign(new Error('Memory store is not private'), { status: 503 });
  }
  let listStatus = 0;
  try {
    listStatus = (await probe({ url: anonymousListUrl(target.bucket), method: 'GET' })).status;
  } catch {
    listStatus = 0;
  }
  if (listStatus === 200) {
    console.error('CRITICAL memory bucket listing is anonymously readable');
    throw Object.assign(new Error('Memory store is not private'), { status: 503 });
  }
}

async function pullGcs() {
  try {
    if (storeReader) {
      const raw = await storeReader();
      if (raw == null) return false;
      noteRawStore(raw);
      state = { ...empty(), ...decodeState(raw) };
      return true;
    }
    const file = await gcsFile();
    if (!file) return false;
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    gcsGeneration = Number(meta.generation || 0);
    const raw = buf.toString('utf8');
    noteRawStore(raw);
    state = { ...empty(), ...decodeState(raw) };
    return true;
  } catch (err) {
    if (isMissingStore(err)) return false;
    noteMemoryStoreProblem("Couldn't read the memory store");
    console.error('memory store read failed', (err as Error).message || err);
    throw Object.assign(new Error("Couldn't read the memory store"), { status: 503, expose: true });
  }
}

/** Pull API keys written by another instance without replacing newer local memory. */
export async function mergeRemoteApiKeys() {
  if (Date.now() - gcsMergeAt < 3000) return;
  gcsMergeAt = Date.now();
  const file = await gcsFile();
  if (!file) return;
  try {
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    gcsGeneration = Number(meta.generation || gcsGeneration || 0);
    const remote = decodeState(buf.toString('utf8'));
    const seen = new Set(state.apiKeys.map((k) => k.hash));
    for (const key of remote.apiKeys || []) {
      if (key?.hash && !seen.has(key.hash)) state.apiKeys.push(key);
    }
  } catch {
    /* object missing */
  }
}

async function pushGcs(attempt = 0): Promise<boolean> {
  const file = await gcsFile();
  if (!file) return true;
  try {
    await file.save(encodeState(state), gcsSaveOptions('application/json', gcsGeneration));
    const [meta] = await file.getMetadata();
    gcsGeneration = Number(meta.generation || 0);
    return true;
  } catch (err) {
    const code = Number((err as { code?: number }).code || 0);
    if (code === 412 && attempt < 3) {
      try {
        const [buf] = await file.download();
        const [meta] = await file.getMetadata();
        const remote = decodeState(buf.toString('utf8'));
        gcsGeneration = Number(meta.generation || 0);
        state = mergeStoredState(state, remote);
        shapeState();
        return pushGcs(attempt + 1);
      } catch (inner) {
        console.warn('memory gcs conflict', (inner as Error).message);
        return false;
      }
    }
    console.warn('memory gcs save skipped', (err as Error).message);
    return false;
  }
}

function unionBy<T>(primary: T[] | undefined, extra: T[] | undefined, id: (row: T) => string) {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(extra) ? extra : [])]) {
    const key = id(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Keep the newer memory snapshot and carry keys and browser pairings from the other copy. */
export function mergeStoredState(local: Partial<EngineState>, remote: Partial<EngineState>): EngineState {
  const remoteRev = Number(remote.rev || 0);
  const localRev = Number(local.rev || 0);
  const newer = remoteRev > localRev ? remote : local;
  const older = newer === remote ? local : remote;
  const merged = { ...empty(), ...newer };
  merged.apiKeys = unionBy(newer.apiKeys, older.apiKeys, (row) => row.hash);
  merged.browserPairs = unionBy(newer.browserPairs, older.browserPairs, (row) => row.hash);
  merged.oauthRefreshes = unionBy(newer.oauthRefreshes, older.oauthRefreshes, (row) => row.hash);
  merged.oauthCodes = unionBy(newer.oauthCodes, older.oauthCodes, (row) => row.code);
  merged.rev = Math.max(remoteRev, localRev) + 1;
  return merged;
}

function shapeState() {
  state.triples = (state.triples || []).map(normalizeTriple);
  state.oauthClients = state.oauthClients || [];
  state.oauthCodes = state.oauthCodes || [];
  state.oauthRefreshes = state.oauthRefreshes || [];
  state.browserPairs = Array.isArray(state.browserPairs) ? state.browserPairs : [];
  state.apiKeys = state.apiKeys || [];
  state.orgs = state.orgs || [];
  state.orgMembers = state.orgMembers || [];
  state.links = state.links || [];
  state.teams = state.teams || [];
  state.teamMembers = state.teamMembers || [];
  state.teamInvites = state.teamInvites || [];
  state.retentionPolicies = state.retentionPolicies || [];
  state.redactionPolicies = state.redactionPolicies || [];
  state.audit = state.audit || [];
  state.erasures = state.erasures || [];
  state.connectorRequests = state.connectorRequests || [];
  state.documents = state.documents || [];
  state.chunks = state.chunks || [];
  state.entities = state.entities || [];
  state.requests = state.requests || [];
  state.jobs = state.jobs || [];
  state.rev = state.rev || 0;
}

export async function loadState() {
  storeNeedsRewrite = false;
  let hadLocal = false;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      noteRawStore(raw);
      state = { ...empty(), ...decodeState(raw) };
      hadLocal = true;
    }
  } catch {
    state = empty();
    storeNeedsRewrite = false;
  }
  const fromGcs = await pullGcs();
  shapeState();
  storeProblem = '';
  storeSource = fromGcs ? 'gcs' : hadLocal ? 'local' : 'memory';
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

export function discardPendingPersistForTests() {
  if (gcsTimer) {
    clearTimeout(gcsTimer);
    gcsTimer = null;
  }
}

export async function persistNow() {
  writeLocal();
  if (gcsTimer) {
    clearTimeout(gcsTimer);
    gcsTimer = null;
  }
  const saved = await pushGcs();
  if (!saved && process.env.K_SERVICE) throw new Error('Memory store could not be saved');
}

/** Rewrite a plaintext store, or one opened with the previous key, under the current key. */
export async function reencryptLoadedStore() {
  if (!encryptionAtRest() || !storeNeedsRewrite) return false;
  await persistNow();
  storeNeedsRewrite = false;
  return true;
}

export function getState() {
  return state;
}

export async function saveBlob(id: string, bytes: Buffer, mime = 'application/octet-stream') {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid file id');
  const dir = path.join(DATA_DIR, 'files');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), bytes);
  const target = resolveGcsTarget();
  if (!target) return;
  try {
    const bucket = await openBucket(target.bucket);
    await bucket.file(`engine/files/${id}`).save(bytes, gcsSaveOptions(mime));
  } catch (err) {
    console.warn('file blob gcs skipped', (err as Error).message);
  }
}

export function readBlob(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const root = path.resolve(DATA_DIR, 'files');
  const file = path.resolve(root, id);
  if (file !== path.join(root, id)) return null;
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
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
  if (/\bfavou?rites?\b|\bfavorites?\b/.test(lower)) extras.push('prefer');
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
