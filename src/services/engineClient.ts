import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { requestJson } from './engineRetry';

const base = '';

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

let tokenCache: { uid: string; token: string; expiresAt: number } | null = null;

async function authHeaders(forceToken = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = (await waitForAuth()) || auth.currentUser;
  if (user) {
    try {
      const fresh = forceToken || !tokenCache || tokenCache.uid !== user.uid || Date.now() >= tokenCache.expiresAt - 60000;
      const token = fresh ? await user.getIdToken(forceToken) : tokenCache!.token;
      if (fresh) tokenCache = { uid: user.uid, token, expiresAt: Date.now() + 3540000 };
      headers.Authorization = `Bearer ${token}`;
    } catch {
      tokenCache = null;
    }
    headers['x-rukmer-user'] = user.uid;
  }
  return headers;
}

async function req(path: string, init?: RequestInit): Promise<any> {
  let refreshed = false;
  return requestJson(`${base}${path}`, init, {
    headers: () => authHeaders(refreshed),
    unauthorized: async () => {
      if (refreshed) return false;
      refreshed = true;
      return true;
    },
  });
}

export const engine = {
  health: () => req('/health'),
  security: () => req('/v4/security'),
  me: () => req('/v3/me'),
  ingest: (body: any) => req('/v3/documents', { method: 'POST', body: JSON.stringify(body) }),
  ingestBatch: (body: any) => req('/v3/documents/batch', { method: 'POST', body: JSON.stringify(body) }),
  listDocs: (containerTag?: string) =>
    req('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag }) }),
  forget: (id: string) => req('/v4/memories', { method: 'DELETE', body: JSON.stringify({ id }) }),
  governance: () => req('/v4/governance'),
  setRetention: (body: { ttlDays: number; memoryKind?: string; action?: string; tenantId?: string }) =>
    req('/v4/governance/retention', { method: 'PUT', body: JSON.stringify(body) }),
  getDoc: (id: string) => req(`/v3/documents/${encodeURIComponent(id)}`),
  tags: (scope?: 'all' | 'private' | 'team') => req(`/v3/tags${scope && scope !== 'all' ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  search: (body: any) => req('/v4/search', { method: 'POST', body: JSON.stringify(body) }),
  chat: (body: any) => req('/v4/chat', { method: 'POST', body: JSON.stringify(body) }),
  remember: (body: any) => req('/v4/remember', { method: 'POST', body: JSON.stringify(body) }),
  inject: (body: any) => req('/v4/inject', { method: 'POST', body: JSON.stringify(body) }),
  protocol: () => req('/v4/protocol'),
  tools: () => req('/v4/tools'),
  runTool: (name: string, args: any) => req('/v4/tools/execute', { method: 'POST', body: JSON.stringify({ name, arguments: args }) }),
  graph: (containerTag?: string, scope?: 'all' | 'private' | 'team') => {
    const params = new URLSearchParams();
    if (containerTag) params.set('containerTag', containerTag);
    if (scope && scope !== 'all') params.set('scope', scope);
    const query = params.toString();
    return req(`/v4/graph${query ? `?${query}` : ''}`);
  },
  stats: () => req('/v3/stats'),
  insights: () => req('/v3/insights'),
  jobs: () => req('/v3/jobs'),
  requests: () => req('/v3/requests'),
  setupStatus: () => req('/v3/requests/setup-status'),
  agents: () => req('/v4/agents'),
  patchKey: (id: string, body: { readOnly?: boolean; containerTags?: string[] }) =>
    req(`/v3/keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  requestConnector: (body: { tool: string; useCase: string }) =>
    req('/v4/connectors/request', { method: 'POST', body: JSON.stringify(body) }),
  entities: (query = '') => req(`/v4/entities${query}`),
  keys: (params?: { name?: string; source?: string; creator?: string }) => {
    const q = new URLSearchParams();
    if (params?.name) q.set('name', params.name);
    if (params?.source) q.set('source', params.source);
    if (params?.creator) q.set('creator', params.creator);
    const suffix = q.toString() ? `?${q}` : '';
    return req(`/v3/keys${suffix}`);
  },
  patchAgent: (id: string, body: { readOnly?: boolean; containerTags?: string[] }) =>
    req(`/v3/keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
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
  teams: () => req('/v4/teams'),
  bootstrapTeam: (orgName: string, displayName?: string) =>
    req('/v4/teams/bootstrap', { method: 'POST', body: JSON.stringify({ orgName, displayName }) }),
  createTeamSpace: (orgId: string, slug: string, name?: string) =>
    req('/v4/teams/spaces', { method: 'POST', body: JSON.stringify({ orgId, slug, name }) }),
  createInvite: (teamId: string, role = 'member', options?: { email?: string; multiUse?: boolean; publicKey?: string }) =>
    req(`/v4/teams/${encodeURIComponent(teamId)}/invites`, { method: 'POST', body: JSON.stringify({ role, ...options }) }),
  previewInvite: (token: string) => req('/v4/teams/invites/preview', { method: 'POST', body: JSON.stringify({ token }) }),
  inboxInvites: () => req('/v4/teams/invites/inbox'),
  declineInvite: (id: string) => req(`/v4/teams/invites/${encodeURIComponent(id)}/decline`, { method: 'POST', body: '{}' }),
  resendInvite: (id: string) => req(`/v4/teams/invites/${encodeURIComponent(id)}/resend`, { method: 'POST', body: '{}' }),
  setTeamApproval: (teamId: string, requireApproval: boolean) =>
    req(`/v4/teams/${encodeURIComponent(teamId)}/approval`, { method: 'POST', body: JSON.stringify({ requireApproval }) }),
  approveMember: (teamId: string, uid: string) =>
    req(`/v4/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}/approve`, { method: 'POST', body: '{}' }),
  acceptInvite: (body: { token?: string; code?: string; id?: string; publicKey?: string; email?: string; displayName?: string }) =>
    req('/v4/teams/invites/accept', { method: 'POST', body: JSON.stringify(body) }),
  readInvite: (id: string) => req(`/v4/teams/invites/${encodeURIComponent(id)}`),
  confirmInvite: (id: string, match: boolean, publicKey = '') =>
    req(`/v4/teams/invites/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ match, publicKey }) }),
  revokeInvite: (id: string) => req(`/v4/teams/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  removeTeammate: (teamId: string, uid: string) =>
    req(`/v4/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}/remove`, { method: 'POST', body: '{}' }),
  leaveTeam: (teamId: string) => req(`/v4/teams/${encodeURIComponent(teamId)}/leave`, { method: 'POST', body: '{}' }),
  setTeammateRole: (teamId: string, uid: string, role: string) =>
    req(`/v4/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  moveMemory: (id: string, to: 'private' | 'team', teamId?: string) =>
    req(`/v4/memories/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ to, teamId }) }),
  closeSession: (sessionId: string) => req('/v4/sessions/close', { method: 'POST', body: JSON.stringify({ sessionId }) }),
};
