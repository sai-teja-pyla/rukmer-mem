import type { NextFunction, Request, Response } from 'express';
import { getState } from './core.js';
import { sha } from './core.js';
import { sanitizeUid } from './tenancy.js';

export type MemoryUser = { uid: string; via: 'firebase' | 'apikey' | 'dev' };

declare global {
  namespace Express {
    interface Request {
      memoryUser?: MemoryUser;
    }
  }
}

function bearer(req: Request) {
  const a = req.headers.authorization;
  const v = Array.isArray(a) ? a[0] : a;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return '';
  return v.slice(7).trim();
}

function authRequired() {
  return !!(process.env.K_SERVICE || process.env.MEMORY_REQUIRE_AUTH === '1');
}

function decodeJwtSub(token: string) {
  try {
    const part = token.split('.')[1];
    if (!part) return '';
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return sanitizeUid(String(json.user_id || json.sub || json.uid || ''));
  } catch {
    return '';
  }
}

async function verifyFirebase(token: string) {
  try {
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) return '';
    const decoded = await admin.auth().verifyIdToken(token);
    return sanitizeUid(decoded.uid);
  } catch {
    return '';
  }
}

function uidFromApiKey(token: string) {
  if (!token.startsWith('rk_live_')) return '';
  const rec = getState().apiKeys.find((k) => k.hash === sha(token));
  if (!rec) return '';
  rec.lastUsed = new Date().toISOString();
  return sanitizeUid((rec as any).ownerUid || '');
}

export async function resolveIdentity(req: Request): Promise<MemoryUser> {
  const token = bearer(req);
  if (token.startsWith('rk_live_')) {
    const uid = uidFromApiKey(token);
    if (!uid) throw Object.assign(new Error('Invalid API key'), { status: 401 });
    return { uid, via: 'apikey' };
  }
  if (token && token.split('.').length === 3) {
    const verified = await verifyFirebase(token);
    if (verified) return { uid: verified, via: 'firebase' };
    if (!authRequired()) {
      const sub = decodeJwtSub(token);
      if (sub) return { uid: sub, via: 'firebase' };
    } else {
      throw Object.assign(new Error('Invalid Firebase token'), { status: 401 });
    }
  }
  if (!authRequired()) {
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
  return false;
}

export function memoryAuth(req: Request, res: Response, next: NextFunction) {
  if (isPublicMemoryPath(req.method, req.path)) return next();
  const gated =
    req.path.startsWith('/v3') ||
    req.path.startsWith('/v4') ||
    req.path.startsWith('/v1') ||
    req.path.startsWith('/mcp');
  if (!gated) return next();
  void resolveIdentity(req)
    .then((user) => {
      req.memoryUser = user;
      next();
    })
    .catch((e) => res.status(e.status || 401).json({ error: e.message || 'Unauthorized' }));
}
