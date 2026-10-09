export function sanitizeUid(raw: string) {
  const uid = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return '';
  return uid;
}

export function homeTag(uid: string) {
  const id = sanitizeUid(uid);
  if (!id) throw new Error('Missing user');
  return `u_${id}`;
}

export function ownsTag(uid: string, tag: string) {
  const id = sanitizeUid(uid);
  const t = String(tag || '').trim();
  if (!id || !t) return false;
  const home = `u_${id}`;
  return t === home || t.startsWith(`${home}--`);
}

export function projectTag(uid: string, slug: string) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
  if (!s) return homeTag(uid);
  return `${homeTag(uid)}--${s}`;
}

/** Requested tag if the user owns it, otherwise their private home tag. Never a shared default. */
export function resolveOwnedTag(uid: string, requested?: string | null) {
  const t = String(requested || '').trim();
  if (t && ownsTag(uid, t)) return t;
  return homeTag(uid);
}

export function uidFromTag(tag: string) {
  const m = /^u_([A-Za-z0-9_-]+?)(?:--|$)/.exec(String(tag || ''));
  return m?.[1] || '';
}
