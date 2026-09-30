import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getState, loadState, saveState, sha, shortestPath, uid } from './core.js';
import {
  chatWithMemory,
  forgetById,
  forgetMatching,
  graphPayload,
  ingestDocument,
  ingestUrl,
  ingestPayload,
  insights,
  listDocuments,
  listTags,
  logRequest,
  searchMemory,
  stats,
} from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

loadState();

const app = express();
app.use(cors());
app.use(express.json({ limit: '40mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/v3') || req.path.startsWith('/v4')) {
      try {
        logRequest({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
          type: req.path.includes('search') ? 'search' : req.path.includes('chat') ? 'chat' : req.path.includes('document') ? 'ingest' : 'other',
        });
      } catch {
        /* ignore */
      }
    }
  });
  next();
});

function tagOf(req: express.Request) {
  return (req.body?.containerTag || req.query.containerTag || req.headers['x-container-tag'] || '') as string;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, engine: 'rukmer-open-core', stats: stats() });
});

app.post('/v3/documents', async (req, res) => {
  try {
    const { title, text, content, url, containerTag, source, mime, task, pdfBase64 } = req.body || {};
    const tag = containerTag || 'default';
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
    const tag = req.body?.containerTag || 'default';
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

app.post('/v3/search', async (req, res) => {
  try {
    const q = String(req.body?.query || req.body?.q || '');
    const out = await searchMemory(q, {
      containerTag: req.body?.containerTag || null,
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
});

app.post('/v4/search', async (req, res) => {
  try {
    const q = String(req.body?.query || req.body?.q || req.body?.prompt || '');
    const out = await searchMemory(q, {
      containerTag: req.body?.containerTag || null,
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
});

app.post('/v4/chat', async (req, res) => {
  try {
    const q = String(req.body?.query || req.body?.prompt || '');
    const out = await chatWithMemory(q, {
      containerTag: req.body?.containerTag || null,
      topK: req.body?.memoriesRetrieved || 10,
      strictness: req.body?.matchStrictness ?? 0.4,
      rerank: !!req.body?.rerank,
      rewrite: !!req.body?.rewriteQuery,
      includeForgotten: !!req.body?.include?.forgotten,
      includeRelated: true,
    });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/v4/profile', (req, res) => {
  const tag = (req.query.containerTag as string) || undefined;
  const triples = getState().triples.filter((t) => !tag || t.containerTag === tag);
  res.json({
    static: triples.slice(0, 20),
    dynamic: triples.slice(0, 8),
  });
});

app.get('/v4/graph', (req, res) => {
  res.json(graphPayload((req.query.containerTag as string) || null));
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
  res.json({ path: shortestPath(triples, String(from || ''), String(to || ''), String(containerTag || 'default')) });
});

const PORT = Number(process.env.PORT || 5001);
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🧠 Rukmer open-core engine on http://localhost:${PORT}`);
  const s = stats();
  console.log(`   docs=${s.documents} chunks=${s.chunks} llm=${s.llm}`);
  if (!s.documents) {
    await ingestDocument({
      title: 'Welcome to Rukmer Memory',
      containerTag: 'rukmer-workspace',
      source: 'seed',
      text: `Rukmer Memory is a workplace memory engine for people and agents.
It stores documents, emails, and notes as chunks with embeddings, BM25 keyword search, and a fact graph.
Container tags isolate projects. The default workspace tag is rukmer-workspace.
Saiteja is building Rukmer so teams can search dark data and act on it.
Preferred coffee is a double espresso in the morning.
Current work includes the open-core RAG pipeline, hybrid retrieval, and graph memory architecture.`,
    });
    console.log('   seeded rukmer-workspace');
  }
});
