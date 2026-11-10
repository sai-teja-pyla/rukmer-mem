const STOP = new Set([
  'what', 'does', 'do', 'did', 'is', 'it', 'for', 'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on',
  'my', 'me', 'i', 'you', 'your', 'about', 'say', 'says', 'said', 'that', 'this', 'with', 'from', 'at',
  'be', 'are', 'was', 'were', 'have', 'has', 'how', 'who', 'why', 'when', 'where', 'can', 'could',
]);

export type MemoryHit = {
  id: string;
  text: string;
  title?: string;
  score?: number;
  vectorScore?: number;
  docId?: string;
  source?: string;
};

export function contentTokens(text: string) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .map((token) => token.replace(/^\.+|\.+$/g, ''))
      .filter((token) => token.length >= 3 && !STOP.has(token))
  )];
}

function lexicalHit(queryTokens: string[], blob: string) {
  const hay = blob.toLowerCase();
  const hits = queryTokens.filter((token) => hay.includes(token));
  return {
    hits,
    ratio: queryTokens.length ? hits.length / queryTokens.length : 0,
  };
}

/** Keep memories that share real words with the question, then drop duplicates and cap the list. */
export function selectMemories<T extends MemoryHit>(query: string, items: T[], opts: { strictness?: number; topK?: number } = {}) {
  const strictness = Math.min(1, Math.max(0, opts.strictness ?? 0.4));
  const topK = Math.max(0, Math.floor(opts.topK ?? 8));
  const tokens = contentTokens(query);
  const profileQuestion = /\b(about me|who am i|my profile|what do you know)\b/i.test(query);
  const vectorFloor = Math.min(0.92, 0.78 + strictness * 0.12);
  const kept = items.filter((item) => {
    if (strictness <= 0) return true;
    if (profileQuestion && item.source === 'profile') return true;
    const { hits, ratio } = lexicalHit(tokens, `${item.title || ''}\n${item.text || ''}`);
    const lexical = hits.some((token) => token.length >= 4) || ratio >= Math.max(0.5, strictness);
    const vector = Number(item.vectorScore || 0);
    return lexical || vector >= vectorFloor;
  });
  const seen = new Set<string>();
  const out: T[] = [];
  const ranked = [...kept].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  for (const item of ranked) {
    const key = String(item.text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 180);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= topK) break;
  }
  return out;
}
