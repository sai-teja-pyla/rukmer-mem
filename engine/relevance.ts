const STOP = new Set([
  'what', 'does', 'do', 'did', 'is', 'it', 'for', 'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on',
  'my', 'me', 'i', 'you', 'your', 'about', 'say', 'says', 'said', 'that', 'this', 'with', 'from', 'at',
  'be', 'are', 'was', 'were', 'have', 'has', 'how', 'who', 'why', 'when', 'where', 'can', 'could',
  'like', 'liked', 'likes', 'just', 'into', 'than', 'then', 'them', 'they', 'their', 'there', 'here',
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

function stemToken(token: string) {
  if (!token || token.length < 3 || STOP.has(token)) return '';
  const stemmed = token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  if (stemmed.length < 3 || STOP.has(stemmed)) return '';
  return stemmed;
}

export function isProfileQuestion(query: string) {
  return /\b(about me|who am i|my profile|what do you know)\b/i.test(query);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * One 0–1 relevance score for chat injection and Search.
 * Word overlap is a fraction of the query's content words (whole words only).
 * The embedding is included on that same scale. Callers drop anything below strictness.
 */
export function relevanceScore(query: string, item: MemoryHit) {
  const tokens = contentTokens(query);
  const hay = new Set(
    contentTokens(
      `${item.title || ''} ${item.text || ''} ${item.subject || ''} ${String(item.predicate || '').replace(/_/g, ' ')} ${item.object || ''}`
    )
  );
  const vector = clamp01(Number(item.vectorScore) || 0);
  if (!tokens.length) return vector;
  const matched = tokens.filter((token) => hay.has(token)).length;
  const lexical = matched / tokens.length;
  return clamp01(Math.max(lexical, vector));
}

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spoKey(item: MemoryHit) {
  const subject = normalizeText(item.subject || '');
  const predicate = normalizeText(String(item.predicate || '').replace(/_/g, ' ')).replace(/ /g, '_');
  const object = normalizeText(item.object || '');
  if (!subject || !predicate || !object) return '';
  return `${subject}|${predicate}|${object}`;
}

/** Keep memories at or above strictness, drop near-duplicates, then cap the list. */
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
    let relevance = relevanceScore(query, item);
    if (aboutUser && item.source === 'profile' && strictness > 0) relevance = Math.max(relevance, strictness);
    return { item, relevance, index };
  });
  const kept = scored.filter(({ relevance }) => strictness <= 0 || relevance >= strictness);
  kept.sort((a, b) => b.relevance - a.relevance || a.index - b.index);

  const seenId = new Set<string>();
  const seenText = new Set<string>();
  const seenSpo = new Set<string>();
  const out: T[] = [];
  for (const { item, relevance } of kept) {
    const id = String(item.id || '');
    if (id && seenId.has(id)) continue;
    const text = normalizeText(item.text);
    if (text && seenText.has(text)) continue;
    const spo = spoKey(item);
    if (spo && seenSpo.has(spo)) continue;
    if (id) seenId.add(id);
    if (text) seenText.add(text);
    if (spo) seenSpo.add(spo);
    out.push({ ...item, score: Number(relevance.toFixed(4)) });
    if (out.length >= topK) break;
  }
  return out;
}
