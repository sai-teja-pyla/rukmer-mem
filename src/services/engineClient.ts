import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';

const base = '';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let firstAuthUser: Promise<User | null> | null = null;

function waitForAuth() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!firstAuthUser) {
    firstAuthUser = new Promise((resolve) => {
      const stop = onAuthStateChanged(auth, (user) => {
        stop();
        resolve(user);
      });
    });
  }
  return firstAuthUser;
}

async function authHeaders(forceToken = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = (await waitForAuth()) || auth.currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken(forceToken)}`;
    } catch {
      /* token refresh can fail while signed out */
    }
    headers['x-rukmer-user'] = user.uid;
  }
  return headers;
}

async function req(path: string, init?: RequestInit, state: { warming?: number; refreshed?: boolean } = {}): Promise<any> {
  const warming = state.warming || 0;
  const headers = { ...(await authHeaders(!!state.refreshed)), ...((init?.headers as Record<string, string>) || {}) };
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });
  const raw = await res.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(res.ok ? 'Memory engine returned a non-JSON response' : `Memory engine ${res.status}`);
  }
  if (!res.ok && res.status === 503 && data.error === 'warming_up' && warming < 3) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const baseWait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
    await wait(Math.min(baseWait * (warming + 1), 8000));
    return req(path, init, { ...state, warming: warming + 1 });
  }
  if (!res.ok && res.status === 401 && !state.refreshed) {
    await wait(400);
    return req(path, init, { ...state, refreshed: true });
  }
  if (!res.ok) {
    const message = data.error === 'warming_up' ? 'Memory is still warming up. Try again.' : data.error || `Memory engine ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const engine = {
  health: () => req('/health'),
  me: () => req('/v3/me'),
  ingest: (body: any) => req('/v3/documents', { method: 'POST', body: JSON.stringify(body) }),
  ingestBatch: (body: any) => req('/v3/documents/batch', { method: 'POST', body: JSON.stringify(body) }),
  listDocs: (containerTag?: string) =>
    req('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag }) }),
  getDoc: (id: string) => req(`/v3/documents/${encodeURIComponent(id)}`),
  tags: () => req('/v3/tags'),
  search: (body: any) => req('/v4/search', { method: 'POST', body: JSON.stringify(body) }),
  chat: (body: any) => req('/v4/chat', { method: 'POST', body: JSON.stringify(body) }),
  remember: (body: any) => req('/v4/remember', { method: 'POST', body: JSON.stringify(body) }),
  inject: (body: any) => req('/v4/inject', { method: 'POST', body: JSON.stringify(body) }),
  protocol: () => req('/v4/protocol'),
  tools: () => req('/v4/tools'),
  runTool: (name: string, args: any) => req('/v4/tools/execute', { method: 'POST', body: JSON.stringify({ name, arguments: args }) }),
  graph: (containerTag?: string) => req(`/v4/graph${containerTag ? `?containerTag=${encodeURIComponent(containerTag)}` : ''}`),
  stats: () => req('/v3/stats'),
  insights: () => req('/v3/insights'),
  jobs: () => req('/v3/jobs'),
  requests: () => req('/v3/requests'),
  keys: () => req('/v3/keys'),
  createKey: (name: string) => req('/v3/keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeKey: (id: string) => req(`/v3/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  verifyKey: (secret: string) => req('/v3/keys/verify', { method: 'POST', body: JSON.stringify({ secret }) }),
  exportData: () => req('/v3/export'),
  resetAccount: () => req('/v4/account/reset', { method: 'POST', body: JSON.stringify({ confirm: 'reset' }) }),
  oauthCode: (body: any) => req('/oauth/code', { method: 'POST', body: JSON.stringify(body) }),
  models: () => req('/v1/models'),
  complete: (body: any, headers?: Record<string, string>) =>
    req('/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) }),
  importConnector: (body: any) => req('/v4/connectors/import', { method: 'POST', body: JSON.stringify(body) }),
  connectorApps: () => req('/v4/connectors/apps'),
  browserConnector: () => req('/v4/connectors/browser'),
  pairBrowser: () => req('/v4/connectors/browser/pair', { method: 'POST', body: JSON.stringify({}) }),
  disconnectConnector: (app: string) => req('/v4/connectors/disconnect', { method: 'POST', body: JSON.stringify({ app }) }),
  createOrg: (name: string) => req('/v4/orgs', { method: 'POST', body: JSON.stringify({ name }) }),
  closeSession: (sessionId: string) => req('/v4/sessions/close', { method: 'POST', body: JSON.stringify({ sessionId }) }),
};
