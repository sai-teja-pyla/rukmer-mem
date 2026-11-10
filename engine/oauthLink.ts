import crypto from 'crypto';

export type OauthLinkRecord = { uid: string; purpose: string; type: string; exp: number };

export interface OauthNonceStore {
  save(nonce: string, rec: OauthLinkRecord): Promise<void>;
  take(nonce: string): Promise<OauthLinkRecord | null>;
}

export function memoryOauthStore(): OauthNonceStore {
  const map = new Map<string, OauthLinkRecord>();
  return {
    async save(nonce, rec) {
      map.set(nonce, rec);
    },
    async take(nonce) {
      const rec = map.get(nonce) || null;
      if (!rec) return null;
      map.delete(nonce);
      if (rec.exp < Date.now()) return null;
      return rec;
    },
  };
}

type FirestoreDb = {
  collection(name: string): { doc(id: string): unknown };
  runTransaction<T>(fn: (tx: { get(ref: unknown): Promise<{ exists: boolean; data(): any }>; delete(ref: unknown): void }) => Promise<T>): Promise<T>;
};

/** Shared nonce store so a callback can land on any Cloud Run instance. */
export function firestoreOauthStore(db: FirestoreDb): OauthNonceStore {
  return {
    async save(nonce, rec) {
      await (db.collection('oauthLinkStates').doc(nonce) as { set(data: object): Promise<unknown> }).set(rec);
    },
    async take(nonce) {
      const ref = db.collection('oauthLinkStates').doc(nonce);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        const data = snap.data() || {};
        const rec: OauthLinkRecord = {
          uid: String(data.uid || ''),
          purpose: String(data.purpose || ''),
          type: String(data.type || ''),
          exp: Number(data.exp || 0),
        };
        if (!rec.uid || rec.exp < Date.now()) return null;
        return rec;
      });
    },
  };
}

export function oauthStateSecret() {
  return process.env.OAUTH_STATE_SECRET || '';
}

function mac(body: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export async function issueOauthState(opts: {
  uid: string;
  purpose: string;
  type?: string;
  secret: string;
  store: OauthNonceStore;
  ttlMs?: number;
  now?: number;
}) {
  if (!opts.secret || !opts.uid || !opts.purpose) throw new Error('OAuth state is not configured');
  const now = opts.now ?? Date.now();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const rec: OauthLinkRecord = {
    uid: opts.uid,
    purpose: opts.purpose,
    type: opts.type || '',
    exp: now + (opts.ttlMs ?? 10 * 60 * 1000),
  };
  await opts.store.save(nonce, rec);
  const body = Buffer.from(JSON.stringify({ ...rec, nonce })).toString('base64url');
  return `${body}.${mac(body, opts.secret)}`;
}

export async function consumeOauthState(
  state: string,
  opts: { purpose: string; secret: string; store: OauthNonceStore; now?: number }
): Promise<OauthLinkRecord | null> {
  const now = opts.now ?? Date.now();
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || !opts.secret) return null;
  const expected = mac(body, opts.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: { uid?: string; purpose?: string; type?: string; nonce?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.nonce || payload.purpose !== opts.purpose) return null;
  if (Number(payload.exp || 0) < now) return null;
  const saved = await opts.store.take(payload.nonce);
  if (!saved || saved.uid !== payload.uid || saved.purpose !== opts.purpose) return null;
  return saved;
}
