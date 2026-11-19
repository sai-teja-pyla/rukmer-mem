/**
 * Bucket privacy, encryption at rest, and legacy upload URLs.
 * Run: npm run storage-privacy
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-store-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.K_SERVICE;
delete process.env.MEMORY_GCS_BUCKET;
delete process.env.MEMORY_GCS_OBJECT;
delete process.env.MEMORY_DATA_KEY;
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.UPLOAD_GCS_BUCKET;

const PREV = '11'.repeat(32);
const CUR = '22'.repeat(32);

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const core = await import('./core.js');
const { mountMemoryEngine, memoryEngineReady, bootMemoryEngine } = await import('./routes.js');
const { mountUserStorageRoutes } = await import('./security.js');

const storeFile = path.join(dir, 'engine.json');
fs.writeFileSync(storeFile, JSON.stringify({ documents: [{ id: 'd1', text: 'plain-quartz', containerTag: 'u_usera', forgotten: false, source: 'api' }], rev: 4 }));

process.env.MEMORY_DATA_KEY = CUR;
await core.loadState();
check('plaintext load is marked for rewrite', core.loadedStoreNeedsReencrypt());
check('plaintext load keeps the memory', core.getState().documents.some((doc) => doc.text === 'plain-quartz'));
check('migration rewrites the store', (await core.reencryptLoadedStore()) === true);
const sealedDisk = fs.readFileSync(storeFile, 'utf8');
check('plaintext fixture is encrypted on disk', sealedDisk.includes('"enc":"v1"') && !sealedDisk.includes('plain-quartz'));
await core.loadState();
check('rewritten store reloads', core.getState().documents.some((doc) => doc.text === 'plain-quartz') && !core.loadedStoreNeedsReencrypt());

process.env.MEMORY_DATA_KEY = PREV;
const previousEnvelope = core.encodeState(core.getState());
fs.writeFileSync(storeFile, previousEnvelope);
process.env.MEMORY_DATA_KEY = CUR;
process.env.MEMORY_DATA_KEY_PREVIOUS = PREV;
await core.loadState();
check('previous key opens the store', core.getState().documents.some((doc) => doc.text === 'plain-quartz'));
check('previous-key store is marked for rewrite', core.loadedStoreNeedsReencrypt());
await core.reencryptLoadedStore();
const rotated = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as { enc?: string; kid?: string };
const currentKid = JSON.parse(core.encodeState({ marker: 1 })).kid;
check('migrated envelope uses the current key id', rotated.enc === 'v1' && rotated.kid === currentKid && !fs.readFileSync(storeFile, 'utf8').includes('plain-quartz'));
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
await core.loadState();
check('current key reads the migrated store', core.getState().documents.some((doc) => doc.text === 'plain-quartz'));

process.env.MEMORY_DATA_KEY = PREV;
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
const older = core.encodeState({ secret: 'old-quartz' });
process.env.MEMORY_DATA_KEY = CUR;
process.env.MEMORY_DATA_KEY_PREVIOUS = PREV;
const opened = (raw: string) => core.decodeState(raw) as { secret?: string };
check('decode tries the previous key', opened(older).secret === 'old-quartz');
const newer = core.encodeState({ secret: 'new-quartz' });
check('encode always uses the current key id', JSON.parse(newer).enc === 'v1' && JSON.parse(newer).kid !== JSON.parse(older).kid);
check('current key round-trips', opened(newer).secret === 'new-quartz');
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
let previousBlocked = false;
try {
  core.decodeState(older);
} catch {
  previousBlocked = true;
}
check('previous envelope stays closed without the previous key', previousBlocked);

delete process.env.K_SERVICE;
process.env.NODE_ENV = 'test';
process.env.MEMORY_DATA_KEY = 'correct horse battery';
const devSealed = core.encodeState({ secret: 'dev-quartz' });
check('dev passphrase still seals', devSealed.includes('"enc":"v1"') && !devSealed.includes('dev-quartz'));
check('dev passphrase round-trips', opened(devSealed).secret === 'dev-quartz');

process.env.NODE_ENV = 'production';
process.env.MEMORY_DATA_KEY = 'correct horse battery';
const refusedPass = core.encodeState({ secret: 'plain-quartz' });
check('production does not hash a passphrase', !refusedPass.includes('"enc"') && core.encryptionAtRest() === false);

process.env.NODE_ENV = 'test';
delete process.env.K_SERVICE;
delete process.env.MEMORY_GCS_BUCKET;
check('dev without a bucket stays local', core.resolveGcsTarget() === null);
process.env.K_SERVICE = 'rukmer-saas-service';
let cloudRunThrew = false;
let cloudRunMessage = '';
try {
  core.resolveGcsTarget();
} catch (err) {
  cloudRunThrew = true;
  cloudRunMessage = (err as Error).message;
}
check('production runtime does not default a bucket', cloudRunThrew && !cloudRunMessage.includes('rukmer-saas-data'));
delete process.env.K_SERVICE;
process.env.NODE_ENV = 'production';
let missingBucket = false;
try {
  core.resolveGcsTarget();
} catch (err) {
  missingBucket = true;
  cloudRunMessage = (err as Error).message;
}
check('production refuses a missing bucket', missingBucket && !cloudRunMessage.includes('rukmer-saas-data'));
check('engine source has no built-in store bucket', !fs.readFileSync(new URL('./core.ts', import.meta.url), 'utf8').includes('rukmer-saas-data'));

process.env.MEMORY_GCS_BUCKET = 'unit-private-bucket';
delete process.env.MEMORY_DATA_KEY;
let missingKey = false;
try {
  core.assertProductionSecrets();
} catch (err) {
  missingKey = /64 hex/.test((err as Error).message);
}
check('production refuses a missing data key', missingKey);
process.env.MEMORY_DATA_KEY = 'not-a-hex-key';
let badKey = false;
try {
  core.assertProductionSecrets();
} catch (err) {
  badKey = /64 hex/.test((err as Error).message);
}
check('production refuses a non-hex data key', badKey);
process.env.MEMORY_DATA_KEY = `${CUR}\n`;
process.env.MEMORY_DATA_KEY_PREVIOUS = 'short';
let badPrevious = false;
try {
  core.assertProductionSecrets();
} catch (err) {
  badPrevious = /MEMORY_DATA_KEY_PREVIOUS/.test((err as Error).message);
}
check('production refuses a bad previous key', badPrevious);
process.env.MEMORY_DATA_KEY_PREVIOUS = PREV;
core.assertProductionSecrets();
check('trimmed 64-hex key is accepted', core.encryptionAtRest() === true && core.resolveGcsTarget()?.bucket === 'unit-private-bucket');

const saves: { bucket: string; name: string; opts: Record<string, unknown> }[] = [];
core.setGcsClientForTests((bucket) => ({
  file(name: string) {
    return {
      async save(_data: string | Buffer, opts: Record<string, unknown>) {
        saves.push({ bucket, name, opts });
      },
      async download() {
        const raw = fs.existsSync(storeFile) ? fs.readFileSync(storeFile) : Buffer.from('{}');
        return [raw];
      },
      async getMetadata() {
        return [{ generation: 7 }];
      },
    };
  },
}));
process.env.NODE_ENV = 'test';
delete process.env.K_SERVICE;
process.env.MEMORY_DATA_KEY = CUR;
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
saves.length = 0;
await core.saveBlob('file1', Buffer.from('abc'), 'text/plain');
await core.persistNow();
const blobSave = saves.find((row) => row.name === 'engine/files/file1');
const stateSave = saves.find((row) => row.name === 'engine/engine.json');
const blobMeta = blobSave?.opts.metadata as { cacheControl?: string } | undefined;
const stateMeta = stateSave?.opts.metadata as { cacheControl?: string } | undefined;
check('blob save sets private cache control', blobSave?.opts.cacheControl === 'private, no-store' && blobMeta?.cacheControl === 'private, no-store' && blobSave?.opts.contentType === 'text/plain');
check(
  'state save sets private cache control',
  stateSave?.opts.cacheControl === 'private, no-store' && stateMeta?.cacheControl === 'private, no-store' && stateSave?.opts.resumable === false && stateSave?.opts.contentType === 'application/json'
);
check(
  'saves never set a public acl',
  saves.length >= 2 &&
    saves.every((row) => row.opts.predefinedAcl === undefined && row.opts.public === undefined && !JSON.stringify(row.opts).includes('makePublic') && !JSON.stringify(row.opts).includes('publicRead'))
);

const signed: { name: string; cfg: { version?: string; action?: string; expires?: number; contentType?: string } }[] = [];
const prefixes: string[] = [];
const known = new Set(['uploads/userA/1_note.txt']);
const app = express();
app.use(express.json());
mountMemoryEngine(app);
mountUserStorageRoutes(app, {
  authenticate(req, res, next) {
    const header = String(req.headers.authorization || '');
    if (header !== 'Bearer test-token') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as { user?: { uid: string } }).user = { uid: 'userA' };
    next();
  },
  sessionUid(req, res, claimed) {
    const uid = String((req as { user?: { uid?: string } }).user?.uid || '');
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    if (claimed && String(claimed) !== uid) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return uid;
  },
  bucket: () => ({
    file(name: string) {
      return {
        async getSignedUrl(cfg: { version?: string; action?: string; expires?: number; contentType?: string }) {
          signed.push({ name, cfg });
          if (cfg.action === 'read') return [`https://storage.googleapis.com/unit/obj?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc`];
          return ['signed-resumable-upload'];
        },
        async exists() {
          return [known.has(name)];
        },
      };
    },
    async getFiles(query: { prefix: string }) {
      prefixes.push(query.prefix);
      return [[
        { name: 'uploads/userA/1_note.txt', metadata: { timeCreated: '2026-11-18T05:46:00.000Z' } },
        { name: 'uploads/userB/secret.txt', metadata: { timeCreated: '2026-11-18T05:46:00.000Z' } },
        { name: 'engine/engine.json', metadata: { timeCreated: '2026-11-18T05:46:00.000Z' } },
      ]];
    },
  }),
});
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;

async function hit(urlPath: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { ...init, headers });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, text };
}

const anonUpload = await hit('/api/storage/resumable-url', { method: 'POST', body: JSON.stringify({ fileName: 'a.txt', contentType: 'text/plain' }) });
check('upload route requires auth', anonUpload.status === 401);
const upload = await hit('/api/storage/resumable-url', {
  method: 'POST',
  headers: { Authorization: 'Bearer test-token' },
  body: JSON.stringify({ fileName: '../engine/engine.json', contentType: 'text/plain', userId: 'userA' }),
});
const uploadPath = String(upload.body.path || '');
check(
  'resumable body has no public object url',
  upload.status === 200 &&
    upload.body.publicUrl === undefined &&
    upload.body.url === undefined &&
    uploadPath.startsWith('uploads/userA/') &&
    !uploadPath.includes('..') &&
    !upload.text.includes('https://storage.googleapis.com/')
);
const foreignUpload = await hit('/api/storage/resumable-url', {
  method: 'POST',
  headers: { Authorization: 'Bearer test-token' },
  body: JSON.stringify({ fileName: 'a.txt', contentType: 'text/plain', userId: 'userB' }),
});
check('upload route rejects another user id', foreignUpload.status === 403);
const missingType = await hit('/api/storage/resumable-url', {
  method: 'POST',
  headers: { Authorization: 'Bearer test-token' },
  body: JSON.stringify({ fileName: 'a.txt' }),
});
check('upload route requires a content type', missingType.status === 400);

const list = await hit('/api/storage/files', { headers: { Authorization: 'Bearer test-token' } });
const listed = Array.isArray(list.body) ? list.body : [];
check(
  'file list is prefixed and has no public url',
  list.status === 200 &&
    prefixes.includes('uploads/userA/') &&
    listed.length === 1 &&
    (listed[0] as { path?: string; url?: string }).path === 'uploads/userA/1_note.txt' &&
    (listed[0] as { url?: string }).url === undefined &&
    !list.text.includes('https://storage.googleapis.com/') &&
    !list.text.includes('engine/engine.json') &&
    !list.text.includes('userB')
);

async function readUrl(objectPath: string) {
  return hit(`/api/storage/files/url?path=${encodeURIComponent(objectPath)}`, { headers: { Authorization: 'Bearer test-token' } });
}
const ownRead = await readUrl('uploads/userA/1_note.txt');
const readCfg = signed.find((row) => row.cfg.action === 'read');
const expiresIn = Number(readCfg?.cfg.expires || 0) - Date.now();
check(
  'owner receives a 10-minute v4 read url',
  ownRead.status === 200 &&
    readCfg?.cfg.version === 'v4' &&
    readCfg.cfg.action === 'read' &&
    expiresIn > 9 * 60 * 1000 &&
    expiresIn < 11 * 60 * 1000 &&
    ownRead.body.expiresIn === 600 &&
    String(ownRead.body.url || '').includes('X-Goog-Algorithm')
);
check('engine object is not signed', (await readUrl('engine/engine.json')).status === 403);
check('another user object is not signed', (await readUrl('uploads/userB/secret.txt')).status === 403);
check('path traversal is not signed', (await readUrl('uploads/userA/../../engine/engine.json')).status === 403);
check('missing object is not signed', (await readUrl('uploads/userA/missing.txt')).status === 404);

const securitySrc = fs.readFileSync(new URL('./security.ts', import.meta.url), 'utf8');
const routeSrc = securitySrc.slice(securitySrc.indexOf('export function mountUserStorageRoutes'));
const serverSrc = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
check('storage route source does not build a public object url', !routeSrc.includes('https://storage.googleapis.com/') && !serverSrc.includes('https://storage.googleapis.com/'));

function sourceFiles(root: string, out: string[]) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !entry.name.includes('-test.') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
}
const files: string[] = [];
sourceFiles(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), files);
const aclHits = files.filter((file) => /makePublic|predefinedAcl|publicRead/.test(fs.readFileSync(file, 'utf8')));
check('application code sets no public object acl', aclHits.length === 0, aclHits.join(','));

process.env.NODE_ENV = 'production';
delete process.env.K_SERVICE;
process.env.MEMORY_GCS_BUCKET = 'unit-private-bucket';
process.env.MEMORY_DATA_KEY = CUR;
delete process.env.MEMORY_DATA_KEY_PREVIOUS;
core.setStoreProbeForTests(async () => ({ status: 200 }));
let publicBoot = false;
try {
  await bootMemoryEngine();
} catch (err) {
  publicBoot = /not private/.test((err as Error).message);
}
const publicHealth = await hit('/health');
const publicHealthText = JSON.stringify(publicHealth.body);
check('anonymous 200 fails production boot', publicBoot && memoryEngineReady() === false);
check(
  'failed boot health hides the bucket',
  publicHealth.status === 503 &&
    publicHealth.body.ready === false &&
    publicHealth.body.encryptionAtRest === true &&
    !('store' in publicHealth.body) &&
    !('providers' in publicHealth.body) &&
    !('encryptionWarning' in publicHealth.body) &&
    !publicHealthText.includes('unit-private-bucket') &&
    !publicHealthText.includes('engine.json') &&
    !publicHealthText.toLowerCase().includes('plaintext') &&
    !publicHealthText.includes('storage.googleapis.com')
);

let sawList = false;
core.setStoreProbeForTests(async ({ url, method }) => {
  if (method === 'GET' && url.includes('/o?')) {
    sawList = true;
    return { status: 200 };
  }
  return { status: 403 };
});
let listBoot = false;
try {
  await bootMemoryEngine();
} catch (err) {
  listBoot = /not private/.test((err as Error).message);
}
check('anonymous bucket list fails production boot', listBoot && sawList && memoryEngineReady() === false);

const probes: { url: string; method: string }[] = [];
core.setStoreProbeForTests(async (input) => {
  probes.push(input);
  if (probes.length === 1) throw new Error('network down');
  return { status: 403 };
});
await bootMemoryEngine();
const readyHealth = await hit('/health');
check('network error then 403 allows boot', memoryEngineReady() === true && readyHealth.status === 200 && readyHealth.body.encryptionAtRest === true);
check(
  'probe is an unauthenticated head and a list',
  probes.some((row) => row.method === 'HEAD' && row.url.startsWith('https://storage.googleapis.com/unit-private-bucket/')) &&
    probes.some((row) => row.method === 'GET' && row.url.includes('/storage/v1/b/unit-private-bucket/o?'))
);
check(
  'ready health stays slim',
  readyHealth.body.ok === true &&
    !('store' in readyHealth.body) &&
    !('providers' in readyHealth.body) &&
    !('encryptionWarning' in readyHealth.body) &&
    !JSON.stringify(readyHealth.body).includes('unit-private-bucket')
);

delete process.env.MEMORY_DATA_KEY;
let refusedBoot = false;
try {
  await bootMemoryEngine();
} catch (err) {
  refusedBoot = /64 hex/.test((err as Error).message);
}
const downHealth = await hit('/health');
check('production boot refuses a missing key', refusedBoot && memoryEngineReady() === false && downHealth.status === 503 && downHealth.body.encryptionAtRest === false);

server.close();
core.discardPendingPersistForTests();
delete process.env.MEMORY_GCS_BUCKET;
delete process.env.K_SERVICE;
process.env.NODE_ENV = 'test';
core.setStoreProbeForTests(null);
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nstorage privacy checks passed');
