import { buildProfile } from './memory.js';
import type { SearchOpts } from './pipeline.js';

export type ChatMessage = { role: string; content?: string; text?: string; parts?: { text?: string }[] };

function textOf(m: ChatMessage) {
  if (typeof m.content === 'string') return m.content;
  if (m.text) return m.text;
  if (Array.isArray(m.content)) {
    return (m.content as any[]).map((p) => p?.text || p?.content || '').join(' ');
  }
  return (m.parts || []).map((p) => p.text || '').join(' ');
}

export function lastUserQuery(messages: ChatMessage[]) {
  const user = [...messages].reverse().find((m) => m.role === 'user' || m.role === 'human');
  return user ? textOf(user).trim() : '';
}

export async function buildMemoryInjection(query: string, containerTag: string, opts: SearchOpts = {}) {
  const { searchMemory } = await import('./pipeline.js');
  const tag = containerTag;
  if (!tag) throw new Error('containerTag required');
  const retrieved = await searchMemory(query || 'profile preferences work history', {
    ...opts,
    containerTag: tag,
    topK: opts.topK ?? 6,
    includeRelated: true,
  });
  const profile = buildProfile(tag);
  const chunks = retrieved.matches.slice(0, 5).map((m, i) => `[${i + 1}] (${m.title}) ${m.text.slice(0, 420)}`).join('\n');
  const injection = `Memory for this user. Use only what is listed. Do not invent profile details. Do not repeat the whole chat.

LONG-TERM PROFILE:
${profile.bucketText || profile.staticText || '(none)'}

RECENT CONTEXT (short-term, may expire):
${profile.dynamicText || '(none)'}

PASSAGES FOR THIS QUESTION:
${chunks || '(none)'}`;

  const system =
    'You have Rukmer Memory injected into this prompt. Treat injected facts as the user\'s long-term memory across Gemini, GPT, Claude, and this app.';

  return { system, injection, retrieved, current: profile.static, historical: profile.dynamic, containerTag: tag };
}

export function injectOpenAIMessages(messages: ChatMessage[], injection: string, systemLead: string) {
  const block = `${systemLead}\n\n${injection}`;
  const rest = messages.filter((m) => m.role !== 'system');
  const existing = messages.filter((m) => m.role === 'system').map(textOf).join('\n');
  return [{ role: 'system', content: existing ? `${existing}\n\n${block}` : block }, ...rest];
}

export function injectAnthropic(body: any, injection: string, systemLead: string) {
  const extra = `${systemLead}\n\n${injection}`;
  const system = body.system
    ? typeof body.system === 'string'
      ? `${body.system}\n\n${extra}`
      : [...(Array.isArray(body.system) ? body.system : []), { type: 'text', text: extra }]
    : extra;
  return { ...body, system };
}

export function injectGemini(body: any, injection: string, systemLead: string) {
  const extra = `${systemLead}\n\n${injection}`;
  const systemInstruction = {
    parts: [{ text: extra }, ...((body.systemInstruction?.parts as any[]) || [])],
  };
  return { ...body, systemInstruction };
}
