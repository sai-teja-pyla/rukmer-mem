import type { Express, NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { assertProductionSecrets, assertStoreNotPublic, encryptionAtRest, getState, loadState, memoryStoreProblem, memoryStoreSource, noteMemoryStoreProblem, persistNow, readBlob, reencryptLoadedStore, saveState, sha, shortestPath, uid } from './core.js';
import {
  chatWithMemory,
  forgetById,
  forgetMatching,
  forgetOwner,
  forgetTenant,
  exportMine,
  moveMemory,
  resetMine,
  graphPayload,
  ingestPayload,
  ingestUrl,
  insights,
  listDocuments,
  readDocument,
  listTags,
  logRequest,
  rememberTranscript,
  searchMemory,
  stats,
  warmFactEmbeddings,
  flushConsolidation,
} from './pipeline.js';
import { upsertFacts } from './facts.js';
import { extractGraph, hasLlm } from './llm.js';
import { isUsefulFact, pruneJunkMemory } from './quality.js';
import { buildMemoryInjection } from './inject.js';
import { completeChat, providerStatus, routeAnthropic, routeGemini, routeGrok, routeOpenAI } from './router.js';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';
import { CHATGPT_OPENAPI, handleMcp } from './mcp.js';
import { MEMORY_PROTOCOL } from './protocol.js';
import { memoryAuth } from './identity.js';
import { canAccessTag, homeTag, resolveScopeTag } from './tenancy.js';
import { readTagsFor } from './spaces.js';
import { mountTeamRoutes } from './teams.js';
import { addOrgMember, closeSession, createOrg, listOrgs, scopeTagsFor } from './scopes.js';
import { importConnector } from './connectors.js';
import { applyDecay, buildProfile } from './memory.js';
import { connectedAppsFor, mountOauth } from './oauth.js';
import { browserConnectorView, claimBrowserPair, createBrowserPair, forgetBrowserMemories } from './browserConnector.js';
import { findKey, forgetKey, keysAreDurable, keysFor, rememberKey, syncStoredKeys } from './keys.js';
import {
  addTeamMember,
  audit,
  auditFor,
  canRead,
  createTeam,
  exportTenant,
  governanceView,
  isTenantAdmin,
  migrateGovernance,
  runExpiry,
  setRedaction,
  setRetention,
  startRetentionLoop,
} from './governance.js';
import { isProduction, publicError, rateLimit, rejectIdentityOverride, sanitizePlain, securityStatus } from './security.js';
import { sendLoiCopy } from '../src/utils/mailer.js';
import { LOI_VERSION } from '../src/legal/loi.js';

function uidOf(req: Request) {
  const uid = req.memoryUser?.uid;
  if (!uid) throw Object.assign(new Error('Sign in required for memory'), { status: 401 });
  return uid;
}

function emailClaim(token: string) {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { email?: string };
    return sanitizePlain(json.email, 200);
  } catch {
    return '';
  }
}

function fail(
  res: { set: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } },
  e: { status?: number; message?: string; expose?: boolean }
) {
  res.set('Cache-Control', 'private, no-store');
  const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status >= 500) console.error('request failed', e?.message || 'unknown');
  if (e?.expose && e.message) {
    res.status(status).json({ error: String(e.message).slice(0, 300) });
    return;
  }
  const err = publicError(e);
  res.status(err.status).json(err.body);
}

function privateNoStore(res: { set: (name: string, value: string) => void }) {
  res.set('Cache-Control', 'private, no-store');
}

export function memoryErrorMiddleware(err: { status?: number; message?: string; expose?: boolean }, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status) || 500;
  const message = err?.expose
    ? String(err.message || 'Memory request failed')
    : status >= 500
      ? 'Memory request failed'
      : String(err?.message || 'Request failed');
  console.error('request failed', err?.message || message);
  privateNoStore(res);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message.slice(0, 300) });
}

function storeIsReady() {
  return memoryEngineReady() && !memoryStoreProblem();
}

function memoryScope(req: Request) {
  const uid = uidOf(req);
  const primary = tagOf(req);
  const scope = String(req.body?.scope || req.query?.scope || req.headers['x-rukmer-scope'] || 'all');
  const teamId = String(req.body?.teamId || req.query?.teamId || '');
  const requested = Array.isArray(req.body?.containerTags) ? req.body.containerTags.map(String) : [];
  return { uid, primary, tags: readTagsFor(uid, { scope, teamId, containerTag: primary, containerTags: requested }) };
}

