import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { getState, persistNow, sha, uid, type OauthClientRec, type OauthCodeRec } from './core.js';
import { consumeRefresh, findKey, forgetKey, readRefresh, rememberKey, saveRefresh } from './keys.js';
import { ALLOWED_ORIGINS } from './security.js';

const ALLOWED_REDIRECT_HOSTS = new Set([
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'platform.openai.com',
  'grok.com',
  'x.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'makersuite.google.com',
  'localhost',
  '127.0.0.1',
  '::1',
  'app.rukmer.com',
  'cursor.com',
  'cursor.sh',
  'anthropic.com',
  'openai.com',
]);

export function publicOrigin(req: Request) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'app.rukmer.com').split(',')[0].trim();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return `http://${host}`;
  return `https://${host}`;
}

export function isAllowedOauthRedirect(redirectUri: string) {
  try {
    const u = new URL(redirectUri);
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (u.protocol !== 'https:' && !loopback) return false;
    if (host.endsWith('.chromiumapp.org') && host !== 'chromiumapp.org') return true;
    if (ALLOWED_REDIRECT_HOSTS.has(host)) return true;
    return ['cursor.com', 'cursor.sh', 'anthropic.com', 'openai.com'].some((root) => host === root || host.endsWith('.' + root));
  } catch {
    return false;
  }
}

function hostOk(redirectUri: string) {
  return isAllowedOauthRedirect(redirectUri);
}

function s256(v: string) {
  return crypto.createHash('sha256').update(v).digest('base64url');
}

