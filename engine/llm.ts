import { sanitiseGraph } from './quality.js';

export function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
}

async function gemini(path: string, body: unknown, timeoutMs = 12000) {
  if (!geminiKey()) throw new Error('Missing GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/${path}?key=${geminiKey()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400)}`);
  }
  return res.json();
}

export function hasLlm() {
  return !!geminiKey();
}

const queryCache = new Map<string, number[]>();
const queryInflight = new Map<string, Promise<number[]>>();

export const EMBED_MODEL = 'gemini-embedding-001';

export function isNeuralEmbed(vec?: number[]) {
  return !!vec && vec.length > 256;
}

async function embedOne(text: string, task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', timeoutMs: number) {
  const data = await gemini(
    `models/${EMBED_MODEL}:embedContent`,
    {
      content: { parts: [{ text: text || ' ' }] },
      taskType: task,
      outputDimensionality: 768,
    },
    timeoutMs
  );
  const values = data.embedding?.values;
  return Array.isArray(values) ? (values as number[]) : [];
}

async function poolMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function embedMany(texts: string[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT') {
  const clean = texts.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 8000));
  if (!clean.length) return [];
  if (!geminiKey()) return clean.map((t) => (t ? localEmbed(t) : []));
  try {
    const rows = await poolMap(clean, 4, async (text) => {
      try {
        return await embedOne(text, task, 8000);
      } catch {
        return [] as number[];
      }
    });
    return clean.map((text, i) => (rows[i]?.length ? rows[i] : localEmbed(text)));
  } catch {
    return clean.map((t) => (t ? localEmbed(t) : []));
  }
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedMany([text], 'RETRIEVAL_DOCUMENT');
  return vec || [];
}

export function localQueryEmbed(text: string) {
  return localEmbed(text);
}

export async function embedQuery(text: string, timeoutMs = 1200): Promise<number[]> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!clean) return [];
  const hit = queryCache.get(clean);
  if (hit) return hit;
  const pending = queryInflight.get(clean);
  if (pending) return pending;
  const job = resolveQueryVector(clean, timeoutMs).finally(() => queryInflight.delete(clean));
  queryInflight.set(clean, job);
  const out = await job;
  if (out.length) {
    queryCache.set(clean, out);
    while (queryCache.size > 256) queryCache.delete(queryCache.keys().next().value || '');
  }
  return out;
}

async function resolveQueryVector(clean: string, timeoutMs: number): Promise<number[]> {
  if (!geminiKey()) return localEmbed(clean);
  try {
    const values = await embedOne(clean, 'RETRIEVAL_QUERY', timeoutMs);
    if (values.length) return values;
  } catch {
    /* keyword channel still answers */
  }
  return [];
}

function localEmbed(text: string): number[] {
  const dim = 256;
  const vec = new Array(dim).fill(0);
  const toks = text.toLowerCase().split(/\s+/);
  for (const t of toks) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    vec[h % dim] += 1;
    vec[(h * 7) % dim] += 0.5;
  }
  const n = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / n);
}

export async function generateText(prompt: string, system?: string, timeoutMs = 8000): Promise<string> {
  if (!geminiKey()) {
    return prompt.slice(0, 200);
  }
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  let last = '';
  for (const model of models) {
    try {
      const data = await gemini(
        `models/${model}:generateContent`,
        {
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
        },
        timeoutMs
      );
      const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
      if (text) return text;
    } catch (e: any) {
      last = e.message;
      if (!/404|not found/i.test(last)) break;
    }
  }
  throw new Error(last || 'Gemini generate failed');
}

