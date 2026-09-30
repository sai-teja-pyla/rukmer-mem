const base = '';

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Engine ${res.status}`);
  return data;
}

export const engine = {
  health: () => req('/health'),
  ingest: (body: any) => req('/v3/documents', { method: 'POST', body: JSON.stringify(body) }),
  ingestBatch: (body: any) => req('/v3/documents/batch', { method: 'POST', body: JSON.stringify(body) }),
  listDocs: (containerTag?: string) =>
    req('/v3/documents/list', { method: 'POST', body: JSON.stringify({ containerTag }) }),
  tags: () => req('/v3/tags'),
  search: (body: any) => req('/v4/search', { method: 'POST', body: JSON.stringify(body) }),
  chat: (body: any) => req('/v4/chat', { method: 'POST', body: JSON.stringify(body) }),
  graph: (containerTag?: string) => req(`/v4/graph${containerTag ? `?containerTag=${encodeURIComponent(containerTag)}` : ''}`),
  stats: () => req('/v3/stats'),
  insights: () => req('/v3/insights'),
  jobs: () => req('/v3/jobs'),
  requests: () => req('/v3/requests'),
  keys: () => req('/v3/keys'),
  createKey: (name: string) => req('/v3/keys', { method: 'POST', body: JSON.stringify({ name }) }),
};
