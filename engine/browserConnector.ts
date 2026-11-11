import crypto from 'crypto';
import { getState, sha } from './core.js';
import { canRead, eraseMemory } from './governance.js';
import { issueBrowserKey } from './oauth.js';

function browserOf(name: string, fallback = '') {
  const raw = String(name || fallback || '').replace(/^Browser\s+/i, '').trim();
  if (raw === 'Chrome' || raw === 'Edge' || raw === 'Brave' || raw === 'Chromium') return raw;
  return fallback || 'Chromium';
}

export function browserConnectorView(uid: string, full = false) {
  const state = getState();
  const keys = state.apiKeys.filter((key) => key.ownerUid === uid && key.connector === 'browser');
  const docs = state.documents.filter((doc) => !doc.forgotten && doc.source === 'browser-extension' && canRead(uid, doc));
  const byName = new Map<string, { name: string; lastSync: string | null; items: number; connected: boolean }>();
  const touch = (name: string, at: string | null, items: number, connected: boolean) => {
    const label = browserOf(name);
    const row = byName.get(label) || { name: label, lastSync: null, items: 0, connected: false };
    row.items += items;
    row.connected = row.connected || connected;
    if (at && (!row.lastSync || at > row.lastSync)) row.lastSync = at;
    byName.set(label, row);
  };
  for (const key of keys) touch(key.name, key.lastUsed, 0, true);
  const sites = { gmail: 0, canvas: 0, x: 0, browser: 0 };
  let lastSync: string | null = null;
  for (const doc of docs) {
    const name = browserOf(doc.metadata?.browser || '', 'Chromium');
    const at = doc.metadata?.captured_at || doc.createdAt;
    touch(name, at, 1, false);
    const site = doc.metadata?.site;
    if (site === 'gmail' || site === 'canvas' || site === 'x') sites[site] += 1;
    else sites.browser += 1;
    if (!lastSync || at > lastSync) lastSync = at;
  }
  for (const key of keys) {
    if (key.lastUsed && (!lastSync || key.lastUsed > lastSync)) lastSync = key.lastUsed;
  }
  return {
    connected: keys.length > 0,
    items: docs.length,
    lastSync,
    browsers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sites,
    documents: full
      ? docs.slice(0, 500).map((doc) => ({
          id: doc.id,
          title: doc.title,
          containerTag: doc.containerTag,
          createdAt: doc.createdAt,
          metadata: doc.metadata || {},
          text: String(doc.text || '').slice(0, 20000),
        }))
      : undefined,
  };
}

export function createBrowserPair(uid: string) {
  const code = crypto.randomBytes(24).toString('hex');
  const state = getState();
  const now = Date.now();
  const current = Array.isArray(state.browserPairs) ? state.browserPairs : [];
  state.browserPairs = current.filter((row) => row.exp > now && row.uid !== uid);
  state.browserPairs.push({ hash: sha(code), uid, exp: now + 2 * 60 * 1000 });
  return { code, expiresIn: 120 };
}

export async function claimBrowserPair(code: string, browser: string) {
  const state = getState();
  const hash = sha(String(code || '').trim());
  const pairs = state.browserPairs || [];
  const index = pairs.findIndex((row) => row.hash === hash);
  const rec = index >= 0 ? pairs[index] : undefined;
  if (index >= 0) pairs.splice(index, 1);
  state.browserPairs = pairs;
  if (!rec || rec.exp < Date.now() || !rec.uid) return null;
  const label = browser === 'Chrome' || browser === 'Edge' || browser === 'Brave' ? browser : 'Chromium';
  return issueBrowserKey(rec.uid, label);
}

export function forgetBrowserMemories(uid: string) {
  const docs = getState().documents.filter((doc) => !doc.forgotten && doc.source === 'browser-extension' && canRead(uid, doc));
  let removed = 0;
  for (const doc of docs) {
    const out = eraseMemory(uid, doc.id);
    if (out.ok) removed += out.removed;
  }
  return { ok: true, removed };
}
