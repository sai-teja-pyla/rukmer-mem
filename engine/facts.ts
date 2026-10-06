import { getState, saveState, uid, type TripleRec } from './core.js';
import { isUsefulFact, normalizePredicate } from './quality.js';

export type IncomingFact = {
  subject?: string;
  predicate?: string;
  object?: string;
  validFrom?: string;
  kind?: TripleRec['kind'];
};

function keyOf(tag: string, subject: string, predicate: string) {
  return `${tag}::${subject.trim().toLowerCase()}::${predicate.trim().toLowerCase()}`;
}

export function upsertFacts(tag: string, facts: IncomingFact[], evidence: string) {
  const state = getState();
  const now = new Date().toISOString();
  let updates = 0;
  let extendsCount = 0;
  let asserts = 0;

  for (const raw of facts) {
    const subject = String(raw.subject || '').trim();
    const object = String(raw.object || '').trim();
    const predicate = normalizePredicate(String(raw.predicate || '')) || String(raw.predicate || '').trim();
    if (!subject || !object) continue;
    if (!isUsefulFact({ subject, predicate, object })) continue;
    const latest = state.triples.find(
      (t) => t.isLatest !== false && keyOf(t.containerTag, t.subject, t.predicate) === keyOf(tag, subject, predicate)
    );
    const sameObject = latest && latest.object.trim().toLowerCase() === object.toLowerCase();

    if (latest && sameObject) {
      latest.evidence = `${latest.evidence} | ${evidence}`.slice(0, 900);
      latest.kind = 'extend';
      extendsCount += 1;
      continue;
    }

    if (latest && !sameObject) {
      latest.isLatest = false;
      latest.validTo = now;
      updates += 1;
    } else {
      asserts += 1;
    }

    const rec: TripleRec = {
      id: uid('trp'),
      containerTag: tag,
      subject,
      predicate,
      object,
      evidence: evidence.slice(0, 400),
      isLatest: true,
      derived: raw.kind === 'derive',
      validFrom: raw.validFrom || now,
      validTo: null,
      kind: raw.kind || (latest ? 'update' : 'assert'),
    };
    state.triples.push(rec);
  }

  saveState();
  return { updates, extends: extendsCount, asserts };
}

export function deriveFacts(tag: string) {
  const state = getState();
  const latest = state.triples.filter((t) => t.containerTag === tag && t.isLatest !== false);
  const incoming: IncomingFact[] = [];

  for (const job of latest.filter((t) => /works_at|employed_at|job|works for/i.test(t.predicate))) {
    const orgLoc = latest.find(
      (t) => t.subject.toLowerCase() === job.object.toLowerCase() && /located|based|in/i.test(t.predicate)
    );
    if (orgLoc) {
      incoming.push({
        subject: job.subject,
        predicate: 'located_in',
        object: orgLoc.object,
        kind: 'derive',
      });
    }
  }

  const unique = incoming
    .filter((f) => f.kind === 'derive' && f.predicate === 'located_in')
    .filter((f, i, arr) => {
      const k = `${f.subject}|${f.predicate}|${f.object}`.toLowerCase();
      return arr.findIndex((x) => `${x.subject}|${x.predicate}|${x.object}`.toLowerCase() === k) === i;
    })
    .slice(0, 8);

  return upsertFacts(tag, unique, 'derived from linked facts across notes');
}

export function formatFacts(tag: string, query?: string) {
  const triples = getState().triples.filter((t) => t.containerTag === tag);
  const q = (query || '').toLowerCase();
  const score = (t: TripleRec) => {
    const hay = `${t.subject} ${t.predicate} ${t.object} ${t.evidence}`.toLowerCase();
    if (!q) return t.isLatest ? 2 : 1;
    return (hay.includes(q) ? 5 : 0) + (t.isLatest ? 2 : 0);
  };
  const current = triples.filter((t) => t.isLatest !== false).sort((a, b) => score(b) - score(a)).slice(0, 24);
  const historical = triples.filter((t) => t.isLatest === false).sort((a, b) => score(b) - score(a)).slice(0, 12);
  return { current, historical };
}
