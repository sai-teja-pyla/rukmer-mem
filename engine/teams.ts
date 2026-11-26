import crypto from 'crypto';
import type { Express } from 'express';
import { getState, saveState, sha, uid, type TeamInviteRec } from './core.js';
import { audit, isTeamMember, teamContainer } from './governance.js';
import { isProduction } from './security.js';
import { activeTeamMember, homeTag, orgTag, slugPart } from './tenancy.js';
import { createOrg } from './scopes.js';
import { sendTeamInviteEmail } from '../src/utils/mailer.js';

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
      displayName: row.displayName && row.displayName !== row.uid ? row.displayName : '',
      email: row.email || '',
      role: row.role,
      status: row.status || 'active',
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
        .map((invite) => ({
          id: invite.id,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          email: invite.inviteeEmail || '',
          sas: invite.sas || '',
          sasDigits: invite.sasDigits || '',
        })),
    })),
  };
}

export function bootstrapTeam(actor: string, orgName: string, displayName?: string) {
  const state = getState();
  const name = String(displayName || actor).slice(0, 80);
  const label = String(orgName || `${name}'s team`).trim().slice(0, 80) || `${name}'s team`;
  const orgMembership = (orgId: string) =>
    state.orgMembers.find((member) => member.orgId === orgId && member.uid === actor && member.status !== 'removed');
  const joined = state.teams.find((row) => !row.archivedAt && isTeamMember(actor, row.id));
  const joinedOrg = joined ? state.orgs.find((row) => row.id === (joined.orgId || joined.tenantId)) : undefined;
  let org =
    state.orgs.find((row) => orgMembership(row.id)?.role === 'owner') ||
    state.orgs.find((row) => !!orgMembership(row.id)) ||
    joinedOrg;
  if (!org) org = createOrg(actor, label);
  let team =
    state.teams.find((row) => (row.orgId === org!.id || row.tenantId === org!.id) && !row.archivedAt && isTeamMember(actor, row.id)) ||
    (orgMembership(org.id)?.role === 'owner'
      ? state.teams.find((row) => row.orgId === org!.id && row.kind === 'general' && !row.archivedAt)
      : undefined);
  if (!team) {
    team = {
      id: uid('team'),
      name: label,
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
    const orgRole = orgMembership(org.id)?.role;
    const role = orgRole === 'owner' || orgRole === 'admin' ? orgRole : 'member';
    state.teamMembers.push({ teamId: team.id, uid: actor, role, status: 'active', joinedAt: new Date().toISOString(), displayName: name });
  } else {
    existing.status = 'active';
    if (!existing.role) existing.role = 'member';
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

export function teamSasEnabled() {
  return process.env.TEAM_SAS_VERIFY === 'true';
}

function personName(name: string | undefined, uid: string) {
  const label = String(name || '').trim();
  return label && label !== uid ? label : '';
}

function inviteOpen(invite: TeamInviteRec) {
  if (!freshInvite(invite)) return false;
  if (!invite.maxUses) return true;
  return (invite.uses || 0) < invite.maxUses;
}

export function createInvite(
  actor: string,
  teamId: string,
  role: 'admin' | 'member' = 'member',
  options: { publicKey?: string; email?: string; multiUse?: boolean } = {}
) {
  const state = getState();
  const team = state.teams.find((row) => row.id === teamId && !row.archivedAt);
  const member = activeTeamMember(actor, teamId);
  if (!team || !member || (member.role !== 'owner' && member.role !== 'admin')) {
    throw Object.assign(new Error('Only an owner or admin can invite'), { status: 403 });
  }
  if (team.slug === 'founders' && role !== 'owner') throw Object.assign(new Error('Founders space is owners only'), { status: 403 });
  const email = String(options.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Email required'), { status: 400 });
  const since = Date.now() - 3600000;
  const recent = state.teamInvites.filter((row) => row.teamId === teamId && Date.parse(row.createdAt) >= since).length;
  if (recent >= 20) throw Object.assign(new Error('This team can send 20 invites an hour'), { status: 429 });
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
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    maxUses: options.multiUse ? 0 : 1,
    uses: 0,
    status: 'pending',
    inviteeEmail: email || undefined,
    inviterKey: teamSasEnabled() && options.publicKey ? options.publicKey : undefined,
    createdAt: new Date().toISOString(),
  };
  state.teamInvites.push(invite);
  audit({ actorId: actor, action: 'invite', memoryId: invite.id, tenantId: invite.orgId, detail: `team:${teamId} result=ok` });
  saveState();
  const inviteUrl = `https://app.rukmer.com/join/${token}`;
  const inviterName = personName(member.displayName, actor);
  return { id: invite.id, inviteUrl, token, code, qrSvg: qrSvg(inviteUrl), expiresAt: invite.expiresAt, teamName: team.name, email, inviterName };
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

function sameEmail(left: string, right: string) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return !!a && a === b;
}

function inviteView(invite: TeamInviteRec) {
  const state = getState();
  const team = state.teams.find((row) => row.id === invite.teamId);
  const inviter = state.teamMembers.find((row) => row.teamId === invite.teamId && row.uid === invite.createdBy);
  return {
    id: invite.id,
    teamId: invite.teamId,
    teamName: team?.name || 'Team',
    inviterName: personName(inviter?.displayName, invite.createdBy),
    email: invite.inviteeEmail || '',
    requireApproval: !!team?.requireApproval,
    sasRequired: teamSasEnabled(),
  };
}

function seatInvitee(invite: TeamInviteRec, actor: string, displayName: string) {
  const state = getState();
  const team = state.teams.find((row) => row.id === invite.teamId);
  const pending = !!team?.requireApproval;
  const now = new Date().toISOString();
  const name = String(displayName || invite.inviteeName || '').slice(0, 80);
  const existing = state.teamMembers.find((row) => row.teamId === invite.teamId && row.uid === actor);
  if (existing && existing.status !== 'removed' && existing.status !== 'pending') {
    throw Object.assign(new Error('Already a member'), { status: 400 });
  }
  if (existing) {
    existing.status = pending ? 'pending' : 'active';
    existing.role = invite.role === 'admin' ? 'admin' : existing.role || 'member';
    if (name) existing.displayName = name;
    if (invite.inviteeEmail) existing.email = invite.inviteeEmail;
  } else {
    state.teamMembers.push({
      teamId: invite.teamId,
      uid: actor,
      role: invite.role === 'admin' ? 'admin' : 'member',
      status: pending ? 'pending' : 'active',
      joinedAt: now,
      displayName: name,
      email: invite.inviteeEmail,
    });
  }
  if (!pending && invite.orgId && !state.orgMembers.some((row) => row.orgId === invite.orgId && row.uid === actor && row.status !== 'removed')) {
    state.orgMembers.push({ orgId: invite.orgId, uid: actor, role: 'member', status: 'active', joinedAt: now });
  }
  invite.uses = (invite.uses || 0) + 1;
  invite.inviteeUid = actor;
  if (name) invite.inviteeName = name;
  invite.status = !invite.maxUses || invite.uses < invite.maxUses ? 'pending' : 'confirmed';
  return pending ? 'pending' : 'active';
}

export function previewInvite(tokenOrCode: string) {
  const invite = inviteByHash(tokenOrCode);
  if (!invite || !inviteOpen(invite)) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  return inviteView(invite);
}

export function inboxFor(email: string) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return [];
  return getState()
    .teamInvites.filter((invite) => invite.status === 'pending' && sameEmail(invite.inviteeEmail || '', needle) && inviteOpen(invite))
    .map((invite) => inviteView(invite));
}

export function resendTeamInvite(actor: string, id: string) {
  const state = getState();
  const invite = state.teamInvites.find((row) => row.id === id);
  if (!invite || invite.status !== 'pending') throw Object.assign(new Error('Invite not found'), { status: 404 });
  const member = activeTeamMember(actor, invite.teamId);
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) throw Object.assign(new Error('Only an owner or admin can resend'), { status: 403 });
  invite.status = 'revoked';
  saveState();
  return createInvite(actor, invite.teamId, invite.role === 'admin' ? 'admin' : 'member', { email: invite.inviteeEmail || '' });
}

export function declineInvite(email: string, id: string) {
  const invite = getState().teamInvites.find((row) => row.id === id);
  if (!invite || !sameEmail(invite.inviteeEmail || '', email)) throw Object.assign(new Error('Invite not found'), { status: 404 });
  invite.status = 'revoked';
  saveState();
  return { status: 'revoked' as const };
}

export function acceptInvite(actor: string, tokenOrCode: string, publicKey: string, verifiedEmail = '', inviteId = '', displayName = '', emailVerified = false) {
  const state = getState();
  const listed = inviteId ? state.teamInvites.find((row) => row.id === inviteId) : undefined;
  const tokenInvite = tokenOrCode ? inviteByHash(tokenOrCode) : undefined;
  const invite = tokenInvite || listed;
  if (!invite || !inviteOpen(invite)) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  lockout(invite.id);
  if (tokenOrCode) {
    const presented = hashSecret(tokenOrCode);
    if (presented !== invite.tokenHash && presented !== invite.codeHash) {
      noteBadCode(invite.id);
      saveState();
      throw Object.assign(new Error('Invite is not valid'), { status: 400 });
    }
  } else if (!listed) {
    throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  }
  if (!invite.inviteeEmail || !sameEmail(invite.inviteeEmail, verifiedEmail)) {
    throw Object.assign(new Error(`This invite was sent to ${invite.inviteeEmail || 'someone else'} — switch account`), { status: 403 });
  }
  if (!emailVerified) throw Object.assign(new Error('Verify your email before accepting this invite'), { status: 403 });
  if (invite.createdBy === actor) throw Object.assign(new Error('You cannot accept your own invite'), { status: 400 });
  if (isTeamMember(actor, invite.teamId)) throw Object.assign(new Error('Already a member'), { status: 400 });
  if (invite.maxUses === 1 && invite.inviteeUid && invite.inviteeUid !== actor) throw Object.assign(new Error('Invite is not valid'), { status: 400 });
  if (displayName) invite.inviteeName = String(displayName).slice(0, 80);
  const view = inviteView(invite);
  if (teamSasEnabled()) {
    invite.inviteeUid = actor;
    if (publicKey) invite.inviteeKey = publicKey;
    invite.status = 'accepted';
    if (invite.inviterKey && invite.inviteeKey) {
      const sas = sasFor(invite.id, invite.inviterKey, invite.inviteeKey);
      invite.sas = sas.sas;
      invite.sasDigits = sas.sasDigits;
    }
    saveState();
    return { ...view, joined: false, status: invite.status, sas: invite.sas || '', sasDigits: invite.sasDigits || '' };
  }
  const status = seatInvitee(invite, actor, displayName);
  audit({ actorId: actor, action: 'join', memoryId: invite.teamId, tenantId: invite.orgId, detail: `member:${actor} result=${status}` });
  saveState();
  return { ...view, joined: true, status, id: invite.id };
}

export function readInvite(actor: string, id: string) {
  const invite = getState().teamInvites.find((row) => row.id === id);
  if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
  if (invite.createdBy !== actor && invite.inviteeUid !== actor) throw Object.assign(new Error('Invite not found'), { status: 404 });
  freshInvite(invite);
  const team = getState().teams.find((row) => row.id === invite.teamId);
  const inviter = getState().teamMembers.find((row) => row.teamId === invite.teamId && row.uid === invite.createdBy);
  const inviterName = inviter?.displayName && inviter.displayName !== inviter.uid ? inviter.displayName : '';
  return {
    id: invite.id,
    status: invite.status,
    sas: invite.sas || '',
    sasDigits: invite.sasDigits || '',
    teamId: invite.teamId,
    teamName: team?.name || '',
    inviterName,
    inviterConfirmed: !!invite.inviterConfirmedAt,
    inviteeConfirmed: !!invite.inviteeConfirmedAt,
  };
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
  if (!invite.sas) throw Object.assign(new Error('Both keys are required before you can confirm'), { status: 400 });
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
        displayName: invite.inviteeName || '',
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

export function setTeamApproval(actor: string, teamId: string, requireApproval: boolean) {
  const state = getState();
  const member = activeTeamMember(actor, teamId);
  if (!member || member.role !== 'owner') throw Object.assign(new Error('Only an owner can change approval'), { status: 403 });
  const team = state.teams.find((row) => row.id === teamId && !row.archivedAt);
  if (!team) throw Object.assign(new Error('Team not found'), { status: 404 });
  team.requireApproval = !!requireApproval;
  saveState();
  return { requireApproval: !!team.requireApproval };
}

export function approveMember(actor: string, teamId: string, memberUid: string) {
  const state = getState();
  const member = activeTeamMember(actor, teamId);
  if (!member || member.role !== 'owner') throw Object.assign(new Error('Only an owner can approve'), { status: 403 });
  const target = state.teamMembers.find((row) => row.teamId === teamId && row.uid === memberUid && row.status === 'pending');
  if (!target) throw Object.assign(new Error('No one is waiting for approval'), { status: 404 });
  target.status = 'active';
  const team = state.teams.find((row) => row.id === teamId);
  const orgId = team?.orgId || team?.tenantId || '';
  if (orgId && !state.orgMembers.some((row) => row.orgId === orgId && row.uid === memberUid && row.status !== 'removed')) {
    state.orgMembers.push({ orgId, uid: memberUid, role: 'member', status: 'active', joinedAt: new Date().toISOString() });
  }
  audit({ actorId: actor, action: 'join', memoryId: teamId, tenantId: orgId, detail: `approved:${memberUid} result=ok` });
  saveState();
  return { uid: memberUid, status: 'active' as const };
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
      res.json(bootstrapTeam(uidOf(req), String(req.body?.orgName || ''), req.body?.displayName));
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
  app.post('/v4/teams/:teamId/invites', async (req, res) => {
    try {
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      const created = createInvite(uidOf(req), String(req.params.teamId || ''), role, {
        publicKey: String(req.body?.publicKey || ''),
        email: String(req.body?.email || ''),
        multiUse: req.body?.multiUse === true,
      });
      let emailSent = false;
      if (created.email) {
        const sent = await sendTeamInviteEmail({
          to: created.email,
          teamName: created.teamName,
          inviterName: created.inviterName,
          inviteUrl: created.inviteUrl,
        });
        emailSent = !!sent.success;
      }
      res.json({ ...created, emailSent });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not create the invite' });
    }
  });
  app.get('/v4/teams/invites/inbox', (req, res) => {
    try {
      if (!req.memoryUser?.emailVerified) return res.json({ invites: [] });
      res.json({ invites: inboxFor(String(req.memoryUser?.email || '')) });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not list invites' });
    }
  });
  app.post('/v4/teams/invites/:id/resend', async (req, res) => {
    try {
      const created = resendTeamInvite(uidOf(req), String(req.params.id || ''));
      let emailSent = false;
      if (created.email) {
        const sent = await sendTeamInviteEmail({
          to: created.email,
          teamName: created.teamName,
          inviterName: created.inviterName,
          inviteUrl: created.inviteUrl,
        });
        emailSent = !!sent.success;
      }
      res.json({ ...created, emailSent });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not resend the invite' });
    }
  });
  app.post('/v4/teams/invites/:id/decline', (req, res) => {
    try {
      if (!req.memoryUser?.emailVerified) return res.status(403).json({ error: 'Verify your email before using this invite' });
      res.json(declineInvite(String(req.memoryUser?.email || ''), String(req.params.id || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not decline' });
    }
  });
  app.post('/v4/teams/invites/preview', (req, res) => {
    try {
      res.json(previewInvite(String(req.body?.token || req.body?.code || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Invite is not valid' });
    }
  });
  app.post('/v4/teams/:teamId/approval', (req, res) => {
    try {
      res.json(setTeamApproval(uidOf(req), String(req.params.teamId || ''), req.body?.requireApproval === true));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not update approval' });
    }
  });
  app.post('/v4/teams/:teamId/members/:memberUid/approve', (req, res) => {
    try {
      res.json(approveMember(uidOf(req), String(req.params.teamId || ''), String(req.params.memberUid || '')));
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || 'Could not approve' });
    }
  });
  app.post('/v4/teams/invites/accept', (req, res) => {
    try {
      const token = String(req.body?.token || req.body?.code || '');
      res.json(
        acceptInvite(
          uidOf(req),
          token,
          String(req.body?.publicKey || ''),
          String(req.memoryUser?.email || ''),
          String(req.body?.id || ''),
          String(req.body?.displayName || ''),
          req.memoryUser?.emailVerified === true
        )
      );
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
