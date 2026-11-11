import { isBlocked, hasSecretFields, type BlockPolicy } from '../lib/blocklist.js';
import { canvasSkipsPrivate } from '../lib/canvas.js';
import { bookmarkKey, canvasKey, chatKey, gmailKey, highlightKey, historyKey, pageKey } from '../lib/dedupe.js';
import { documentBody, type CaptureDraft } from '../lib/document.js';
import { gmailImportant, shouldSkipEmail } from '../lib/gmail.js';
import { hashText } from '../lib/hash.js';
import { dropJobs, enqueue, retryAt, takeReady, type Job } from '../lib/queue.js';
import { mergeSettings, type Settings } from '../lib/settings.js';
import { ownedTag } from '../lib/url.js';
import { xDedupeKey, xIsMessages } from '../lib/x.js';

type Auth = { accessToken: string; refreshToken?: string; expiresAt?: number; browser: string };
type Recent = { id: string; title: string; url: string; at: string; captureType: string; sourceRef: string };

const AUTH = 'rukmer.auth';
const SETTINGS = 'rukmer.settings';
const QUEUE = 'rukmer.queue';
const RECENT = 'rukmer.recent';
const HOME = 'rukmer.home';
const NOTICE = 'rukmer.notice';
const ACTIVE = 'rukmer.active';

let flushing = false;
const outcomes = new Map<string, { id?: string; duplicate?: boolean; updated?: boolean; created?: boolean }>();
let bookmarksHooked = false;

function policy(settings: Settings): BlockPolicy {
  return {
    blocklist: settings.blocklist,
    removedDefaults: settings.removedDefaults,
    allowlistOnly: settings.allowlistOnly,
    allowlist: settings.allowlist,
    canvasDomain: settings.canvasDomain,
    gmail: settings.features.gmail,
    canvas: settings.features.canvas,
    x: settings.features.x,
  };
}

async function localGet<T>(key: string, fallback: T): Promise<T> {
  const bag = await chrome.storage.local.get(key);
  return (bag[key] as T) ?? fallback;
}

async function settings() {
  return mergeSettings(await localGet<Partial<Settings> | null>(SETTINGS, null));
}

async function auth() {
  return localGet<Auth | null>(AUTH, null);
}

async function saveAuth(next: Auth | null) {
  if (!next) await chrome.storage.local.remove(AUTH);
  else await chrome.storage.local.set({ [AUTH]: next });
  await paint();
}

async function queue() {
  return localGet<Job[]>(QUEUE, []);
}

async function saveQueue(items: Job[]) {
  await chrome.storage.local.set({ [QUEUE]: items.slice(-200) });
}

async function recent() {
  return localGet<Recent[]>(RECENT, []);
}

async function remember(item: Recent) {
  const items = (await recent()).filter((row) => row.id !== item.id && row.sourceRef !== item.sourceRef);
  items.unshift(item);
  await chrome.storage.local.set({ [RECENT]: items.slice(0, 20) });
}

async function notice(text: string) {
  await chrome.storage.local.set({ [NOTICE]: text });
}

