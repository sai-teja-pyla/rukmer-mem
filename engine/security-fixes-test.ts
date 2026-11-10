/**
 * Focused checks for the six security fixes.
 * Run: npm run security-fixes
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { claimedUserMismatch } from './actorGuard.js';
import { consumeOauthState, issueOauthState, memoryOauthStore } from './oauthLink.js';
import { linesVisibleInChannel, slackAccountForMention } from './channelReply.js';
import { debugRoutesEnabled } from './security.js';
import { isProPlan } from '../src/services/plan.js';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('matching user id is accepted', claimedUserMismatch('user-a', 'user-a') === false);
check('missing user id is left to the session', claimedUserMismatch('user-a', '') === false);
check('foreign user id is rejected', claimedUserMismatch('user-a', 'user-b') === true);
check('query user id is rejected', claimedUserMismatch('user-a', 'user-b') === true);

const secret = 'test-oauth-state-secret';
const store = memoryOauthStore();
const state = await issueOauthState({ uid: 'owner-1', purpose: 'google', type: 'gmail', secret, store, ttlMs: 1000 });
const linked = await consumeOauthState(state, { purpose: 'google', secret, store });
check('oauth state binds the signed-in user', linked?.uid === 'owner-1' && linked.type === 'gmail');
check('oauth state is single use', (await consumeOauthState(state, { purpose: 'google', secret, store })) === null);
const slackState = await issueOauthState({ uid: 'owner-1', purpose: 'slack', type: 'slack', secret, store });
check('oauth state purpose is checked', (await consumeOauthState(slackState, { purpose: 'google', secret, store })) === null);
const [body] = slackState.split('.');
check('forged oauth state is rejected', (await consumeOauthState(`${body}.not-the-mac`, { purpose: 'slack', secret, store })) === null);
const expiredStore = memoryOauthStore();
const expired = await issueOauthState({ uid: 'owner-1', purpose: 'microsoft', type: 'outlook', secret, store: expiredStore, ttlMs: -1 });
check('expired oauth state is rejected', (await consumeOauthState(expired, { purpose: 'microsoft', secret, store: expiredStore })) === null);
const plain = Buffer.from(JSON.stringify({ userId: 'victim' })).toString('base64');
check('unsigned base64 state is rejected', (await consumeOauthState(plain, { purpose: 'google', secret, store })) === null);

process.env.VITE_GEMINI_API_KEY = 'client-secret-should-not-be-used';
delete process.env.GEMINI_API_KEY;
const { geminiKey } = await import('./llm.js');
check('gemini key is not read from the client env', geminiKey() === '');
process.env.GEMINI_API_KEY = 'server-key';
check('gemini key is read from the server env', geminiKey() === 'server-key');
delete process.env.GEMINI_API_KEY;
delete process.env.VITE_GEMINI_API_KEY;

delete process.env.ENABLE_DEBUG_ROUTES;
check('debug routes are off by default', debugRoutesEnabled() === false);
process.env.ENABLE_DEBUG_ROUTES = 'false';
check('debug routes ignore a false flag', debugRoutesEnabled() === false);
process.env.ENABLE_DEBUG_ROUTES = 'true';
check('debug routes turn on only for the exact flag', debugRoutesEnabled() === true);
delete process.env.ENABLE_DEBUG_ROUTES;

check('private memory stays out of a channel', linesVisibleInChannel([
  { text: 'secret preference', visibility: 'private' },
  { text: 'team plan', visibility: 'team' },
  { text: 'org note', visibility: 'org' },
]) === 'team plan\norg note');
check('unlinked slack user gets no account', slackAccountForMention([{ uid: 'owner', slackUserId: 'U1' }], 'U2') === '');
check('mention maps to the slack user who connected', slackAccountForMention([{ uid: 'owner', slackUserId: 'U1' }], 'U1') === 'owner');

check('missing plan is not pro', isProPlan(null) === false);
check('free plan is not pro', isProPlan({ plan: 'free' }) === false);
check('active pro plan is pro', isProPlan({ plan: 'pro' }) === true);
check('canceled billing is not pro', isProPlan({ billing: { plan: 'pro', status: 'canceled' } }) === false);
check('client isPro flag is ignored', isProPlan({ plan: 'free', isPro: true } as { plan: string }) === false);

const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
check('rules default to deny', rules.includes('match /{document=**}') && rules.includes('allow read, write: if false'));
check('rules keep billing fields off the client', rules.includes('billingUnchanged') && rules.includes("'plan'"));
check('rules scope user documents to the owner', rules.includes('request.auth.uid == uid'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-fixes-'));
process.env.MEMORY_DATA_DIR = dir;
process.env.RUKMER_LOCAL_EXTRACT = '1';
delete process.env.K_SERVICE;
const { mountMemoryEngine } = await import('./routes.js');
const { getState, uid } = await import('./core.js');
const { homeTag } = await import('./tenancy.js');
const app = express();
app.use(express.json());
mountMemoryEngine(app);
const server = await new Promise<import('http').Server>((resolve) => {
  const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
});
const port = (server.address() as { port: number }).port;

async function hit(urlPath: string, user = '') {
  const headers = new Headers();
  if (user) headers.set('x-rukmer-user', user);
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

const tag = homeTag('usera');
getState().triples.push({
  id: uid('trip'),
  containerTag: tag,
  subject: 'Alex',
  predicate: 'prefers',
  object: 'saffron-tea',
  evidence: 'only for user b',
  isLatest: true,
  derived: false,
  validFrom: new Date().toISOString(),
  validTo: null,
  kind: 'assert',
  gov: {
    ownerId: 'userb',
    tenantId: tag,
    visibility: 'private',
    createdBy: 'userb',
    memoryKind: 'fact',
  },
});
const graph = await hit(`/v4/graph?containerTag=${encodeURIComponent(tag)}`, 'usera');
const profile = await hit('/v4/profile', 'usera');
const graphText = JSON.stringify(graph.body);
const profileText = JSON.stringify(profile.body);
check('graph hides another users private row', graph.status === 200 && !graphText.includes('saffron-tea'));
check('profile hides another users private row', profile.status === 200 && !profileText.includes('saffron-tea'));

server.close();

if (failures.length) {
  console.error(`\n${failures.length} security fix check(s) failed`);
  process.exit(1);
}
console.log('\nsecurity fix checks passed');