export async function extractGraph(text: string) {
  const fallback = heuristicExtract(text);
  if (!geminiKey()) return sanitiseGraph(fallback);
  try {
    const raw = await generateText(
      `You are the memory layer for this person's AI chats. Extract important filtered facts only. Do not store the conversation.
Keep: preferences, identity, people, job, location, projects, decisions, plans, deadlines, constraints, requirements, tools they use, and next steps.
Drop: greetings, thanks, questions, filler, and model speculation.
Return JSON only:
{"entities":[{"name":"","type":"person|org|place|topic|decision"}],"triples":[{"subject":"","predicate":"","object":"","validFrom":"","kind":"assert"}]}
Rules:
- Max 12 triples.
- Subject is "User" for the account owner (I/me/my).
- predicate is snake_case: prefers, dislikes, works_at, lives_in, building, uses, goal, name, decided, plans, deadline, constraint, next_step, member_of, founder_of.
- Other specific snake_case predicates are allowed. Never use related_to.
- object is the fact itself, a short phrase, not a sentence of chatter.
- If nothing important was stated or agreed, return {"entities":[],"triples":[]}.
TEXT:\n${text.slice(0, 6000)}`,
      'JSON only. Store durable memory, not the chat transcript.'
    );
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const llm = sanitiseGraph({
      entities: Array.isArray(json.entities) ? json.entities : [],
      triples: Array.isArray(json.triples) ? json.triples : [],
    });
    const base = sanitiseGraph(fallback);
    const seen = new Set(llm.triples.map((t) => `${t.subject}|${t.predicate}|${t.object}`.toLowerCase()));
    return sanitiseGraph({
      entities: [...llm.entities, ...base.entities],
      triples: [...llm.triples, ...base.triples.filter((t) => !seen.has(`${t.subject}|${t.predicate}|${t.object}`.toLowerCase()))],
    });
  } catch {
    return sanitiseGraph(fallback);
  }
}

export function heuristicExtract(text: string) {
  const triples: { subject: string; predicate: string; object: string }[] = [];
  const take = (re: RegExp, predicate: string) => {
    const m = text.match(re);
    if (m?.[1]) triples.push({ subject: 'User', predicate, object: m[1].trim().slice(0, 140) });
  };
  take(/\b(?:I|we)\s+(?:prefer|like|love)\s+([^.,;\n]{2,80})/i, 'prefers');
  take(/\b(?:I|we)\s+(?:work(?:s)? at|joined|founded)\s+([^.,;\n]{2,80})/i, 'works_at');
  take(/\b(?:I|we)\s+(?:live|based)\s+(?:in\s+)?([^.,;\n]{2,60})/i, 'lives_in');
  take(/\bmy name is\s+([^.,;\n]{2,60})/i, 'name');
  take(/\b(?:I|we)\s+(?:decided|agreed)\s+(?:to|that|on)?\s*([^.,;\n]{4,120})/i, 'decided');
  take(/\b(?:the plan is|we plan to|I plan to)\s+([^.,;\n]{4,120})/i, 'plans');
  take(/\b(?:deadline|due|launch(?:es|ing)?(?: date)?)\s*(?:is|:)?\s*([^.,;\n]{2,80})/i, 'deadline');
  take(/\b(?:must|need to|have to|constraint is)\s+([^.,;\n]{4,120})/i, 'constraint');
  take(/\b(?:next step is|action item:?)\s+([^.,;\n]{4,120})/i, 'next_step');
  take(/\b(?:I|we)\s+(?:am|are|'m)\s+building\s+([^.,;\n]{2,80})/i, 'building');
  const names = [...new Set(triples.flatMap((t) => [t.subject, t.object]))];
  return { entities: names.map((name) => ({ name, type: 'topic' })), triples };
}

export async function llmRerank(query: string, passages: { id: string; text: string }[]) {
  if (!geminiKey() || passages.length < 2) return passages.map((p, i) => ({ id: p.id, score: 1 - i * 0.05 }));
  try {
    const raw = await generateText(
      `Score each passage 0-1 for answering: "${query}"\nReturn JSON array [{"id":"...","score":0.0}]\n\n${passages
        .map((p) => `ID ${p.id}: ${p.text.slice(0, 400)}`)
        .join('\n\n')}`,
      'JSON only.'
    );
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* hybrid scores remain */
  }
  return passages.map((p, i) => ({ id: p.id, score: 1 - i * 0.05 }));
}
