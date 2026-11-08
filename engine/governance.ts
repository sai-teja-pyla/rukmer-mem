/**
 * Privacy, retention, and erasure for the memory store.
 * Rukmer does not train models on customer memory. A provider model only
 * receives the prompt built for the current request.
 *
 * Isolation is enforced here, on the stored rows, before search or export.
 * The engine keeps one JSON document (encrypted at rest when MEMORY_DATA_KEY
 * is set). There is no separate SQL database, so this gate is the row filter:
 * a row without a matching owner, team, or org is invisible to the caller.
 */
import {
  deleteBlob,
  encryptionAtRest,
  encryptionWarning,
  getState,
  saveState,
  uid,
  type AuditRec,
  type MemoryGov,
  type MemoryKind,
  type RedactMode,
  type Visibility,
} from './core.js';
import { canAccessTag, homeTag, ownsTag, uidFromTag } from './tenancy.js';

const DEFAULT_TTL: Record<MemoryKind, number> = {
  session: 7,
  working: 14,
  context: 30,
  summary: 180,
  preference: 365,
  fact: 365,
  decision: 365,
};

const DEFAULT_ACTION: Record<MemoryKind, 'archive' | 'purge'> = {
  session: 'purge',
  working: 'purge',
  context: 'archive',
  summary: 'archive',
  preference: 'archive',
  fact: 'archive',
  decision: 'archive',
};

const DEFAULT_REDACTION: Record<'credentials' | 'payment' | 'sensitive', RedactMode> = {
  credentials: 'mask',
  payment: 'mask',
  sensitive: 'mask',
};

type GovCarrier = { id: string; containerTag: string; forgotten?: boolean; gov?: MemoryGov; text?: string; embedding?: number[] };

export function isExpired(expiresAt?: string | null, now = Date.now()) {
  return !!expiresAt && Date.parse(expiresAt) <= now;
}

export function isRetired(row: { forgotten?: boolean; gov?: MemoryGov }, now = Date.now()) {
  if (row.forgotten || row.gov?.archived || row.gov?.deletedAt) return true;
  return isExpired(row.gov?.expiresAt, now);
}

function legacyGov(tag: string): MemoryGov {
  if (tag.startsWith('org_')) {
    return { ownerId: '', tenantId: tag, visibility: 'org', createdBy: '', memoryKind: 'context', expiresAt: null };
  }
  const owner = uidFromTag(tag);
  return {
    ownerId: owner,
    tenantId: owner ? homeTag(owner) : tag,
    visibility: 'private',
    createdBy: owner,
    memoryKind: 'context',
    expiresAt: null,
  };
}

export function govOf(row: { containerTag: string; gov?: MemoryGov }) {
  return row.gov || legacyGov(row.containerTag);
}

export function teamContainer(teamId: string) {
  const id = String(teamId || '').replace(/^tm_/, '');
  if (!/^team_[A-Za-z0-9_-]{1,80}$/.test(id)) throw Object.assign(new Error('Invalid team'), { status: 400 });
  return `tm_${id}`;
}

export function readableTeamTags(actor: string) {
  const seen = new Set<string>();
  for (const member of getState().teamMembers) {
    if (member.uid !== actor) continue;
    seen.add(teamContainer(member.teamId));
  }
  return [...seen];
}

export function scopeTagsForActor(actor: string, primary: string) {
  const tags = new Set<string>([primary]);
  if (primary === homeTag(actor)) {
    for (const tag of readableTeamTags(actor)) tags.add(tag);
  }
  return [...tags];
}

export function isTeamMember(actor: string, teamId: string) {
  if (!actor || !teamId) return false;
  return getState().teamMembers.some((m) => m.teamId === teamId && m.uid === actor);
}

export function isTenantAdmin(actor: string, tenantId: string) {
  if (!actor || !tenantId) return false;
  if (tenantId === homeTag(actor)) return true;
  if (tenantId.startsWith('org_')) {
    return getState().orgMembers.some((m) => m.orgId === tenantId && m.uid === actor && m.role === 'owner');
  }
  return false;
}

export function canRead(actor: string, row: { containerTag: string; forgotten?: boolean; gov?: MemoryGov }) {
  if (!actor || isRetired(row)) return false;
  const gov = govOf(row);
  if (gov.visibility === 'org') return gov.ownerId === actor || canAccessTag(actor, gov.tenantId || row.containerTag);
  if (gov.visibility === 'team') return gov.ownerId === actor || isTeamMember(actor, gov.teamId || '');
  if (row.gov) return gov.ownerId === actor;
  return ownsTag(actor, row.containerTag);
}

