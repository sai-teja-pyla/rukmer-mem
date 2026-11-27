const STOP = new Set([
  'what', 'does', 'do', 'did', 'is', 'it', 'for', 'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on',
  'my', 'me', 'i', 'you', 'your', 'about', 'say', 'says', 'said', 'that', 'this', 'with', 'from', 'at',
  'be', 'are', 'was', 'were', 'have', 'has', 'how', 'who', 'why', 'when', 'where', 'can', 'could',
  'like', 'liked', 'likes', 'know', 'knows', 'known', 'tell', 'tells', 'told',
  'just', 'into', 'than', 'then', 'them', 'they', 'their', 'there', 'here',
]);

export type MemoryHit = {
  id: string;
  text: string;
  title?: string;
  score?: number;
  vectorScore?: number;
  docId?: string;
  source?: string;
  subject?: string;
  predicate?: string;
  object?: string;
};

/** Whole-word tokens. "like" is a stop word, so it cannot match "likes" or "likely". */
export function contentTokens(text: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9.]+/)) {
    const token = stemToken(raw.replace(/^\.+|\.+$/g, ''));
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

const PREFER = new Set(['favourite', 'favorite', 'prefer', 'preferred']);

function stemToken(token: string) {
  if (!token || token.length < 3 || STOP.has(token)) return '';
  const stemmed = token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  if (stemmed.length < 3 || STOP.has(stemmed)) return '';
  if (PREFER.has(token) || PREFER.has(stemmed)) return 'prefer';
  return stemmed;
}

export function isProfileQuestion(query: string) {
  return /\b(about me|who am i|my profile|what do you know)\b/i.test(query);
}

/**
 * False for small talk and general-knowledge questions that do not refer to the
 * user or a specific thing already worth looking up. A question is not skipped
 * only because it starts with "what".
 */
export function needsMemory(query: string) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (isProfileQuestion(q)) return true;
  if (/^(thanks|thank you|hello|hi|hey|ok|okay|cool|good morning|good night)\b/i.test(q) && q.length < 90) return false;
  if (/\b(my|mine|remember|don't forget|do not forget|favou?rite|favorite)\b/i.test(q)) return true;
  if (/\b(i|me)\b/i.test(q) && /\b(like|prefer|love|live|work|know|remember|plan|planning|city|coffee|name|drink)\b/i.test(q)) return true;
  if (/\bcapital of\b/i.test(q)) return false;
  if (/\b(how do i|how to|how can i)\b/i.test(q) && /\b(bake|cook|sourdough|bread)\b/i.test(q)) return false;
  return true;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export const LEXICAL_GATE = 0.34;
export const VECTOR_GATE = 0.82;
export const WEAK_BEST = 0.55;
export const SCORE_GAP = 0.12;
export const SCORE_RATIO = 0.85;

export type ScoreParts = { lexical: number; vector: number; combined: number; gated: boolean };

/** Word overlap plus embedding. A mid-range cosine with no shared content words does not pass. */
export function relevanceParts(query: string, item: MemoryHit): ScoreParts {
  const tokens = contentTokens(query);
  const hay = new Set(
    contentTokens(
      `${item.title || ''} ${item.text || ''} ${item.subject || ''} ${String(item.predicate || '').replace(/_/g, ' ')} ${item.object || ''}`
    )
  );
  const vector = clamp01(Number(item.vectorScore) || 0);
  const lexical = tokens.length ? tokens.filter((token) => hay.has(token)).length / tokens.length : 0;
  const combined = clamp01(0.55 * lexical + 0.45 * (lexical >= LEXICAL_GATE ? Math.max(vector, lexical) : vector));
  const gated = lexical >= LEXICAL_GATE || vector >= VECTOR_GATE;
  return { lexical, vector, combined: Number(combined.toFixed(4)), gated };
}

/**
 * Final 0–1 score. Callers also require the lexical-or-vector gate.
 * Overlap is not thrown away when the embedding is weak; a cosine with no overlap stays low.
 */
export function relevanceScore(query: string, item: MemoryHit) {
  const parts = relevanceParts(query, item);
  if (!parts.gated) return 0;
  return parts.combined;
}

export function memoryTextKey(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function memoryFactKey(item: { subject?: string; predicate?: string; object?: string }) {
  const subject = memoryTextKey(item.subject || '');
  const predicate = memoryTextKey(String(item.predicate || '').replace(/_/g, ' ')).replace(/ /g, '_');
  const object = memoryTextKey(item.object || '');
  if (!subject || !predicate || !object) return '';
  return `${subject}|${predicate}|${object}`;
}

/** Keep gated memories at or above strictness, drop near-duplicates, then stop at a score gap. topK is a maximum. */
export function selectMemories<T extends MemoryHit>(
  query: string,
  items: T[],
  opts: { strictness?: number; topK?: number; aboutUser?: boolean } = {}
) {
  const strictness = Math.min(1, Math.max(0, opts.strictness ?? 0.4));
  const topK = Math.max(0, Math.floor(opts.topK ?? 8));
  const aboutUser = opts.aboutUser ?? isProfileQuestion(query);
  if (!topK) return [] as T[];

  const scored = items.map((item, index) => {
    const parts = relevanceParts(query, item);
    let relevance = parts.gated ? parts.combined : 0;
    let keep = parts.gated && (strictness <= 0 || relevance >= strictness);
    if (aboutUser && item.source === 'profile') {
      relevance = Math.max(relevance, Math.max(strictness, WEAK_BEST));
      keep = true;
    }
    return { item, relevance, lexical: parts.lexical, index, keep };
  });
  const kept = scored.filter((row) => row.keep);
  kept.sort((a, b) => b.relevance - a.relevance || a.index - b.index);

  const seenId = new Set<string>();
  const seenText = new Set<string>();
  const seenSpo = new Set<string>();
  const deduped: typeof kept = [];
  for (const row of kept) {
    const id = String(row.item.id || '');
    if (id && seenId.has(id)) continue;
    const text = memoryTextKey(row.item.text);
    if (text && seenText.has(text)) continue;
    const spo = memoryFactKey(row.item);
    if (spo && seenSpo.has(spo)) continue;
    if (id) seenId.add(id);
    if (text) seenText.add(text);
    if (spo) seenSpo.add(spo);
    deduped.push(row);
  }
  if (!deduped.length) return [] as T[];
  const best = deduped[0].relevance;
  const lexicalKeeper = deduped[0].lexical >= LEXICAL_GATE && best >= strictness;
  if (best < WEAK_BEST && !lexicalKeeper && !(aboutUser && deduped[0].item.source === 'profile')) return [] as T[];

  const out: T[] = [];
  for (const row of deduped) {
    const close = best - row.relevance <= SCORE_GAP + 1e-9 && row.relevance + 1e-9 >= best * SCORE_RATIO;
    const profileKeep = aboutUser && row.item.source === 'profile';
    if (!close && !profileKeep) break;
    out.push({ ...row.item, score: Number(row.relevance.toFixed(4)), vectorScore: row.item.vectorScore });
    if (out.length >= topK) break;
  }
  return out;
}
