import crypto from 'crypto';
import type { Express } from 'express';
import { getState, saveState, sha, uid, type TeamInviteRec } from './core.js';
import { audit, isTeamMember, teamContainer } from './governance.js';
import { isProduction } from './security.js';
import { activeTeamMember, homeTag, orgTag, slugPart } from './tenancy.js';
import { createOrg } from './scopes.js';

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EMOJI = [
  '🦊', '🚀', '🌵', '🎈', '🍋', '🔔', '🌙', '🐙', '🌻', '🎯', '🧊', '🐝', '🌈', '🍀', '🦉', '🎸',
  '🪐', '🍉', '🧸', '⚡️', '🦋', '🧀', '🐢', '🎲', '🌊', '🔥', '🌺', '🐧', '🍩', '🪄', '🦄', '🍓',
  '🥥', '🎹', '🪴', '🪁', '🥐', '🦚', '🔮', '🍯', '🦓', '🎺', '🍄', '🪁', '🫐', '🦦', '🎻', '🌮',
  '🌸', '🐬', '🥨', '🌙', '🦔', '🥁', '🍒', '🦙', '🧿', '🍿', '🦢', '🧩', '🍈', '🦜', '🧭', '🧃',
];

const badCodes = new Map<string, { fails: number; lockedUntil: number }>();

function hashSecret(value: string) {
  return sha(String(value || '').trim());
}

function codeValue() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function sasFor(inviteId: string, inviterKey: string, inviteeKey: string) {
  const digest = crypto.createHash('sha256').update(`${inviteId}|${inviterKey}|${inviteeKey}`).digest();
  let bits = 0n;
  for (const byte of digest.subarray(0, 5)) bits = (bits << 8n) + BigInt(byte);
  const emoji: string[] = [];
  const digits: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const index = Number((bits >> BigInt(i * 6)) & 63n);
    emoji.push(EMOJI[index] || EMOJI[0]);
    digits.push(String(digest[5 + i] % 10));
  }
  return { sas: emoji.join(''), sasDigits: digits.join('') };
}

function inviteByHash(tokenOrCode: string) {
  const hashed = hashSecret(tokenOrCode);
  return getState().teamInvites.find((row) => row.tokenHash === hashed || row.codeHash === hashed);
}

function freshInvite(invite: TeamInviteRec) {
  if (invite.status === 'revoked' || invite.status === 'confirmed') return false;
  if (Date.parse(invite.expiresAt) <= Date.now()) {
    invite.status = 'expired';
    return false;
  }
  return invite.status === 'pending' || invite.status === 'accepted';
}

function memberView(teamId: string) {
  return getState()
    .teamMembers.filter((row) => row.teamId === teamId && row.status !== 'removed')
    .map((row) => ({
      uid: row.uid,
      displayName: row.displayName || row.uid,
      email: row.email || '',
      role: row.role,
      joinedAt: row.joinedAt,
      lastActiveAt: row.lastActiveAt || '',
    }));
}

export function listMyTeams(actor: string) {
  const state = getState();
  const teams = state.teams.filter((team) => !team.archivedAt && isTeamMember(actor, team.id));
  return {
    teams: teams.map((team) => ({
      ...team,
      tag: teamContainer(team.id),
      members: memberView(team.id),
      invites: state.teamInvites
        .filter((invite) => invite.teamId === team.id && (invite.status === 'pending' || invite.status === 'accepted'))
        .map((invite) => ({ id: invite.id, role: invite.role, status: invite.status, expiresAt: invite.expiresAt, sas: invite.sas || '' })),
    })),
  };
}