export function canErase(actor: string, row: { containerTag: string; gov?: MemoryGov }) {
  const gov = govOf(row);
  if (gov.ownerId && gov.ownerId === actor) return true;
  if (!row.gov && ownsTag(actor, row.containerTag)) return true;
  if (gov.visibility === 'org' && canAccessTag(actor, gov.tenantId || row.containerTag)) return true;
  if (gov.visibility === 'team' && isTeamMember(actor, gov.teamId || '')) return true;
  return isTenantAdmin(actor, gov.tenantId);
}

function redactionFor(tenantId: string) {
  const saved = getState().redactionPolicies.find((p) => p.tenantId === tenantId);
  return {
    credentials: saved?.credentials || DEFAULT_REDACTION.credentials,
    payment: saved?.payment || DEFAULT_REDACTION.payment,
    sensitive: saved?.sensitive || DEFAULT_REDACTION.sensitive,
  };
}

function luhn(num: string) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = num.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS = [
  /rk_live_[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z\-_]{20,}/g,
  /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi,
];

function maskCategory(text: string, category: 'credentials' | 'payment' | 'sensitive') {
  const token = `[REDACTED:${category}]`;
  if (category === 'credentials') {
    let next = text;
    for (const pattern of SECRET_PATTERNS) next = next.replace(pattern, token);
    return next;
  }
  if (category === 'payment') {
    return text.replace(/\b(?:\d[ -]?){13,19}\b/g, (raw) => {
      const digits = raw.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? token : raw;
    });
  }
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, token)
    .replace(
      /\b(?:diagnosed with [^.\n]{0,80}|hiv positive|passport number\s*[:=]?\s*[A-Z0-9]{6,}|sexual orientation\s*[:=]\s*\S+|religion\s*[:=]\s*\S+)/gi,
      token
    );
}

function categoryHit(before: string, after: string) {
  return before !== after;
}

export function redactText(tenantId: string, text: string) {
  const policy = redactionFor(tenantId);
  const hits: string[] = [];
  let next = text;
  for (const category of ['credentials', 'payment', 'sensitive'] as const) {
    const mode = policy[category];
    if (mode === 'allow') continue;
    const masked = maskCategory(next, category);
    if (!categoryHit(next, masked)) continue;
    if (mode === 'drop') return { text: '', redacted: [category], dropped: true as const };
    hits.push(category);
    next = masked;
  }
  return { text: next, redacted: hits, dropped: false as const };
}

export function ttlFor(tenantId: string, kind: MemoryKind) {
  const rows = getState().retentionPolicies.filter((p) => p.tenantId === tenantId);
  const chosen = rows.find((p) => p.memoryKind === kind) || rows.find((p) => p.memoryKind === '*');
  const days = chosen ? chosen.ttlDays : DEFAULT_TTL[kind];
  const action = chosen?.action || DEFAULT_ACTION[kind];
  return { days, action };
}

export function expiresOn(tenantId: string, kind: MemoryKind, from = new Date()) {
  const { days } = ttlFor(tenantId, kind);
  if (!days || days <= 0) return null;
  return new Date(from.getTime() + days * 86400000).toISOString();
}

export function assignGovernance(input: {
  actorId: string;
  containerTag: string;
  visibility?: Visibility | string;
  teamId?: string;
  memoryKind?: MemoryKind | string;
  sourceRef?: string;
  extraction?: string;
}) {
  const actor = input.actorId;
  const tag = input.containerTag;
  const requested = String(input.visibility || 'private');
  const visibility: Visibility = requested === 'team' || requested === 'org' ? requested : 'private';
  const tenantId = tag.startsWith('org_') ? tag : homeTag(actor);
  if (visibility === 'org' && !canAccessTag(actor, tenantId)) {
    throw Object.assign(new Error('Not allowed to share this memory with the org'), { status: 403 });
  }
  if (visibility === 'team') {
    const teamId = String(input.teamId || '');
    const team = getState().teams.find((t) => t.id === teamId);
    if (!team || !isTeamMember(actor, team.id)) {
      throw Object.assign(new Error('Team membership required'), { status: 403 });
    }
  }
  if (!tag.startsWith('org_') && !ownsTag(actor, tag)) {
    throw Object.assign(new Error('Cannot write into another user store'), { status: 403 });
  }
  if (tag.startsWith('org_') && !canAccessTag(actor, tag)) {
    throw Object.assign(new Error('Not a member of this org'), { status: 403 });
  }
  const kinds: MemoryKind[] = ['session', 'working', 'preference', 'fact', 'decision', 'summary', 'context'];
  const memoryKind = kinds.includes(input.memoryKind as MemoryKind) ? (input.memoryKind as MemoryKind) : tag.includes('--ses--') ? 'session' : 'context';
  const gov: MemoryGov = {
    ownerId: actor,
    tenantId,
    visibility,
    createdBy: actor,
    sourceRef: input.sourceRef ? String(input.sourceRef).slice(0, 200) : undefined,
    memoryKind,
    extraction: input.extraction || 'heuristic',
    expiresAt: expiresOn(tenantId, memoryKind),
    archived: false,
    deletedAt: null,
    teamId: visibility === 'team' ? String(input.teamId || '') : undefined,
  };
  return gov;
}

