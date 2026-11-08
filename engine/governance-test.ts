/**
 * Isolation, redaction, retention, and erasure.
 * Run: npm run governance
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-gov-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;
delete process.env.MEMORY_DATA_KEY;

const { encryptionWarning, getState, loadState, saveState } = await import('./core.js');
const { homeTag } = await import('./tenancy.js');
const { ingestDocument, searchMemory, readDocument } = await import('./pipeline.js');
const { createOrg, addOrgMember } = await import('./scopes.js');
const gov = await import('./governance.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('missing data key warns', (encryptionWarning() || '').includes('MEMORY_DATA_KEY is not set'));

const secret = 'I prefer tea. The deploy key is rk_live_abc123def456 and the card is 4242424242424242.';
const written = await ingestDocument({
  title: 'note',
  text: secret,
  containerTag: homeTag('usera'),
  source: 'api',
  actorId: 'usera',
  memoryKind: 'preference',
});
const stored = getState().documents.find((d) => d.id === written.document.id);
const blob = `${stored?.title || ''}\n${stored?.text || ''}\n${getState().chunks.map((c) => c.text).join('\n')}`;
check('secret is masked', !blob.includes('rk_live_abc123def456') && blob.includes('[REDACTED:credentials]'));
check('card is masked', !blob.includes('4242424242424242') && blob.includes('[REDACTED:payment]'));
check('preference text remains', /tea/i.test(blob));
check('new memory is private', stored?.gov?.visibility === 'private' && stored.gov.ownerId === 'usera');
check('write is audited', getState().audit.some((row) => row.action === 'write' && row.memoryId === written.document.id));

gov.setRedaction('usera', { tenantId: homeTag('usera'), credentials: 'drop' });
let dropped = false;
try {
  await ingestDocument({
    title: 'blocked',
    text: 'token=rk_live_zzzzzzzzzzzz',
    containerTag: homeTag('usera'),
    actorId: 'usera',
  });
} catch (err) {
  dropped = (err as { status?: number }).status === 422;
}
check('drop policy rejects the write', dropped);
check('dropped secret was not stored', !getState().documents.some((d) => d.title === 'blocked' || /rk_live_zzzz/.test(d.text)));
gov.setRedaction('usera', { tenantId: homeTag('usera'), credentials: 'mask' });

await ingestDocument({
  title: 'marker',
  text: 'User A keeps the cedar-token in a green tin.',
  containerTag: homeTag('usera'),
  actorId: 'usera',
});
const leaked = await searchMemory('cedar-token', { containerTag: homeTag('usera'), actorId: 'userb', topK: 5 });
const own = await searchMemory('cedar-token', { containerTag: homeTag('usera'), actorId: 'usera', topK: 5 });
check('other user cannot retrieve the memory', leaked.matches.length === 0);
check('owner can retrieve the memory', own.matches.some((m) => /cedar-token/i.test(m.text)));
check('other user cannot open the document', readDocument(written.document.id, 'userb') === null);

const org = createOrg('usera', 'Gov Lab');
addOrgMember('usera', org.id, 'userb');
const priv = await ingestDocument({
  title: 'private org note',
  text: 'The quiet plan is lilac-only.',
  containerTag: org.id,
  actorId: 'usera',
});
const shared = await ingestDocument({
  title: 'shared org note',
  text: 'The shared plan is cedar-shared.',
  containerTag: org.id,
  actorId: 'usera',
  visibility: 'org',
});
const memberPriv = await searchMemory('lilac-only', { containerTag: org.id, actorId: 'userb', topK: 5 });
const memberShared = await searchMemory('cedar-shared', { containerTag: org.id, actorId: 'userb', topK: 5 });
const outsider = await searchMemory('cedar-shared', { containerTag: org.id, actorId: 'userc', topK: 5 });
check('org member cannot see a private memory', memberPriv.matches.length === 0, priv.document.id);
check('org member can see an org memory', memberShared.matches.some((m) => /cedar-shared/i.test(m.text)));
check('outsider cannot see the org memory', outsider.matches.length === 0, shared.document.id);

const team = gov.createTeam('usera', 'Platform');
gov.addTeamMember('usera', team.id, 'userb');
await ingestDocument({
  title: 'team note',
  text: 'The team password phrase is maple-squad.',
  containerTag: homeTag('usera'),
  actorId: 'usera',
  visibility: 'team',
  teamId: team.id,
});
const teammate = await searchMemory('maple-squad', {
  containerTags: gov.scopeTagsForActor('userb', homeTag('userb')),
  actorId: 'userb',
  topK: 5,
});
const stranger = await searchMemory('maple-squad', {
  containerTags: gov.scopeTagsForActor('userc', homeTag('userc')),
  actorId: 'userc',
  topK: 5,
});
check('teammate can see a team memory', teammate.matches.some((m) => /maple-squad/i.test(m.text)));
check('stranger cannot see a team memory', stranger.matches.length === 0);

const doomed = await ingestDocument({
  title: 'gone',
  text: 'Erase the violet-keepsake from the index.',
  containerTag: homeTag('usera'),
  actorId: 'usera',
});
const chunk = getState().chunks.find((c) => c.docId === doomed.document.id);
check('chunk has an embedding before delete', !!chunk?.embedding?.length);
const erased = gov.eraseMemory('usera', doomed.document.id);
const after = await searchMemory('violet-keepsake', { containerTag: homeTag('usera'), actorId: 'usera', topK: 5 });
check('erase removes the document', erased.ok === true && !getState().documents.some((d) => d.id === doomed.document.id));
check('erase removes the embedding', !getState().chunks.some((c) => c.docId === doomed.document.id && (c.embedding?.length || 0) > 0));
check('search misses the erased memory', after.matches.length === 0);

const preview = gov.eraseBulk('usera', 'owner', 'usera', true);
check('dry-run deletes nothing', preview.dryRun === true && getState().documents.some((d) => d.id === written.document.id));
const wiped = gov.eraseBulk('usera', 'owner', 'usera', false);
check('owner erasure removes their rows', wiped.removed > 0 && !getState().documents.some((d) => d.gov?.ownerId === 'usera' && d.containerTag === homeTag('usera')));

const expiring = await ingestDocument({
  title: 'session',
  text: 'Session scratch says amber-ttl.',
  containerTag: homeTag('userd'),
  actorId: 'userd',
  memoryKind: 'session',
});
const row = getState().documents.find((d) => d.id === expiring.document.id);
if (row?.gov) row.gov.expiresAt = new Date(Date.now() - 1000).toISOString();
for (const chunkRow of getState().chunks) {
  if (chunkRow.docId === expiring.document.id && chunkRow.gov) chunkRow.gov.expiresAt = row?.gov?.expiresAt || null;
}
saveState();
const sweep = gov.runExpiry('userd');
check('expired session is purged', sweep.purged > 0 && !getState().documents.some((d) => d.id === expiring.document.id));

const phrase = 'encrypt-me-quartz';
await ingestDocument({
  title: 'sealed',
  text: `Keep ${phrase} in the vault.`,
  containerTag: homeTag('usere'),
  actorId: 'usere',
});
process.env.MEMORY_DATA_KEY = 'a'.repeat(64);
saveState();
const rawFile = fs.readFileSync(path.join(dir, 'engine.json'), 'utf8');
check('store is encrypted at rest', rawFile.includes('"enc":"v1"') && !rawFile.includes(phrase));
await loadState();
check('encrypted store reloads the memory', getState().documents.some((d) => d.text.includes(phrase)));

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
