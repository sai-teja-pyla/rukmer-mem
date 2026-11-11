import { getState, persistNow } from './core.js';
import { canRead } from './governance.js';
import { ingestDocument } from './pipeline.js';
import { homeTag } from './tenancy.js';

export type GmailDraft = {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  threadId?: string;
};

function redactMail(text: string) {
  return String(text || '')
    .replace(/([?&#](?:token|key|code|session|auth|password|secret|sig|signature)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(?:otp|passcode|pin|security code|verification code|one[- ]time code)\s*(?:is|:)?\s*[A-Z0-9-]{4,10}\b/gi, (match) =>
      match.replace(/[A-Z0-9-]{4,10}$/i, '[redacted]')
    )
    .replace(/\b\d{4,8}\b/g, (digits, offset, all) => {
      const around = String(all).slice(Math.max(0, Number(offset) - 48), Number(offset) + digits.length + 16).toLowerCase();
      return /code|otp|verify|verification|pin|passcode|2fa|two-factor|one-time/.test(around) ? '[redacted]' : digits;
    })
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}

export function gmailSkipReason(subject: string, body: string) {
  const hay = `${subject}\n${body}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/one[- ]time|otp|verification code|security code|login code|passcode/, 'one-time code'],
    [/password reset|reset your password|forgot your password|set a new password/, 'password reset'],
    [/verify your (email|account)|verification link|confirm your email/, 'verification'],
    [/bank statement|payment statement|billing statement|card ending in|direct deposit/, 'payment statement'],
  ];
  for (const [rule, reason] of rules) {
    if (rule.test(hay)) return reason;
  }
  return '';
}

export function prepareGmailMessage(message: GmailDraft) {
  const id = String(message.id || '').trim();
  if (!id) return null;
  const subject = String(message.subject || '').trim() || '(No subject)';
  const from = String(message.from || '').trim() || '(Unknown sender)';
  const body = redactMail(String(message.body || '')).trim();
  if (!body) return null;
  if (gmailSkipReason(subject, body)) return null;
  const thread = String(message.threadId || id).replace(/[^\w-]/g, '').slice(0, 80);
  const url = `https://mail.google.com/mail/u/0/#all/${thread}`;
  const text = [`Subject: ${subject}`, `From: ${from}`, `Date: ${message.date || ''}`, `URL: ${url}`, '', body.slice(0, 8000)].join('\n');
  return {
    title: subject.slice(0, 180),
    text,
    sourceRef: `gmail:${id}`.slice(0, 200),
    metadata: {
      site: 'gmail',
      url,
      from: from.slice(0, 180),
      captured_at: new Date().toISOString(),
      capture_type: 'gmail',
    },
  };
}

export async function saveGmailMessages(uid: string, messages: GmailDraft[]) {
  const tag = homeTag(uid);
  let imported = 0;
  let skipped = 0;
  for (const message of messages) {
    const prepared = prepareGmailMessage(message);
    if (!prepared) {
      skipped += 1;
      continue;
    }
    const saved = await ingestDocument({
      title: prepared.title,
      text: prepared.text,
      containerTag: tag,
      source: 'gmail',
      mime: 'text/plain',
      sourceRef: prepared.sourceRef,
      metadata: prepared.metadata,
      actorId: uid,
      extract: false,
    });
    if (saved.created || saved.updated) imported += 1;
  }
  await persistNow();
  return { imported, skipped, items: gmailMemoryCount(uid) };
}

export function gmailMemoryCount(uid: string) {
  return getState().documents.filter((doc) => !doc.forgotten && doc.source === 'gmail' && canRead(uid, doc)).length;
}
