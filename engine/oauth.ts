import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { getState, persistNow, sha, uid, type OauthClientRec, type OauthCodeRec } from './core.js';

const ALLOWED_REDIRECT = [
  'claude.ai',
  'claude.com',
  'anthropic.com',
  'chatgpt.com',
  'openai.com',
  'oaistatic.com',
  'grok.com',
  'x.ai',
  'google.com',
  'googleusercontent.com',
  'gemini.google.com',
  'localhost',
  '127.0.0.1',
  'app.rukmer.com',
];

export function publicOrigin(req: Request) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'app.rukmer.com').split(',')[0].trim();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return `http://${host}`;
  return `https://${host}`;
}

function hostOk(redirectUri: string) {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
    return ALLOWED_REDIRECT.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function s256(v: string) {
  return crypto.createHash('sha256').update(v).digest('base64url');
}

function cors(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-protocol-version, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function resourceMeta(req: Request) {
  const origin = publicOrigin(req);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header', 'query'],
    scopes_supported: ['memory'],
  };
}

function asMeta(req: Request) {
  const origin = publicOrigin(req);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['memory'],
  };
}

function bodyOf(req: Request) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return b as Record<string, any>;
}

export function mountOauth(app: Express) {
  const wellKnown = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/mcp/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/mcp/.well-known/oauth-authorization-server',
  ];

  for (const path of wellKnown) {
    app.options(path, (_req, res) => {
      cors(res);
      res.status(204).end();
    });
    app.get(path, (req, res) => {
      cors(res);
      if (path.includes('protected-resource')) return res.json(resourceMeta(req));
      res.json(asMeta(req));
    });
  }

  app.options('/oauth/register', (_req, res) => {
    cors(res);
    res.status(204).end();
  });
  app.options('/oauth/token', (_req, res) => {
    cors(res);
    res.status(204).end();
  });

  app.get('/oauth/authorize', (req, res) => {
    const origin = publicOrigin(req);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (typeof v === 'string') q.set(k, v);
    }
    res.redirect(302, `${origin}/connect/oauth?${q.toString()}`);
  });

  app.post('/oauth/register', async (req, res) => {
    cors(res);
    const body = bodyOf(req);
    const uris = ([] as string[])
      .concat(body.redirect_uris || body.redirectUris || [])
      .filter((u) => typeof u === 'string' && hostOk(u));
    if (!uris.length) return res.status(400).json({ error: 'invalid_redirect_uri' });
    const rec: OauthClientRec = { id: uid('oauth'), redirectUris: uris, createdAt: new Date().toISOString() };
    getState().oauthClients.push(rec);
    await persistNow();
    res.status(201).json({
      client_id: rec.id,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });

  app.post('/oauth/code', async (req, res) => {
    const uidUser = req.memoryUser?.uid;
    if (!uidUser) return res.status(401).json({ error: 'Sign in required' });
    const body = bodyOf(req);
    const clientId = String(body.client_id || body.clientId || '');
    const redirectUri = String(body.redirect_uri || body.redirectUri || '');
    const state = String(body.state || '');
    const challenge = String(body.code_challenge || body.codeChallenge || '');
    const method = String(body.code_challenge_method || body.codeChallengeMethod || 'S256');
    const client = getState().oauthClients.find((c) => c.id === clientId);
    if (client && !client.redirectUris.includes(redirectUri)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }
    if (!hostOk(redirectUri)) return res.status(400).json({ error: 'invalid_redirect_uri' });
    const rec: OauthCodeRec = {
      code: crypto.randomBytes(24).toString('hex'),
      uid: uidUser,
      clientId,
      redirectUri,
      challenge,
      method,
      exp: Date.now() + 10 * 60 * 1000,
    };
    const stateNow = getState();
    stateNow.oauthCodes = stateNow.oauthCodes.filter((c) => c.exp > Date.now());
    stateNow.oauthCodes.push(rec);
    await persistNow();
    const next = new URL(redirectUri);
    next.searchParams.set('code', rec.code);
    if (state) next.searchParams.set('state', state);
    res.json({ redirect: next.toString(), code: rec.code });
  });

  app.post('/oauth/token', async (req, res) => {
    cors(res);
    const body = bodyOf(req);
    const grant = String(body.grant_type || 'authorization_code');
    if (grant !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    const code = String(body.code || '');
    const stateNow = getState();
    const idx = stateNow.oauthCodes.findIndex((c) => c.code === code);
    const rec = idx >= 0 ? stateNow.oauthCodes[idx] : undefined;
    if (idx >= 0) stateNow.oauthCodes.splice(idx, 1);
    if (!rec || rec.exp < Date.now()) {
      await persistNow();
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const redirectUri = String(body.redirect_uri || rec.redirectUri);
    if (redirectUri !== rec.redirectUri) {
      await persistNow();
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const verifier = String(body.code_verifier || '');
    if (rec.challenge) {
      const computed = rec.method.toLowerCase() === 'plain' ? verifier : s256(verifier);
      if (!verifier || computed !== rec.challenge) {
        await persistNow();
        return res.status(400).json({ error: 'invalid_grant' });
      }
    }
    const secret = 'rk_live_' + crypto.randomBytes(18).toString('hex');
    stateNow.apiKeys.push({
      id: uid('key'),
      name: 'OAuth connector',
      prefix: secret.slice(0, 12) + '…',
      hash: sha(secret.trim()),
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      ownerUid: rec.uid,
    });
    await persistNow();
    res.json({
      access_token: secret,
      token_type: 'bearer',
      expires_in: 86400 * 30,
      scope: 'memory',
    });
  });
}

export function mcpUnauthorized(req: Request, res: Response) {
  const origin = publicOrigin(req);
  cors(res);
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="rukmer", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message: 'unauthorized' },
  });
}
