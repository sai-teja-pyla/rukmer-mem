import { sanitiseGraph } from './quality.js';

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
}

async function gemini(path: string, body: unknown) {
  const GEMINI_KEY = geminiKey();
  if (!geminiKey()) throw new Error('Missing GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/${path}?key=${geminiKey()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400)}`);
  }
  return res.json();
}

export function hasLlm() {
  return !!geminiKey();
}

export async function embedText(text: string): Promise<number[]> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
  if (!clean) return [];
  if (!geminiKey()) return localEmbed(clean);
  try {
    const data = await gemini('models/text-embedding-004:embedContent', {
      model: 'models/text-embedding-004',
      content: { parts: [{ text: clean }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    return data.embedding?.values || [];
  } catch {
    return localEmbed(clean);
  }
}

export async function embedQuery(text: string): Promise<number[]> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
  if (!geminiKey()) return localEmbed(clean);
  try {
    const data = await gemini('models/text-embedding-004:embedContent', {
      model: 'models/text-embedding-004',
      content: { parts: [{ text: clean }] },
      taskType: 'RETRIEVAL_QUERY',
    });
    return data.embedding?.values || [];
  } catch {
    return localEmbed(clean);
  }
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

export async function generateText(prompt: string, system?: string): Promise<string> {
  if (!geminiKey()) {
    return prompt.slice(0, 200);
  }
  const models = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  let last = '';
  for (const model of models) {
    try {
      const data = await gemini(`models/${model}:generateContent`, {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      });
      const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
      if (text) return text;
    } catch (e: any) {
      last = e.message;
    }
  }
  throw new Error(last || 'Gemini generate failed');
}

export async function extractGraph(text: string) {
  const fallback = heuristicExtract(text);
  if (!geminiKey()) return sanitiseGraph(fallback);
  try {
    const raw = await generateText(
      `Extract ONLY durable, user-relevant facts. Skip filler, pronouns, and chaining random nouns.
Return JSON only:
{"entities":[{"name":"","type":"person|org|place|topic"}],"triples":[{"subject":"","predicate":"prefers|works_at|lives_in|building|uses|member_of|founder_of|allergic_to|goal|name","object":"","validFrom":"","kind":"update|extend|assert"}]}
Rules:
- Max 8 triples.
- Predicates must be from that list (snake_case).
- No related_to.
- Do not extract The, This, Container, Memory, User, Assistant.
- Prefer stable profile facts (preferences, job, location, projects).
TEXT:\n${text.slice(0, 5000)}`,
      'JSON only. If nothing durable, return {"entities":[],"triples":[]}.'
    );
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return sanitiseGraph({
      entities: Array.isArray(json.entities) ? json.entities : fallback.entities,
      triples: Array.isArray(json.triples) ? json.triples : fallback.triples,
    });
  } catch {
    return sanitiseGraph(fallback);
  }
}

function heuristicExtract(text: string) {
  const triples: { subject: string; predicate: string; object: string }[] = [];
  const prefer = text.match(/\b(?:I|we)\s+(?:prefer|like|love)\s+([^.,;\n]{2,80})/i);
  if (prefer) triples.push({ subject: 'User', predicate: 'prefers', object: prefer[1].trim() });
  const work = text.match(/\b(?:I|we)\s+(?:work(?:s)? at|joined|founded)\s+([^.,;\n]{2,60})/i);
  if (work) triples.push({ subject: 'User', predicate: 'works_at', object: work[1].trim() });
  const live = text.match(/\b(?:I|we)\s+(?:live|based)\s+(?:in\s+)?([^.,;\n]{2,40})/i);
  if (live) triples.push({ subject: 'User', predicate: 'lives_in', object: live[1].trim() });
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
