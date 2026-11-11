import { gmailImportant, redactSecrets, shouldSkipEmail } from '../lib/gmail.js';
import { fieldCounts } from './article.js';
import { toast } from './toast.js';

const seen = new Set<string>();

function text(selector: string) {
  return Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join('\n').trim();
}

function threadId() {
  const node = document.querySelector('[data-legacy-thread-id], [data-thread-id]');
  const attr = node?.getAttribute('data-legacy-thread-id') || node?.getAttribute('data-thread-id') || '';
  if (attr) return attr;
  const match = location.hash.match(/\/([0-9a-f]{10,})/i);
  return match?.[1] || '';
}

function snapshot() {
  const subject = document.querySelector('h2.hP')?.textContent?.trim() || document.title;
  const senderNode = document.querySelector('span.gD');
  const from = `${senderNode?.getAttribute('name') || senderNode?.textContent || ''} <${senderNode?.getAttribute('email') || ''}>`.trim();
  const recipients = text('.g2');
  const date = document.querySelector('.g3')?.getAttribute('title') || document.querySelector('.g3')?.textContent || '';
  const attachments = Array.from(document.querySelectorAll('.aZo .aV3, .aQA span, .aYy')).map((node) => node.textContent?.trim() || '').filter(Boolean);
  const body = text('.a3s');
  const labels = Array.from(document.querySelectorAll('.at .av, .ar .as')).map((node) => node.textContent?.trim() || '').filter(Boolean);
  const starred = !!document.querySelector('[aria-label*="Starred" i], .T-KT-Jp');
  const important = !!document.querySelector('[aria-label*="Important" i], img[alt*="Important" i]');
  const raw = [`From: ${from}`, `To: ${recipients}`, `Date: ${date}`, `Subject: ${subject}`, attachments.length ? `Attachments: ${attachments.join(', ')}` : '', '', body].filter(Boolean).join('\n');
  return { subject, from, labels, starred, important, body: redactSecrets(raw), threadId: threadId() };
}

function save(kind: 'manual' | 'auto') {
  const mail = snapshot();
  const skip = shouldSkipEmail({ subject: mail.subject, body: mail.body });
  if (skip.skip) {
    toast(`Not saved (${skip.reason})`);
    return;
  }
  chrome.runtime.sendMessage({ type: 'capture', kind: 'gmail', mode: kind, title: mail.subject, url: location.href, text: mail.body, threadId: mail.threadId, from: mail.from, labels: mail.labels, starred: mail.starred, important: mail.important, ...fieldCounts() }, (res) => {
    if (res?.skipped) toast(res.error || 'Not saved');
    else if (res?.ok) toast(res.duplicate ? 'Already saved' : res.updated ? 'Updated in Rukmer' : 'Saved to Rukmer', res.id && res.created ? () => chrome.runtime.sendMessage({ type: 'undo', id: res.id }) : undefined);
    else if (res?.error) toast(res.error);
  });
}

function button() {
  if (document.getElementById('rukmer-gmail-save')) return;
  const host = document.querySelector('.iH') || document.querySelector('.G-atb') || document.querySelector('h2.hP')?.parentElement;
  if (!host) return;
  const el = document.createElement('button');
  el.id = 'rukmer-gmail-save';
  el.type = 'button';
  el.textContent = 'Save to Rukmer';
  el.style.cssText = 'margin-left:8px;border:0;border-radius:8px;background:#2563eb;color:white;padding:4px 8px;cursor:pointer;font:12px Inter,ui-sans-serif,system-ui,sans-serif';
  el.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    save('manual');
  });
  host.append(el);
}

chrome.runtime.sendMessage({ type: 'gate', kind: 'gmail', url: location.href }, (res) => {
  if (!res?.gmail) return;
  let timer = 0;
  const watch = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => watchNow(), 400);
  };
  const watchNow = () => {
    button();
    if (!res.gmailImportant) return;
    const mail = snapshot();
    if (!mail.threadId || seen.has(mail.threadId) || !mail.body) return;
    chrome.runtime.sendMessage({ type: 'gate', kind: 'gmail-auto', url: location.href, from: mail.from, labels: mail.labels, starred: mail.starred, important: mail.important }, (auto) => {
      if (!auto?.ok) return;
      if (!gmailImportant({ starred: mail.starred, important: mail.important, from: mail.from, labels: mail.labels, senders: auto.senders, wantedLabels: auto.labels })) return;
      seen.add(mail.threadId);
      save('auto');
    });
  };
  watch();
  new MutationObserver(() => watch()).observe(document.body, { childList: true, subtree: true });
});
