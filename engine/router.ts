import type { Request, Response } from 'express';
import {
  buildMemoryInjection,
  injectAnthropic,
  injectGemini,
  injectOpenAIMessages,
  lastUserQuery,
} from './inject.js';
import { currentModel, geminiTryList } from './models.js';
import { rememberTranscript } from './pipeline.js';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';
import { readTagsFor, readableSpaces } from './spaces.js';
import { resolveOwnedTag } from './tenancy.js';
import { isProduction } from './security.js';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'grok';

function tagOf(req: Request) {
  const uid = req.memoryUser?.uid;
  if (!uid) throw new Error('Sign in required for memory');
  return resolveOwnedTag(uid, String(req.headers['x-container-tag'] || req.body?.containerTag || ''));
}

function memoryOn(req: Request) {
  const v = String(req.headers['x-rukmer-memory'] || 'on').toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

function header(req: Request, name: string) {
  const v = req.headers[name];
  return typeof v === 'string' ? v.trim() : '';
}

function bearer(req: Request) {
  const a = header(req, 'authorization');
  return a.toLowerCase().startsWith('bearer ') ? a.slice(7).trim() : '';
}

function providerSecret(req: Request) {
  const t = bearer(req);
  if (!t || t.split('.').length === 3 || t.startsWith('rk_live_')) return '';
  return t;
}

export function providerName(provider: Provider) {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'grok') return 'xAI';
  return 'Gemini';
}

export function missingKeyMessage(provider: Provider) {
  const name = providerName(provider);
  const article = provider === 'gemini' ? 'a' : 'an';
  return `Add ${article} ${name} API key in Playground (plug icon) or Settings → Advanced before using this model.`;
}

export function providerFromModel(model: string): Provider {
  const m = (model || '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('grok') || m.includes('xai')) return 'grok';
  return 'openai';
}

export function serverProviderKey(provider: Provider) {
  if (provider === 'openai') return String(process.env.OPENAI_API_KEY || '');
  if (provider === 'anthropic') return String(process.env.ANTHROPIC_API_KEY || '');
  if (provider === 'gemini') return String(process.env.GEMINI_API_KEY || '');
  return String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || '');
}

export function providerStatus() {
  return {
    gemini: !!serverProviderKey('gemini'),
    openai: !!serverProviderKey('openai'),
    anthropic: !!serverProviderKey('anthropic'),
    grok: !!serverProviderKey('grok'),
  };
}

export function keyFor(provider: Provider, req: Request) {
  const token = providerSecret(req);
  if (provider === 'openai') return header(req, 'x-openai-key') || token || serverProviderKey('openai');
  if (provider === 'anthropic') return header(req, 'x-anthropic-key') || header(req, 'x-api-key') || serverProviderKey('anthropic');
  if (provider === 'gemini') return header(req, 'x-gemini-key') || header(req, 'x-goog-api-key') || serverProviderKey('gemini');
  return header(req, 'x-grok-key') || header(req, 'x-xai-key') || token || serverProviderKey('grok');
}

function spaceOf(tag: string, actorId?: string) {
  const space = actorId ? readableSpaces(actorId).find((row) => row.tag === tag) : undefined;
  const personal = !tag.startsWith('tm_');
  return {
    spaceKind: personal ? 'personal' : 'team',
    spaceLabel: personal ? 'Personal' : space?.name || 'Organization',
  };
}

async function rememberNow(tag: string, messages: { role?: string; content?: string }[], actorId: string | undefined, source: string) {
  const started = Date.now();
  try {
    const saved = await Promise.race([
      rememberTranscript({ containerTag: tag, source, messages, actorId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    const place = spaceOf(tag, actorId);
    return {
      saved: saved.skipped !== true,
      skipped: saved.skipped === true,
      reason: saved.reason || (saved.skipped ? 'not-durable' : ''),
      documentId: saved.document?.id,
      ...place,
      ms: Date.now() - started,
    };
  } catch {
    return { saved: false, skipped: true, reason: 'save failed', ...spaceOf(tag, actorId) };
  }
}

async function proxyJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

function openaiMessages(req: Request) {
  if (Array.isArray(req.body?.messages)) return req.body.messages;
  if (Array.isArray(req.body?.contents)) {
    return req.body.contents.map((c: any) => ({
      role: c.role === 'model' ? 'assistant' : c.role || 'user',
      content: (c.parts || []).map((p: any) => p.text || '').join(' '),
    }));
  }
  const q = String(req.body?.query || req.body?.prompt || '');
  return q ? [{ role: 'user', content: q }] : [];
}

function toAnthropicMessages(messages: any[]) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
}

function toGeminiContents(messages: any[]) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));
}

