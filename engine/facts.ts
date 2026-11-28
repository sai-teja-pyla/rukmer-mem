import { getState, sanitizeMeta, saveState, uid, type MemoryGov, type TripleRec } from './core.js';
import { redactText } from './governance.js';
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
  gov?: MemoryGov;
  sourceDocId?: string;
};

const INVALIDATES: Record<string, { subjectIs: 'S' | 'O'; predicate: string; objectIs: 'S' | 'O' }[]> = {
  divested: [
    { subjectIs: 'O', predicate: 'owned_by', objectIs: 'S' },
    { subjectIs: 'S', predicate: 'owns', objectIs: 'O' },
    { subjectIs: 'S', predicate: 'acquired', objectIs: 'O' },
  ],
  sold: [
    { subjectIs: 'O', predicate: 'owned_by', objectIs: 'S' },
    { subjectIs: 'S', predicate: 'owns', objectIs: 'O' },
    { subjectIs: 'S', predicate: 'acquired', objectIs: 'O' },
  ],
  spun_off: [
    { subjectIs: 'O', predicate: 'owned_by', objectIs: 'S' },
    { subjectIs: 'S', predicate: 'owns', objectIs: 'O' },
    { subjectIs: 'S', predicate: 'acquired', objectIs: 'O' },
  ],
};

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function keyOf(tag: string, subject: string, predicate: string) {
  return `${tag}::${subject.trim().toLowerCase()}::${predicate.trim().toLowerCase()}`;
}

export function upsertFacts(tag: string, facts: IncomingFact[], evidence = '', gov?: MemoryGov, originalText = '') {
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

    const cleanEvidence = gov?.tenantId ? redactText(gov.tenantId, evidence).text : evidence;
    const cleanOriginal = String(gov?.tenantId ? redactText(gov.tenantId, originalText).text : originalText || '')
      .trim()
      .slice(0, 4000);
    if (latest && sameObject) {
      latest.evidence = `${latest.evidence} | ${cleanEvidence}`.slice(0, 900);
      if (cleanOriginal) latest.originalText = cleanOriginal;
      latest.kind = 'extend';
      latest.updatedAt = now;
      if (!latest.recordedAt) latest.recordedAt = latest.validFrom || now;
      extendsCount += 1;
      continue;
    }

    const incomingFrom = raw.validFrom ? Date.parse(raw.validFrom) : NaN;
    const latestFrom = latest ? Date.parse(latest.validFrom || '') : NaN;
    const outOfOrder =
      !!latest &&
      !sameObject &&
      !!raw.validFrom &&
      Number.isFinite(incomingFrom) &&
      Number.isFinite(latestFrom) &&
      incomingFrom < latestFrom;
    let historical = false;
    if (latest && !sameObject) {
      if (outOfOrder) {
        historical = true;
        asserts += 1;
      } else {
        latest.isLatest = false;
        latest.validTo = raw.validFrom || now;
        updates += 1;
      }
    } else if (!latest) {
      asserts += 1;
    }

    const rec: TripleRec = {
      id: uid('trp'),
      containerTag: tag,
      subject,
      predicate,
      object,
      evidence: String(cleanEvidence || '').slice(0, 400),
      originalText: cleanOriginal || undefined,
      isLatest: !historical,
      derived: raw.kind === 'derive',
      validFrom: raw.validFrom || now,
      validTo: historical && latest ? latest.validFrom : null,
      recordedAt: now,
      updatedAt: now,
      kind: raw.kind || (historical || latest ? 'update' : 'assert'),
      horizon: horizonFor(predicate),
      sourceDocId: raw.sourceDocId || undefined,
    };
    const when = inferTemporal(`${object} ${evidence}`, raw.validFrom || now);
    rec.occurredAt = raw.occurredAt ?? when.occurredAt;
    rec.temporal = raw.temporal || when.temporal;
    rec.metadata = sanitizeMeta(raw.metadata);
    rec.scope = scopeFromTag(tag);
    const inherited = raw.gov || gov || latest?.gov;
    if (inherited) rec.gov = { ...inherited, deletedAt: null, archived: false };
    state.triples.push(rec);
    if (rec.isLatest) {
      const rules = INVALIDATES[predicate.toLowerCase()] || [];
      const closedAt = rec.validFrom || now;
      for (const rule of rules) {
        const subjectName = rule.subjectIs === 'S' ? subject : object;
        const objectName = rule.objectIs === 'S' ? subject : object;
        const pred = rule.predicate.toLowerCase();
        for (const row of state.triples) {
          if (row.id === rec.id || row.containerTag !== tag || row.isLatest === false) continue;
          const rowPred = (normalizePredicate(row.predicate) || row.predicate).toLowerCase();
          if (rowPred !== pred) continue;
          if (!sameName(row.subject, subjectName) || !sameName(row.object, objectName)) continue;
          row.isLatest = false;
          row.validTo = closedAt;
        }
      }
    }
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
