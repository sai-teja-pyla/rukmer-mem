import { getState, saveState, type TripleRec } from './core.js';
import { horizonFor, isUsefulFact } from './quality.js';

const SHORT_TTL_MS = 21 * 86400000;
const SESSION_TTL_MS = 12 * 3600000;

const BUCKETS: Record<string, string[]> = {
  preferences: ['prefers', 'dislikes'],
  work: ['works_at', 'role', 'job_title', 'founder_of', 'building', 'reports_to', 'member_of'],
  people: ['partner_of'],
  plans: ['plans', 'deadline', 'next_step', 'goal', 'decided', 'constraint'],
  identity: ['name', 'lives_in', 'email', 'phone', 'born_in', 'speaks', 'allergic_to', 'owns'],
};

export function bucketFor(predicate: string) {
  const p = predicate.toLowerCase();
  for (const [name, list] of Object.entries(BUCKETS)) if (list.includes(p)) return name;
  return 'other';
}

export function applyDecay(tag?: string) {
  const state = getState();
  const now = Date.now();
  let closed = 0;
  for (const t of state.triples) {
    if (tag && t.containerTag !== tag) continue;
    if (t.isLatest === false) continue;
    const session = t.scope === 'session' || t.containerTag.includes('--ses--');
    const horizon = t.horizon || horizonFor(t.predicate);
    if (!session && horizon !== 'short') continue;
    const age = now - new Date(t.validFrom || 0).getTime();
    if (age < (session ? SESSION_TTL_MS : SHORT_TTL_MS)) continue;
    t.isLatest = false;
    t.validTo = new Date().toISOString();
    closed += 1;
  }
  if (closed) saveState();
  return { closed };
}

function line(t: TripleRec) {
  return `${t.subject} ${t.predicate.replace(/_/g, ' ')} ${t.object}`;
}

export function buildProfile(tag: string) {
  applyDecay(tag);
  const latest = getState().triples.filter((t) => t.containerTag === tag && t.isLatest !== false && isUsefulFact(t));
  const longTerm = latest.filter((t) => (t.horizon || horizonFor(t.predicate)) === 'long');
  const recent = latest
    .filter((t) => (t.horizon || horizonFor(t.predicate)) === 'short')
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
    .slice(0, 12);
  const buckets: Record<string, TripleRec[]> = {};
  for (const t of longTerm) {
    const name = bucketFor(t.predicate);
    (buckets[name] ||= []).push(t);
  }
  const bucketText = Object.entries(buckets)
    .map(([name, rows]) => `[${name}]\n${rows.map(line).join('\n')}`)
    .join('\n');
  return {
    containerTag: tag,
    static: longTerm,
    dynamic: recent,
    staticText: longTerm.map(line).join('\n'),
    dynamicText: recent.map(line).join('\n'),
    buckets,
    bucketText,
  };
}
