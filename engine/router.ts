import type { Request, Response } from 'express';
import {
  buildMemoryInjection,
  injectAnthropic,
  injectGemini,
  injectOpenAIMessages,
  lastUserQuery,
} from './inject.js';
import { rememberTranscript } from './pipeline.js';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';
import { resolveOwnedTag } from './tenancy.js';

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

export function providerFromModel(model: string): Provider {
  const m = (model || '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('grok') || m.includes('xai')) return 'grok';
  return 'openai';
}

export function providerStatus() {
  return {
    gemini: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    grok: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
  };
}

function keyFor(provider: Provider, req: Request) {
  const token = providerSecret(req);
  if (provider === 'openai') {
    return header(req, 'x-openai-key') || token || process.env.OPENAI_API_KEY || '';
  }
  if (provider === 'anthropic') {
    return header(req, 'x-anthropic-key') || header(req, 'x-api-key') || process.env.ANTHROPIC_API_KEY || '';
  }
  if (provider === 'gemini') {
    return header(req, 'x-gemini-key') || header(req, 'x-goog-api-key') || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  }
  return header(req, 'x-grok-key') || header(req, 'x-xai-key') || token || process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
}

function rememberLater(tag: string, source: string, query: string, answer: string) {
  if (!query || !answer) return;
  void rememberTranscript({
    containerTag: tag,
    source,
    messages: [
      { role: 'user', content: query },
      { role: 'assistant', content: answer.slice(0, 8000) },
    ],
  }).catch(() => undefined);
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
      const result = await runMemoryTool(name, args);
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
  const tag = tagOf(req);
  const model = String(req.body?.model || 'gemini-3.8-flash');
  const provider = providerFromModel(model);
  const key = keyFor(provider, req);
  if (!key) {
    return res.status(401).json({
      error: `Missing API key for ${provider}. Paste it in Playground (plug icon) or set it on the server.`,
      provider,
    });
  }

  const rawMessages = openaiMessages(req);
  const query = lastUserQuery(rawMessages);
  const useMemory = memoryOn(req) && req.body?.compareWithoutMemory !== true;
  const agentic = String(req.headers['x-rukmer-mode'] || req.body?.memoryMode || 'auto') === 'agentic';

  let mem: Awaited<ReturnType<typeof buildMemoryInjection>> | null = null;
  let messages = rawMessages;
  if (useMemory) {
    mem = await buildMemoryInjection(query, tag, {
      topK: Number(req.body?.memoriesRetrieved || 8),
      rerank: !!req.body?.rerank,
      rewrite: !!req.body?.rewriteQuery,
    });
    messages = injectOpenAIMessages(rawMessages, mem.injection, mem.system);
  }

  let status = 200;
  let json: any = {};
  let answer = '';

  if (provider === 'openai' || provider === 'grok') {
    const url =
      provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const up = await runOpenAICompat({ url, key, model, messages, tools: agentic && useMemory });
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
    const tried = [...new Set([model, 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-flash-latest'])];
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

  if (useMemory && status < 400) rememberLater(tag, `${provider}-router`, query, answer);
  res.status(status).json({
    ...json,
    answer,
    rukmer: {
      injected: useMemory,
      provider,
      containerTag: tag,
      matches: mem?.retrieved.matches.length || 0,
    },
  });
}

export async function routeOpenAI(req: Request, res: Response) {
  req.body = { ...(req.body || {}), model: req.body?.model || 'gpt-4o-mini' };
  return completeChat(req, res);
}

export async function routeAnthropic(req: Request, res: Response) {
  req.body = {
    ...(req.body || {}),
    model: req.body?.model || 'claude-sonnet-4-5',
    messages: req.body?.messages,
  };
  return completeChat(req, res);
}

export async function routeGemini(req: Request, res: Response) {
  req.body = {
    ...(req.body || {}),
    model: String(req.params.model || req.body?.model || 'gemini-3.8-flash'),
    contents: req.body?.contents,
  };
  return completeChat(req, res);
}

export async function routeGrok(req: Request, res: Response) {
  req.body = { ...(req.body || {}), model: req.body?.model || 'grok-3-mini' };
  return completeChat(req, res);
}
