import { getState } from './core.js';
import { activeTeamMember, homeTag, ownsTag } from './tenancy.js';

export type SpaceKind = 'private' | 'team' | 'org';
export type SpaceScope = 'private' | 'team' | 'all';

export type ReadableSpace = {
  tag: string;
  kind: SpaceKind;
  teamId?: string;
  orgId?: string;
  name: string;
};

function teamTag(teamId: string) {
  return `tm_${teamId}`;
}

export function readableSpaces(actor: string): ReadableSpace[] {
  const state = getState();
  const spaces: ReadableSpace[] = [{ tag: homeTag(actor), kind: 'private', name: 'Private' }];
  const seen = new Set<string>([spaces[0].tag]);
  for (const member of state.teamMembers) {
    if (member.uid !== actor || member.status === 'removed') continue;
    const team = state.teams.find((row) => row.id === member.teamId && !row.archivedAt);
    if (!team || !activeTeamMember(actor, team.id)) continue;
    const tag = teamTag(team.id);
    if (seen.has(tag)) continue;
    seen.add(tag);
    spaces.push({
      tag,
      kind: 'team',
      teamId: team.id,
      orgId: team.orgId || (team.tenantId.startsWith('org_') ? team.tenantId : undefined),
      name: team.name,
    });
  }
  for (const member of state.orgMembers) {
    if (member.uid !== actor || member.status === 'removed') continue;
    if (seen.has(member.orgId)) continue;
    const org = state.orgs.find((row) => row.id === member.orgId);
    seen.add(member.orgId);
    spaces.push({ tag: member.orgId, kind: 'org', orgId: member.orgId, name: org?.name || member.orgId });
  }
  return spaces;
}

export function spaceTagsFor(actor: string, scope: SpaceScope = 'all', teamId?: string) {
  const spaces = readableSpaces(actor);
  if (teamId) {
    const team = spaces.find((space) => space.kind === 'team' && space.teamId === teamId);
    if (!team) throw Object.assign(new Error('Not a member of this team'), { status: 403 });
    if (scope === 'private') return [];
    return [team.tag];
  }
  if (scope === 'private') return spaces.filter((space) => space.kind === 'private').map((space) => space.tag);
  if (scope === 'team') return spaces.filter((space) => space.kind === 'team').map((space) => space.tag);
  return spaces.map((space) => space.tag);
}

/** Tags a request may read. Foreign tags are dropped. Owned private sub-tags stay. */
export function readTagsFor(
  actor: string,
  input: { scope?: string; teamId?: string; containerTag?: string; containerTags?: string[] }
) {
  const scope: SpaceScope = input.scope === 'private' || input.scope === 'team' ? input.scope : 'all';
  const requested = [input.containerTag, ...(input.containerTags || [])].map((tag) => String(tag || '').trim()).filter(Boolean);
  const owned = requested.filter((tag) => ownsTag(actor, tag));
  if (scope === 'private') return owned.length ? owned : spaceTagsFor(actor, 'private');
  if (scope === 'team') return spaceTagsFor(actor, 'team', input.teamId || undefined);
  const teams = spaceTagsFor(actor, 'team');
  const orgs = readableSpaces(actor).filter((space) => space.kind === 'org').map((space) => space.tag);
  const priv = owned.length ? owned : spaceTagsFor(actor, 'private');
  return [...new Set([...priv, ...teams, ...orgs])];
}