export function bootstrapTeam(actor: string, orgName: string, displayName?: string) {
  const state = getState();
  const name = String(displayName || actor).slice(0, 80);
  let org = state.orgs.find((row) => state.orgMembers.some((member) => member.orgId === row.id && member.uid === actor && member.role === 'owner' && member.status !== 'removed'));
  if (!org) {
    org = createOrg(actor, orgName || 'Rukmer');
  }
  let team = state.teams.find((row) => row.orgId === org!.id && row.kind === 'general' && !row.archivedAt);
  if (!team) {
    team = {
      id: uid('team'),
      name: 'General',
      tenantId: org.id,
      orgId: org.id,
      kind: 'general',
      slug: 'general',
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    state.teams.push(team);
  }
  const existing = state.teamMembers.find((row) => row.teamId === team!.id && row.uid === actor);
  if (!existing) {
    state.teamMembers.push({ teamId: team.id, uid: actor, role: 'owner', status: 'active', joinedAt: team.createdAt, displayName: name });
  } else {
    existing.status = 'active';
    existing.role = existing.role || 'owner';
    if (name) existing.displayName = name;
  }
  const orgMember = state.orgMembers.find((row) => row.orgId === org!.id && row.uid === actor);
  if (orgMember) {
    orgMember.status = 'active';
    if (!orgMember.joinedAt) orgMember.joinedAt = team.createdAt;
  }
  audit({ actorId: actor, action: 'retain', memoryId: team.id, tenantId: org.id, detail: 'team-bootstrap result=ok' });
  saveState();
  return { org, team, tag: teamContainer(team.id) };
}

export function createCustomSpace(actor: string, orgId: string, slug: string, name?: string) {
  const state = getState();
  const org = state.orgs.find((row) => row.id === orgId);
  const admin = state.orgMembers.find((row) => row.orgId === orgId && row.uid === actor && row.status !== 'removed' && (row.role === 'owner' || row.role === 'admin'));
  if (!org || !admin) throw Object.assign(new Error('Org admin required'), { status: 403 });
  const clean = slugPart(slug);
  if (!['marketing', 'tech', 'founders'].includes(clean)) throw Object.assign(new Error('Unknown space'), { status: 400 });
  const existing = state.teams.find((row) => row.orgId === orgId && row.slug === clean && !row.archivedAt);
  if (existing) return { team: existing, tag: teamContainer(existing.id) };
  const team = {
    id: uid('team'),
    name: String(name || clean).slice(0, 80),
    tenantId: orgId,
    orgId,
    kind: 'custom' as const,
    slug: clean,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };
  state.teams.push(team);
  const role = clean === 'founders' ? 'owner' : admin.role === 'admin' ? 'admin' : 'owner';
  state.teamMembers.push({ teamId: team.id, uid: actor, role: role === 'admin' ? 'admin' : 'owner', status: 'active', joinedAt: team.createdAt, displayName: actor });
  audit({ actorId: actor, action: 'retain', memoryId: team.id, tenantId: orgId, detail: `space:${clean} result=ok` });
  saveState();
  return { team, tag: teamContainer(team.id) };
}

function qrSvg(text: string) {
  const digest = crypto.createHash('sha256').update(text).digest();
  const cells = [...digest].slice(0, 64).map((byte, index) => {
    const x = (index % 8) * 8;
    const y = Math.floor(index / 8) * 8;
    return byte % 2 ? `<rect x="${x}" y="${y}" width="8" height="8" fill="#111"/>` : '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Invite code">${cells.join('')}</svg>`;
}

export function createInvite(actor: string, teamId: string, role: 'admin' | 'member' = 'member', publicKey = '') {
  const state = getState();
  const team = state.teams.find((row) => row.id === teamId && !row.archivedAt);
  const member = activeTeamMember(actor, teamId);
  if (!team || !member || (member.role !== 'owner' && member.role !== 'admin')) {
    throw Object.assign(new Error('Only an owner or admin can invite'), { status: 403 });
  }
  if (team.slug === 'founders' && role !== 'owner') throw Object.assign(new Error('Founders space is owners only'), { status: 403 });
  const token = crypto.randomBytes(32).toString('base64url');
  const code = codeValue();
  const invite: TeamInviteRec = {
    id: uid('inv'),
    teamId,
    orgId: team.orgId || team.tenantId,
    createdBy: actor,
    tokenHash: hashSecret(token),
    codeHash: hashSecret(code),
    role: role === 'admin' ? 'admin' : 'member',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    maxUses: 1,
    status: 'pending',
    inviterKey: publicKey || undefined,
    createdAt: new Date().toISOString(),
  };
  state.teamInvites.push(invite);
  audit({ actorId: actor, action: 'invite', memoryId: invite.id, tenantId: invite.orgId, detail: `team:${teamId} result=ok` });
  saveState();
  const inviteUrl = `https://app.rukmer.com/join/${token}`;
  return { id: invite.id, inviteUrl, token, code, qrSvg: qrSvg(inviteUrl), expiresAt: invite.expiresAt, teamName: team.name };
}

function lockout(inviteId: string) {
  const row = badCodes.get(inviteId);
  if (row && row.lockedUntil > Date.now()) throw Object.assign(new Error('Too many attempts. Try again later.'), { status: 429 });
}

function noteBadCode(inviteId: string) {
  const row = badCodes.get(inviteId) || { fails: 0, lockedUntil: 0 };
  row.fails += 1;
  if (row.fails >= 5) row.lockedUntil = Date.now() + 15 * 60 * 1000;
  badCodes.set(inviteId, row);
}

export function acceptInvite(actor: string, tokenOrCode: string, publicKey: string, email = '', inviteId = '') {
  const state = getState();
  const invite = (inviteId ? state.teamInvites.find((row) => row.id === inviteId) : undefined) || inviteByHash(tokenOrCode);
  if (!invite || !freshInvite(invite)) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  lockout(invite.id);
  const presented = hashSecret(tokenOrCode);
  if (!tokenOrCode || (presented !== invite.tokenHash && presented !== invite.codeHash)) {
    noteBadCode(invite.id);
    saveState();
    throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  }
  if (invite.createdBy === actor) throw Object.assign(new Error('You cannot accept your own invite'), { status: 400 });
  if (isTeamMember(actor, invite.teamId)) throw Object.assign(new Error('Already a member'), { status: 400 });
  if (invite.inviteeUid && invite.inviteeUid !== actor) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  invite.inviteeUid = actor;
  invite.inviteeEmail = email || invite.inviteeEmail;
  invite.inviteeKey = publicKey || invite.inviteeKey || actor;
  invite.status = 'accepted';
  const team = state.teams.find((row) => row.id === invite.teamId);
  const inviter = state.teamMembers.find((row) => row.teamId === invite.teamId && row.uid === invite.createdBy);
  if (invite.inviterKey && invite.inviteeKey) {
    const sas = sasFor(invite.id, invite.inviterKey, invite.inviteeKey);
    invite.sas = sas.sas;
    invite.sasDigits = sas.sasDigits;
  }
  saveState();
  return { id: invite.id, sas: invite.sas || '', sasDigits: invite.sasDigits || '', teamName: team?.name || 'Team', inviterName: inviter?.displayName || invite.createdBy };
}

export function readInvite(actor: string, id: string) {
  const invite = getState().teamInvites.find((row) => row.id === id);
  if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
  if (invite.createdBy !== actor && invite.inviteeUid !== actor) throw Object.assign(new Error('Invite not found'), { status: 404 });
  freshInvite(invite);
  return { id: invite.id, status: invite.status, sas: invite.sas || '', sasDigits: invite.sasDigits || '', teamId: invite.teamId };
}

export function confirmInvite(actor: string, id: string, match: boolean, publicKey = '') {
  const state = getState();
  const invite = state.teamInvites.find((row) => row.id === id);
  if (!invite || !freshInvite(invite)) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  if (invite.createdBy !== actor && invite.inviteeUid !== actor) throw Object.assign(new Error('Invite is not valid'), { status: 403 });
  if (!match) {
    invite.status = 'revoked';
    audit({ actorId: actor, action: 'revoke', memoryId: invite.id, tenantId: invite.orgId, detail: 'sas-mismatch' });
    saveState();
    return { status: 'revoked' };
  }
  if (actor === invite.createdBy && publicKey) invite.inviterKey = publicKey;
  if (actor === invite.inviteeUid && publicKey) invite.inviteeKey = publicKey;
  if (invite.inviterKey && invite.inviteeKey && !invite.sas) {
    const sas = sasFor(invite.id, invite.inviterKey, invite.inviteeKey);
    invite.sas = sas.sas;
    invite.sasDigits = sas.sasDigits;
  }
  const now = new Date().toISOString();
  if (actor === invite.createdBy) invite.inviterConfirmedAt = now;
  if (actor === invite.inviteeUid) invite.inviteeConfirmedAt = now;
  if (invite.inviterConfirmedAt && invite.inviteeConfirmedAt && invite.inviteeUid) {
    invite.status = 'confirmed';
    const team = state.teams.find((row) => row.id === invite.teamId);
    if (team?.slug === 'founders' && invite.role !== 'owner') {
      invite.status = 'revoked';
      saveState();
      throw Object.assign(new Error('Founders space is owners only'), { status: 403 });
    }
    if (!state.teamMembers.some((row) => row.teamId === invite.teamId && row.uid === invite.inviteeUid && row.status !== 'removed')) {
      state.teamMembers.push({
        teamId: invite.teamId,
        uid: invite.inviteeUid,
        role: invite.role,
        status: 'active',
        joinedAt: now,
        displayName: invite.inviteeUid,
        email: invite.inviteeEmail,
      });
    }
    if (invite.orgId && !state.orgMembers.some((row) => row.orgId === invite.orgId && row.uid === invite.inviteeUid && row.status !== 'removed')) {
      state.orgMembers.push({ orgId: invite.orgId, uid: invite.inviteeUid, role: 'member', status: 'active', joinedAt: now });
    }
    audit({ actorId: actor, action: 'join', memoryId: invite.teamId, tenantId: invite.orgId, detail: `member:${invite.inviteeUid} result=ok` });
  }
  saveState();
  return { status: invite.status, sas: invite.sas || '' };
}

export function revokeInvite(actor: string, id: string) {
  const invite = getState().teamInvites.find((row) => row.id === id);
  if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
  const member = activeTeamMember(actor, invite.teamId);
  if (invite.createdBy !== actor && member?.role !== 'owner' && member?.role !== 'admin') {
    throw Object.assign(new Error('Only an owner or admin can revoke'), { status: 403 });
  }
  invite.status = 'revoked';
  audit({ actorId: actor, action: 'revoke', memoryId: invite.id, tenantId: invite.orgId, detail: 'invite-revoked result=ok' });
  saveState();
  return { status: 'revoked' };
}

export function removeMember(actor: string, teamId: string, memberUid: string) {
  const state = getState();
  const actorMember = activeTeamMember(actor, teamId);
  if (!actorMember || (actorMember.role !== 'owner' && actorMember.role !== 'admin')) {
    throw Object.assign(new Error('Only an owner or admin can remove members'), { status: 403 });
  }
  const target = state.teamMembers.find((row) => row.teamId === teamId && row.uid === memberUid && row.status !== 'removed');
  if (!target) throw Object.assign(new Error('Member not found'), { status: 404 });
  const owners = state.teamMembers.filter((row) => row.teamId === teamId && row.role === 'owner' && row.status !== 'removed');
  if (target.role === 'owner' && owners.length < 2) throw Object.assign(new Error('The last owner cannot be removed'), { status: 400 });
  target.status = 'removed';
  target.removedAt = new Date().toISOString();
  const team = state.teams.find((row) => row.id === teamId);
  audit({ actorId: actor, action: 'revoke', memoryId: teamId, tenantId: team?.orgId || homeTag(actor), detail: `removed:${memberUid} result=ok` });
  saveState();
  return { removed: memberUid };
}

export function leaveTeam(actor: string, teamId: string) {
  const state = getState();
  const member = state.teamMembers.find((row) => row.teamId === teamId && row.uid === actor && row.status !== 'removed');
  if (!member) throw Object.assign(new Error('Not a member'), { status: 404 });
  const owners = state.teamMembers.filter((row) => row.teamId === teamId && row.role === 'owner' && row.status !== 'removed');
  if (member.role === 'owner' && owners.length < 2) throw Object.assign(new Error('The last owner cannot leave'), { status: 400 });
  member.status = 'removed';
  member.removedAt = new Date().toISOString();
  const team = state.teams.find((row) => row.id === teamId);
  audit({ actorId: actor, action: 'leave', memoryId: teamId, tenantId: team?.orgId || homeTag(actor), detail: 'left result=ok' });
  saveState();
  return { left: teamId };
}

export function setMemberRole(actor: string, teamId: string, memberUid: string, role: 'owner' | 'admin' | 'member') {
  const actorMember = activeTeamMember(actor, teamId);
  if (!actorMember || actorMember.role !== 'owner') throw Object.assign(new Error('Only an owner can change roles'), { status: 403 });
  const team = getState().teams.find((row) => row.id === teamId);
  if (team?.slug === 'founders' && role !== 'owner') throw Object.assign(new Error('Founders space is owners only'), { status: 403 });
  const target = getState().teamMembers.find((row) => row.teamId === teamId && row.uid === memberUid && row.status !== 'removed');
  if (!target) throw Object.assign(new Error('Member not found'), { status: 404 });
  const owners = getState().teamMembers.filter((row) => row.teamId === teamId && row.role === 'owner' && row.status !== 'removed');
  if (target.role === 'owner' && role !== 'owner' && owners.length < 2) throw Object.assign(new Error('The last owner cannot change role'), { status: 400 });
  target.role = role;
  audit({ actorId: actor, action: 'retain', memoryId: teamId, tenantId: team?.orgId || '', detail: `role:${memberUid}:${role} result=ok` });
  saveState();
  return { uid: memberUid, role };
}

function uidOf(req: { memoryUser?: { uid?: string } }) {
  const uid = req.memoryUser?.uid || '';
  if (!uid) throw Object.assign(new Error('Sign in required'), { status: 401 });
  return uid;
}

export function mountTeamRoutes(app: Express) {
  app.post('/v4/teams/bootstrap', (req, res) => {
    try {
      res.json(bootstrapTeam(uidOf(req), String(req.body?.orgName || 'Rukmer'), req.body?.displayName));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not create the team' });
    }
  });
  app.get('/v4/teams', (req, res) => {
    try {
      res.json(listMyTeams(uidOf(req)));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not list teams' });
    }
  });
  app.post('/v4/teams/spaces', (req, res) => {
    try {
      res.json(createCustomSpace(uidOf(req), String(req.body?.orgId || ''), String(req.body?.slug || ''), req.body?.name));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not create the space' });
    }
  });
  app.post('/v4/teams/:teamId/invites', (req, res) => {
    try {
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      res.json(createInvite(uidOf(req), String(req.params.teamId || ''), role, String(req.body?.publicKey || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not create the invite' });
    }
  });
  app.post('/v4/teams/invites/accept', (req, res) => {
    try {
      const token = String(req.body?.token || req.body?.code || '');
      res.json(acceptInvite(uidOf(req), token, String(req.body?.publicKey || ''), String(req.body?.email || ''), String(req.body?.id || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not accept the invite' });
    }
  });
  app.get('/v4/teams/invites/:id', (req, res) => {
    try {
      res.json(readInvite(uidOf(req), String(req.params.id || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Invite not found' });
    }
  });
  app.post('/v4/teams/invites/:id/confirm', (req, res) => {
    try {
      res.json(confirmInvite(uidOf(req), String(req.params.id || ''), req.body?.match !== false, String(req.body?.publicKey || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not confirm' });
    }
  });
  app.delete('/v4/teams/invites/:id', (req, res) => {
    try {
      res.json(revokeInvite(uidOf(req), String(req.params.id || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not revoke' });
    }
  });
  app.post('/v4/teams/:teamId/members/:memberUid/remove', (req, res) => {
    try {
      res.json(removeMember(uidOf(req), String(req.params.teamId || ''), String(req.params.memberUid || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not remove the member' });
    }
  });
  app.post('/v4/teams/:teamId/leave', (req, res) => {
    try {
      res.json(leaveTeam(uidOf(req), String(req.params.teamId || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not leave' });
    }
  });
  app.patch('/v4/teams/:teamId/members/:memberUid', (req, res) => {
    try {
      const role = req.body?.role === 'owner' || req.body?.role === 'admin' ? req.body.role : 'member';
      res.json(setMemberRole(uidOf(req), String(req.params.teamId || ''), String(req.params.memberUid || ''), role));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not change the role' });
    }
  });
  if (!isProduction()) {
    /* raw uid routes stay available outside production */
  }
}

export function orgTagForName(name: string) {
  return orgTag(slugPart(name) || 'rukmer');
}
