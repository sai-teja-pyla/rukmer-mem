import { getState, saveState, uid as newId } from './core.js';
import { agentTag, canAccessTag, homeTag, orgTag, scopeFromTag, sessionTag, slugPart } from './tenancy.js';

export function createOrg(uid: string, name: string) {
  const label = String(name || '').trim().slice(0, 80);
  if (!label) throw Object.assign(new Error('Org name required'), { status: 400 });
  const id = orgTag(slugPart(label) || newId('org').replace(/^org_/, '').slice(0, 12));
  const state = getState();
  if (state.orgs.some((o) => o.id === id)) throw Object.assign(new Error('Org already exists'), { status: 409 });
  const rec = { id, name: label, createdBy: uid, createdAt: new Date().toISOString() };
  state.orgs.push(rec);
  state.orgMembers.push({ orgId: id, uid, role: 'owner' });
  saveState();
  return rec;
}

export function addOrgMember(actorUid: string, orgId: string, memberUid: string) {
  const tag = orgTag(orgId);
  const member = String(memberUid || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(member)) throw Object.assign(new Error('Invalid member'), { status: 400 });
  const state = getState();
  const actor = state.orgMembers.find((m) => m.orgId === tag && m.uid === actorUid);
  if (!actor || actor.role !== 'owner') throw Object.assign(new Error('Only the org owner can add members'), { status: 403 });
  if (!state.orgMembers.some((m) => m.orgId === tag && m.uid === member)) {
    state.orgMembers.push({ orgId: tag, uid: member, role: 'member' });
    saveState();
  }
  return { orgId: tag, uid: member };
}

export function listOrgs(uid: string) {
  const state = getState();
  const ids = new Set(state.orgMembers.filter((m) => m.uid === uid).map((m) => m.orgId));
  return state.orgs.filter((o) => ids.has(o.id));
}

export function closeSession(uid: string, sessionId: string) {
  const tag = sessionTag(uid, sessionId);
  const now = new Date().toISOString();
  const state = getState();
  let closed = 0;
  for (const t of state.triples) {
    if (t.containerTag !== tag || t.isLatest === false) continue;
    t.isLatest = false;
    t.validTo = now;
    closed += 1;
  }
  for (const c of state.chunks) {
    if (c.containerTag === tag) c.forgotten = true;
  }
  for (const d of state.documents) {
    if (d.containerTag === tag) d.forgotten = true;
  }
  saveState();
  return { containerTag: tag, closed };
}

export function scopeTagsFor(
  uid: string,
  input: { containerTag?: string; sessionId?: string; agentId?: string; orgId?: string; union?: boolean }
) {
  const tags = new Set<string>();
  if (input.union) tags.add(homeTag(uid));
  if (input.containerTag && canAccessTag(uid, input.containerTag)) tags.add(input.containerTag);
  if (input.sessionId) tags.add(sessionTag(uid, input.sessionId));
  if (input.agentId) tags.add(agentTag(uid, input.agentId));
  if (input.orgId) {
    const tag = orgTag(input.orgId);
    if (!canAccessTag(uid, tag)) throw Object.assign(new Error('Not a member of this org'), { status: 403 });
    tags.add(tag);
  }
  if (!tags.size && input.containerTag) tags.add(input.containerTag);
  return [...tags];
}

export function scopeOf(tag: string) {
  return scopeFromTag(tag);
}
