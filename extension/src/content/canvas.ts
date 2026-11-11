import { canvasKind, canvasSkipsPrivate } from '../lib/canvas.js';
import { fieldCounts } from './article.js';
import { toast } from './toast.js';

const saved = new Set<string>();

function courseName() {
  const crumbs = Array.from(document.querySelectorAll('#breadcrumbs a, .ic-app-crumbs a')).map((node) => node.textContent?.trim() || '').filter(Boolean);
  return crumbs[1] || crumbs[0] || '';
}

function snapshot() {
  const title = document.querySelector('h1')?.textContent?.trim() || document.title;
  const due = document.querySelector('.assignment-dates .date_text, .assignment_dates .date_text, time')?.textContent?.trim() || '';
  const points = document.querySelector('.points_possible, .points')?.textContent?.trim() || '';
  const description = document.querySelector('.user_content, #assignment_show .description, .message.user_content')?.textContent?.trim() || '';
  const kind = canvasKind(location.href);
  const body = [`Course: ${courseName()}`, `Type: ${kind}`, `Title: ${title}`, due ? `Due: ${due}` : '', points ? `Points: ${points}` : '', '', description].filter(Boolean).join('\n');
  return { title, kind, body };
}

function save(includeGrades: boolean) {
  if (canvasSkipsPrivate(location.href, includeGrades)) {
    toast('Grades and other students stay private');
    return;
  }
  const item = snapshot();
  chrome.runtime.sendMessage({ type: 'capture', kind: 'canvas', title: item.title, url: location.href, text: item.body, itemType: item.kind, ...fieldCounts() }, (res) => {
    if (res?.ok) toast(res.duplicate ? 'Already saved' : 'Saved to Rukmer', res.id && res.created ? () => chrome.runtime.sendMessage({ type: 'undo', id: res.id }) : undefined);
    else if (res?.error) toast(res.error);
  });
}

chrome.runtime.sendMessage({ type: 'gate', kind: 'canvas', url: location.href }, (res) => {
  if (!res?.canvas || !canvasKind(location.href)) return;
  if (canvasSkipsPrivate(location.href, !!res.includeGrades)) return;
  if (document.getElementById('rukmer-canvas-save')) return;
  const el = document.createElement('button');
  el.id = 'rukmer-canvas-save';
  el.type = 'button';
  el.textContent = 'Save to Rukmer';
  el.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:16px;border:0;border-radius:999px;background:#2563eb;color:white;padding:8px 12px;cursor:pointer;font:13px Inter,ui-sans-serif,system-ui,sans-serif';
  el.addEventListener('click', (event) => {
    event.preventDefault();
    save(!!res.includeGrades);
  });
  document.documentElement.append(el);
  if (res.auto && !saved.has(location.href)) {
    saved.add(location.href);
    const kind = canvasKind(location.href);
    if (kind === 'assignment' || kind === 'announcement') save(!!res.includeGrades);
  }
});
