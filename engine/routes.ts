import type { Express, Request } from 'express';
import crypto from 'crypto';
import { encryptionAtRest, encryptionWarning, getState, loadState, persistNow, readBlob, saveState, sha, shortestPath, uid } from './core.js';
import {
  chatWithMemory,
  forgetById,
  forgetMatching,
  forgetOwner,
  forgetTenant,
  exportMine,
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
import { extractGraph } from './llm.js';
import { isUsefulFact, pruneJunkMemory } from './quality.js';
import { buildMemoryInjection } from './inject.js';
import { completeChat, providerStatus, routeAnthropic, routeGemini, routeGrok, routeOpenAI } from './router.js';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';
import { CHATGPT_OPENAPI, handleMcp } from './mcp.js';
import { MEMORY_PROTOCOL } from './protocol.js';
import { memoryAuth } from './identity.js';
import { homeTag, resolveScopeTag } from './tenancy.js';
import { addOrgMember, closeSession, createOrg, listOrgs, scopeTagsFor } from './scopes.js';
import { importConnector } from './connectors.js';
import { applyDecay, buildProfile } from './memory.js';
import { mountOauth } from './oauth.js';
import {
  addTeamMember,
  audit,
  auditFor,
  canRead,
  createTeam,
  exportTenant,
  governanceView,
  isTenantAdmin,
  scopeTagsForActor,
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

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, e: { status?: number; message?: string }) {
  const err = publicError(e);
  res.status(err.status).json(err.body);
}

function tagOf(req: Request) {
  return resolveScopeTag(uidOf(req), {
    containerTag: String(req.body?.containerTag || req.query.containerTag || req.headers['x-container-tag'] || ''),
    scope: String(req.body?.scope || req.query.scope || ''),
    sessionId: String(req.body?.sessionId || req.query.sessionId || ''),
    agentId: String(req.body?.agentId || req.query.agentId || ''),
    orgId: String(req.body?.orgId || req.query.orgId || ''),
  });
}

export async function bootMemoryEngine() {
  await loadState();
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
  if (isProduction() && !encryptionAtRest()) console.warn(encryptionWarning());
  void warmFactEmbeddings().catch(() => undefined);
  return stats();
}

export function mountMemoryEngine(app: Express) {
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
    res.json({
      ok: true,
      engine: 'rukmer-open-core',
      isolation: 'per-user',
      encryptionAtRest: encryptionAtRest(),
      encryptionWarning: encryptionWarning(),
      rateLimiting: true,
      corsMode: 'allowlist',
      debugMode: !isProduction(),
      training: false,
      providers: providerStatus(),
      llm: stats().llm,
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

  app.get('/v4/security', (_req, res) => {
    res.json(securityStatus());
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
        visibility: req.body?.visibility,
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
      const tag = tagOf(req);
      res.json({ documents: listDocuments(tag, uid), tags: listTags(uid), homeTag: homeTag(uid) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v3/tags', (req, res) => {
    try {
      res.json({ tags: listTags(uidOf(req)), homeTag: homeTag(uidOf(req)) });
    } catch (e: any) {
      fail(res, e);
    }
  });

  const searchHandler = async (req: Request, res: any) => {
    try {
      const q = sanitizePlain(req.body?.query || req.body?.q || req.body?.prompt || '', 2000);
      const uid = uidOf(req);
      const primary = tagOf(req);
      const extra = req.body?.union
        ? scopeTagsFor(uid, {
            containerTag: primary,
            sessionId: req.body?.sessionId,
            agentId: req.body?.agentId,
            orgId: req.body?.orgId,
            union: true,
          })
        : scopeTagsForActor(uid, primary);
      const out = await searchMemory(q, {
        containerTag: primary,
        containerTags: extra,
        topK: req.body?.topK || req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? req.body?.strictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        retrieval: req.body?.retrieval === 'semantic' || req.body?.retrieval === 'keyword' ? req.body.retrieval : 'hybrid',
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: req.body?.include?.related !== false,
        filters: req.body?.filters,
        actorId: uid,
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
      const out = await chatWithMemory(q, {
        containerTag: tagOf(req),
        topK: req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: true,
        history: req.body?.history,
        remember: req.body?.remember !== false,
        source: req.body?.source || 'playground',
        actorId: uidOf(req),
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
      const tag = tagOf(req);
      const out = await buildMemoryInjection(q, tag, {
        topK: req.body?.topK || 8,
        rewrite: !!req.body?.rewriteQuery,
        rerank: !!req.body?.rerank,
        actorId: uidOf(req),
        purpose: 'inject',
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
        visibility: req.body?.visibility,
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
      const profile = buildProfile(tagOf(req));
      res.json(profile);
    } catch (e: any) {
      fail(res, e);
    }
  });

  app.get('/v4/graph', (req, res) => {
    try {
      const uid = uidOf(req);
      const requested = String(req.query.containerTag || '').trim();
      res.json(requested ? graphPayload(tagOf(req)) : graphPayload(undefined, uid));
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
      const rows = getState().requests.filter((r) => r.ownerUid === uid);
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
        requests: rows.slice(0, 80),
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

  app.get('/v3/keys', (req, res) => {
    try {
      const uid = uidOf(req);
      res.json({
        keys: getState()
          .apiKeys.filter((k) => k.ownerUid === uid)
          .map((k) => ({
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
      const rec = getState().apiKeys.find((k) => k.hash === sha(secret));
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
      const state = getState();
      const index = state.apiKeys.findIndex((k) => k.id === req.params.id && k.ownerUid === uid);
      if (index < 0) return res.status(404).json({ error: 'Key not found' });
      state.apiKeys.splice(index, 1);
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
      getState().apiKeys.push(rec);
      audit({ actorId: ownerUid, action: 'retain', memoryId: rec.id, tenantId: homeTag(ownerUid), detail: 'api-key-created result=ok' });
      await persistNow();
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

  app.post('/v4/governance/teams/members', (req, res) => {
    try {
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
}
