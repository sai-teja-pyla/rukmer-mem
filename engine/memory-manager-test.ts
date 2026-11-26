/**
 * Memory manager: list, manual add, soft delete, restore, cleanup, retention.
 * Run: npm run memory-manager
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-memories-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.MEMORY_DATA_KEY;
delete process.env.NODE_ENV;
delete process.env.K_SERVICE;

const { getState, saveState } = await import('./core.js');
const { homeTag } = await import('./tenancy.js');
const { ingestDocument, searchMemory } = await import('./pipeline.js');
const { createOrg, addOrgMember } = await import('./scopes.js');
const { isChatter } = await import('./quality.js');
const gov = await import('./governance.js');
const mgr = await import('./memoryManager.js');
const { mountMemoryEngine } = await import('./routes.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const note = 'ok cool';
check('short note would be skipped as chatter', isChatter(note) && isChatter('What coffee do I prefer?'));
const created = await mgr.createManualMemory('usera', { text: note, title: 'short note' });
const question = await mgr.createManualMemory('usera', { text: 'What coffee do I prefer?' });
const secret = await mgr.createManualMemory('usera', { text: 'Remember the deploy key rk_live_abc123def456 for later.' });
const stored = getState().documents.find((doc) => doc.id === created.memories[0].id);
const secretDoc = getState().documents.find((doc) => doc.id === secret.memories[0].id);
check('manual create stores a short note', !!stored && stored.text === note && stored.source === 'user' && stored.gov?.extraction === 'manual');
check('question-like note is stored', question.memories.some((row) => row.text.includes('What coffee')));
check('redaction masks a credential', !!secretDoc && !secretDoc.text.includes('rk_live_abc123def456') && secretDoc.text.includes('[REDACTED:credentials]'));

const fields = ['id', 'recordType', 'title', 'text', 'preview', 'source', 'kind', 'containerTag', 'visibility', 'teamId', 'ownerId', 'createdBy', 'createdAt', 'expiresAt', 'archived', 'forgotten', 'deletedAt', 'canErase', 'canEdit'];
check('list item has the manager fields', fields.every((field) => field in created.memories[0]));

for (let i = 0; i < 3; i += 1) {
  await ingestDocument({
    title: `page ${i}`,
    text: `paging-token-${i} stays on its own row`,
    containerTag: homeTag('usera'),
    actorId: 'usera',
    source: 'user',
    extract: false,
  });
}
const page1 = mgr.listMemories('usera', { limit: 2, recordType: 'document', q: 'paging-token' });
const page2 = mgr.listMemories('usera', { limit: 2, recordType: 'document', q: 'paging-token', cursor: page1.nextCursor || '' });
const pageIds = new Set([...page1.memories, ...page2.memories].map((row) => row.id));
check('list is paginated', page1.total === 3 && page1.memories.length === 2 && page2.memories.length === 1 && pageIds.size === 3, `total=${page1.total}`);
const foreign = mgr.listMemories('userb', { q: 'paging-token' });
check('another user sees none of the private memories', foreign.total === 0 && foreign.memories.length === 0);

const team = gov.createTeam('author', 'Lab');
gov.addTeamMember('author', team.id, 'mate');
const shared = await ingestDocument({
  title: 'team note',
  text: 'Launch decision maple-squad stays with the team.',
  containerTag: homeTag('author'),
  actorId: 'author',
  visibility: 'team',
  teamId: team.id,
  source: 'user',
  extract: false,
});
const mate = mgr.listMemories('mate', { scope: 'team', q: 'maple-squad' });
const stranger = mgr.listMemories('stranger', { q: 'maple-squad' });
check('teammate can read the team memory', mate.memories.some((row) => row.id === shared.document.id));
check('stranger cannot read the team memory', stranger.total === 0);
const blocked = mgr.forgetMemoriesMatching({ actor: 'mate', query: 'maple-squad', dryRun: false });
const stillThere = getState().documents.find((doc) => doc.id === shared.document.id);
check('teammate cannot retire a memory they did not author', blocked.count === 0 && stillThere?.forgotten !== true);

const member = getState().teamMembers.find((row) => row.uid === 'mate' && row.teamId === team.id);
if (member) member.status = 'removed';
saveState();
check('removed teammate loses the team memory', mgr.listMemories('mate', { q: 'maple-squad' }).total === 0);
if (member) member.status = 'active';
saveState();

const live = await mgr.createManualMemory('usera', { text: 'Keep the violet-harbor token on the shelf.' });
const liveId = live.memories[0].id;
const chunk = getState().chunks.find((row) => row.docId === liveId);
const embedding = chunk?.embedding?.slice() || [];
const found = await searchMemory('violet-harbor', { containerTag: homeTag('usera'), actorId: 'usera', topK: 5 });
check('new memory can be retrieved', found.matches.some((row) => /violet-harbor/i.test(row.text)));
const preview = mgr.forgetMemoriesMatching({ actor: 'usera', ids: [liveId], dryRun: true });
check('dry run writes nothing', preview.dryRun === true && preview.count === 1 && getState().documents.some((doc) => doc.id === liveId && !doc.forgotten));
const soft = mgr.retireMemories('usera', [liveId]);
const hidden = await searchMemory('violet-harbor', { containerTag: homeTag('usera'), actorId: 'usera', topK: 5 });
const afterSoft = getState().chunks.find((row) => row.id === chunk?.id);
const defaultList = mgr.listMemories('usera', { q: 'violet-harbor' });
const trash = mgr.listMemories('usera', { q: 'violet-harbor', onlyDeleted: true });
check('soft delete hides the memory', soft.permanent === false && defaultList.total === 0 && hidden.matches.length === 0);
check('soft delete keeps text and embedding', !!afterSoft && afterSoft.text.length > 0 && afterSoft.embedding.join(',') === embedding.join(','));
check('trash shows the soft-deleted row to the owner', trash.memories.some((row) => row.id === liveId && row.forgotten));
check('someone else cannot see the trash', mgr.listMemories('userb', { q: 'violet-harbor', includeDeleted: true }).total === 0);
const back = mgr.restoreMemories('usera', [liveId]);
const restored = getState().documents.find((doc) => doc.id === liveId);
const foundAgain = await searchMemory('violet-harbor', { containerTag: homeTag('usera'), actorId: 'usera', topK: 5 });
check('restore brings the text back', back.ok === true && restored?.forgotten === false && restored?.text.includes('violet-harbor') && foundAgain.matches.length > 0);

const permanent = await mgr.createManualMemory('usera', { text: 'Erase the quartz-keepsake from the shelf.' });
const hard = mgr.retireMemories('usera', [permanent.memories[0].id], { permanent: true });
check('permanent delete removes the document', hard.permanent === true && !getState().documents.some((doc) => doc.id === permanent.memories[0].id));
const legacy = await ingestDocument({
  title: 'legacy',
  text: 'Erase the violet-keepsake from the index.',
  containerTag: homeTag('usera'),
  actorId: 'usera',
  extract: false,
});
const erased = gov.eraseMemory('usera', legacy.document.id);
check('eraseMemory still hard-purges', erased.ok === true && !getState().documents.some((doc) => doc.id === legacy.document.id));

const factDoc = await mgr.createManualMemory('usera', { text: 'I prefer violet-harbor tea.' });
const factRow = factDoc.memories.find((row) => row.recordType === 'fact');
const docRow = factDoc.memories.find((row) => row.recordType === 'document');
if (factRow && docRow) mgr.retireMemories('usera', [factRow.id]);
check(
  'deleting a fact leaves the document',
  !!factRow && !!docRow && !getState().triples.some((fact) => fact.id === factRow.id && !fact.forgotten) && getState().documents.some((doc) => doc.id === docRow.id && !doc.forgotten)
);

await ingestDocument({ title: 'same', text: 'Hello World!', containerTag: homeTag('usera'), actorId: 'usera', source: 'user', extract: false });
await ingestDocument({ title: 'same again', text: 'hello world', containerTag: homeTag('usera'), actorId: 'usera', source: 'user', extract: false });
const nearA = await ingestDocument({ title: 'near a', text: 'alpha orbit signal one', containerTag: homeTag('usera'), actorId: 'usera', source: 'user', extract: false });
const nearB = await ingestDocument({ title: 'near b', text: 'beta quarry signal two', containerTag: homeTag('usera'), actorId: 'usera', source: 'user', extract: false });
const vec = [1, 0, 0, 0];
for (const id of [nearA.document.id, nearB.document.id]) {
  const row = getState().chunks.find((chunkRow) => chunkRow.docId === id);
  if (row) row.embedding = vec.slice();
}
saveState();
const dupDry = mgr.findDuplicateMemories('usera', { dryRun: true, threshold: 0.92 });
const exact = dupDry.clusters.find((cluster) => cluster.reason === 'exact' && /hello world/i.test(cluster.keep.text));
const near = dupDry.clusters.find((cluster) => cluster.drop.some((row) => row.id === nearA.document.id || row.id === nearB.document.id));
check('exact normalized text clusters', !!exact && exact.drop.length >= 1);
check('high cosine clusters as near', !!near && near.reason === 'near' && near.score >= 0.92);
check('duplicate preview deletes nothing', dupDry.dryRun === true && getState().documents.filter((doc) => /hello world/i.test(doc.text) && !doc.forgotten).length >= 2);
const dup = mgr.findDuplicateMemories('usera', { dryRun: false, threshold: 0.92 });
const dropped = new Set(dup.clusters.flatMap((cluster) => cluster.drop.map((row) => row.id)));
const kept = new Set(dup.clusters.map((cluster) => cluster.keep.id));
check(
  'confirm retires only the drop rows',
  dup.dryRun === false && [...dropped].every((id) => getState().documents.find((doc) => doc.id === id)?.forgotten === true) && [...kept].every((id) => getState().documents.find((doc) => doc.id === id)?.forgotten !== true)
);

await ingestDocument({ title: 'chat dump', text: 'Assistant: the capital of Mongolia is Ulaanbaatar.', containerTag: homeTag('usera'), actorId: 'usera', source: 'gemini-router', extract: false });
await ingestDocument({ title: 'openai dump', text: 'Assistant reply from openai.', containerTag: homeTag('usera'), actorId: 'usera', source: 'openai-router', extract: false });
const keptUser = await mgr.createManualMemory('usera', { text: 'A user note that is not junk.' });
const junkDry = mgr.forgetMemoriesMatching({ actor: 'usera', junk: true, dryRun: true });
check('junk preview selects router sources only', junkDry.ids.length >= 2 && junkDry.ids.every((id) => mgr.junkSource(getState().documents.find((doc) => doc.id === id)?.source || '')) && !junkDry.ids.includes(keptUser.memories[0].id));
check('junk dry run does not delete', getState().documents.some((doc) => doc.source === 'gemini-router' && !doc.forgotten));
const junk = mgr.forgetMemoriesMatching({ actor: 'usera', junk: true, dryRun: false });
check('junk confirm retires router memories', junk.count >= 2 && getState().documents.filter((doc) => mgr.junkSource(doc.source)).every((doc) => doc.forgotten));

const expiring = await ingestDocument({
  title: 'old',
  text: 'stale-lantern should expire',
  containerTag: homeTag('usera'),
  actorId: 'usera',
  source: 'user',
  extract: false,
});
const expiringRow = getState().documents.find((doc) => doc.id === expiring.document.id);
if (expiringRow?.gov) expiringRow.gov.expiresAt = new Date(Date.now() - 1000).toISOString();
saveState();
const expiredDry = mgr.forgetMemoriesMatching({ actor: 'usera', expired: true, dryRun: true });
check('expired preview includes the stale row and writes nothing', expiredDry.ids.includes(expiring.document.id) && !getState().documents.find((doc) => doc.id === expiring.document.id)?.forgotten);

gov.setRetention('usera', { tenantId: homeTag('usera'), memoryKind: 'context', ttlDays: 10, action: 'purge' });
check('home retention updates ttl', gov.ttlFor(homeTag('usera'), 'context').days === 10 && gov.ttlFor(homeTag('usera'), 'context').action === 'purge');
gov.setRetention('usera', { tenantId: homeTag('usera'), memoryKind: 'context', ttlDays: 0, action: 'archive' });
check('zero days means keep', gov.ttlFor(homeTag('usera'), 'context').days === 0 && gov.expiresOn(homeTag('usera'), 'context') === null);
const keptForever = await ingestDocument({
  title: 'keep',
  text: 'context that should not expire immediately',
  containerTag: homeTag('usera'),
  actorId: 'usera',
  memoryKind: 'context',
  extract: false,
});
check('ttl zero does not stamp an expiry', getState().documents.find((doc) => doc.id === keptForever.document.id)?.gov?.expiresAt == null);
const org = createOrg('usera', 'Mem Lab');
addOrgMember('usera', org.id, 'userb');
let denied = false;
try {
  gov.setRetention('userb', { tenantId: org.id, memoryKind: 'context', ttlDays: 3, action: 'purge' });
} catch (err) {
  denied = (err as { status?: number }).status === 403;
}
check('non-admin cannot change another tenant', denied);
let missing = false;
try {
  await mgr.createManualMemory('usera', { text: '   ' });
} catch (err) {
  missing = (err as { status?: number }).status === 400;
}
check('empty text is rejected', missing);
const file = await ingestDocument({
  title: 'scan',
  text: 'a scanned page',
  containerTag: homeTag('usera'),
  actorId: 'usera',
  mime: 'application/pdf',
  fileId: 'file_1',
  extract: false,
});
let locked = false;
try {
  await mgr.updateManualMemory('usera', file.document.id, { text: 'changed' });
} catch (err) {
  locked = (err as { status?: number }).status === 409;
}
check('file memories cannot be edited', locked);
const edited = await mgr.updateManualMemory('usera', keptForever.document.id, { text: 'context renamed to amber-lantern', title: 'renamed' });
check('edit replaces the text', edited.memory.text.includes('amber-lantern') && edited.memory.title === 'renamed');

const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as { port: number }).port;
async function hit(method: string, urlPath: string, user: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-rukmer-user': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, cache: res.headers.get('cache-control') || '' };
}
const anon = await hit('GET', '/v4/memories', '');
const listed = await hit('GET', '/v4/memories?limit=1', 'usera');
const added = await hit('POST', '/v4/memories', 'usera', { text: 'route-token added by hand' });
const addedId = added.data.memories?.[0]?.id || '';
const removed = await hit('DELETE', '/v4/memories', 'usera', { ids: [addedId] });
const still = getState().documents.find((doc) => doc.id === addedId);
const gone = await hit('DELETE', '/v4/memories', 'usera', { ids: [addedId], permanent: true });
check('signed out list is 401', anon.status === 401);
check('list route is private and paginated', listed.status === 200 && listed.cache.includes('no-store') && Array.isArray(listed.data.memories) && 'total' in listed.data);
check('create route stores a user memory', added.status === 201 && added.data.memories?.[0]?.source === 'user');
check('delete route defaults to soft', removed.status === 200 && removed.data.permanent === false && still?.forgotten === true && still.text.includes('route-token'));
check('permanent flag purges', gone.status === 200 && gone.data.permanent === true && !getState().documents.some((doc) => doc.id === addedId));
server.close();

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
