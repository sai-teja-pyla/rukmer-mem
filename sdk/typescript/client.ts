export type RukmerClientOptions = {
  baseUrl: string;
  apiKey?: string;
  user?: string;
};

export class RukmerClient {
  constructor(private opts: RukmerClientOptions) {}

  search(query: string, extra: Record<string, unknown> = {}) {
    return this.call('/v4/search', { query, ...extra });
  }

  add(text: string, extra: Record<string, unknown> = {}) {
    return this.call('/v3/documents', { text, title: extra.title || text.slice(0, 80), ...extra });
  }

  remember(messages: { role: string; content: string }[], extra: Record<string, unknown> = {}) {
    return this.call('/v4/remember', { messages, ...extra });
  }

  profile(extra: Record<string, unknown> = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v != null) q.set(k, String(v));
    const suffix = q.toString() ? `?${q}` : '';
    return this.call(`/v4/profile${suffix}`, undefined, 'GET');
  }

  inject(query: string, extra: Record<string, unknown> = {}) {
    return this.call('/v4/inject', { query, ...extra });
  }

  injectStable(query: string, opts: { sessionId?: string; threadId?: string } & Record<string, unknown> = {}) {
    return this.call('/v4/inject', { query, ...opts });
  }

  listDocuments(opts: { cursor?: string; limit?: number; containerTag?: string } = {}) {
    return this.call('/v3/documents/list', { cursor: opts.cursor || '', limit: opts.limit ?? 50, containerTag: opts.containerTag });
  }

  listMemories(opts: { cursor?: string; limit?: number; containerTag?: string } = {}) {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    q.set('limit', String(opts.limit ?? 50));
    if (opts.containerTag) q.set('containerTag', opts.containerTag);
    return this.call(`/v4/memories?${q}`, undefined, 'GET');
  }

  listChunks(opts: { docId: string; cursor?: string; limit?: number }) {
    const q = new URLSearchParams({ docId: opts.docId, limit: String(opts.limit ?? 50) });
    if (opts.cursor) q.set('cursor', opts.cursor);
    return this.call(`/v4/chunks?${q}`, undefined, 'GET');
  }

  listEntities(opts: { cursor?: string; limit?: number; sort?: string; containerTag?: string } = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), sort: opts.sort || 'degree' });
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.containerTag) q.set('containerTag', opts.containerTag);
    return this.call(`/v4/entities?${q}`, undefined, 'GET');
  }

  private async call(path: string, body?: unknown, method = 'POST') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;
    if (this.opts.user) headers['x-rukmer-user'] = this.opts.user;
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Rukmer ${res.status}`);
    return data;
  }
}