function tagOf(req: Request) {
  const uid = uidOf(req);
  const raw = String(req.body?.containerTag || req.query.containerTag || req.headers['x-container-tag'] || '');
  if (raw.startsWith('tm_')) {
    if (!canAccessTag(uid, raw)) throw Object.assign(new Error('Not a member of this team'), { status: 403 });
    return raw;
  }
  return resolveScopeTag(uid, {
    containerTag: String(req.body?.containerTag || req.query.containerTag || req.headers['x-container-tag'] || ''),
    scope: String(req.body?.scope || req.query.scope || ''),
    sessionId: String(req.body?.sessionId || req.query.sessionId || ''),
    agentId: String(req.body?.agentId || req.query.agentId || ''),
    orgId: String(req.body?.orgId || req.query.orgId || ''),
  });
}

let bootRequired = false;
let engineReady = false;

/** Call before listen so early requests cannot read an empty store. */
export function beginMemoryBoot() {
  bootRequired = true;
  engineReady = false;
}

export function memoryEngineReady() {
  return !bootRequired || engineReady;
}

function engineRoute(path: string) {
  return (
    path === '/health' ||
    path.startsWith('/v3') ||
    path.startsWith('/v4') ||
    path.startsWith('/v1') ||
    path.startsWith('/mcp') ||
    path.startsWith('/oauth') ||
    path === '/api/loi-accepted'
  );
}

export async function bootMemoryEngine() {
  beginMemoryBoot();
  try {
    assertProductionSecrets();
    await assertStoreNotPublic();
    await loadState();
    await reencryptLoadedStore();
    migrateGovernance();
    runExpiry('system');
    startRetentionLoop();
    pruneJunkMemory();
    applyDecay();
    const remaining = getState().triples.filter(isUsefulFact).length;
    if (remaining < 2) {
      for (const doc of getState().documents.filter((d) => !d.forgotten && d.source !== 'conversation').slice(0, 8)) {
        const graph = await extractGraph(doc.text.slice(0, 4000));
        upsertFacts(doc.containerTag, graph.triples || [], doc.text.slice(0, 240));
      }
    }
    void syncStoredKeys().catch((err) => console.warn('api key sync skipped', (err as Error).message));
    void warmFactEmbeddings().catch(() => undefined);
    const snapshot = stats();
    engineReady = true;
    return snapshot;
  } catch (err) {
    engineReady = false;
    if (!memoryStoreProblem()) {
      const message = err instanceof Error && err.message ? err.message : 'Memory store failed to load';
      noteMemoryStoreProblem(message);
    }
    throw err;
  }
}

