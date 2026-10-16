import type { NextFunction, Request, Response } from 'express';
import { getState } from './core.js';
import { sha } from './core.js';
import { sanitizeUid } from './tenancy.js';
import { mcpUnauthorized } from './oauth.js';

export type MemoryUser = { uid: string; via: 'firebase' | 'apikey' | 'dev' };

declare global {
  namespace Express {
    interface Request {
      memoryUser?: MemoryUser;
    }
  }
}

function headerVal(req: Request, name: string) {
  const v = req.headers[name];
  return typeof v === 'string' ? v.trim() : '';
}

function bearer(req: Request) {
  const a = headerVal(req, 'authorization');
  if (a.toLowerCase().startsWith('bearer ')) return a.slice(7).trim();
  return '';
}

export function extractAccessToken(req: Request) {
  const q = req.query || {};
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const fromBody = String(body.api_key || body.access_token || '').trim();
  return (
    bearer(req) ||
    headerVal(req, 'x-api-key') ||
    headerVal(req, 'x-rukmer-key') ||
    headerVal(req, 'api-key') ||
    String(q.api_key || q.access_token || q.key || '').trim() ||
    (fromBody.startsWith('rk_live_') ? fromBody : '')
  );
}

function isLoopback(req: Request) {
  const ip = req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

type TokenCheck = { status: 'ok'; uid: string } | { status: 'invalid' } | { status: 'unavailable' };

async function verifyWithAdmin(token: string): Promise<TokenCheck> {
  try {
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) {
      const fs = await import('fs');
      const path = await import('path');
      const file = path.join(process.cwd(), 'service-account.json');
      if (!fs.existsSync(file)) return { status: 'unavailable' };
      const cred = JSON.parse(fs.readFileSync(file, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = sanitizeUid(decoded.uid);
    return uid ? { status: 'ok', uid } : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}

async function verifyWithIdentityToolkit(token: string): Promise<TokenCheck> {
  const key = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';
  if (!key) return { status: 'unavailable' };
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return res.status >= 500 ? { status: 'unavailable' } : { status: 'invalid' };
    const data = (await res.json()) as { users?: { localId?: string }[] };
    const uid = sanitizeUid(String(data.users?.[0]?.localId || ''));
    return uid ? { status: 'ok', uid } : { status: 'invalid' };
  } catch {
    return { status: 'unavailable' };
  }
}

async function verifyFirebase(token: string): Promise<TokenCheck> {
  const admin = await verifyWithAdmin(token);
  if (admin.status === 'ok') return admin;
  const toolkit = await verifyWithIdentityToolkit(token);
  if (toolkit.status === 'ok' || toolkit.status === 'invalid') return toolkit;
  if (admin.status === 'invalid' && toolkit.status === 'unavailable') {
    const fs = await import('fs');
    const path = await import('path');
    if (fs.existsSync(path.join(process.cwd(), 'service-account.json'))) return { status: 'invalid' };
  }
  return toolkit.status === 'unavailable' && admin.status === 'unavailable' ? admin : toolkit;
}

function uidFromApiKey(token: string) {
  const raw = token.trim();
  if (!raw.startsWith('rk_live_')) return '';
  const rec = getState().apiKeys.find((k) => k.hash === sha(raw) || k.hash === sha(raw.trim()));
  if (!rec) return '';
  rec.lastUsed = new Date().toISOString();
  const uid = sanitizeUid(rec.ownerUid || '');
  if (!uid) return '';
  return uid;
}

export async function resolveIdentity(req: Request): Promise<MemoryUser> {
  const token = extractAccessToken(req);
  if (token.startsWith('rk_live_')) {
    const uid = uidFromApiKey(token);
    if (!uid) throw Object.assign(new Error('Invalid API key'), { status: 401 });
    return { uid, via: 'apikey' };
  }
  if (token && token.split('.').length === 3) {
    const verified = await verifyFirebase(token);
    if (verified.status === 'ok') return { uid: verified.uid, via: 'firebase' };
    if (verified.status === 'invalid') throw Object.assign(new Error('Invalid Firebase token'), { status: 401 });
  }
  if (isLoopback(req)) {
    const dev = sanitizeUid(String(req.headers['x-rukmer-user'] || ''));
    if (dev) return { uid: dev, via: 'dev' };
  }
  throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
}

const PUBLIC = new Set(['/health', '/v4/protocol', '/v4/openai.json', '/v1/models']);

export function isPublicMemoryPath(method: string, path: string) {
  if (method === 'OPTIONS') return true;
  if (PUBLIC.has(path)) return true;
  if (method === 'GET' && path === '/mcp') return true;
  if (path.includes('/.well-known/')) return true;
  if (path === '/oauth/authorize' || path === '/oauth/register' || path === '/oauth/token') return true;
  return false;
}

export function memoryAuth(req: Request, res: Response, next: NextFunction) {
  if (isPublicMemoryPath(req.method, req.path)) return next();
  const gated =
    req.path.startsWith('/v3') ||
    req.path.startsWith('/v4') ||
    req.path.startsWith('/v1') ||
    req.path.startsWith('/mcp') ||
    req.path === '/oauth/code';
  if (!gated) return next();
  void resolveIdentity(req)
    .then((user) => {
      req.memoryUser = user;
      next();
    })
    .catch((e) => {
      if (req.path.startsWith('/mcp')) return mcpUnauthorized(req, res);
      res.status(e.status || 401).json({ error: e.message || 'Unauthorized' });
    });
}
