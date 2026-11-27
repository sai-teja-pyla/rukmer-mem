/**
 * Gmail token health and Chrome connection honesty.
 * Run: npx tsx engine/gmail-oauth-health-test.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-gmail-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';

const { gmailConnectionStatus, gmailFailureResponse, mergeGmailTokens } = await import('./gmailOauth.js');
const { gmailMemoryCount, gmailSkipReason, prepareGmailMessage, saveGmailMessages } = await import('./gmailSync.js');
const { browserConnectorView, browserDisplayStatus, createBrowserPair, claimBrowserPair } = await import('./browserConnector.js');
const { bootMemoryEngine, mountMemoryEngine } = await import('./routes.js');
const { getState } = await import('./core.js');
const { searchMemory } = await import('./pipeline.js');
const { homeTag } = await import('./tenancy.js');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('no gmail token is disconnected even if drive tokens exist', gmailConnectionStatus(undefined).status === 'disconnected');
check('a drive-scoped record without a gmail refresh token is not connected', gmailConnectionStatus({ access_token: 'ya29', scope: 'https://www.googleapis.com/auth/drive.readonly' }).status === 'disconnected');
check('invalid gmail grant is reconnect required', gmailConnectionStatus({ refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/gmail.readonly', health: 'reconnect_required' }).connected === false);
const mapped = gmailFailureResponse({ message: 'invalid_grant: Token has been expired or revoked.' });
check('sync maps invalid_grant to a safe message', mapped.status === 409 && mapped.body.error === 'reconnect_required' && !JSON.stringify(mapped.body).includes('invalid_grant'));
const kept = mergeGmailTokens({ refresh_token: 'old', scope: 'https://www.googleapis.com/auth/gmail.readonly' }, { access_token: 'new' });
check('reconnect keeps the previous refresh token', kept.refresh_token === 'old' && kept.access_token === 'new');
check('otp mail is still skipped', gmailSkipReason('Your code', 'Your verification code is 123456') === 'one-time code');
check('gmail dedupe key is stable', prepareGmailMessage({ id: 'm1', subject: 'Hello', from: 'a@b.c', date: '', body: 'A normal note' })?.sourceRef === 'gmail:m1');

await bootMemoryEngine();
const saved = await saveGmailMessages('mailuser', [
  { id: 'm1', subject: 'Lunch', from: 'a@b.c', date: '', body: 'Meet at noon' },
  { id: 'm1', subject: 'Lunch', from: 'a@b.c', date: '', body: 'Meet at noon' },
  { id: 'otp', subject: 'Code', from: 'a@b.c', date: '', body: 'Your verification code is 123456' },
]);
check('gmail import counts and dedupes', saved.imported === 1 && gmailMemoryCount('mailuser') === 1);
const found = await searchMemory('Meet at noon', { containerTag: homeTag('mailuser'), actorId: 'mailuser', topK: 4 });
check('gmail mail is searchable in that space', found.matches.some((hit) => hit.source === 'gmail' && /noon/i.test(hit.text)));

const express = (await import('express')).default;
const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;
async function hit(method: string, urlPath: string, body?: unknown, user = 'extuser') {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-rukmer-user': user },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
const stale = browserConnectorView('extuser');
check('a keyless browser is disconnected', stale.status === 'disconnected' && stale.lastSync === null);
const pair = createBrowserPair('extuser');
const claimed = await claimBrowserPair(pair.code, 'Chrome');
const leftover = browserConnectorView('extuser');
check('a fresh browser key is not a healthy sync', leftover.hasKey === true && leftover.items === 0 && leftover.status === 'setup_incomplete' && leftover.lastSync === null && String(claimed?.access_token || '').startsWith('rk_live_'));
check('no extension means not connected', browserDisplayStatus(leftover, false) === 'extension_missing');
await hit('POST', '/v3/documents', { title: 'Inbox', text: 'A page from gmail', source: 'browser-extension', metadata: { site: 'gmail', browser: 'Chrome', captured_at: '2026-11-20T00:00:00.000Z' } });
const after = browserConnectorView('extuser');
check('a saved page increments items and gmail count', after.items === 1 && after.sites.gmail === 1 && after.status === 'connected' && after.lastSync === '2026-11-20T00:00:00.000Z');
const gone = await hit('POST', '/v4/connectors/disconnect', { app: 'browser' });
const afterDisconnect = browserConnectorView('extuser');
check('disconnect forgets the browser key', gone.status === 200 && afterDisconnect.status === 'disconnected' && getState().apiKeys.every((key) => key.connector !== 'browser' || key.ownerUid !== 'extuser'));

server.close();
if (failures.length) {
  console.error(`\n${failures.length} gmail/browser check(s) failed`);
  process.exit(1);
}
console.log('\ngmail and browser checks passed');