export function mountMemoryEngine(app: Express) {
  app.use((req, res, next) => {
    if (storeIsReady() || !engineRoute(req.path) || req.path === '/health') return next();
    privateNoStore(res);
    res.set('Retry-After', '2');
    res.status(503).json({ error: memoryStoreProblem() || 'Memory store is still loading', ready: false });
  });
  app.use(memoryAuth);
  app.use(rejectIdentityOverride);
  app.use(rateLimit);
  mountOauth(app);
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/v3') || req.path.startsWith('/v4') || req.path.startsWith('/v1') || req.path.startsWith('/mcp')) {
        try {
          logRequest({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Date.now() - start,
            ownerUid: req.memoryUser?.uid,
            type: req.path.includes('search')
              ? 'search'
              : req.path.includes('chat')
                ? 'chat'
                : req.path.includes('document') || req.path.includes('remember')
                  ? 'ingest'
                  : 'other',
          });
        } catch {
          /* ignore */
        }
      }
    });
    next();
  });

  app.get('/health', (_req, res) => {
    const problem = memoryStoreProblem();
    const ready = storeIsReady();
    privateNoStore(res);
    if (!ready) res.set('Retry-After', '2');
    res.status(ready ? 200 : 503).json({
      ok: ready,
      ready,
      encryptionAtRest: encryptionAtRest(),
      engine: 'rukmer-open-core',
      isolation: 'per-user',
      dependencies: { memoryStore: ready ? 'ok' : problem ? 'error' : 'loading' },
      rateLimiting: true,
      corsMode: 'allowlist',
      training: false,
      llm: hasLlm(),
    });
  });

  app.get('/v4/client', (req, res) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    res.json({ ip: forwarded || req.ip || req.socket?.remoteAddress || '' });
  });

  app.post('/api/loi-accepted', async (req, res) => {
    try {
      const uid = uidOf(req);
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const claimEmail = emailClaim(token);
      const email = claimEmail || sanitizePlain(req.body?.email, 200);
      const name = sanitizePlain(req.body?.name, 200);
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const result = await sendLoiCopy({
        name,
        email,
        uid,
        acceptedAt: new Date().toISOString(),
        ip: forwarded || req.ip || req.socket?.remoteAddress || '',
        userAgent: sanitizePlain(req.headers['user-agent'], 400),
      });
      if (!result.success) return res.status(502).json({ error: 'Could not store the letter copy' });
      res.json({ ok: true, version: LOI_VERSION });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/me', (req, res) => {
    try {
      const uid = uidOf(req);
      res.json({ uid, homeTag: homeTag(uid), via: req.memoryUser?.via });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/security', (req, res) => {
    try {
      const actor = uidOf(req);
      if (!isTenantAdmin(actor, homeTag(actor))) return res.status(403).json({ error: 'Admin required' });
      privateNoStore(res);
      res.json({
        ...securityStatus(),
        store: memoryStoreSource(),
        storeError: memoryStoreProblem() || null,
        ready: storeIsReady(),
        providers: providerStatus(),
        llm: hasLlm(),
      });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/protocol', (_req, res) => {
    res.json({
      ...MEMORY_PROTOCOL,
      persistence: 'Processed memory is stored in Rukmer (chunks + durable facts). Provider models only receive an injected prompt; they do not own the store.',
    });
  });

  app.options('/mcp', handleMcp);
  app.get('/mcp', handleMcp);
  app.post('/mcp', handleMcp);
  app.get('/v4/openai.json', (_req, res) => res.json(CHATGPT_OPENAPI));

  app.post('/v3/documents', async (req, res) => {
    try {
      const { title, text, content, url, source, mime, task, pdfBase64, imageBase64, videoBase64, metadata } = req.body || {};
      const tag = tagOf(req);
      if (url) {
        const out = await ingestUrl(String(url), tag, task);
        return res.json(out);
      }
      const out = await ingestPayload({
        title,
        text,
        content,
        pdfBase64,
        imageBase64,
        videoBase64,
        metadata,
        mime,
        source: source || 'api',
        containerTag: tag,
        task,
        actorId: uidOf(req),
        visibility: req.body?.visibility || (req.body?.scope === 'team' ? 'team' : undefined),
        teamId: req.body?.teamId,
        memoryKind: req.body?.memoryKind,
        sourceRef: req.body?.sourceRef,
      });
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v3/documents/batch', async (req, res) => {
    try {
      const items = req.body?.documents || req.body?.files || [];
      const tag = tagOf(req);
      const results = [];
      for (const item of items) {
        results.push(
          await ingestPayload({
            title: item.title || item.name || 'Untitled',
            text: item.text || item.content || '',
            pdfBase64: item.pdfBase64,
            imageBase64: item.imageBase64,
            videoBase64: item.videoBase64,
            metadata: item.metadata,
            mime: item.mime,
            source: item.source || 'upload',
            containerTag: tag,
            task: req.body?.task,
            actorId: uidOf(req),
            visibility: item.visibility || req.body?.visibility,
            teamId: item.teamId || req.body?.teamId,
            memoryKind: item.memoryKind || req.body?.memoryKind,
            sourceRef: item.sourceRef || req.body?.sourceRef,
          })
        );
      }
      res.json({ count: results.length, results });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/files/:id', (req, res) => {
    try {
      const id = String(req.params.id || '');
      const uid = uidOf(req);
      const doc = getState().documents.find((d) => d.fileId === id && canRead(uid, d));
      const bytes = doc ? readBlob(id) : null;
      if (!doc || !bytes) return res.status(404).json({ error: 'File not found' });
      res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/documents/:id', (req, res) => {
    try {
      const doc = readDocument(String(req.params.id || ''), uidOf(req));
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      res.json(doc);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v3/documents/list', (req, res) => {
    try {
      const uid = uidOf(req);
      const explicit = String(req.body?.containerTag || req.query?.containerTag || req.headers['x-container-tag'] || '');
      const documents = explicit ? listDocuments(tagOf(req), uid) : memoryScope(req).tags.flatMap((tag) => listDocuments(tag, uid));
      res.json({ documents, tags: listTags(uid), homeTag: homeTag(uid) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/tags', (req, res) => {
    try {
      privateNoStore(res);
      const scope = String(req.query.scope || 'all');
      res.json({ tags: listTags(uidOf(req), scope === 'private' || scope === 'team' ? scope : 'all'), homeTag: homeTag(uidOf(req)) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  const searchHandler = async (req: Request, res: any) => {
    try {
      const q = sanitizePlain(req.body?.query || req.body?.q || req.body?.prompt || '', 2000);
      const scoped = memoryScope(req);
      const extra = req.body?.union
        ? scopeTagsFor(scoped.uid, {
            containerTag: scoped.primary,
            sessionId: req.body?.sessionId,
            agentId: req.body?.agentId,
            orgId: req.body?.orgId,
            union: true,
          }).filter((tag) => scoped.tags.includes(tag) || tag === scoped.primary)
        : scoped.tags;
      const out = await searchMemory(q, {
        containerTag: scoped.primary,
        containerTags: extra,
        topK: req.body?.topK || req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? req.body?.strictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        retrieval: req.body?.retrieval === 'semantic' || req.body?.retrieval === 'keyword' ? req.body.retrieval : 'hybrid',
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: req.body?.include?.related !== false,
        filters: req.body?.filters,
        actorId: scoped.uid,
        purpose: String(req.body?.purpose || 'search'),
      });
      const bucket = String(req.body?.sources || '');
      if (bucket && bucket !== 'All sources') {
        const docs = getState().documents;
        const originOf = (m: { source?: string; text?: string; containerTag?: string }) => {
          const src = String(m.source || '');
          if (src && src !== 'fact') return src;
          const needle = String(m.text || '').trim().toLowerCase().slice(0, 80);
          if (needle.length < 12) return '';
          const parent = docs.find(
            (d) =>
              d.containerTag === m.containerTag &&
              !d.forgotten &&
              String(d.text || '').toLowerCase().includes(needle.slice(0, 48))
          );
          return parent?.source || '';
        };
        out.matches = (out.matches || []).filter((m: { source?: string; text?: string; containerTag?: string }) => {
          const src = originOf(m);
          if (bucket === 'Documents') return !!src && src !== 'conversation' && src !== 'playground' && src !== 'memory';
          if (bucket === 'Conversations') return src === 'conversation' || src === 'playground' || src === 'memory';
          if (bucket === 'Apps') return ['github', 'notion', 'slack', 'gmail', 'gdrive', 'web', 's3'].includes(src);
          return true;
        });
      }
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  };

  app.post('/v3/search', searchHandler);
  app.post('/v4/search', searchHandler);

  app.post('/v4/chat', async (req, res) => {
    try {
      const q = sanitizePlain(req.body?.query || req.body?.prompt || '', 2000);
      const scoped = memoryScope(req);
      const out = await chatWithMemory(q, {
        containerTag: scoped.primary,
        containerTags: scoped.tags,
        topK: req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: true,
        history: req.body?.history,
        remember: req.body?.remember !== false,
        source: req.body?.source || 'playground',
        actorId: scoped.uid,
        purpose: 'chat',
      });
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/inject', async (req, res) => {
    try {
      const q = sanitizePlain(req.body?.query || req.body?.prompt || '', 2000);
      const scoped = memoryScope(req);
      const out = await buildMemoryInjection(q, scoped.primary, {
        topK: req.body?.topK || req.body?.memoriesRetrieved || 8,
        strictness: req.body?.matchStrictness ?? req.body?.strictness ?? 0.4,
        rewrite: !!req.body?.rewriteQuery,
        rerank: !!req.body?.rerank,
        actorId: scoped.uid,
        purpose: 'inject',
        containerTags: scoped.tags,
      });
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/tools', (_req, res) => res.json({ tools: MEMORY_TOOLS }));

  app.post('/v4/tools/execute', async (req, res) => {
    try {
      const name = String(req.body?.name || req.body?.tool || '');
      const args = req.body?.arguments || req.body?.args || {};
      const out = await runMemoryTool(name, args, uidOf(req));
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v1/models', (_req, res) => {
    const configured = providerStatus();
    res.json({
      object: 'list',
      data: [
        { id: 'gemini-3.8-flash', owned_by: 'google', configured: configured.gemini },
        { id: 'gemini-2.5-flash', owned_by: 'google', configured: configured.gemini },
        { id: 'gpt-4o-mini', owned_by: 'openai', configured: configured.openai },
        { id: 'gpt-4o', owned_by: 'openai', configured: configured.openai },
        { id: 'claude-sonnet-4-5', owned_by: 'anthropic', configured: configured.anthropic },
        { id: 'claude-3-5-haiku-latest', owned_by: 'anthropic', configured: configured.anthropic },
        { id: 'grok-3-mini', owned_by: 'xai', configured: configured.grok },
        { id: 'grok-3', owned_by: 'xai', configured: configured.grok },
      ],
    });
  });

  app.post('/v1/chat/completions', (req, res) => {
    void completeChat(req, res).catch((e) => fail(res, e));
  });
  app.post('/v1/openai/chat/completions', (req, res) => {
    void routeOpenAI(req, res).catch((e) => fail(res, e));
  });
  app.post('/v1/xai/chat/completions', (req, res) => {
    void routeGrok(req, res).catch((e) => fail(res, e));
  });
  app.post('/v1/anthropic/messages', (req, res) => {
    void routeAnthropic(req, res).catch((e) => fail(res, e));
  });
  app.post('/v1/google/models/:model/generateContent', (req, res) => {
    void routeGemini(req, res).catch((e) => fail(res, e));
  });
  app.post('/v1/google/generateContent', (req, res) => {
    void routeGemini(req, res).catch((e) => fail(res, e));
  });

  app.post('/v4/remember', async (req, res) => {
    try {
      const out = await rememberTranscript({
        containerTag: tagOf(req),
        source: req.body?.source || 'api',
        messages: req.body?.messages || [],
        title: req.body?.title,
        actorId: uidOf(req),
        visibility: req.body?.visibility || (req.body?.scope === 'team' ? 'team' : undefined),
        teamId: req.body?.teamId,
      });
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/orgs', (req, res) => {
    try {
      res.json(createOrg(uidOf(req), String(req.body?.name || '')));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/orgs', (req, res) => {
    try {
      res.json({ orgs: listOrgs(uidOf(req)) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/orgs/members', (req, res) => {
    try {
      if (isProduction()) return res.status(410).json({ error: 'Use team invites' });
      res.json(addOrgMember(uidOf(req), String(req.body?.orgId || ''), String(req.body?.uid || '')));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/sessions/close', (req, res) => {
    try {
      res.json(closeSession(uidOf(req), String(req.body?.sessionId || '')));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/consolidate', async (req, res) => {
    try {
      const out = await flushConsolidation(tagOf(req));
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/connectors/apps', (req, res) => {
    try {
      res.json({ apps: connectedAppsFor(uidOf(req)) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/connectors/disconnect', async (req, res) => {
    try {
      const uid = uidOf(req);
      const app = String(req.body?.app || '');
      if (!['claude', 'chatgpt', 'grok', 'gemini', 'browser'].includes(app)) {
        return res.status(400).json({ error: 'Unknown app' });
      }
      const state = getState();
      const before = state.apiKeys.length;
      state.apiKeys = state.apiKeys.filter((k) => !(k.ownerUid === uid && k.connector === app));
      if (state.apiKeys.length !== before) {
        audit({ actorId: uid, action: 'retain', memoryId: app, tenantId: homeTag(uid), detail: 'connector-disconnected result=ok' });
        await persistNow();
      }
      res.json({ ok: true, apps: connectedAppsFor(uid) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/connectors/browser', (req, res) => {
    try {
      const full = String(req.query.full || '') === '1';
      res.json(browserConnectorView(uidOf(req), full));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/connectors/browser/pair', async (req, res) => {
    try {
      const pair = createBrowserPair(uidOf(req));
      await persistNow();
      res.json(pair);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/connectors/browser/claim', async (req, res) => {
    try {
      const issued = await claimBrowserPair(String(req.body?.code || ''), String(req.body?.browser || ''));
      await persistNow();
      if (!issued) return res.status(400).json({ error: 'That connect code expired. Click Connect this browser again.' });
      res.json(issued);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/connectors/browser/forget', (req, res) => {
    try {
      if (req.body?.confirm !== 'forget-browser') return res.status(400).json({ error: 'confirm required' });
      res.json(forgetBrowserMemories(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/connectors/import', async (req, res) => {
    try {
      const out = await importConnector({
        provider: String(req.body?.provider || ''),
        containerTag: tagOf(req),
        token: req.body?.token,
        url: req.body?.url,
      });
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/profile', (req, res) => {
    try {
      const uid = uidOf(req);
      res.json(buildProfile(tagOf(req), uid));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/graph', (req, res) => {
    try {
      privateNoStore(res);
      const uid = uidOf(req);
      const requested = String(req.query.containerTag || '').trim();
      const scope = String(req.query.scope || 'all');
      res.json(graphPayload(requested ? tagOf(req) : undefined, uid, scope === 'private' || scope === 'team' ? scope : 'all'));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.delete('/v4/memories', (req, res) => {
    try {
      const id = String(req.body?.id || req.query.id || '');
      res.json(forgetById(id, uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/memories/forget-matching', (req, res) => {
    try {
      res.json(forgetMatching(String(req.body?.query || ''), tagOf(req), !!req.body?.dryRun));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/stats', (req, res) => {
    try {
      res.json(stats(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });
  app.get('/v3/insights', (req, res) => {
    try {
      res.json(insights(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });
  app.get('/v3/jobs', (req, res) => {
    try {
      const uid = uidOf(req);
      res.json({ jobs: getState().jobs.filter((j) => j.ownerUid === uid).slice(-20).reverse() });
    } catch (e: any) {
      fail(res, e);
    }
  });
  app.get('/v3/requests', (req, res) => {
    try {
      const uid = uidOf(req);
      const weekAgo = Date.now() - 7 * 86400000;
      const rows = getState().requests.filter((r) => r.ownerUid === uid && Date.parse(r.at) >= weekAgo);
      const byType: Record<string, number> = {};
      let ok = 0;
      let searchMs = 0;
      let searchN = 0;
      for (const row of rows) {
        byType[row.type] = (byType[row.type] || 0) + 1;
        if (row.status >= 200 && row.status < 300) ok += 1;
        if (row.type === 'search') {
          searchMs += row.ms;
          searchN += 1;
        }
      }
      res.json({
        requests: rows.slice(0, 400),
        window: '7d',
        byType,
        ok,
        avgMs: searchN ? Math.round(searchMs / searchN) : 0,
      });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/export', (req, res) => {
    try {
      res.json(exportMine(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/account/reset', (req, res) => {
    try {
      if (req.body?.confirm !== 'reset') return res.status(400).json({ error: 'Confirm with {"confirm":"reset"}' });
      res.json(resetMine(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/keys', async (req, res) => {
    try {
      const uid = uidOf(req);
      const keys = await keysFor(uid);
      res.json({
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          createdAt: k.createdAt,
          lastUsed: k.lastUsed,
          expires: 'Never',
        })),
      });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v3/keys/verify', async (req, res) => {
    try {
      const uid = uidOf(req);
      const secret = String(req.body?.secret || '').trim();
      if (!secret.startsWith('rk_live_')) return res.status(401).json({ ok: false, error: 'Invalid API key' });
      const rec = await findKey(secret);
      if (!rec || !rec.ownerUid || rec.ownerUid !== uid) return res.status(401).json({ ok: false, error: 'Invalid API key' });
      res.json({ ok: true, uid, homeTag: homeTag(uid), via: 'apikey', name: rec.name });
    } catch (e: any) {
      const err = publicError(e);
      res.status(err.status).json({ ok: false, ...err.body });
    }
  });

  app.delete('/v3/keys/:id', async (req, res) => {
    try {
      const uid = uidOf(req);
      const owned = await keysFor(uid);
      const rec = owned.find((k) => k.id === req.params.id);
      if (!rec) return res.status(404).json({ error: 'Key not found' });
      await forgetKey(rec.hash);
      audit({ actorId: uid, action: 'retain', memoryId: String(req.params.id), tenantId: homeTag(uid), detail: 'api-key-revoked result=ok' });
      await persistNow();
      res.json({ ok: true });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v3/keys', async (req, res) => {
    try {
      const ownerUid = uidOf(req);
      const secret = 'rk_live_' + crypto.randomBytes(18).toString('hex');
      const rec = {
        id: uid('key'),
        name: String(req.body?.name || 'Untitled'),
        prefix: secret.slice(0, 12) + '…',
        hash: sha(secret.trim()),
        createdAt: new Date().toISOString(),
        lastUsed: null,
        ownerUid,
      };
      await rememberKey(rec);
      audit({ actorId: ownerUid, action: 'retain', memoryId: rec.id, tenantId: homeTag(ownerUid), detail: 'api-key-created result=ok' });
      try {
        await persistNow();
      } catch (err) {
        if (!keysAreDurable()) throw err;
        console.warn('api key saved; shared json copy lagged', (err as Error).message);
      }
      res.json({ ...rec, secret, scope: 'Full' });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/governance', (req, res) => {
    try {
      res.json(governanceView(uidOf(req)));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.put('/v4/governance/retention', (req, res) => {
    try {
      const policies = setRetention(uidOf(req), {
        tenantId: String(req.body?.tenantId || ''),
        memoryKind: req.body?.memoryKind || 'context',
        ttlDays: Number(req.body?.ttlDays),
        action: req.body?.action === 'purge' ? 'purge' : 'archive',
      });
      res.json({ policies });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.put('/v4/governance/redaction', (req, res) => {
    try {
      res.json(setRedaction(uidOf(req), {
        tenantId: String(req.body?.tenantId || ''),
        credentials: req.body?.credentials,
        payment: req.body?.payment,
        sensitive: req.body?.sensitive,
      }));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/governance/expiry', (req, res) => {
    try {
      const actor = uidOf(req);
      const requested = String(req.body?.tenantId || '');
      const tenantId = requested || homeTag(actor);
      if (requested && requested !== homeTag(actor) && !isTenantAdmin(actor, requested)) {
        return res.status(403).json({ error: 'Tenant admin required' });
      }
      res.json(runExpiry(actor, Date.now(), tenantId));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.delete('/v4/governance/memories/:id', (req, res) => {
    try {
      const out = forgetById(String(req.params.id || ''), uidOf(req));
      if (out.ok === false) return res.status(403).json(out);
      res.json(out);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/governance/forget', (req, res) => {
    try {
      const actor = uidOf(req);
      const dryRun = !!req.body?.dryRun;
      if (req.body?.memoryId) {
        const out = forgetById(String(req.body.memoryId), actor);
        if (out.ok === false) return res.status(403).json(out);
        return res.json({ ...out, dryRun: false });
      }
      if (req.body?.ownerId) return res.json(forgetOwner(actor, String(req.body.ownerId), dryRun));
      if (req.body?.tenantId) return res.json(forgetTenant(actor, String(req.body.tenantId), dryRun));
      res.status(400).json({ error: 'memoryId, ownerId, or tenantId required' });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/governance/export', (req, res) => {
    try {
      const actor = uidOf(req);
      const tenantId = String(req.query.tenantId || '');
      res.json(tenantId ? exportTenant(actor, tenantId) : exportMine(actor));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/governance/audit', (req, res) => {
    try {
      res.json({ audit: auditFor(uidOf(req), String(req.query.tenantId || '') || undefined) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/governance/teams', (req, res) => {
    try {
      res.json(createTeam(uidOf(req), String(req.body?.name || ''), req.body?.tenantId ? String(req.body.tenantId) : undefined));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.post('/v4/memories/:id/move', (req, res) => {
    try {
      const to = req.body?.to === 'team' ? 'team' : req.body?.to === 'private' ? 'private' : '';
      if (!to) return res.status(400).json({ error: 'to must be private or team' });
      res.json(moveMemory(uidOf(req), String(req.params.id || ''), to, req.body?.teamId ? String(req.body.teamId) : undefined));
    } catch (e: any) {
      fail(res, e);
    }
  });

  mountTeamRoutes(app);

  app.post('/v4/governance/teams/members', (req, res) => {
    try {
      if (isProduction()) return res.status(410).json({ error: 'Use team invites' });
      res.json(addTeamMember(uidOf(req), String(req.body?.teamId || ''), String(req.body?.uid || '')));
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/path', (req, res) => {
    try {
      const tag = tagOf(req);
      const triples = getState().triples.filter((t) => t.containerTag === tag);
      res.json({ path: shortestPath(triples, String(req.query.from || ''), String(req.query.to || ''), tag) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.use(memoryErrorMiddleware);
}
