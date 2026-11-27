export type SpaceRef = { id?: string; name?: string; tag?: string };

export function spaceLabel(tag: string, opts?: { homeTag?: string; teams?: SpaceRef[] }) {
  const raw = String(tag || '').trim();
  if (!raw || raw === 'all') return { label: 'All Spaces', raw };
  if ((opts?.homeTag && raw === opts.homeTag) || raw.startsWith('u_')) return { label: 'Personal', raw };
  const team = (opts?.teams || []).find((item) => item.tag === raw || (item.id && (raw === `tm_${item.id}` || raw.endsWith(item.id))));
  if (team?.name) return { label: team.name, raw };
  if (raw.startsWith('tm_')) return { label: 'Team', raw };
  if (raw.startsWith('org_')) return { label: 'Organization', raw };
  return { label: raw, raw };
}