async function browserName() {
  const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
  if (nav.brave?.isBrave && (await nav.brave.isBrave().catch(() => false))) return 'Brave';
  if (/Edg\//.test(navigator.userAgent)) return 'Edge';
  return 'Chrome';
}

function closed(settings: Settings) {
  if (!settings.onboarded) return 'Finish setup before saving';
  if (!settings.captureEnabled) return 'Capture is off';
  if (settings.pauseUntil > Date.now()) return 'Capture is paused';
  return '';
}

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const current = await auth();
  const cfg = await settings();
  const token = init.token || current?.accessToken || '';
  if (!token) throw Object.assign(new Error('Connect to Rukmer first'), { status: 401, retryAfter: 0 });
  if (!init.token && current?.refreshToken && current.expiresAt && current.expiresAt < Date.now() + 86_400_000) {
    await refresh(current, cfg.apiBase);
  }
  const send = async (bearer: string) => {
    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${path}`, {
        method: init.method || 'GET',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw Object.assign(new Error('Offline'), { status: 0, retryAfter: 0 });
    }
    const retryAfter = Number(res.headers.get('Retry-After') || 0);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && current?.refreshToken && !init.token && bearer === token) {
      const next = await refresh(current, cfg.apiBase);
      init.token = next.accessToken;
      return send(next.accessToken);
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `Rukmer ${res.status}`), { status: res.status, retryAfter });
    return data;
  };
  const latest = (await auth()) || current;
  return send(init.token || latest?.accessToken || token);
}

async function refresh(current: Auth, apiBase: string) {
  if (!current.refreshToken) throw Object.assign(new Error('Sign in again'), { status: 401, retryAfter: 0 });
  const res = await fetch(`${apiBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: current.refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    await saveAuth(null);
    throw Object.assign(new Error('Sign in again'), { status: 401, retryAfter: 0 });
  }
  const next: Auth = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
    browser: current.browser,
  };
  await saveAuth(next);
  return next;
}

async function homeTag() {
  const cached = await localGet<string>(HOME, '');
  if (cached) return cached;
  const me = await api('/v3/me');
  const tag = String(me.homeTag || '');
  if (tag) await chrome.storage.local.set({ [HOME]: tag });
  return tag;
}

async function tagFor(slug: string) {
  return ownedTag(await homeTag(), slug);
}

function bytes(value: string) {
  const raw = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) raw[i] = value.charCodeAt(i);
  return raw;
}

async function claim(code: string) {
  const cfg = await settings();
  const browser = await browserName();
  const res = await fetch(`${cfg.apiBase}/v4/connectors/browser/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, browser }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !String(data.access_token || '').startsWith('rk_live_')) {
    throw new Error(data.error || 'Could not connect this browser');
  }
  await saveAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
    browser,
  });
  await chrome.storage.local.remove(HOME);
  await homeTag().catch(() => undefined);
  return { ok: true, browser };
}

async function connect() {
  const cfg = await settings();
  const browser = await browserName();
  const redirect = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const digest = await crypto.subtle.digest('SHA-256', bytes(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const url = new URL('/oauth/authorize', cfg.apiBase);
  url.searchParams.set('client_id', 'rukmer-browser');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'memory');
  url.searchParams.set('browser', browser);
  const back = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!back) throw new Error('Sign-in was cancelled');
  const params = new URL(back).searchParams;
  if (params.get('state') !== state) throw new Error('Sign-in did not match this window');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error') || 'Rukmer did not return a code');
  const res = await fetch(`${cfg.apiBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, client_id: 'rukmer-browser' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !String(data.access_token || '').startsWith('rk_live_')) throw new Error(data.error || 'Could not finish sign-in');
  await saveAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
    browser,
  });
  await chrome.storage.local.remove(HOME);
  await homeTag();
  return { ok: true, browser };
}

