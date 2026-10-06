import { getState, saveState, type TripleRec } from './core.js';

const STOP = new Set(
  `the a an and or of to for in on at as is was are were be been being this that these those it its it's i me my we our you your he she they them his her their here there then than so if but not no yes from with without into over under about into off up down out by via per vs welcome untitled conversation assistant user model text json document chunk memory graph container tag preferred pref related note notes untitled hello hi thanks thank okay ok yes no sure please just also really very more most some any all each every`.split(
    /\s+/
  )
);

const ALLOWED_PREDICATES = new Set([
  'prefers',
  'prefer',
  'likes',
  'dislikes',
  'works_at',
  'works_for',
  'employed_at',
  'employed_as',
  'job_title',
  'role',
  'founder_of',
  'owns',
  'building',
  'working_on',
  'lives_in',
  'located_in',
  'based_in',
  'from',
  'born_in',
  'member_of',
  'reports_to',
  'partner_of',
  'uses',
  'speaks',
  'email',
  'phone',
  'allergic_to',
  'goal',
  'name',
]);

export function isJunkName(name: string) {
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 60) return true;
  const words = n.toLowerCase().split(/\s+/);
  if (words.every((w) => STOP.has(w))) return true;
  if (STOP.has(n.toLowerCase())) return true;
  if (/^(user|assistant|system|model|json|text|chunk|document)$/i.test(n)) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

export function normalizePredicate(raw: string) {
  const p = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (ALLOWED_PREDICATES.has(p)) return p;
  if (/prefer|like|favorite|favourite/.test(p)) return 'prefers';
  if (/work|employ|job|company/.test(p)) return 'works_at';
  if (/live|located|based|city|from/.test(p)) return 'lives_in';
  if (/build|found/.test(p)) return 'building';
  if (/use|using/.test(p)) return 'uses';
  return '';
}

export function isUsefulFact(t: { subject?: string; predicate?: string; object?: string }) {
  const subject = String(t.subject || '').trim();
  const object = String(t.object || '').trim();
  const predicate = normalizePredicate(String(t.predicate || ''));
  if (!predicate) return false;
  if (isJunkName(subject) || isJunkName(object)) return false;
  if (subject.toLowerCase() === object.toLowerCase()) return false;
  return true;
}

export function looksLikeDurableFact(text: string) {
  const t = text.trim();
  if (t.length < 12) return false;
  if (/^\s*(what|who|where|when|how|why|do you|can you|tell me)\b/i.test(t)) return false;
  const lower = t.toLowerCase();
  if (/^\s*(please remember|remember that|save this|note that)\b/i.test(lower)) return true;
  if (/^\s*(thanks|thank you|ok|okay|cool|got it|sounds good|lol|haha|nice)\b/i.test(lower) && t.length < 80) {
    return false;
  }
  return /\b(i|i'm|i am|my|we|our)\b/.test(lower) &&
    /\b(prefer|like|dislike|work at|works at|live in|name is|building|founder|allergic|email|born|based in|i use|i'm a|i am a|sister|brother|spouse|wife|husband)\b/.test(lower);
}

export function sanitiseGraph(raw: { entities?: any[]; triples?: any[] }) {
  const triples = (raw.triples || [])
    .map((t) => ({
      ...t,
      subject: String(t.subject || '').trim(),
      predicate: normalizePredicate(t.predicate) || t.predicate,
      object: String(t.object || '').trim(),
    }))
    .filter(isUsefulFact)
    .slice(0, 10);
  const names = new Set<string>();
  for (const t of triples) {
    names.add(t.subject);
    names.add(t.object);
  }
  const entities = (raw.entities || [])
    .filter((e) => !isJunkName(e?.name) && names.has(String(e.name).trim()))
    .slice(0, 16);
  for (const n of names) {
    if (!entities.some((e) => String(e.name).toLowerCase() === n.toLowerCase())) {
      entities.push({ name: n, type: 'topic' });
    }
  }
  return { entities, triples };
}

export function pruneJunkMemory() {
  const state = getState();
  const beforeT = state.triples.length;
  const beforeE = state.entities.length;
  state.triples = state.triples.filter(isUsefulFact);
  const keep = new Set(
    state.triples.flatMap((t) => [t.subject.toLowerCase(), t.object.toLowerCase()])
  );
  state.entities = state.entities.filter((e) => !isJunkName(e.name) && keep.has(e.name.toLowerCase()));
  if (state.triples.length !== beforeT || state.entities.length !== beforeE) saveState();
  return { triplesRemoved: beforeT - state.triples.length, entitiesRemoved: beforeE - state.entities.length };
}

export function usefulFacts(tag: string, query?: string, currentLimit = 8, historyLimit = 4) {
  const triples = getState().triples.filter((t) => t.containerTag === tag && isUsefulFact(t));
  const q = (query || '').toLowerCase();
  const toks = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const score = (t: TripleRec) => {
    const hay = `${t.subject} ${t.predicate} ${t.object} ${t.evidence}`.toLowerCase();
    const hit = toks.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    return hit * 4 + (t.isLatest !== false ? 2 : 0) + (t.derived ? -1 : 0);
  };
  const current = triples.filter((t) => t.isLatest !== false).sort((a, b) => score(b) - score(a)).slice(0, currentLimit);
  const historical = triples.filter((t) => t.isLatest === false).sort((a, b) => score(b) - score(a)).slice(0, historyLimit);
  return { current, historical };
}