export function prepareWrite(tenantId: string, text: string) {
  const out = redactText(tenantId, text);
  if (out.dropped) {
    throw Object.assign(new Error(`Blocked: ${out.redacted[0]} cannot be stored`), { status: 422 });
  }
  return out;
}

export function audit(entry: Omit<AuditRec, 'id' | 'at'> & { at?: string }) {
  const state = getState();
  state.audit.unshift({
    id: uid('aud'),
    at: entry.at || new Date().toISOString(),
    actorId: entry.actorId,
    action: entry.action,
    memoryId: entry.memoryId || '',
    tenantId: entry.tenantId || '',
    purpose: entry.purpose,
    detail: entry.detail,
  });
  if (state.audit.length > 2000) state.audit.length = 2000;
}

export function findMemory(id: string): GovCarrier | null {
  const state = getState();
  return (
    state.documents.find((d) => d.id === id) ||
    state.chunks.find((c) => c.id === id) ||
    state.triples.find((t) => t.id === id) ||
    null
  );
}

function rows(): GovCarrier[] {
  const state = getState();
  return [...state.documents, ...state.chunks, ...state.triples];
}

export function eraseIds(ids: string[], actorId: string) {
  const gone = new Set(ids.filter(Boolean));
  if (!gone.size) return { removed: 0, tags: [] as string[] };
  const state = getState();
  const tags = new Set<string>();
  for (const row of rows()) {
    if (gone.has(row.id)) tags.add(row.containerTag);
  }
  for (const doc of state.documents) {
    if (!gone.has(doc.id)) continue;
    if (doc.fileId) deleteBlob(doc.fileId);
    for (const chunk of state.chunks) if (chunk.docId === doc.id) gone.add(chunk.id);
  }
  const wipe = <T extends GovCarrier>(list: T[]) => list.filter((row) => !gone.has(row.id));
  const removed = rows().filter((row) => gone.has(row.id)).length;
  state.documents = wipe(state.documents);
  state.chunks = wipe(state.chunks);
  state.triples = wipe(state.triples);
  state.links = state.links.filter((link) => !gone.has(link.fromId) && !gone.has(link.toId));
  for (const entity of state.entities) {
    if (entity.memoryIds) entity.memoryIds = entity.memoryIds.filter((id) => !gone.has(id));
  }
  state.entities = state.entities.filter((entity) => !entity.memoryIds || entity.memoryIds.length > 0);
  state.erasures.unshift({
    id: uid('era'),
    at: new Date().toISOString(),
    actorId,
    target: [...gone].slice(0, 8).join(','),
    mode: 'memory',
    dryRun: false,
    removed,
    completed: true,
  });
  if (state.erasures.length > 500) state.erasures.length = 500;
  for (const id of gone) {
    audit({ actorId, action: 'delete', memoryId: id, tenantId: '', detail: 'erased' });
  }
  saveState();
  return { removed, tags: [...tags] };
}

export function eraseMemory(actor: string, id: string) {
  const row = findMemory(id);
  if (!row) return { ok: true, removed: 0 };
  if (!canErase(actor, row)) return { ok: false, error: 'forbidden', removed: 0 };
  const out = eraseIds([id], actor);
  return { ok: true, removed: out.removed, tags: out.tags };
}

function selectBulk(actor: string, mode: 'owner' | 'tenant', target: string) {
  return rows().filter((row) => {
    const gov = govOf(row);
    if (mode === 'owner') return gov.ownerId === target || (!row.gov && uidFromTag(row.containerTag) === target);
    return gov.tenantId === target || row.containerTag === target;
  }).filter((row) => canErase(actor, row));
}

