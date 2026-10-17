import { getState, sanitizeMeta, saveState, uid, type TripleRec } from './core.js';
import { linkEntities } from './entities.js';
import { horizonFor, isUsefulFact, normalizePredicate } from './quality.js';
import { inferTemporal } from './temporal.js';
import { scopeFromTag } from './tenancy.js';

export type IncomingFact = {
  subject?: string;
  predicate?: string;
  object?: string;
  validFrom?: string;
  kind?: TripleRec['kind'];
  metadata?: Record<string, string>;
  occurredAt?: string | null;
  temporal?: TripleRec['temporal'];
};

function keyOf(tag: string, subject: string, predicate: string) {
  return `${tag}::${subject.trim().toLowerCase()}::${predicate.trim().toLowerCase()}`;
}

export function upsertFacts(tag: string, facts: IncomingFact[], evidence = '') {
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
      latest.updatedAt = now;
      if (!latest.recordedAt) latest.recordedAt = latest.validFrom || now;
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
      evidence: String(evidence || '').slice(0, 400),
      isLatest: true,
      derived: raw.kind === 'derive',
      validFrom: raw.validFrom || now,
      validTo: null,
      recordedAt: now,
      updatedAt: now,
      kind: raw.kind || (latest ? 'update' : 'assert'),
      horizon: horizonFor(predicate),
    };
    const when = inferTemporal(`${object} ${evidence}`, raw.validFrom || now);
    rec.occurredAt = raw.occurredAt ?? when.occurredAt;
    rec.temporal = raw.temporal || when.temporal;
    rec.metadata = sanitizeMeta(raw.metadata);
    rec.scope = scopeFromTag(tag);
    state.triples.push(rec);
  }

  linkEntities(tag);
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

  for (const t of latest.filter((x) => x.predicate === 'partner_of')) {
    incoming.push({ subject: t.object, predicate: 'partner_of', object: t.subject, kind: 'derive' });
  }
  for (const t of latest.filter((x) => x.predicate === 'reports_to')) {
    const boss = latest.find((x) => x.subject.toLowerCase() === t.object.toLowerCase() && x.predicate === 'works_at');
    if (boss) incoming.push({ subject: t.subject, predicate: 'member_of', object: boss.object, kind: 'derive' });
  }

  const unique = incoming
    .filter((f) => f.kind === 'derive')
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
