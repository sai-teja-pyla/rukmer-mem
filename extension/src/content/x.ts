import { xIsMessages, xPostId } from '../lib/x.js';
import { fieldCounts } from './article.js';
import { toast } from './toast.js';

type Flags = { x: boolean; auto: boolean; thread: boolean; messages: boolean };

function articleOf(node: Element | null) {
  return node?.closest('article') || null;
}

function postFrom(article: Element) {
  const name = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
  const handle = name.match(/@[A-Za-z0-9_]+/)?.[0] || '';
  const texts = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).map((node) => node.textContent?.trim() || '').filter(Boolean);
  const time = article.querySelector('time')?.getAttribute('datetime') || '';
  const link = (article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null)?.href || location.href;
  const alts = Array.from(article.querySelectorAll('img[alt]')).map((img) => img.getAttribute('alt') || '').filter((alt) => alt && !/profile/i.test(alt));
  const body = [`Author: ${name}`, handle ? `Handle: ${handle}` : '', time ? `Posted: ${time}` : '', '', texts[0] || '', texts[1] ? `Quoted: ${texts[1]}` : '', alts.length ? `Images: ${alts.join(' | ')}` : ''].filter(Boolean).join('\n');
  return { handle, title: `${handle || 'Post'} on X`, url: link, text: body, postId: xPostId(link) };
}

function threadFrom(article: Element) {
  const first = postFrom(article);
  const posts = [first.text];
  let node = article.nextElementSibling;
  while (node) {
    const next = node.matches('article') ? node : node.querySelector('article');
    if (!next) break;
    const post = postFrom(next);
    if (first.handle && post.handle && post.handle !== first.handle) break;
    posts.push(post.text);
    node = next.parentElement === article.parentElement ? next.nextElementSibling : null;
    if (!node) break;
  }
  return { ...first, text: posts.join('\n\n---\n\n'), thread: true };
}

function send(article: Element, thread: boolean) {
  const post = thread ? threadFrom(article) : postFrom(article);
  chrome.runtime.sendMessage({ type: 'capture', kind: 'x', title: post.title, url: post.url, text: post.text, postId: post.postId, thread, ...fieldCounts() }, (res) => {
    if (res?.ok) toast(res.duplicate ? 'Already saved' : 'Saved to Rukmer', res.id && res.created ? () => chrome.runtime.sendMessage({ type: 'undo', id: res.id }) : undefined);
    else if (res?.error) toast(res.error);
  });
}

function decorate(flags: Flags) {
  if (xIsMessages(location.href) && !flags.messages) return;
  for (const article of Array.from(document.querySelectorAll('article'))) {
    if (article.querySelector('[data-rukmer-x]')) continue;
    const bar = article.querySelector('[role="group"]') || article;
    const wrap = document.createElement('span');
    wrap.setAttribute('data-rukmer-x', '');
    wrap.style.cssText = 'display:inline-flex;gap:6px;margin-left:8px';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.style.cssText = 'border:0;background:transparent;color:#2563eb;cursor:pointer;font:12px Inter,ui-sans-serif,system-ui,sans-serif';
    save.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      send(article, false);
    });
    wrap.append(save);
    if (flags.thread) {
      const all = document.createElement('button');
      all.type = 'button';
      all.textContent = 'Thread';
      all.style.cssText = save.style.cssText;
      all.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        send(article, true);
      });
      wrap.append(all);
    }
    bar.append(wrap);
  }
}

chrome.runtime.sendMessage({ type: 'gate', kind: 'x', url: location.href }, (res: Flags) => {
  if (!res?.x) return;
  decorate(res);
  new MutationObserver(() => decorate(res)).observe(document.body, { childList: true, subtree: true });
  if (!res.auto) return;
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const hit = target?.closest('[data-testid="like"], [data-testid="bookmark"]');
    if (!hit) return;
    const article = articleOf(hit);
    if (article) send(article, false);
  }, true);
});
