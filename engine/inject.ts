import { usefulFacts } from './quality.js';
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
  const tag = containerTag || 'rukmer-workspace';
  const retrieved = await searchMemory(query || 'profile preferences work history', {
    ...opts,
    containerTag: tag,
    topK: opts.topK ?? 8,
    includeRelated: true,
  });
  const { current, historical } = usefulFacts(tag, query, 8, 4);
  const chunks = retrieved.matches.slice(0, 5).map((m, i) => `[${i + 1}] (${m.title}) ${m.text.slice(0, 420)}`).join('\n');
  const injection = `High-signal memory for "${tag}". Ignore anything not listed here.

CURRENT FACTS:
${current.map((t) => `- ${t.subject} ${t.predicate} ${t.object}${t.derived ? ' [derived]' : ''}`).join('\n') || '(none)'}

OLDER FACTS (only if the user asks about the past):
${historical.map((t) => `- ${t.subject} ${t.predicate} ${t.object} (${t.validFrom.slice(0, 10)}–${t.validTo?.slice(0, 10) || '?'})`).join('\n') || '(none)'}

RETRIEVED PASSAGES:
${chunks || '(none)'}

Use these facts when relevant. Do not invent profile details.`;

  const system =
    'You have Rukmer Memory injected into this prompt. Treat injected facts as the user\'s long-term memory across Gemini, GPT, Claude, and this app.';

  return { system, injection, retrieved, current, historical, containerTag: tag };
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