async function useKey(secret: string) {
  const key = secret.trim();
  if (!key.startsWith('rk_live_')) throw new Error('Paste a Rukmer API key');
  const cfg = await settings();
  const res = await fetch(`${cfg.apiBase}/v3/me`, { headers: { Authorization: `Bearer ${key}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That API key was not accepted');
  await saveAuth({ accessToken: key, browser: await browserName() });
  if (data.homeTag) await chrome.storage.local.set({ [HOME]: data.homeTag });
  return { ok: true };
}

async function signOut() {
  const current = await auth();
  if (current?.accessToken) {
    try {
      const keys = await api('/v3/keys');
      const prefix = current.accessToken.slice(0, 12);
      const match = (keys.keys || []).find((row: { id: string; prefix?: string }) => String(row.prefix || '').startsWith(prefix));
      if (match) await api(`/v3/keys/${encodeURIComponent(match.id)}`, { method: 'DELETE' });
    } catch {
      /* local sign-out still clears the token */
    }
  }
  await saveAuth(null);
  await chrome.storage.local.remove(HOME);
  return { ok: true };
}

async function paint() {
  const current = await auth();
  const cfg = await settings();
  const paused = cfg.pauseUntil > Date.now();
  const on = !!current && cfg.onboarded && cfg.captureEnabled && !paused;
  const icon = !current ? 'off' : paused ? 'pause' : on ? 'on' : 'off';
  const path = (size: number) => `icons/icon-${icon}-${size}.png`;
  await chrome.action.setIcon({ path: { 16: path(16), 32: path(32), 48: path(48), 128: path(128) } }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: on ? 'ON' : paused ? 'II' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#d97706' : '#2563eb' });
}

async function syncScripts(cfg: Settings) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = existing.map((script) => script.id).filter((id) => id.startsWith('rukmer-'));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  const granted = async (origins: string[]) => chrome.permissions.contains({ origins });
  const regs: chrome.scripting.RegisteredContentScript[] = [];
  if ((cfg.features.autoRead || cfg.features.highlights) && (await granted(['<all_urls>']))) {
    regs.push({ id: 'rukmer-read', matches: ['<all_urls>'], js: ['content/read.js'], runAt: 'document_idle' });
  }
  if (cfg.features.gmail && (await granted(['https://mail.google.com/*']))) {
    regs.push({ id: 'rukmer-gmail', matches: ['https://mail.google.com/*'], js: ['content/gmail.js'], runAt: 'document_idle' });
  }
  if (cfg.features.canvas) {
    const matches: string[] = [];
    if (await granted(['https://*.instructure.com/*']) || (await granted(['<all_urls>']))) matches.push('https://*.instructure.com/*');
    const domain = cfg.canvasDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (domain && (await granted([`https://${domain}/*`]) || (await granted(['<all_urls>'])))) matches.push(`https://${domain}/*`);
    if (matches.length) regs.push({ id: 'rukmer-canvas', matches, js: ['content/canvas.js'], runAt: 'document_idle' });
  }
  if (cfg.features.x && (await granted(['https://x.com/*', 'https://twitter.com/*']))) {
    regs.push({ id: 'rukmer-x', matches: ['https://x.com/*', 'https://twitter.com/*'], js: ['content/x.js'], runAt: 'document_idle' });
  }
  if (cfg.features.aiChat && (await granted(['https://chatgpt.com/*', 'https://claude.ai/*', 'https://grok.com/*', 'https://gemini.google.com/*']))) {
    regs.push({ id: 'rukmer-ai', matches: ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://grok.com/*', 'https://gemini.google.com/*'], js: ['content/ai.js'], runAt: 'document_idle' });
  }
  if (regs.length) await chrome.scripting.registerContentScripts(regs);
}

function hookBookmarks() {
  if (bookmarksHooked || !chrome.bookmarks?.onCreated) return;
  bookmarksHooked = true;
  chrome.bookmarks.onCreated.addListener((_id, node) => {
    if (!node.url) return;
    void settings().then((cfg) => {
      if (!cfg.onboarded || !cfg.captureEnabled || !cfg.features.bookmarksSync || isBlocked(node.url || '', policy(cfg))) return;
      return storeDraft(cfg, {
        title: node.title || node.url || '',
        url: node.url || '',
        captureType: 'bookmark',
        body: `${node.title || ''}\n${node.url}`,
        sourceRef: bookmarkKey(node.url || ''),
        container: cfg.containerTag,
      }).then(() => flush());
    });
  });
}

async function storeDraft(cfg: Settings, input: { title: string; url: string; captureType: CaptureDraft['captureType']; body: string; sourceRef: string; container: string; site?: CaptureDraft['site'] }) {
  if (!input.sourceRef || !input.body.trim()) return { ok: false, error: 'Nothing to save' };
  const current = await auth();
  const draft: CaptureDraft = {
    title: input.title || input.url,
    url: input.url,
    browser: current?.browser || (await browserName()),
    capturedAt: new Date().toISOString(),
    captureType: input.captureType,
    site: input.site || '',
    body: input.body,
    sourceRef: input.sourceRef,
    containerTag: await tagFor(input.container),
  };
  const body = documentBody(draft);
  const job: Job = { id: crypto.randomUUID(), sourceRef: draft.sourceRef, contentHash: String(body.metadata.contentHash), attempts: 0, nextAt: Date.now(), body };
  await saveQueue(enqueue(await queue(), job));
  return { ok: true, queued: true, sourceRef: draft.sourceRef };
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (let round = 0; round < 10; round++) {
    let pending = await queue();
    const ready = takeReady(pending, Date.now(), 5);
    if (!ready.length) break;
    let retryLater = false;
    const groups = new Map<string, Job[]>();
    for (const job of ready) {
      const tag = String(job.body.containerTag || '');
      groups.set(tag, [...(groups.get(tag) || []), job]);
    }
    for (const [containerTag, jobs] of groups) {
      try {
        const out = await api('/v3/documents/batch', { method: 'POST', body: { containerTag, documents: jobs.map((job) => job.body), task: 'memory' } });
        const results = out.results || [];
        for (let i = 0; i < jobs.length; i++) {
          const doc = results[i]?.document;
          outcomes.set(jobs[i].sourceRef, { id: doc?.id, duplicate: !!results[i]?.duplicate, updated: !!results[i]?.updated, created: !!results[i]?.created });
          if (doc?.id) {
            const meta = (jobs[i].body.metadata || {}) as { url?: string; capture_type?: string };
            await remember({ id: doc.id, title: String(doc.title || jobs[i].body.title || ''), url: String(meta.url || ''), at: new Date().toISOString(), captureType: String(meta.capture_type || ''), sourceRef: jobs[i].sourceRef });
          }
        }
        pending = dropJobs(pending, jobs.map((job) => job.sourceRef));
      } catch (err) {
        const status = Number((err as { status?: number }).status || 0);
        const retryAfter = Number((err as { retryAfter?: number }).retryAfter || 0);
        if (status === 422 || status === 400 || status === 403) {
          pending = dropJobs(pending, jobs.map((job) => job.sourceRef));
          await notice((err as Error).message);
        } else {
          retryLater = true;
          pending = pending.map((job) => (jobs.some((row) => row.sourceRef === job.sourceRef) ? { ...job, attempts: job.attempts + 1, nextAt: retryAt(job.attempts + 1, Date.now(), retryAfter) } : job));
        }
      }
    }
    await saveQueue(pending);
    if (retryLater) break;
    }
  } finally {
    flushing = false;
  }
}

async function saveFromMessage(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  if (sender.tab?.incognito) return { ok: false, error: 'Private windows are never saved' };
  const cfg = await settings();
  const blockedReason = closed(cfg);
  if (blockedReason) return { ok: false, error: blockedReason };
  const url = String(message.url || sender.tab?.url || '');
  const kind = String(message.kind || '');
  const site = kind === 'gmail' ? 'gmail' : kind === 'canvas' ? 'canvas' : kind === 'x' ? 'x' : '';
  if (isBlocked(url, policy(cfg), site as '' | 'gmail' | 'canvas' | 'x')) return { ok: false, error: 'This site is blocked' };
  if (hasSecretFields({ passwordFields: Number(message.passwordFields || 0), cardFields: Number(message.cardFields || 0) })) {
    return { ok: false, error: 'Pages with passwords or cards are never saved' };
  }
  const title = String(message.title || 'Untitled');
  const text = String(message.text || '').trim();
  if (kind === 'highlight') {
    if (!cfg.features.highlights) return { ok: false, error: 'Highlights are off' };
    return finish(await storeDraft(cfg, { title, url, captureType: 'highlight', body: text, sourceRef: highlightKey(url, text), container: cfg.containerTag }));
  }
  if (kind === 'auto') {
    if (!cfg.features.autoRead) return { ok: false, error: 'Auto-capture is off' };
    return finish(await storeDraft(cfg, { title, url, captureType: 'auto', body: text, sourceRef: pageKey(url), container: cfg.containerTag }));
  }
  if (kind === 'gmail') {
    if (!cfg.features.gmail) return { ok: false, error: 'Gmail capture is off' };
    const skip = shouldSkipEmail({ subject: title, body: text, keywords: cfg.gmailKeywords });
    if (skip.skip) return { ok: false, skipped: true, error: `Not saved (${skip.reason})` };
    if (message.mode === 'auto') {
      const important = gmailImportant({
        starred: !!message.starred,
        important: !!message.important,
        from: String(message.from || ''),
        labels: Array.isArray(message.labels) ? message.labels.map(String) : [],
        senders: cfg.gmailSenders,
        wantedLabels: cfg.gmailLabels,
      });
      if (!cfg.features.gmailImportant || !important) return { ok: false, error: 'Only important mail is auto-saved' };
    }
    const thread = String(message.threadId || '');
    return finish(await storeDraft(cfg, { title, url, captureType: message.mode === 'auto' ? 'auto' : 'manual', body: text, sourceRef: gmailKey(thread) || pageKey(url), container: cfg.gmailTag, site: 'gmail' }));
  }
  if (kind === 'canvas') {
    if (!cfg.features.canvas) return { ok: false, error: 'Canvas capture is off' };
    if (canvasSkipsPrivate(url, cfg.features.canvasGrades)) return { ok: false, error: 'Grades and other students stay private' };
    return finish(await storeDraft(cfg, { title, url, captureType: 'manual', body: text, sourceRef: canvasKey(url), container: cfg.canvasTag, site: 'canvas' }));
  }
  if (kind === 'x') {
    if (!cfg.features.x) return { ok: false, error: 'X capture is off' };
    if (xIsMessages(url) && !cfg.features.xMessages) return { ok: false, error: 'X messages are off' };
    const key = xDedupeKey(String(message.postId || ''), !!message.thread);
    return finish(await storeDraft(cfg, { title, url, captureType: 'manual', body: text, sourceRef: key || pageKey(url), container: cfg.xTag, site: 'x' }));
  }
  if (kind === 'ai-chat') {
    if (!cfg.features.aiChat) return { ok: false, error: 'Conversation capture is off' };
    return finish(await storeDraft(cfg, { title, url, captureType: 'ai-chat', body: text, sourceRef: chatKey(url), container: cfg.containerTag }));
  }
  if (!cfg.features.manual) return { ok: false, error: 'Manual save is off' };
  return finish(await storeDraft(cfg, { title, url, captureType: 'manual', body: text, sourceRef: pageKey(url), container: cfg.containerTag }));
}

async function finish(result: { ok: boolean; queued?: boolean; error?: string; sourceRef?: string }) {
  if (!result.ok || !result.sourceRef) return result;
  await flush();
  const still = (await queue()).some((job) => job.sourceRef === result.sourceRef);
  const saved = outcomes.get(result.sourceRef);
  return { ok: true, queued: still, id: saved?.id, created: !!saved?.created, duplicate: !!saved?.duplicate, updated: !!saved?.updated, error: still ? '' : undefined };
}

async function savePage(tabId: number) {
  const cfg = await settings();
  const reason = closed(cfg);
  if (reason) return { ok: false, error: reason };
  if (!cfg.features.manual) return { ok: false, error: 'Turn on manual save in Options' };
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] });
  const [out] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis as { __rukmerExtract?: () => Record<string, unknown> }).__rukmerExtract?.() });
  const page = out?.result;
  if (!page) return { ok: false, error: 'This page could not be read' };
  return saveFromMessage({ ...page, kind: 'manual' }, { tab: { id: tabId, incognito: false } as chrome.tabs.Tab });
}