function openaiWrap(answer: string, model: string, extra: any = {}) {
  return {
    id: 'rukmer-complete',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    ...extra,
  };
}

async function runOpenAICompat(opts: {
  url: string;
  key: string;
  model: string;
  messages: any[];
  tools?: boolean;
  uid?: string;
}) {
  let messages = opts.messages;
  for (let i = 0; i < 4; i++) {
    const body: any = { model: opts.model, messages };
    if (opts.tools) body.tools = MEMORY_TOOLS;
    const up = await proxyJson(opts.url, {
      Authorization: `Bearer ${opts.key}`,
      'Content-Type': 'application/json',
    }, body);
    if (up.status >= 400) return up;
    const msg = up.json?.choices?.[0]?.message;
    const calls = msg?.tool_calls || [];
    if (!calls.length) return up;
    messages = [...messages, msg];
    for (const call of calls) {
      const name = call.function?.name || call.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await runMemoryTool(name, args, opts.uid);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }
  return { status: 200, json: openaiWrap('Memory tools ran, but the model did not finish.', opts.model) };
}

export async function completeChat(req: Request, res: Response) {
  const sessionId = String(req.body?.sessionId || req.body?.threadId || req.headers['x-rukmer-session'] || '');
  if (req.body && String(req.body.scope || '') !== 'session') {
    delete req.body.sessionId;
    delete req.body.threadId;
  }
  const tag = tagOf(req);
  const model = currentModel(String(req.body?.model || 'gemini-4-hydrogen'));
  const provider = providerFromModel(model);
  const key = keyFor(provider, req);
  if (!key) {
    return res.status(401).json({
      error: missingKeyMessage(provider),
      provider,
    });
  }

  const rawMessages = openaiMessages(req);
  const query = lastUserQuery(rawMessages);
  const uid = req.memoryUser?.uid;
  const useMemory = memoryOn(req) && req.body?.compareWithoutMemory !== true;
  const agentic = String(req.headers['x-rukmer-mode'] || req.body?.memoryMode || 'auto') === 'agentic';

  let mem: Awaited<ReturnType<typeof buildMemoryInjection>> | null = null;
  let messages = rawMessages;
  if (useMemory) {
    const scope = String(req.headers['x-rukmer-scope'] || req.body?.memoryScope || req.body?.scope || 'private');
    const tags = uid ? readTagsFor(uid, { scope, teamId: req.body?.teamId, containerTag: tag }) : [tag];
    const knowable = uid ? readTagsFor(uid, { scope: 'all' }) : tags;
    const allowed = req.memoryUser?.containerTags;
    const visible = allowed?.length ? knowable.filter((item) => allowed.includes(item)) : knowable;
    mem = await buildMemoryInjection(query, tag, {
      topK: Number(req.body?.memoriesRetrieved || 4),
      strictness: Number(req.body?.matchStrictness ?? req.body?.strictness ?? 0.4),
      rerank: !!req.body?.rerank,
      rewrite: !!req.body?.rewriteQuery,
      retrieval: req.body?.retrieval === 'semantic' || req.body?.retrieval === 'keyword' ? req.body.retrieval : undefined,
      actorId: uid,
      purpose: 'chat',
      containerTags: tags,
      probeTags: visible.filter((item) => !tags.includes(item)),
      sessionId,
    });
    messages = injectOpenAIMessages(rawMessages, mem.injection, mem.system);
  }

  let status = 200;
  let json: any = {};
  let answer = '';

  if (provider === 'openai' || provider === 'grok') {
    const url =
      provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const up = await runOpenAICompat({ url, key, model, messages, tools: agentic && useMemory, uid });
    status = up.status;
    json = up.json;
    answer = json?.choices?.[0]?.message?.content || json?.error?.message || '';
  } else if (provider === 'anthropic') {
    const payload = injectAnthropic(
      {
        model,
        max_tokens: Number(req.body?.max_tokens || 1024),
        messages: toAnthropicMessages(rawMessages),
      },
      useMemory && mem ? mem.injection : '',
      useMemory && mem ? mem.system : 'You are a helpful assistant.'
    );
    if (!useMemory) delete payload.system;
    const up = await proxyJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': key,
      'anthropic-version': header(req, 'anthropic-version') || '2023-06-01',
      'Content-Type': 'application/json',
    }, payload);
    status = up.status;
    const text = Array.isArray(up.json?.content) ? up.json.content.map((p: any) => p.text || '').join('') : up.json?.error?.message || '';
    answer = text;
    json = openaiWrap(text, model, { raw: up.json });
    if (up.status >= 400) json = up.json;
  } else {
    const tried = geminiTryList(model);
    let up: { status: number; json: any } = { status: 400, json: {} };
    let text = '';
    for (const m of tried) {
      up = await proxyJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
        { 'Content-Type': 'application/json' },
        injectGemini(
          { contents: toGeminiContents(rawMessages) },
          useMemory && mem ? mem.injection : '',
          useMemory && mem ? mem.system : 'You are a helpful assistant.'
        )
      );
      text = up.json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
      if (up.status < 400 && text) {
        json = openaiWrap(text, m, { raw: up.json });
        answer = text;
        status = up.status;
        break;
      }
      json = up.json;
      status = up.status;
      answer = up.json?.error?.message || text;
    }
  }

  const memorySave = useMemory && status < 400
    ? await rememberNow(
        tag,
        rawMessages.slice(-6).map((message) => ({ role: message.role, content: String(message.content || '') })),
        uid,
        req.body?.source === 'playground' ? 'playground' : 'conversation',
      )
    : { saved: false, skipped: true, reason: useMemory ? 'model failed' : 'memory off', ...spaceOf(tag, uid) };
  const citations = (mem?.retrieved.matches || []).map((match) => ({
    id: match.id,
    text: String(match.text || '').slice(0, 500),
    title: match.title,
    source: match.source || 'memory',
    score: match.score,
  }));
  const skipReason = !memoryOn(req)
    ? 'memory off'
    : req.body?.compareWithoutMemory === true
      ? 'compare mode'
      : mem?.skipReason || mem?.retrieved?.skipReason || (useMemory && citations.length === 0 ? 'below-threshold' : '');
  const emptyReason = !tag
    ? 'no tag'
    : skipReason === 'memory off'
      ? 'memory off'
      : skipReason === 'compare mode'
        ? 'compare mode'
        : useMemory && citations.length === 0
          ? 'below threshold'
          : '';
  res.status(status).json({
    ...json,
    answer,
    rukmer: {
      injected: useMemory,
      provider,
      containerTag: tag,
      matches: citations.length,
      retrievedCount: citations.length,
      scores: citations.map((hit) => hit.score),
      tokensInjected: Number(mem?.tokensInjected || 0),
      skipReason,
      citations,
      prefixHash: mem?.prefixHash || '',
      fullHash: mem?.fullHash || '',
      reusedMemoryIds: mem?.reusedMemoryIds || [],
      newMemoryIds: mem?.newMemoryIds || [],
      prefixChars: mem?.prefixChars || 0,
      memorySave,
      otherSpaceHint: (mem as { otherSpaceHint?: unknown } | null)?.otherSpaceHint,
      ...(!isProduction() && citations.length === 0 && emptyReason ? { debug: { reason: emptyReason } } : {}),
    },
  });
}

export async function routeOpenAI(req: Request, res: Response) {
  req.body = { ...(req.body || {}), model: currentModel(req.body?.model || 'gpt-6.2-astra') };
  return completeChat(req, res);
}

export async function routeAnthropic(req: Request, res: Response) {
  req.body = {
    ...(req.body || {}),
    model: currentModel(req.body?.model || 'claude-sonnet-5-5'),
    messages: req.body?.messages,
  };
  return completeChat(req, res);
}

export async function routeGemini(req: Request, res: Response) {
  req.body = {
    ...(req.body || {}),
    model: currentModel(String(req.params.model || req.body?.model || 'gemini-4-hydrogen')),
    contents: req.body?.contents,
  };
  return completeChat(req, res);
}

export async function routeGrok(req: Request, res: Response) {
  req.body = { ...(req.body || {}), model: currentModel(req.body?.model || 'grok-4.7') };
  return completeChat(req, res);
}
