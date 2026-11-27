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

  injectStable(query: string, sessionId: string, extra: Record<string, unknown> = {}) {
    return this.call('/v4/inject', { query, sessionId, ...extra });
  }

  listDocuments(cursor = '', limit = 50) {
    return this.call('/v3/documents/list', { cursor, limit });
  }

  listMemories(cursor = '', limit = 50) {
    return this.call(`/v4/memories?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, undefined, 'GET');
  }

  listChunks(docId: string, cursor = '', limit = 50) {
    return this.call(`/v4/chunks?docId=${encodeURIComponent(docId)}&cursor=${encodeURIComponent(cursor)}&limit=${limit}`, undefined, 'GET');
  }

  listEntities(cursor = '', limit = 50, sort = 'degree') {
    return this.call(`/v4/entities?cursor=${encodeURIComponent(cursor)}&limit=${limit}&sort=${sort}`, undefined, 'GET');
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
