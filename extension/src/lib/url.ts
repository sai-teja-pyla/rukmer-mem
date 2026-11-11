const SECRET_QUERY = /token|key|code|session|auth|password|secret|sig|signature/i;

export function stripUrl(raw: string) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    const next = new URLSearchParams();
    for (const key of [...url.searchParams.keys()].sort()) {
      for (const value of url.searchParams.getAll(key)) next.append(key, value);
    }
    url.search = next.toString() ? `?${next.toString()}` : '';
    return url.toString();
  } catch {
    return '';
  }
}

export function ownedTag(home: string, requested: string) {
  const root = String(home || '').trim();
  const raw = String(requested || '').trim();
  if (!root) return raw;
  if (raw === root || raw.startsWith(`${root}--`)) return raw;
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return slug ? `${root}--${slug}` : root;
}
