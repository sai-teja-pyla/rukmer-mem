/**
 * Request controls that sit in front of the memory engine.
 * Identity always comes from the verified session. Client fields such as
 * uid, actorId, and userId are claims, not credentials.
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { encryptionAtRest, encryptionWarning } from './core.js';

export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://app.rukmer.com',
  'https://rukmer.com',
  'https://www.rukmer.com',
  'https://rukmer-saas.web.app',
  'https://rukmer-saas.firebaseapp.com',
  'https://rukmer-saas-service-361739908342.us-central1.run.app',
];

/** Tools an authenticated caller may invoke. Anything else is rejected. */
export const TOOL_ALLOWLIST = ['searchMemories', 'addMemory'] as const;

const LIMITS: Record<string, number> = {
  auth: 30,
  write: 60,
  search: 120,
  export: 10,
  forget: 30,
  admin: 30,
  upload: 20,
};

const buckets = new Map<string, { n: number; reset: number }>();

export function isProduction() {
  return process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
}

export function securityStatus() {
  return {
    encryptionAtRest: encryptionAtRest(),
    encryptionWarning: encryptionWarning(),
    rateLimiting: true,
    corsMode: 'allowlist' as const,
    debugMode: !isProduction(),
    httpsOnly: isProduction(),
    training: false,
    identity: 'session' as const,
    tools: [...TOOL_ALLOWLIST],
  };
}

export function setSecurityHeaders(res: Response) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (isProduction()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  setSecurityHeaders(res);
  if (isProduction() && req.headers['x-forwarded-proto'] === 'http') {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'app.rukmer.com').split(',')[0];
    return res.redirect(308, `https://${host}${req.originalUrl}`);
  }
  const origin = String(req.headers.origin || '');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-container-tag, x-rukmer-key, x-api-key, x-goog-resumable'
  );
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

const IDENTITY_FIELDS = ['uid', 'userId', 'actorId', 'createdBy', 'ownerUid'];

/** Caller identity is the session. A conflicting body claim is rejected. ownerId and tenantId are targets, checked separately. */
export function conflictingIdentity(req: Request) {
  const session = req.memoryUser?.uid || '';
  if (!session) return '';
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  for (const field of IDENTITY_FIELDS) {
    const claimed = String(body[field] || '').trim();
    if (claimed && claimed !== session) return field;
  }
  const header = String(req.headers['x-rukmer-user'] || '').trim();
  if (header && header !== session && req.memoryUser?.via !== 'dev') return 'x-rukmer-user';
  return '';
}

export function rejectIdentityOverride(req: Request, res: Response, next: NextFunction) {
  if (!req.memoryUser) return next();
  const field = conflictingIdentity(req);
  if (!field) return next();
  return res.status(403).json({ error: 'Identity is taken from the signed-in session' });
}

export function bucketFor(path: string) {
  if (path.includes('/files') && path.includes('/documents')) return 'upload';
  if (path.includes('/governance/forget') || path.includes('/memories') || path.includes('/account/reset')) return 'forget';
  if (path.includes('/export')) return 'export';
  if (path.includes('/search') || path.includes('/inject') || path.includes('/chat') || path.includes('/consolidate')) return 'search';
  if (path.includes('/documents') || path.includes('/remember') || path.includes('/connectors') || path.includes('/tools/execute')) return 'write';
  if (path.startsWith('/oauth') || path.includes('/keys') || path.includes('/loi-accepted')) return 'auth';
  if (path.includes('/governance') || path.includes('/orgs')) return 'admin';
  return '';
}

export function resetRateLimits() {
  buckets.clear();
}

function allowance(kind: string) {
  const override = Number(process.env.MEMORY_RATE_LIMIT || 0);
  if (override > 0) return override;
  return LIMITS[kind] || 60;
}

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const kind = bucketFor(req.path);
  if (!kind) return next();
  const uid = req.memoryUser?.uid || 'anon';
  const ip = req.ip || req.socket?.remoteAddress || '';
  const key = `${kind}:${uid}:${ip}`;
  const now = Date.now();
  const windowMs = 60_000;
  const row = buckets.get(key);
  if (!row || row.reset <= now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return next();
  }
  row.n += 1;
  if (row.n > allowance(kind)) {
    const retryAfter = Math.max(1, Math.ceil((row.reset - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests', retryAfter });
  }
  next();
}

export function sanitizePlain(input: unknown, max = 20000) {
  return String(input ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, max);
}

const ALLOWED_UPLOADS = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

function contentMatches(mime: string, bytes: Buffer) {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/gif') return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === 'video/mp4' || mime === 'video/quicktime') return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  return mime.startsWith('text/');
}

export function checkUpload(mime: string, bytes: Buffer) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_UPLOADS.has(type)) {
    throw Object.assign(new Error('This file type is not allowed'), { status: 415 });
  }
  const cap = type.startsWith('video/') ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
  if (bytes.length > cap) {
    throw Object.assign(new Error(type.startsWith('video/') ? 'File is larger than 25MB' : 'File is larger than 8MB'), { status: 413 });
  }
  if (!contentMatches(type, bytes)) {
    throw Object.assign(new Error('File content does not match its type'), { status: 415 });
  }
  return type;
}

export function sanitizeName(input: unknown) {
  const name = sanitizePlain(input, 200).replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || 'Untitled';
}

export function slackSignatureOk(raw: Buffer | string, timestamp: unknown, signature: unknown) {
  const secret = process.env.SLACK_SIGNING_SECRET || '';
  if (!secret) return !isProduction() && process.env.SLACK_ALLOW_UNSIGNED === '1';
  const ts = String(timestamp || '');
  const sig = String(signature || '');
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!ts || !sig || !Number.isFinite(age) || age > 60 * 5) return false;
  const body = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const mac = crypto.createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  const expected = Buffer.from(`v0=${mac}`);
  const given = Buffer.from(sig);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

export function publicError(e: { status?: number; message?: string }) {
  const status = e.status || 500;
  if (isProduction() && status >= 500) return { status, body: { error: 'Internal error' } };
  return { status: status === 500 ? 500 : status, body: { error: e.message || 'Request failed' } };
}
