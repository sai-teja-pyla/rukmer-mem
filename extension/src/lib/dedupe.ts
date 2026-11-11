import { hashText } from './hash.js';
import { stripUrl } from './url.js';

export function pageKey(url: string) {
  const clean = stripUrl(url) || url;
  return `browser:page:${hashText(clean)}`;
}

export function highlightKey(url: string, text: string) {
  return `browser:highlight:${hashText(`${stripUrl(url) || url}\n${text.trim()}`)}`;
}

export function bookmarkKey(url: string) {
  return `browser:bookmark:${hashText(stripUrl(url) || url)}`;
}

export function historyKey(url: string) {
  return `browser:history:${hashText(stripUrl(url) || url)}`;
}

export function chatKey(url: string) {
  return `browser:ai:${hashText(stripUrl(url) || url)}`;
}

export function gmailKey(threadId: string) {
  const id = String(threadId || '').trim().slice(0, 80);
  return id ? `browser:gmail:${id}` : '';
}

export function canvasKey(url: string) {
  return `browser:canvas:${hashText(stripUrl(url) || url)}`;
}

export function sameCapture(a: { sourceRef: string; contentHash: string }, b: { sourceRef: string; contentHash: string }) {
  return !!a.sourceRef && a.sourceRef === b.sourceRef && a.contentHash === b.contentHash;
}
