import type { Express, Request } from 'express';
import crypto from 'crypto';
import { getState, loadState, saveState, sha, shortestPath, uid } from './core.js';
import {
  chatWithMemory,
  forgetById,
  forgetMatching,
  graphPayload,
  ingestDocument,
  ingestPayload,
  ingestUrl,
  insights,
  listDocuments,
  listTags,
  logRequest,
  rememberTranscript,
  searchMemory,
  stats,
} from './pipeline.js';
import { upsertFacts } from './facts.js';
import { extractGraph } from './llm.js';
import { isUsefulFact, pruneJunkMemory } from './quality.js';
import { buildMemoryInjection } from './inject.js';
import { completeChat, providerStatus, routeAnthropic, routeGemini, routeGrok, routeOpenAI } from './router.js';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';
import { CHATGPT_OPENAPI, handleMcp } from './mcp.js';
import { MEMORY_PROTOCOL } from './protocol.js';

function tagOf(req: Request) {
  return (req.body?.containerTag || req.query.containerTag || req.headers['x-container-tag'] || '') as string;
}

export async function bootMemoryEngine() {
  await loadState();
  pruneJunkMemory();
  const remaining = getState().triples.filter(isUsefulFact).length;
  if (remaining < 2) {
    for (const doc of getState().documents.filter((d) => !d.forgotten && d.source !== 'conversation').slice(0, 8)) {
      const graph = await extractGraph(doc.text.slice(0, 4000));
      upsertFacts(doc.containerTag, graph.triples || [], doc.text.slice(0, 240));
    }
  }
  const s = stats();
  if (!s.documents) {
    await ingestDocument({
      title: 'Welcome to Rukmer Memory',
      containerTag: 'rukmer-workspace',
      source: 'seed',
      text: `Rukmer Memory is a workplace memory engine for people and agents.
It stores documents, emails, notes, and live conversations as chunks with embeddings, BM25 keyword search, and a fact graph.
Container tags isolate projects. The default workspace tag is rukmer-workspace.
Preferred coffee is a double espresso in the morning.
Current work includes the open-core RAG pipeline, hybrid retrieval, and graph memory architecture.
Claude, Gemini, ChatGPT, and the Rukmer playground should all write turns into this same memory so later answers know what happened.`,
    });
  }
  return stats();
}