export function eraseBulk(actor: string, mode: 'owner' | 'tenant', target: string, dryRun = false) {
  if (mode === 'tenant' && !isTenantAdmin(actor, target) && target !== homeTag(actor)) {
    throw Object.assign(new Error('Only a tenant admin can erase that tenant'), { status: 403 });
  }
  if (mode === 'owner' && target !== actor && !rows().some((row) => govOf(row).ownerId === target && isTenantAdmin(actor, govOf(row).tenantId))) {
    throw Object.assign(new Error('Cannot erase another user'), { status: 403 });
  }
  const matched = selectBulk(actor, mode, target);
  const ids = [...new Set(matched.map((row) => row.id))];
  if (dryRun) {
    audit({ actorId: actor, action: 'preview', memoryId: '', tenantId: mode === 'tenant' ? target : '', detail: `${mode}:${target}:${ids.length}` });
    saveState();
    return { ok: true, dryRun: true, count: ids.length, ids, removed: 0 };
  }
  const out = eraseIds(ids, actor);
  return { ok: true, dryRun: false, count: ids.length, ids, removed: out.removed, tags: out.tags };
}

export function runExpiry(actor = 'system', now = Date.now()) {
  const state = getState();
  const purge: string[] = [];
  let archived = 0;
  const stamp = new Date(now).toISOString();
  for (const row of rows()) {
    if (!row.gov?.expiresAt || !isExpired(row.gov.expiresAt, now) || row.gov.deletedAt) continue;
    const kind = row.gov.memoryKind;
    const { action } = ttlFor(row.gov.tenantId, kind);
    if (action === 'purge') {
      purge.push(row.id);
      continue;
    }
    row.forgotten = true;
    row.gov.archived = true;
    row.gov.deletedAt = stamp;
    if (row.embedding) row.embedding = [];
    if ('text' in row && row.text) row.text = '';
    archived += 1;
  }
  if (archived) {
    audit({ actorId: actor, action: 'retain', memoryId: '', tenantId: '', detail: `archived:${archived}` });
    saveState();
  }
  const purged = purge.length ? eraseIds(purge, actor).removed : 0;
  if (!archived && !purged) return { archived: 0, purged: 0 };
  return { archived, purged };
}

export function setRetention(actor: string, input: { tenantId: string; memoryKind: MemoryKind | '*'; ttlDays: number; action: 'archive' | 'purge' }) {
  if (!isTenantAdmin(actor, input.tenantId)) throw Object.assign(new Error('Tenant admin required'), { status: 403 });
  const days = Math.max(0, Math.min(3650, Number(input.ttlDays) || 0));
  const state = getState();
  const existing = state.retentionPolicies.find((p) => p.tenantId === input.tenantId && p.memoryKind === input.memoryKind);
  if (existing) {
    existing.ttlDays = days;
    existing.action = input.action === 'purge' ? 'purge' : 'archive';
  } else {
    state.retentionPolicies.push({
      id: uid('ret'),
      tenantId: input.tenantId,
      memoryKind: input.memoryKind,
      ttlDays: days,
      action: input.action === 'purge' ? 'purge' : 'archive',
    });
  }
  audit({ actorId: actor, action: 'retain', memoryId: '', tenantId: input.tenantId, detail: `${input.memoryKind}:${days}:${input.action}` });
  saveState();
  return state.retentionPolicies.filter((p) => p.tenantId === input.tenantId);
}

export function setRedaction(actor: string, input: { tenantId: string; credentials?: RedactMode; payment?: RedactMode; sensitive?: RedactMode }) {
  if (!isTenantAdmin(actor, input.tenantId)) throw Object.assign(new Error('Tenant admin required'), { status: 403 });
  const mode = (value: RedactMode | undefined, fallback: RedactMode): RedactMode =>
    value === 'drop' || value === 'mask' || value === 'allow' ? value : fallback;
  const state = getState();
  let row = state.redactionPolicies.find((p) => p.tenantId === input.tenantId);
  if (!row) {
    row = { tenantId: input.tenantId, ...DEFAULT_REDACTION };
    state.redactionPolicies.push(row);
  }
  row.credentials = mode(input.credentials, row.credentials);
  row.payment = mode(input.payment, row.payment);
  row.sensitive = mode(input.sensitive, row.sensitive);
  audit({ actorId: actor, action: 'retain', memoryId: '', tenantId: input.tenantId, detail: 'redaction-updated' });
  saveState();
  return row;
}

