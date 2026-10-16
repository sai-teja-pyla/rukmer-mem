import { assertPublicHttpUrl, ingestDocument, ingestUrl } from './pipeline.js';

type ImportInput = {
  provider: string;
  containerTag: string;
  token?: string;
  url?: string;
};

export async function importConnector(input: ImportInput) {
  const provider = input.provider.toLowerCase();
  const tag = input.containerTag;
  if (!tag) throw Object.assign(new Error('containerTag required'), { status: 400 });
  if (provider === 'web' || provider === 'crawler') {
    if (!input.url) throw Object.assign(new Error('url required'), { status: 400 });
    const out = await ingestUrl(input.url, tag, 'rag');
    return { provider, imported: 1, ids: [out.document.id] };
  }
  if (provider === 's3') {
    if (!input.url) throw Object.assign(new Error('Pass a presigned https URL. Secrets are not stored.'), { status: 400 });
    const safe = assertPublicHttpUrl(input.url);
    const res = await fetch(safe);
    if (!res.ok) throw Object.assign(new Error(`S3 fetch failed ${res.status}`), { status: 400 });
    const text = (await res.text()).slice(0, 200000);
    const out = await ingestDocument({ title: safe.split('/').pop() || 's3-object', text, containerTag: tag, source: 's3', mime: 'text/plain' });
    return { provider, imported: 1, ids: [out.document.id] };
  }
  if (provider === 'github') {
    const token = String(input.token || '').trim();
    if (token.length < 20) throw Object.assign(new Error('GitHub token required. It is used once and not stored.'), { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rukmer' };
    const repos = await ghJson('https://api.github.com/user/repos?per_page=5&sort=updated', headers);
    const ids: string[] = [];
    for (const repo of Array.isArray(repos) ? repos.slice(0, 5) : []) {
      const name = String(repo.full_name || '');
      if (!name.includes('/')) continue;
      const readme = await fetch(`https://api.github.com/repos/${name}/readme`, { headers: { ...headers, Accept: 'application/vnd.github.raw' } });
      if (!readme.ok) continue;
      const text = (await readme.text()).slice(0, 80000);
      if (!text.trim()) continue;
      const out = await ingestDocument({ title: name, text, containerTag: tag, source: 'github', mime: 'text/markdown', task: 'rag' });
      ids.push(out.document.id);
    }
    return { provider, imported: ids.length, ids };
  }
  if (provider === 'notion') {
    const token = String(input.token || '').trim();
    if (token.length < 20) throw Object.assign(new Error('Notion integration token required. It is used once and not stored.'), { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
    const found = (await ghJson('https://api.notion.com/v1/search', headers, { page_size: 5 })) as { results?: { id: string; properties?: unknown }[] };
    const ids: string[] = [];
    for (const page of Array.isArray(found?.results) ? found.results.slice(0, 5) : []) {
      const title = notionTitle(page) || 'Notion page';
      const blocks = (await ghJson(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=40`, headers)) as { results?: unknown[] };
      const text = [title, ...(Array.isArray(blocks?.results) ? blocks.results.map(notionText) : [])].filter(Boolean).join('\n').slice(0, 80000);
      if (!text.trim()) continue;
      const out = await ingestDocument({ title, text, containerTag: tag, source: 'notion', mime: 'text/plain', task: 'rag' });
      ids.push(out.document.id);
    }
    return { provider, imported: ids.length, ids };
  }
  throw Object.assign(new Error('Unknown connector'), { status: 400 });
}

async function ghJson(url: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw Object.assign(new Error(`Connector request failed ${res.status}`), { status: 400 });
  return res.json();
}

function notionTitle(page: any) {
  const props = page?.properties || {};
  for (const value of Object.values(props) as any[]) {
    if (value?.type === 'title' && Array.isArray(value.title)) return value.title.map((t: any) => t.plain_text || '').join('');
  }
  return '';
}

function notionText(block: any) {
  const rich = block?.[block.type]?.rich_text;
  if (!Array.isArray(rich)) return '';
  return rich.map((t: any) => t.plain_text || '').join('');
}