async function search(query: string) {
  const cfg = await settings();
  const slugs = [cfg.containerTag, cfg.gmailTag, cfg.canvasTag, cfg.xTag];
  const tags = [...new Set(await Promise.all(slugs.map((slug) => tagFor(slug))))];
  const matches: { id: string; title?: string; text?: string; score?: number; source?: string }[] = [];
  for (const containerTag of tags) {
    const out = await api('/v4/search', { method: 'POST', body: { query, containerTag, topK: 5 } });
    matches.push(...(out.matches || []));
  }
  const seen = new Set<string>();
  return matches.filter((match) => {
    const id = String(match.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
}

async function importHistory(days: number) {
  const cfg = await settings();
  const reason = closed(cfg);
  if (reason) return { ok: false, error: reason };
  if (!cfg.features.history) return { ok: false, error: 'Turn on history import first' };
  const rows = await chrome.history.search({ text: '', startTime: Date.now() - days * 86_400_000, maxResults: 1000 });
  let queued = 0;
  for (const row of rows) {
    if (!row.url || !/^https?:/i.test(row.url)) continue;
    if (isBlocked(row.url, policy(cfg))) continue;
    await storeDraft(cfg, { title: row.title || row.url, url: row.url, captureType: 'history', body: `${row.title || ''}\n${row.url}`, sourceRef: historyKey(row.url), container: cfg.containerTag });
    queued += 1;
  }
  await flush();
  return { ok: true, queued };
}

async function importBookmarks() {
  const cfg = await settings();
  const reason = closed(cfg);
  if (reason) return { ok: false, error: reason };
  const tree = await chrome.bookmarks.getTree();
  const flat: { title: string; url: string }[] = [];
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of nodes) {
      if (node.url) flat.push({ title: node.title || node.url, url: node.url });
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  let queued = 0;
  for (const row of flat) {
    if (isBlocked(row.url, policy(cfg))) continue;
    await storeDraft(cfg, { title: row.title, url: row.url, captureType: 'bookmark', body: `${row.title}\n${row.url}`, sourceRef: bookmarkKey(row.url), container: cfg.containerTag });
    queued += 1;
  }
  await flush();
  return { ok: true, queued };
}

function gate(message: Record<string, unknown>) {
  return settings().then((cfg) => {
    const url = String(message.url || '');
    const open = !closed(cfg);
    const kind = String(message.kind || '');
    if (kind === 'read') {
      return { highlights: open && cfg.features.highlights && !isBlocked(url, policy(cfg)), autoRead: open && cfg.features.autoRead && !isBlocked(url, policy(cfg)) };
    }
    if (kind === 'gmail') return { gmail: open && cfg.features.gmail && !isBlocked(url, policy(cfg), 'gmail'), gmailImportant: cfg.features.gmailImportant };
    if (kind === 'gmail-auto') {
      return { ok: open && cfg.features.gmail && cfg.features.gmailImportant, senders: cfg.gmailSenders, labels: cfg.gmailLabels };
    }
    if (kind === 'canvas') {
      return { canvas: open && cfg.features.canvas && !isBlocked(url, policy(cfg), 'canvas'), includeGrades: cfg.features.canvasGrades, auto: cfg.features.canvasAuto };
    }
    if (kind === 'x') {
      return { x: open && cfg.features.x && !isBlocked(url, policy(cfg), 'x'), auto: cfg.features.xAuto, thread: cfg.features.xThread, messages: cfg.features.xMessages };
    }
    if (kind === 'ai') return { ai: open && cfg.features.aiChat && !isBlocked(url, policy(cfg)) };
    return { ok: false };
  });
}

function menus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-selection', title: 'Save to Rukmer', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Rukmer', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'save-image', title: 'Save image to Rukmer', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'save-page', title: 'Save page to Rukmer', contexts: ['page'] });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  menus();
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
  void chrome.alarms.create('rukmer-flush', { periodInMinutes: 1 });
  void paint();
});
chrome.runtime.onStartup.addListener(() => {
  menus();
  hookBookmarks();
  void settings().then(syncScripts);
  void paint();
  void flush();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'rukmer-flush') void flush();
});
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'save-page') return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    const result = await savePage(tab.id);
    if (!result.ok && result.error) await notice(result.error);
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    const cfg = await settings();
    if (!tab?.id || tab.incognito) return;
    if (info.menuItemId === 'save-page') {
      const result = await savePage(tab.id);
      if (!result.ok && result.error) await notice(result.error);
      return;
    }
    const url = info.menuItemId === 'save-link' ? info.linkUrl || '' : info.menuItemId === 'save-image' ? info.srcUrl || '' : info.pageUrl || tab.url || '';
    const linkText = (info as chrome.contextMenus.OnClickData & { linkText?: string }).linkText || '';
    const text = info.menuItemId === 'save-selection' ? info.selectionText || '' : info.menuItemId === 'save-link' ? `${linkText}\n${info.linkUrl || ''}` : info.menuItemId === 'save-image' ? `Image: ${info.srcUrl || ''}` : '';
    const result = await saveFromMessage({ kind: 'manual', title: info.menuItemId === 'save-selection' ? 'Highlight' : tab.title || url, url, text }, { tab });
    if (!result.ok && result.error) await notice(result.error);
    void cfg;
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const type = String(message?.type || '');
    if (type === 'status') {
      const current = await auth();
      const cfg = await settings();
      return { connected: !!current, browser: current?.browser || '', settings: cfg, recent: await recent(), notice: await localGet<string>(NOTICE, ''), queue: (await queue()).length };
    }
    if (type === 'connect') return connect();
    if (type === 'claim') return claim(String(message.code || ''));
    if (type === 'signout') return signOut();
    if (type === 'use-key') return useKey(String(message.key || ''));
    if (type === 'settings') {
      const next = mergeSettings(message.settings);
      await chrome.storage.local.set({ [SETTINGS]: next });
      await syncScripts(next);
      hookBookmarks();
      await paint();
      return { ok: true, settings: next };
    }
    if (type === 'gate') return gate(message);
    if (type === 'capture') {
      if (message.url) await chrome.storage.local.set({ [ACTIVE]: { title: message.title || '', url: message.url } });
      return saveFromMessage(message, sender);
    }
    if (type === 'save-page') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'No active tab' };
      return savePage(tab.id);
    }
    if (type === 'search') return { matches: await search(String(message.query || '')) };
    if (type === 'related') {
      const active = await localGet<{ title?: string; url?: string } | null>(ACTIVE, null);
      const query = active?.title || active?.url || '';
      if (!query) return { matches: [], page: active };
      return { matches: await search(query), page: active };
    }
    if (type === 'delete' || type === 'undo') {
      const id = String(message.id || '');
      const out = await api(`/v4/memories?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const items = (await recent()).filter((row) => row.id !== id);
      await chrome.storage.local.set({ [RECENT]: items });
      return out;
    }
    if (type === 'history') return importHistory(Number(message.days || (await settings()).historyDays));
    if (type === 'bookmarks') return importBookmarks();
    if (type === 'export') return api('/v4/connectors/browser?full=1');
    if (type === 'forget-browser') return api('/v4/connectors/browser/forget', { method: 'POST', body: { confirm: 'forget-browser' } });
    if (type === 'clear-notice') {
      await chrome.storage.local.remove(NOTICE);
      return { ok: true };
    }
    return { ok: false, error: 'Unknown request' };
  };
  run().then(sendResponse).catch((err: Error) => sendResponse({ ok: false, error: err.message || 'Something went wrong' }));
  return true;
});

hookBookmarks();
void paint();
void flush();