export function createTeam(actor: string, name: string, tenantId?: string) {
  const tenant = tenantId && isTenantAdmin(actor, tenantId) ? tenantId : homeTag(actor);
  if (tenantId && tenant !== tenantId) throw Object.assign(new Error('Tenant admin required'), { status: 403 });
  const label = String(name || '').trim().slice(0, 80);
  if (!label) throw Object.assign(new Error('Team name required'), { status: 400 });
  const team = { id: uid('team'), name: label, tenantId: tenant, createdBy: actor, createdAt: new Date().toISOString() };
  const state = getState();
  state.teams.push(team);
  state.teamMembers.push({ teamId: team.id, uid: actor, role: 'owner' });
  saveState();
  return team;
}

export function addTeamMember(actor: string, teamId: string, memberUid: string) {
  const state = getState();
  const team = state.teams.find((t) => t.id === teamId);
  const owner = state.teamMembers.find((m) => m.teamId === teamId && m.uid === actor && m.role === 'owner');
  if (!team || !owner) throw Object.assign(new Error('Only the team owner can add members'), { status: 403 });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberUid)) throw Object.assign(new Error('Invalid member'), { status: 400 });
  if (!state.teamMembers.some((m) => m.teamId === teamId && m.uid === memberUid)) {
    state.teamMembers.push({ teamId, uid: memberUid, role: 'member' });
    saveState();
  }
  return { teamId, uid: memberUid };
}

export function exportTenant(actor: string, tenantId: string) {
  if (!isTenantAdmin(actor, tenantId)) throw Object.assign(new Error('Tenant admin required'), { status: 403 });
  const state = getState();
  const inTenant = (row: { containerTag: string; gov?: MemoryGov; forgotten?: boolean }) =>
    (govOf(row).tenantId === tenantId || row.containerTag === tenantId) && !isRetired(row);
  audit({ actorId: actor, action: 'export', memoryId: '', tenantId, purpose: 'tenant-export' });
  return {
    exportedAt: new Date().toISOString(),
    tenantId,
    documents: state.documents.filter(inTenant).map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      createdAt: d.createdAt,
      visibility: govOf(d).visibility,
      ownerId: govOf(d).ownerId,
      text: String(d.text || '').slice(0, 8000),
    })),
    facts: state.triples.filter((t) => t.isLatest !== false && inTenant(t)).map((t) => ({
      id: t.id,
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      evidence: t.evidence,
      visibility: govOf(t).visibility,
      ownerId: govOf(t).ownerId,
    })),
  };
}

export function governanceView(actor: string) {
  const home = homeTag(actor);
  const state = getState();
  const orgIds = state.orgMembers.filter((m) => m.uid === actor).map((m) => m.orgId);
  const tenants = [home, ...orgIds];
  return {
    training: false,
    encryptionAtRest: encryptionAtRest(),
    encryptionWarning: encryptionWarning(),
    transit: 'tls',
    defaultVisibility: 'private' as const,
    tenants,
    retention: state.retentionPolicies.filter((p) => tenants.includes(p.tenantId)),
    redaction: tenants.map((tenantId) => ({ tenantId, ...redactionFor(tenantId) })),
    defaults: { ttlDays: DEFAULT_TTL, action: DEFAULT_ACTION, redaction: DEFAULT_REDACTION },
    teams: state.teams.filter((t) => tenants.includes(t.tenantId) && isTeamMember(actor, t.id)),
  };
}

export function auditFor(actor: string, tenantId?: string) {
  const state = getState();
  const home = homeTag(actor);
  return state.audit
    .filter((row) => {
      if (row.actorId === actor) return true;
      const tenant = tenantId || row.tenantId;
      if (!tenant) return false;
      return isTenantAdmin(actor, tenant) && (!tenantId || row.tenantId === tenantId || row.tenantId === home);
    })
    .slice(0, 200);
}

export function migrateGovernance() {
  const state = getState();
  state.teams = state.teams || [];
  state.teamMembers = state.teamMembers || [];
  state.retentionPolicies = state.retentionPolicies || [];
  state.redactionPolicies = state.redactionPolicies || [];
  state.audit = state.audit || [];
  state.erasures = state.erasures || [];
  let changed = false;
  for (const row of [...state.documents, ...state.chunks, ...state.triples]) {
    if (row.gov) continue;
    row.gov = legacyGov(row.containerTag);
    changed = true;
  }
  if (changed) saveState();
  return { stamped: changed };
}

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startRetentionLoop() {
  if (retentionTimer) return;
  retentionTimer = setInterval(() => {
    try {
      runExpiry('system');
    } catch (err) {
      console.warn('retention sweep skipped', (err as Error).message);
    }
  }, 15 * 60 * 1000);
  retentionTimer.unref?.();
}
