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

const BLOCKED_PREDICATES = new Set(['related_to', 'mentions', 'associated_with', 'linked_to', 'about', 'has']);

export function canonSubject(name: string) {
  const n = String(name || '').trim();
  if (/^(i|me|myself|user|the user)$/i.test(n)) return 'User';
  return n;
}

export function isJunkName(name: string) {
  const n = String(name || '').trim();
  if (/^(user|the user)$/i.test(n)) return false;
  if (n.length < 2 || n.length > 140) return true;
  const words = n.toLowerCase().split(/\s+/);
  if (words.every((w) => STOP.has(w))) return true;
  if (STOP.has(n.toLowerCase())) return true;
  if (/^(assistant|system|model|json|text|chunk|document)$/i.test(n)) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

export function normalizePredicate(raw: string) {
  const p = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '')
    .replace(/\s+/g, '_');
  if (!p || BLOCKED_PREDICATES.has(p)) return '';
  if (ALLOWED_PREDICATES.has(p)) return p;
  if (/prefer|like|favorite|favourite|love/.test(p)) return 'prefers';
  if (/dislik|hate/.test(p)) return 'dislikes';
  if (/work|employ|job|company/.test(p)) return 'works_at';
  if (/live|located|based|city/.test(p)) return 'lives_in';
  if (/build|found/.test(p)) return 'building';
  if (/^use|using|tool/.test(p)) return 'uses';
  if (/decid|chose|choice|agreed/.test(p)) return 'decided';
  if (/plan|intend|will_/.test(p)) return 'plans';
  if (p === 'deadline' || p === 'due_date' || p === 'launch_date' || p.endsWith('_deadline')) return 'deadline';
  if (p === 'constraint' || p === 'requirement' || p === 'must' || p.endsWith('_constraint')) return 'constraint';
  if (p === 'next_step' || p === 'todo' || p === 'action_item') return 'next_step';
  if (p === 'goal' || p === 'aim' || p === 'target') return 'goal';
  if (p === 'name' || p.endsWith('_name')) return 'name';
  if (/^[a-z][a-z0-9_]{2,40}$/.test(p)) return p;
  return '';
}

const LONG_TERM = new Set([
  'name',
  'works_at',
  'lives_in',
  'prefers',
  'dislikes',
  'founder_of',
  'email',
  'phone',
  'allergic_to',
  'speaks',
  'born_in',
  'member_of',
  'role',
  'job_title',
  'owns',
  'building',
  'partner_of',
  'reports_to',
]);

export function horizonFor(predicate: string): 'long' | 'short' {
  return LONG_TERM.has(normalizePredicate(predicate) || predicate) ? 'long' : 'short';
}

export function isUsefulFact(t: { subject?: string; predicate?: string; object?: string }) {
  const subject = canonSubject(String(t.subject || ''));
  const object = String(t.object || '').trim();
  const predicate = normalizePredicate(String(t.predicate || ''));
  if (!predicate) return false;
  if (isJunkName(subject) || isJunkName(object)) return false;
  if (subject.toLowerCase() === object.toLowerCase()) return false;
  return true;
}

export function isChatter(text: string) {
  const t = text.trim();
  if (t.length < 8) return true;
  if (/^\s*(thanks|thank you|ok|okay|cool|got it|sounds good|lol|haha|nice|hi|hello|hey|good morning|good night)\b/i.test(t) && t.length < 90) {
    return true;
  }
  if (/^\s*(what|who|where|when|how|why|do you|can you|could you|tell me|show me)\b/i.test(t)) {
    return !/\b(remember|don't forget|do not forget)\b/i.test(t);
  }
  return false;
}

export function looksLikeDurableFact(text: string) {
  const t = text.trim();
  if (isChatter(t) || t.length < 12) return false;
  if (/\b(remember that|save this|note that|don't forget|do not forget|important|decision|we decided|i decided|the plan|deadline|launch|prefer|i work|my name|i am|i'm|i live|based in|we need|next step|constraint|requirement|must store|must not)\b/i.test(t)) {
    return true;
  }
  if (t.includes('?') && t.replace(/[^?]/g, '').length === 1 && t.length < 48) return false;
  return t.length >= 28 && /\b(is|are|was|were|will|should|must|decided|owns|uses|needs|plans|building|works|stores|wants)\b/i.test(t);
}

export function sanitiseGraph(raw: { entities?: any[]; triples?: any[] }) {
  const triples = (raw.triples || [])
    .map((t) => ({
      ...t,
      subject: canonSubject(String(t.subject || '')),
      predicate: normalizePredicate(t.predicate),
      object: String(t.object || '').trim(),
    }))
    .filter(isUsefulFact)
    .slice(0, 16);
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