export function mountMemoryEngine(app: Express) {
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
    res.json({ ok: true, engine: 'rukmer-open-core', stats: stats(), providers: providerStatus() });
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
      const { title, text, content, url, containerTag, source, mime, task, pdfBase64 } = req.body || {};
      const tag = containerTag || 'rukmer-workspace';
      if (url) {
        const out = await ingestUrl(String(url), tag, task);
        return res.json(out);
      }
      const out = await ingestPayload({
        title,
        text,
        content,
        pdfBase64,
        mime,
        source: source || 'api',
        containerTag: tag,
        task,
      });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/v3/documents/batch', async (req, res) => {
    try {
      const items = req.body?.documents || req.body?.files || [];
      const tag = req.body?.containerTag || 'rukmer-workspace';
      const results = [];
      for (const item of items) {
        results.push(
          await ingestPayload({
            title: item.title || item.name || 'Untitled',
            text: item.text || item.content || '',
            pdfBase64: item.pdfBase64,
            mime: item.mime,
            source: item.source || 'upload',
            containerTag: tag,
            task: req.body?.task,
          })
        );
      }
      res.json({ count: results.length, results });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/v3/documents/list', (req, res) => {
    const tag = tagOf(req) || undefined;
    res.json({ documents: listDocuments(tag || null), tags: listTags() });
  });

  app.get('/v3/tags', (_req, res) => res.json({ tags: listTags() }));

  const searchHandler = async (req: Request, res: any) => {
    try {
      const q = String(req.body?.query || req.body?.q || req.body?.prompt || '');
      const out = await searchMemory(q, {
        containerTag: req.body?.containerTag || 'rukmer-workspace',
        topK: req.body?.topK || req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? req.body?.strictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: req.body?.include?.related !== false,
      });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  };

  app.post('/v3/search', searchHandler);
  app.post('/v4/search', searchHandler);

  app.post('/v4/chat', async (req, res) => {
    try {
      const q = String(req.body?.query || req.body?.prompt || '');
      const out = await chatWithMemory(q, {
        containerTag: req.body?.containerTag || 'rukmer-workspace',
        topK: req.body?.memoriesRetrieved || 10,
        strictness: req.body?.matchStrictness ?? 0.4,
        rerank: !!req.body?.rerank,
        rewrite: !!req.body?.rewriteQuery,
        includeForgotten: !!req.body?.include?.forgotten,
        includeRelated: true,
        history: req.body?.history,
        remember: req.body?.remember !== false,
        source: req.body?.source || 'playground',
      });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/v4/inject', async (req, res) => {
    try {
      const q = String(req.body?.query || req.body?.prompt || '');
      const tag = req.body?.containerTag || tagOf(req) || 'rukmer-workspace';
      const out = await buildMemoryInjection(q, tag, {
        topK: req.body?.topK || 8,
        rewrite: !!req.body?.rewriteQuery,
        rerank: !!req.body?.rerank,
      });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/v4/tools', (_req, res) => res.json({ tools: MEMORY_TOOLS }));

  app.post('/v4/tools/execute', async (req, res) => {
    try {
      const name = String(req.body?.name || req.body?.tool || '');
      const args = req.body?.arguments || req.body?.args || {};
      const out = await runMemoryTool(name, args);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
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
    void completeChat(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });
  app.post('/v1/openai/chat/completions', (req, res) => {
    void routeOpenAI(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });
  app.post('/v1/xai/chat/completions', (req, res) => {
    void routeGrok(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });
  app.post('/v1/anthropic/messages', (req, res) => {
    void routeAnthropic(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });
  app.post('/v1/google/models/:model/generateContent', (req, res) => {
    void routeGemini(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });
  app.post('/v1/google/generateContent', (req, res) => {
    void routeGemini(req, res).catch((e) => res.status(400).json({ error: e.message }));
  });

  app.post('/v4/remember', async (req, res) => {
    try {
      const out = await rememberTranscript({
        containerTag: req.body?.containerTag || 'rukmer-workspace',
        source: req.body?.source || 'api',
        messages: req.body?.messages || [],
        title: req.body?.title,
      });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/v4/profile', (req, res) => {
    const tag = (req.query.containerTag as string) || 'rukmer-workspace';
    const triples = getState().triples.filter((t) => !tag || t.containerTag === tag);
    res.json({
      static: triples.slice(0, 20),
      dynamic: triples.slice(0, 8),
    });
  });

  app.get('/v4/graph', (req, res) => {
    res.json(graphPayload((req.query.containerTag as string) || 'rukmer-workspace'));
  });

  app.delete('/v4/memories', (req, res) => {
    const id = String(req.body?.id || req.query.id || '');
    res.json(forgetById(id));
  });

  app.post('/v4/memories/forget-matching', (req, res) => {
    res.json(forgetMatching(String(req.body?.query || ''), req.body?.containerTag, !!req.body?.dryRun));
  });

  app.get('/v3/stats', (_req, res) => res.json(stats()));
  app.get('/v3/insights', (_req, res) => res.json(insights()));
  app.get('/v3/jobs', (_req, res) => res.json({ jobs: getState().jobs.slice(-20).reverse() }));
  app.get('/v3/requests', (req, res) => {
    const days = Number(req.query.days || 30);
    const cutoff = Date.now() - days * 86400000;
    const rows = getState().requests.filter((r) => new Date(r.at).getTime() >= cutoff);
    res.json({
      requests: rows,
      byType: rows.reduce((a: any, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {}),
      ok: rows.filter((r) => r.status < 300).length,
      avgMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length) : 0,
    });
  });

  app.get('/v3/keys', (_req, res) => {
    res.json({
      keys: getState().apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        createdAt: k.createdAt,
        lastUsed: k.lastUsed,
        expires: 'Never',
      })),
    });
  });

  app.post('/v3/keys', (req, res) => {
    const secret = 'rk_live_' + crypto.randomBytes(18).toString('hex');
    const rec = {
      id: uid('key'),
      name: String(req.body?.name || 'Untitled'),
      prefix: secret.slice(0, 12) + '…',
      hash: sha(secret),
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };
    getState().apiKeys.push(rec);
    saveState();
    res.json({ ...rec, secret, scope: 'Full' });
  });

  app.get('/v4/path', (req, res) => {
    const { from, to, containerTag } = req.query as any;
    const triples = getState().triples;
    res.json({ path: shortestPath(triples, String(from || ''), String(to || ''), String(containerTag || 'rukmer-workspace')) });
  });
}
