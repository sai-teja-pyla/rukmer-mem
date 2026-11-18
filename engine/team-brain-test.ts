/**
 * Team brain isolation: private rows stay private, team rows follow membership.
 * Run: npm run team-brain
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-team-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.K_SERVICE;
delete process.env.NODE_ENV;

const { mountMemoryEngine } = await import('./routes.js');
const { getState } = await import('./core.js');
const { buildMemoryInjection } = await import('./inject.js');
const { buildProfile } = await import('./memory.js');
const { graphPayload, ingestDocument, insights, listTags, stats } = await import('./pipeline.js');
const { handleMcp } = await import('./mcp.js');
const { readTagsFor } = await import('./spaces.js');
const { runMemoryTool } = await import('./tools.js');
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;

async function hit(method: string, urlPath: string, user: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-rukmer-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed, text };
}

function has(blob: unknown, marker: string) {
  return JSON.stringify(blob).includes(marker);
}

getState().orgs.push({ id: 'org_rukmer', name: 'Rukmer', createdBy: 'founder', createdAt: '2020-01-01T00:00:00.000Z' });
getState().orgMembers.push({ orgId: 'org_rukmer', uid: 'founder', role: 'owner', status: 'active', joinedAt: '2020-01-01T00:00:00.000Z' });
const legacyOrg = JSON.stringify(getState().orgs.find((org) => org.id === 'org_rukmer'));
const legacyMembers = JSON.stringify(getState().orgMembers.filter((member) => member.orgId === 'org_rukmer'));

const ada = await hit('POST', '/v4/teams/bootstrap', 'ada', { orgName: 'Rukmer', displayName: 'Ada' });
const nori = await hit('POST', '/v4/teams/bootstrap', 'nori', { orgName: 'Rukmer', displayName: 'Nori' });
check(
  'two users with the same name get their own org and team',
  ada.status === 200 &&
    nori.status === 200 &&
    ada.body.org?.id !== nori.body.org?.id &&
    ada.body.team?.id !== nori.body.team?.id &&
    String(ada.body.org?.id).startsWith('org_') &&
    ada.body.org?.id !== 'org_rukmer' &&
    nori.body.org?.id !== 'org_rukmer' &&
    ada.body.org?.name === 'Rukmer' &&
    nori.body.org?.name === 'Rukmer'
);
const adaAgain = await hit('POST', '/v4/teams/bootstrap', 'ada', { orgName: 'Something else', displayName: 'Ada' });
check('bootstrap twice returns the same team', adaAgain.status === 200 && adaAgain.body.team?.id === ada.body.team?.id && adaAgain.body.org?.id === ada.body.org?.id);

const boot = await hit('POST', '/v4/teams/bootstrap', 'tj', { orgName: 'Rukmer', displayName: 'TJ' });
const teamId = boot.body.team?.id as string;
const orgId = boot.body.org?.id as string;
check('tj bootstraps a general team', boot.status === 200 && !!teamId && String(orgId).startsWith('org_'));

const invited = await hit('POST', `/v4/teams/${teamId}/invites`, 'tj', { role: 'member', publicKey: 'tj-key' });
check('invite returns a link and code', invited.status === 200 && String(invited.body.inviteUrl || '').includes('/join/') && !!invited.body.code);
const accepted = await hit('POST', '/v4/teams/invites/accept', 'suren', { token: invited.body.token, publicKey: 'suren-key' });
check('suren accepts the invite', accepted.status === 200 && !!accepted.body.sas);
const surenYes = await hit('POST', `/v4/teams/invites/${accepted.body.id}/confirm`, 'suren', { match: true });
const tjYes = await hit('POST', `/v4/teams/invites/${accepted.body.id}/confirm`, 'tj', { match: true });
check('both confirm the emoji code', surenYes.body.status === 'confirmed' || tjYes.body.status === 'confirmed');
const surenBoot = await hit('POST', '/v4/teams/bootstrap', 'suren', { orgName: 'Rukmer', displayName: 'Suren' });
check('a member bootstrap reuses the team they joined', surenBoot.status === 200 && surenBoot.body.team?.id === teamId && surenBoot.body.org?.id === orgId);

async function save(user: string, text: string, scope: 'private' | 'team') {
  return hit('POST', '/v3/documents', user, {
    title: text.slice(0, 40),
    text,
    containerTag: scope === 'team' ? undefined : undefined,
    visibility: scope === 'team' ? 'team' : 'private',
    teamId: scope === 'team' ? teamId : undefined,
  });
}

const tjPrivate = await save('tj', 'TJ private: sourdough-violet-42', 'private');
const tjTeam = await save('tj', 'Launch decision: pricing-maple-7', 'team');
const surenTeam = await save('suren', 'Campaign: lisbon-orchid-9', 'team');
const surenPrivate = await save('suren', 'Suren private: harbor-quartz-3', 'private');
check('four memories stored', [tjPrivate, tjTeam, surenTeam, surenPrivate].every((row) => row.status === 200));

const teamDoc = getState().documents.find((doc) => String(doc.text).includes('pricing-maple-7'));
check(
  'team save is durable and owned by the org',
  !!teamDoc && teamDoc.gov?.visibility === 'team' && teamDoc.gov.tenantId === orgId && teamDoc.gov.expiresAt == null && teamDoc.gov.memoryKind !== 'context'
);

async function blobFor(user: string) {
  const search = await hit('POST', '/v4/search', user, { query: 'decision campaign private', scope: 'all' });
  const inject = await hit('POST', '/v4/inject', user, { query: 'decision campaign private', scope: 'all' });
  const chat = await hit('POST', '/v4/chat', user, { query: 'decision campaign private', scope: 'all', remember: false });
  const listed = await hit('POST', '/v3/documents/list', user, { scope: 'all' });
  const graph = await hit('GET', '/v4/graph', user);
  const tags = await hit('GET', '/v3/tags', user);
  const insight = await hit('GET', '/v3/insights', user);
  const stat = await hit('GET', '/v3/stats', user);
  const exported = await hit('GET', '/v3/export', user);
  const tenant = await hit('GET', `/v4/governance/export?tenantId=${encodeURIComponent(orgId)}`, user);
  const profile = buildProfile(readTagsFor(user, { scope: 'all' }), user);
  const directGraph = graphPayload(undefined, user);
  const tool = await runMemoryTool('searchMemories', { query: 'decision campaign private', scope: 'all' }, user);
  let mcpText = '';
  const mcpRes = {
    setHeader() {},
    status() {
      return this;
    },
    json(payload: unknown) {
      mcpText = JSON.stringify(payload);
    },
    end() {},
  };
  await handleMcp(
    { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'searchMemories', arguments: { query: 'decision campaign private', scope: 'all' } } }, memoryUser: { uid: user } } as any,
    mcpRes as any
  );
  return JSON.stringify({ search, inject, chat, listed, graph, tags, insight, stat, exported, tenant, profile, directGraph, tool, mcpText, listTags: listTags(user), insights: insights(user), stats: stats(user) });
}

const surenView = await blobFor('suren');
const tjView = await blobFor('tj');
const outsider = await blobFor('outsider');
check('suren sees both team memories', surenView.includes('pricing-maple-7') && surenView.includes('lisbon-orchid-9'));
check('suren never sees TJ private', !surenView.includes('sourdough-violet-42'));
check('tj sees both team memories', tjView.includes('pricing-maple-7') && tjView.includes('lisbon-orchid-9'));
check('tj never sees Suren private', !tjView.includes('harbor-quartz-3'));
check('outsider sees none of the four', !['sourdough-violet-42', 'pricing-maple-7', 'lisbon-orchid-9', 'harbor-quartz-3'].some((marker) => outsider.includes(marker)));

const privateTool = await runMemoryTool('addMemory', { text: 'MCP private marker quartz-private-11' }, 'suren');
const teamTool = await runMemoryTool('addMemory', { text: 'MCP team marker cedar-team-12', scope: 'team', teamId }, 'suren');
const privateRow = getState().documents.find((doc) => String(doc.text).includes('quartz-private-11'));
const teamRow = getState().documents.find((doc) => String(doc.text).includes('cedar-team-12'));
check('MCP without scope stays private', privateTool && privateRow?.gov?.visibility === 'private' && privateRow.gov.expiresAt == null && privateRow.gov.memoryKind !== 'context');
check('MCP team scope lands in the team', !!teamRow && teamRow.containerTag.startsWith('tm_') && teamRow.gov?.tenantId === orgId && teamRow.gov.expiresAt == null);

const authored = await runMemoryTool('searchMemories', { query: '', author: 'suren', since: '7d' }, 'tj');
check(
  'empty author search returns Suren with a name and time',
  JSON.stringify(authored).includes('lisbon-orchid-9') && JSON.stringify(authored).includes('suren') && JSON.stringify(authored).includes('authoredAt')
);

const bulkTag = readTagsFor('tj', { scope: 'all' });
for (let i = 0; i < 20; i += 1) {
  await ingestDocument({
    title: `bulk private ${i}`,
    text: `shared-signal-bulk private ${i} prefers the word shared-signal-bulk`,
    containerTag: bulkTag[0],
    actorId: 'tj',
    extract: false,
    memoryKind: 'fact',
  });
  await ingestDocument({
    title: `bulk team ${i}`,
    text: `shared-signal-bulk team ${i} prefers the word shared-signal-bulk`,
    containerTag: bulkTag[0],
    actorId: 'tj',
    visibility: 'team',
    teamId,
    extract: false,
    memoryKind: 'fact',
    durable: true,
  });
}
const injected = await buildMemoryInjection('shared-signal-bulk', bulkTag[0], { containerTags: bulkTag, topK: 8, strictness: 0.4, actorId: 'tj' });
check(
  'union still respects topK and strictness',
  injected.retrieved.matches.length <= 8 && injected.retrieved.matches.every((match) => Number(match.score) >= 0.4)
);

const moved = await hit('POST', `/v4/memories/${teamDoc?.id}/move`, 'tj', { to: 'private' });
const afterMove = await hit('POST', '/v4/search', 'suren', { query: 'pricing-maple-7', scope: 'all' });
const moveAudit = getState().audit.some((row) => row.action === 'move');
const movedHits = JSON.stringify(afterMove.body.matches || []);
check('author can move a team memory back to private', moved.status === 200 && !movedHits.includes('pricing-maple-7') && moveAudit, `status ${moved.status} ${moved.body?.error || ''}`);
const stolen = await hit('POST', `/v4/memories/${surenTeam.body.document?.id || surenTeam.body.id}/move`, 'tj', { to: 'private' });
check('non-author cannot move a memory', stolen.status === 403);

const tjOnly = await save('tj', 'Team only: amber-lock-55', 'team');
const erased = await hit('DELETE', `/v4/governance/memories/${tjOnly.body.document?.id || ''}`, 'suren');
check('member cannot erase another author team memory', erased.status === 403 || erased.body?.ok === false, `status ${erased.status}`);

const removed = await hit('POST', `/v4/teams/${teamId}/members/suren/remove`, 'tj');
const afterRemove = await blobFor('suren');
check('remove cuts team access on the next read', removed.status === 200 && !afterRemove.includes('lisbon-orchid-9') && !afterRemove.includes('cedar-team-12'));

const again = await hit('POST', `/v4/teams/${teamId}/invites`, 'tj', { role: 'member', publicKey: 'tj-key-2' });
const againAccept = await hit('POST', '/v4/teams/invites/accept', 'suren', { token: again.body.token, publicKey: 'suren-key-2' });
await hit('POST', `/v4/teams/invites/${againAccept.body.id}/confirm`, 'suren', { match: true });
await hit('POST', `/v4/teams/invites/${againAccept.body.id}/confirm`, 'tj', { match: true });
const rejoined = await hit('POST', '/v4/search', 'suren', { query: 'cedar-team-12', scope: 'team', teamId });
check('re-invite restores team search', rejoined.status === 200 && has(rejoined.body, 'cedar-team-12'));

const expired = await hit('POST', `/v4/teams/${teamId}/invites`, 'tj', { publicKey: 'tj-key-3' });
const expiredRow = getState().teamInvites.find((row) => row.id === expired.body.id);
if (expiredRow) expiredRow.expiresAt = new Date(Date.now() - 1000).toISOString();
const expiredAccept = await hit('POST', '/v4/teams/invites/accept', 'outsider', { token: expired.body.token, publicKey: 'x' });
check('expired invite is rejected', expiredAccept.status >= 400);

const reused = await hit('POST', '/v4/teams/invites/accept', 'outsider', { token: invited.body.token, publicKey: 'x' });
check('reused invite is rejected', reused.status >= 400);
const selfInvite = await hit('POST', '/v4/teams/invites/accept', 'tj', { token: again.body.token, publicKey: 'x' });
check('self-invite is rejected', selfInvite.status >= 400);

const lockedInvite = await hit('POST', `/v4/teams/${teamId}/invites`, 'tj', { publicKey: 'tj-lock' });
let lockedStatus = 0;
for (let i = 0; i < 6; i += 1) {
  const bad = await hit('POST', '/v4/teams/invites/accept', 'outsider', { id: lockedInvite.body.id, code: 'WRONGCODE', publicKey: 'x' });
  lockedStatus = bad.status;
}
check('five bad codes lock the invite', lockedStatus === 429);

const mismatch = await hit('POST', `/v4/teams/${teamId}/invites`, 'tj', { publicKey: 'tj-mis' });
const mismatchAccept = await hit('POST', '/v4/teams/invites/accept', 'outsider', { token: mismatch.body.token, publicKey: 'out-key' });
const mismatchConfirm = await hit('POST', `/v4/teams/invites/${mismatchAccept.body.id}/confirm`, 'outsider', { match: false });
check('emoji mismatch revokes the invite', mismatchConfirm.body.status === 'revoked');

const memberInvite = await hit('POST', `/v4/teams/${teamId}/invites`, 'suren', { publicKey: 'nope' });
check('member cannot invite', memberInvite.status === 403);
const ownerLeave = await hit('POST', `/v4/teams/${teamId}/leave`, 'tj');
check('last owner cannot leave', ownerLeave.status === 400);

const founders = await hit('POST', '/v4/teams/spaces', 'tj', { orgId, slug: 'founders', name: 'Founders' });
const foundersInvite = await hit('POST', `/v4/teams/${founders.body.team?.id}/invites`, 'tj', { role: 'member', publicKey: 'tj-f' });
check('founders space rejects a member invite', founders.status === 200 && foundersInvite.status === 403);
const surenSpaces = readTagsFor('suren', { scope: 'all' });
check('founders space is invisible to a member', !surenSpaces.some((tag) => tag === founders.body.tag));

const spoof = await hit('POST', '/v4/search', 'suren', { query: 'sourdough-violet-42', containerTag: 'u_tj', containerTags: ['u_tj'] });
const spoofTeam = await hit('POST', '/v4/search', 'suren', { query: 'secret', scope: 'team', teamId: 'team_not_mine' });
check('spoofed private tag returns no foreign rows', spoof.status < 500 && !JSON.stringify(spoof.body.matches || []).includes('sourdough-violet-42'));
check('spoofed team id is rejected', spoofTeam.status === 403);

check(
  'existing org_rukmer is unchanged',
  JSON.stringify(getState().orgs.find((org) => org.id === 'org_rukmer')) === legacyOrg &&
    JSON.stringify(getState().orgMembers.filter((member) => member.orgId === 'org_rukmer')) === legacyMembers
);

server.close();
if (failures.length) {
  console.error(`\n${failures.length} team-brain checks failed`);
  process.exit(1);
}
console.log('\nteam-brain checks passed');
