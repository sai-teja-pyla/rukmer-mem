export class RukmerClient {
  constructor(private opts: { baseUrl: string; apiKey?: string }) {}

  search(query: string) {
    return this.call('/v4/search', { query });
  }

  add(text: string, title?: string) {
    return this.call('/v3/documents', { text, title: title || text.slice(0, 80), source: 'cli' });
  }

  profile() {
    return this.call('/v4/profile', undefined, 'GET');
  }

  private async call(path: string, body?: unknown, method = 'POST') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || `Rukmer ${res.status}`);
    return data;
  }
}
