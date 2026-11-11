import { hashText } from './hash.js';
import { stripUrl } from './url.js';

export type CaptureDraft = {
  title: string;
  url: string;
  browser: string;
  capturedAt: string;
  captureType: 'manual' | 'auto' | 'highlight' | 'bookmark' | 'history' | 'ai-chat';
  site?: '' | 'gmail' | 'canvas' | 'x';
  body: string;
  sourceRef: string;
  containerTag: string;
};

export function documentText(draft: CaptureDraft) {
  const url = stripUrl(draft.url) || draft.url;
  const lines = [`Title: ${draft.title || url || 'Untitled'}`, `URL: ${url}`, `Browser: ${draft.browser}`, `Captured: ${draft.capturedAt}`, `Type: ${draft.captureType}`];
  if (draft.site) lines.push(`Site: ${draft.site}`);
  return `${lines.join('\n')}\n\n${String(draft.body || '').trim()}`;
}

export function documentBody(draft: CaptureDraft) {
  const text = documentText(draft).slice(0, 20000);
  return {
    title: (draft.title || 'Untitled').slice(0, 180),
    text,
    source: 'browser-extension',
    sourceRef: draft.sourceRef,
    containerTag: draft.containerTag,
    metadata: {
      url: (stripUrl(draft.url) || draft.url).slice(0, 200),
      captured_at: draft.capturedAt,
      capture_type: draft.captureType,
      browser: draft.browser,
      site: draft.site || '',
      contentHash: hashText(text),
    },
  };
}