function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '');
  if (origin && (ALLOWED_ORIGINS.includes(origin) || hostOk(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-protocol-version, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function resourceMeta(req: Request) {
  const origin = publicOrigin(req);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header', 'query'],
    scopes_supported: ['memory', 'memory:read', 'memory:write'],
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
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['memory', 'memory:read', 'memory:write'],
  };
}

function bodyOf(req: Request) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return b as Record<string, any>;
}

export const AGENT_CONNECTORS = ['cursor', 'claude-code', 'codex', 'cli', 'mcp', 'claude', 'chatgpt', 'grok', 'gemini', 'browser'] as const;
export type AgentConnector = (typeof AGENT_CONNECTORS)[number];
const CONNECTOR_APPS = ['claude', 'chatgpt', 'grok', 'gemini'] as const;
export type ConnectorApp = (typeof CONNECTOR_APPS)[number];

export function explicitConnector(value: unknown): AgentConnector | '' {
  const raw = String(value || '').trim().toLowerCase();
  return (AGENT_CONNECTORS as readonly string[]).includes(raw) ? (raw as AgentConnector) : '';
}

export function connectorFromRedirect(redirectUri: string, explicit = ''): AgentConnector | '' {
  const named = explicitConnector(explicit);
  if (named) return named;
  let host = '';
  try {
    host = new URL(redirectUri).hostname.toLowerCase();
  } catch {
    return '';
  }
  const is = (root: string) => host === root || host.endsWith('.' + root);
  if (is('claude.ai') || is('claude.com') || is('anthropic.com')) return 'claude';
  if (is('chatgpt.com') || is('openai.com')) return 'chatgpt';
  if (is('grok.com') || is('x.ai')) return 'grok';
  if (is('gemini.google.com') || is('aistudio.google.com') || is('makersuite.google.com')) return 'gemini';
  if (host.endsWith('.chromiumapp.org')) return 'browser';
  if (is('cursor.com') || is('cursor.sh')) return 'cursor';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'cli';
  return '';
}

export function connectedAppsFor(uid: string): ConnectorApp[] {
  const keys = getState().apiKeys.filter((k) => k.ownerUid === uid && k.connector);
  return CONNECTOR_APPS.filter((id) => keys.some((k) => k.connector === id));
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
    app.options(path, (req, res) => {
      cors(req, res);
      res.status(204).end();
    });
    app.get(path, (req, res) => {
      cors(req, res);
      if (path.includes('protected-resource')) return res.json(resourceMeta(req));
      res.json(asMeta(req));
    });
  }

  app.options('/oauth/register', (req, res) => {
    cors(req, res);
    res.status(204).end();
  });
  app.options('/oauth/token', (req, res) => {
    cors(req, res);
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
    cors(req, res);
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
    const method = String(body.code_challenge_method || body.codeChallengeMethod || 'S256').toUpperCase();
    if (!challenge || (method !== 'S256' && method !== 'PLAIN')) return res.status(400).json({ error: 'invalid_request' });
    const client = getState().oauthClients.find((c) => c.id === clientId);
    if (client && !client.redirectUris.includes(redirectUri)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }
    if (!hostOk(redirectUri)) return res.status(400).json({ error: 'invalid_redirect_uri' });
    const browser = ['Chrome', 'Edge', 'Brave'].includes(String(body.browser || '')) ? String(body.browser) : '';
    const named = explicitConnector(body.connector || body.client);
    if ((body.connector || body.client) && !named) return res.status(400).json({ error: 'invalid_client' });
    const scope = String(body.scope || 'memory');
    if (!['memory', 'memory:read', 'memory:write'].includes(scope)) return res.status(400).json({ error: 'invalid_scope' });
    const tags = Array.isArray(body.containerTags) ? body.containerTags.map(String).filter(Boolean) : [];
    const rec: OauthCodeRec = {
      code: crypto.randomBytes(24).toString('hex'),
      uid: uidUser,
      clientId,
      redirectUri,
      challenge,
      method: method === 'PLAIN' ? 'plain' : 'S256',
      exp: Date.now() + 10 * 60 * 1000,
      label: browser,
      connector: named || connectorFromRedirect(redirectUri),
      teamId: String(body.teamId || ''),
      orgId: String(body.orgId || ''),
      readOnly: body.readOnly === true || scope === 'memory:read',
      containerTags: tags,
      scope,
      createdBy: { uid: uidUser, email: req.memoryUser?.email, name: req.memoryUser?.name },
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
    cors(req, res);
    const body = bodyOf(req);
    const grant = String(body.grant_type || 'authorization_code');
    if (grant === 'refresh_token') {
      const refresh = String(body.refresh_token || '');
      const row = refresh ? await readRefresh(sha(refresh)) : null;
      const old = row ? await findKey(row.keyHash) : null;
      if (!row || !old || old.ownerUid !== row.uid || !old.connector) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      await consumeRefresh(sha(refresh));
      const issued = await issueConnectorKey(old.ownerUid || '', old.connector, old.name.replace(/^Browser\s+/, ''), old);
      await forgetKey(old.hash);
      await persistNow();
      return res.json(issued);
    }
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
    const methodName = rec.method.toUpperCase();
    const challengeOk = methodName === 'PLAIN' ? verifier === rec.challenge : methodName === 'S256' && !!rec.challenge && s256(verifier) === rec.challenge;
    if (!challengeOk) {
      await persistNow();
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const connector = rec.connector || connectorFromRedirect(rec.redirectUri);
    const issued = await issueConnectorKey(rec.uid, connector, rec.label || '', rec);
    await persistNow();
    res.json(issued);
  });
}

export async function issueBrowserKey(ownerUid: string, label: string) {
  return issueConnectorKey(ownerUid, 'browser', label);
}

async function issueConnectorKey(ownerUid: string, connector: string, label: string, prior?: Partial<OauthCodeRec> & Partial<import('./core.js').ApiKeyRec>) {
  const secret = 'rk_live_' + crypto.randomBytes(18).toString('hex');
  const browser = connector === 'browser';
  const browserName = label === 'Chrome' || label === 'Edge' || label === 'Brave' ? label : 'Chromium';
  const rec = {
    id: uid('key'),
    name: browser ? `Browser ${browserName}` : connector ? `OAuth ${connector}` : 'OAuth connector',
    prefix: secret.slice(0, 12) + '…',
    hash: sha(secret.trim()),
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    ownerUid,
    connector: connector || undefined,
    source: connector === 'cli' ? 'cli' as const : connector === 'mcp' ? 'mcp' as const : 'oauth' as const,
    createdBy: prior?.createdBy || { uid: ownerUid },
    orgId: prior?.orgId,
    teamId: prior?.teamId,
    readOnly: prior?.readOnly === true,
    containerTags: prior?.containerTags,
  };
  await rememberKey(rec);
  const body: Record<string, string | number> = {
    access_token: secret,
    token_type: 'bearer',
    expires_in: 86400 * 30,
    scope: prior?.readOnly ? 'memory:read' : 'memory',
  };
  if (connector) {
    const refresh = crypto.randomBytes(32).toString('hex');
    await saveRefresh({ hash: sha(refresh), keyHash: rec.hash, uid: ownerUid, exp: Date.now() + 86400 * 30 * 1000 });
    body.refresh_token = refresh;
  }
  return body;
}

export function mcpUnauthorized(req: Request, res: Response) {
  const origin = publicOrigin(req);
  cors(req, res);
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
