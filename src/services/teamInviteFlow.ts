export type InvitePhase = 'waiting-open' | 'waiting-keys' | 'confirm' | 'waiting-inviter' | 'waiting-invitee' | 'live' | 'revoked';

export function inviterPhase(row: { status?: string; sas?: string; inviterConfirmed?: boolean }): InvitePhase {
  if (row.status === 'confirmed') return 'live';
  if (row.status === 'revoked') return 'revoked';
  if (row.status !== 'accepted' || !row.sas) return 'waiting-open';
  if (row.inviterConfirmed) return 'waiting-invitee';
  return 'confirm';
}

export function inviteePhase(row: { status?: string; sas?: string; inviteeConfirmed?: boolean }): InvitePhase {
  if (row.status === 'confirmed') return 'live';
  if (row.status === 'revoked') return 'revoked';
  if (row.inviteeConfirmed) return 'waiting-inviter';
  if (!row.sas) return 'waiting-keys';
  return 'confirm';
}

export function inviteCopy(phase: InvitePhase, inviterName = '') {
  if (phase === 'live') return 'Team brain is live';
  if (phase === 'revoked') return 'Invite revoked';
  if (phase === 'waiting-open') return 'Waiting for teammate to open the link';
  if (phase === 'waiting-keys') return 'Waiting for both keys…';
  if (phase === 'waiting-inviter') return `Waiting for ${inviterName || 'your teammate'} to confirm`;
  if (phase === 'waiting-invitee') return 'Waiting for your teammate to confirm';
  return '';
}
