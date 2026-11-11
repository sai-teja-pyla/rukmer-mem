import { fieldCounts } from './article.js';
import { toast } from './toast.js';

function conversation() {
  const nodes = document.querySelectorAll('[data-message-author-role], [data-testid="user-message"], message-content, .font-claude-message');
  const parts = Array.from(nodes).map((node) => {
    const role = node.getAttribute('data-message-author-role') || node.getAttribute('data-testid') || 'message';
    const text = node.textContent?.trim() || '';
    return text ? `${role}: ${text}` : '';
  }).filter(Boolean);
  if (parts.length) return parts.join('\n\n').slice(0, 20000);
  return String(document.querySelector('main')?.textContent || '').trim().slice(0, 20000);
}

chrome.runtime.sendMessage({ type: 'gate', kind: 'ai', url: location.href }, (res) => {
  if (!res?.ai) return;
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = 'Save this conversation';
  el.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:16px;border:0;border-radius:999px;background:#2563eb;color:white;padding:8px 12px;cursor:pointer;font:13px Inter,ui-sans-serif,system-ui,sans-serif';
  el.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'capture', kind: 'ai-chat', title: document.title, url: location.href, text: conversation(), ...fieldCounts() }, (out) => {
      if (out?.ok) toast(out.duplicate ? 'Already saved' : 'Saved to Rukmer', out.id && out.created ? () => chrome.runtime.sendMessage({ type: 'undo', id: out.id }) : undefined);
      else if (out?.error) toast(out.error);
    });
  });
  document.documentElement.append(el);
});
