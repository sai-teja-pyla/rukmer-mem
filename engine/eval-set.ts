export type EvalFact = { subject: string; predicate: string; object: string; evidence: string };
export type EvalCase = {
  id: string;
  facts: EvalFact[];
  query: string;
  expect: string;
  reject?: string;
};

/** Original fixed set. Categories match long-horizon memory benches: update, time, entity, multi-fact. */
export const EVAL_CASES: EvalCase[] = [
  {
    id: 'preference-now',
    facts: [
      { subject: 'User', predicate: 'prefers', object: 'tea', evidence: 'preferred tea in March 2024' },
      { subject: 'User', predicate: 'prefers', object: 'coffee', evidence: 'currently drinks coffee' },
    ],
    query: 'what do I currently prefer to drink',
    expect: 'coffee',
    reject: 'tea',
  },
  {
    id: 'temporal-past',
    facts: [
      { subject: 'User', predicate: 'lives_in', object: 'Austin', evidence: 'lived in Austin in March 2020' },
      { subject: 'User', predicate: 'lives_in', object: 'Seattle', evidence: 'currently lives in Seattle' },
    ],
    query: 'what happened in 2020 where did I live',
    expect: 'Austin',
  },
  {
    id: 'entity-link',
    facts: [
      { subject: 'User', predicate: 'works_at', object: 'Rukmer', evidence: 'User works at Rukmer' },
      { subject: 'Rukmer', predicate: 'located_in', object: 'Austin', evidence: 'Rukmer is located in Austin' },
    ],
    query: 'where is Rukmer based',
    expect: 'Austin',
  },
  {
    id: 'plan-short',
    facts: [
      { subject: 'User', predicate: 'plans', object: 'ship the memory index', evidence: 'planning to ship the memory index next week' },
    ],
    query: 'what am I planning to ship',
    expect: 'memory index',
  },
  {
    id: 'person',
    facts: [
      { subject: 'User', predicate: 'partner_of', object: 'Mina', evidence: 'User partner is Mina' },
      { subject: 'Mina', predicate: 'lives_in', object: 'Berlin', evidence: 'Mina lives in Berlin' },
    ],
    query: 'where does Mina live',
    expect: 'Berlin',
  },
];
