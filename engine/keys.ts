import { getState, mergeRemoteApiKeys, sha, type ApiKeyRec, type OauthRefreshRec } from './core.js';
import { listMyTeams } from './teams.js';

const COLLECTION = 'rukmerApiKeys';

export function keysAreDurable() {
  return !!process.env.K_SERVICE || process.env.MEMORY_KEYS_FIRESTORE === '1';
}

async function db() {
  if (!keysAreDurable()) return null;
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin.firestore();
}

function asRec(hash: string, data: Partial<ApiKeyRec>): ApiKeyRec {
  return {
    id: String(data.id || ''),
    name: String(data.name || 'Untitled'),
    prefix: String(data.prefix || ''),
    hash,
    createdAt: String(data.createdAt || new Date().toISOString()),
    lastUsed: data.lastUsed ? String(data.lastUsed) : null,
    ownerUid: String(data.ownerUid || ''),
    connector: data.connector ? String(data.connector) : undefined,
    source: data.source,
    createdBy: data.createdBy,
    orgId: data.orgId,
    teamId: data.teamId,
    readOnly: data.readOnly === true,
    containerTags: Array.isArray(data.containerTags) ? data.containerTags.map(String) : undefined,
  };
}

function cache(rec: ApiKeyRec) {
  const keys = getState().apiKeys;
  if (!keys.some((k) => k.hash === rec.hash)) keys.push(rec);
}

export async function rememberKey(rec: ApiKeyRec) {
  cache(rec);
  const firestore = await db();
  if (!firestore) return;
  await firestore.collection(COLLECTION).doc(rec.hash).set({
    id: rec.id,
    name: rec.name,
    prefix: rec.prefix,
    createdAt: rec.createdAt,
    lastUsed: rec.lastUsed,
    ownerUid: rec.ownerUid || '',
    connector: rec.connector || '',
    source: rec.source || '',
    createdBy: rec.createdBy || null,
    orgId: rec.orgId || '',
    teamId: rec.teamId || '',
    readOnly: rec.readOnly === true,
    containerTags: rec.containerTags || [],
  });
}

export async function findKey(secretOrHash: string) {
  const hash = secretOrHash.startsWith('rk_live_') ? sha(secretOrHash.trim()) : secretOrHash;
  const local = getState().apiKeys.find((k) => k.hash === hash);
  if (local) return local;
  const firestore = await db();
  if (firestore) {
    const snap = await firestore.collection(COLLECTION).doc(hash).get();
    if (snap.exists) {
      const rec = asRec(hash, snap.data() || {});
      cache(rec);
      return rec;
    }
  }
  await mergeRemoteApiKeys();
  return getState().apiKeys.find((k) => k.hash === hash);
}

export async function keysFor(uid: string) {
  const firestore = await db();
  if (firestore) {
    const snap = await firestore.collection(COLLECTION).where('ownerUid', '==', uid).get();
    for (const doc of snap.docs) cache(asRec(doc.id, doc.data() || {}));
  }
  return getState().apiKeys.filter((k) => k.ownerUid === uid);
}

export async function forgetKey(hash: string) {
  getState().apiKeys = getState().apiKeys.filter((k) => k.hash !== hash);
  const firestore = await db();
  if (!firestore) return;
  await firestore.collection(COLLECTION).doc(hash).delete();
}

export async function touchKey(hash: string) {
  const now = new Date().toISOString();
  const rec = getState().apiKeys.find((k) => k.hash === hash);
  if (rec) rec.lastUsed = now;
  const firestore = await db();
  if (!firestore) return;
  await firestore.collection(COLLECTION).doc(hash).set({ lastUsed: now }, { merge: true }).catch(() => undefined);
}

export async function saveRefresh(rec: OauthRefreshRec) {
  const state = getState();
  state.oauthRefreshes = (state.oauthRefreshes || []).filter((row) => row.hash !== rec.hash && row.exp > Date.now());
  state.oauthRefreshes.push(rec);
  const firestore = await db();
  if (!firestore) return;
  await firestore.collection('rukmerOauthRefresh').doc(rec.hash).set({
    keyHash: rec.keyHash,
    uid: rec.uid,
    exp: rec.exp,
  });
}

export async function readRefresh(hash: string) {
  const state = getState();
  let rec = (state.oauthRefreshes || []).find((row) => row.hash === hash);
  const firestore = await db();
  if (!rec && firestore) {
    const snap = await firestore.collection('rukmerOauthRefresh').doc(hash).get();
    if (snap.exists) {
      const data = snap.data() || {};
      rec = { hash, keyHash: String(data.keyHash || ''), uid: String(data.uid || ''), exp: Number(data.exp || 0) };
    }
  }
  if (!rec || rec.exp < Date.now() || !rec.keyHash || !rec.uid) return null;
  return rec;
}

export async function consumeRefresh(hash: string) {
  const rec = await readRefresh(hash);
  const state = getState();
  state.oauthRefreshes = (state.oauthRefreshes || []).filter((row) => row.hash !== hash);
  const firestore = await db();
  if (firestore) await firestore.collection('rukmerOauthRefresh').doc(hash).delete().catch(() => undefined);
  return rec;
}

export function keysVisible(actor: string) {
  const teams = listMyTeams(actor).teams;
  const adminTeams = teams.filter((team) => (team.members || []).some((member) => member.uid === actor && (member.role === 'owner' || member.role === 'admin')));
  const adminIds = new Set(adminTeams.map((team) => team.id));
  const adminOrgs = new Set(adminTeams.map((team) => team.orgId).filter(Boolean));
  return getState().apiKeys.filter((key) => {
    if (key.ownerUid === actor) return true;
    if (key.teamId && adminIds.has(key.teamId)) return true;
    if (key.orgId && adminOrgs.has(key.orgId)) return true;
    return false;
  }).map((key) => ({
    key,
    canRevoke: key.ownerUid === actor || (!!key.teamId && adminIds.has(key.teamId)) || (!!key.orgId && adminOrgs.has(String(key.orgId))),
  }));
}

export async function syncStoredKeys() {
  if (!keysAreDurable()) return;
  for (const rec of [...getState().apiKeys]) {
    if (!rec.hash || !rec.ownerUid) continue;
    await rememberKey(rec);
  }
}
