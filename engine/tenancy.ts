import { getState } from './core.js';

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

export function slugPart(raw: string) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

export function sessionTag(uid: string, sessionId: string) {
  const s = slugPart(sessionId);
  if (!s) throw Object.assign(new Error('sessionId required'), { status: 400 });
  return `${homeTag(uid)}--ses--${s}`;
}

export function agentTag(uid: string, agentId: string) {
  const s = slugPart(agentId);
  if (!s) throw Object.assign(new Error('agentId required'), { status: 400 });
  return `${homeTag(uid)}--agt--${s}`;
}

export function orgTag(orgId: string) {
  const raw = String(orgId || '').trim();
  if (raw.startsWith('org_') && /^org_[a-z0-9_-]{1,64}$/.test(raw)) return raw;
  const s = slugPart(raw.replace(/^org_/, ''));
  if (!s) throw Object.assign(new Error('orgId required'), { status: 400 });
  return `org_${s}`;
}

export function scopeFromTag(tag: string): 'user' | 'session' | 'agent' | 'org' {
  if (tag.startsWith('org_')) return 'org';
  if (tag.includes('--ses--')) return 'session';
  if (tag.includes('--agt--')) return 'agent';
  return 'user';
}

export function canAccessTag(uid: string, tag: string) {
  if (ownsTag(uid, tag)) return true;
  if (!tag.startsWith('org_')) return false;
  return getState().orgMembers.some((m) => m.orgId === tag && m.uid === uid);
}

export function resolveScopeTag(
  uid: string,
  input: { containerTag?: string | null; scope?: string | null; sessionId?: string | null; agentId?: string | null; orgId?: string | null }
) {
  const scope = String(input.scope || '').trim();
  if (input.orgId || scope === 'org') {
    if (!input.orgId) throw Object.assign(new Error('orgId required'), { status: 400 });
    const tag = orgTag(input.orgId);
    if (!canAccessTag(uid, tag)) throw Object.assign(new Error('Not a member of this org'), { status: 403 });
    return tag;
  }
  if (input.sessionId || scope === 'session') {
    if (!input.sessionId) throw Object.assign(new Error('sessionId required'), { status: 400 });
    return sessionTag(uid, input.sessionId);
  }
  if (input.agentId || scope === 'agent') {
    if (!input.agentId) throw Object.assign(new Error('agentId required'), { status: 400 });
    return agentTag(uid, input.agentId);
  }
  const requested = String(input.containerTag || '').trim();
  if (requested.startsWith('org_')) {
    if (!canAccessTag(uid, requested)) throw Object.assign(new Error('Not a member of this org'), { status: 403 });
    return requested;
  }
  return resolveOwnedTag(uid, requested);
}
