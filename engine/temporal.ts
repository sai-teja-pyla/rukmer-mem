import type { TemporalKind } from './core.js';

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export function inferTemporal(text: string, writtenAt = new Date().toISOString()): { occurredAt: string | null; temporal: TemporalKind } {
  const lower = text.toLowerCase();
  const written = new Date(writtenAt);
  const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
  let month: number | null = null;
  for (const [name, idx] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      month = idx;
      break;
    }
  }
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    const occurredAt = new Date(Date.UTC(year, month ?? 0, 1)).toISOString();
    const wy = written.getUTCFullYear();
    const temporal: TemporalKind = year < wy || (year === wy && month != null && month < written.getUTCMonth()) ? 'past' : year > wy ? 'future' : 'present';
    return { occurredAt, temporal };
  }
  if (/\b(tomorrow|next week|next month|planning to|going to|will )\b/.test(lower)) return { occurredAt: null, temporal: 'future' };
  if (/\b(yesterday|last week|last month|last year|ago|used to|previously)\b/.test(lower)) return { occurredAt: null, temporal: 'past' };
  if (/\b(now|currently|today|right now)\b/.test(lower)) return { occurredAt: writtenAt, temporal: 'present' };
  return { occurredAt: null, temporal: 'undated' };
}

export function queryTimeIntent(query: string): TemporalKind {
  const q = query.toLowerCase();
  if (/\b(when did|what happened|last|ago|used to|previously|history|in (19|20)\d{2}|back in)\b/.test(q)) return 'past';
  if (/\b(tomorrow|next week|next month|planning|going to|will )\b/.test(q)) return 'future';
  if (/\b(now|current|currently|today|right now)\b/.test(q)) return 'present';
  return 'undated';
}

export function timeMultiplier(intent: TemporalKind, temporal: TemporalKind | undefined, isLatest: boolean) {
  const kind = temporal || 'undated';
  if (intent === 'undated') return isLatest ? 1 : 0.7;
  if (intent === 'past' && !isLatest) return 1.25;
  if (intent === 'present' && !isLatest) return 0.35;
  if (intent === kind) return 1.35;
  if (kind === 'undated') return 1;
  return 0.8;
}
