import { scrolledMeaningfully, dwellReady } from '../lib/dwell.js';
import { articleText, fieldCounts } from './article.js';
import { toast } from './toast.js';

const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Save';
button.style.cssText = 'position:fixed;z-index:2147483646;display:none;padding:6px 10px;border:0;border-radius:999px;background:#2563eb;color:white;font:12px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer';
button.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const text = String(getSelection()?.toString() || '').trim();
  if (!text) return;
  button.style.display = 'none';
  chrome.runtime.sendMessage({ type: 'capture', kind: 'highlight', title: document.title, url: location.href, text, ...fieldCounts() }, (res) => {
    if (res?.ok) toast(res.duplicate ? 'Already saved' : 'Saved to Rukmer', res.id && !res.duplicate ? () => chrome.runtime.sendMessage({ type: 'undo', id: res.id }) : undefined);
    else if (res?.error) toast(res.error);
  });
});
let highlightsOn = false;
document.documentElement.append(button);

let autoOn = false;
let activeMs = 0;
let last = 0;
let sentUrl = '';

function place() {
  if (!highlightsOn) return;
  const sel = getSelection();
  const text = String(sel?.toString() || '').trim();
  if (text.length < 2 || !sel?.rangeCount) {
    button.style.display = 'none';
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  button.style.display = 'block';
  button.style.left = `${Math.max(8, rect.left)}px`;
  button.style.top = `${Math.max(8, rect.bottom + 8)}px`;
}

document.addEventListener('mouseup', () => window.setTimeout(place, 0));
document.addEventListener('keyup', () => window.setTimeout(place, 0));
document.addEventListener('selectionchange', () => {
  if (!String(getSelection()?.toString() || '').trim()) button.style.display = 'none';
});

window.setInterval(() => {
  if (document.visibilityState !== 'visible') {
    last = 0;
    return;
  }
  const now = Date.now();
  if (sentUrl && sentUrl !== location.href) {
    activeMs = 0;
    sentUrl = '';
  }
  if (last) activeMs += now - last;
  last = now;
  if (!autoOn || sentUrl === location.href || !dwellReady(activeMs)) return;
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  if (!scrolledMeaningfully(scrollY, document.documentElement.scrollHeight, window.innerHeight)) return;
  sentUrl = location.href;
  chrome.runtime.sendMessage({
    type: 'capture',
    kind: 'auto',
    title: document.title,
    url: location.href,
    text: articleText(),
    ...fieldCounts(),
  });
}, 1000);

chrome.runtime.sendMessage({ type: 'gate', kind: 'read', url: location.href }, (res) => {
  highlightsOn = !!res?.highlights;
  autoOn = !!res?.autoRead;
  if (!highlightsOn) button.remove();
});
