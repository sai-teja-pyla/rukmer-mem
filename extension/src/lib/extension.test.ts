import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isBlocked, hasSecretFields } from './blocklist.js';
import { canvasSkipsPrivate } from './canvas.js';
import { pageKey, sameCapture } from './dedupe.js';
import { dwellReady, scrolledMeaningfully } from './dwell.js';
import { redactSecrets, shouldSkipEmail } from './gmail.js';
import { enqueue, retryAt, takeReady, type Job } from './queue.js';
import { stripUrl, ownedTag } from './url.js';
import { xDedupeKey, xPostId } from './x.js';

process.env.MEMORY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rukmer-ext-'));
delete process.env.K_SERVICE;
delete process.env.MEMORY_GCS_BUCKET;

const failures: string[] = [];
function check(name: string, ok: boolean) {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}`);
}

const policy = { blocklist: [], removedDefaults: [], allowlistOnly: false, allowlist: [], canvasDomain: 'canvas.school.edu', gmail: false, canvas: false, x: false };
check('bank is blocked', isBlocked('https://www.chase.com/account', policy));
check('localhost is blocked', isBlocked('http://localhost:3000/app', policy));
check('file is blocked', isBlocked('file:///tmp/secret.txt', policy));
check('checkout is blocked', isBlocked('https://shop.example.com/checkout', policy));
check('article is allowed', !isBlocked('https://example.com/docs', policy));
check('gmail stays blocked until opted in', isBlocked('https://mail.google.com/mail/u/0/', policy));
check('gmail opens for the gmail toggle', !isBlocked('https://mail.google.com/mail/u/0/', { ...policy, gmail: true }, 'gmail'));
check('gmail stays blocked for auto-read', isBlocked('https://mail.google.com/mail/u/0/', { ...policy, gmail: true }));
check('canvas domain stays blocked', isBlocked('https://canvas.school.edu/courses/1', policy));
check('canvas domain opens when enabled', !isBlocked('https://canvas.school.edu/courses/1/assignments/2', { ...policy, canvas: true }, 'canvas'));
check('x stays blocked', isBlocked('https://x.com/home', policy));
check('allowlist only', isBlocked('https://example.com', { ...policy, allowlistOnly: true, allowlist: ['news.example'] }));
check('allowlist hit', !isBlocked('https://news.example/story', { ...policy, allowlistOnly: true, allowlist: ['news.example'] }));
check('removed default', !isBlocked('https://x.com/home', { ...policy, removedDefaults: ['x.com'] }));
check('password field blocks', hasSecretFields({ passwordFields: 1 }));
check('plain page does not', !hasSecretFields({ passwordFields: 0, cardFields: 0 }));

const stripped = stripUrl('https://Example.com/a/b/?q=1&token=secret&code=abc&page=2#hash');
check('token query removed', !!stripped && !stripped.includes('token=') && !stripped.includes('code=') && stripped.includes('q=1') && stripped.includes('page=2') && !stripped.includes('#'));
check('host normalized', stripped.startsWith('https://example.com/a/b'));
check('owned tag', ownedTag('u_abc', 'browser') === 'u_abc--browser');
check('owned tag keeps full tag', ownedTag('u_abc', 'u_abc--gmail') === 'u_abc--gmail');

const job = (sourceRef: string, nextAt: number): Job => ({ id: sourceRef, sourceRef, contentHash: 'h', attempts: 0, nextAt, body: {} });
const queued = enqueue(enqueue([job('a', 0)], job('b', 100)), job('a', 5));
check('queue dedupes by source', queued.length === 2 && queued.some((item) => item.sourceRef === 'a' && item.nextAt === 5));
check('queue waits', takeReady(queued, 0, 5).length === 0);
check('queue batches', takeReady(queued, 5, 1).length === 1);
check('backoff grows', retryAt(1, 0) < retryAt(4, 0) && retryAt(20, 0) - 0 <= 15 * 60 * 1000);
check('same capture', sameCapture({ sourceRef: 'browser:x:1', contentHash: 'aa' }, { sourceRef: 'browser:x:1', contentHash: 'aa' }));
check('page key stable', pageKey('https://example.com/a?token=1') === pageKey('https://example.com/a'));
check('dwell', dwellReady(30000) && !dwellReady(29999) && scrolledMeaningfully(400, 2000, 800) && !scrolledMeaningfully(10, 800, 800));

const redacted = redactSecrets('Your verification code is 123456. Reset link https://x.test/r?token=abcdef0123456789abcdef0123456789');
check('otp redacted', !redacted.includes('123456') && redacted.includes('[redacted]'));
check('link token redacted', !redacted.includes('abcdef0123456789'));
check('skip reset mail', shouldSkipEmail({ subject: 'Reset your password', body: 'click here' }).skip);
check('keep normal mail', !shouldSkipEmail({ subject: 'Notes from class', body: 'Read chapter 2' }).skip);
check('keyword skip', shouldSkipEmail({ subject: 'Hello', body: 'payroll run', keywords: ['payroll'] }).reason === 'keyword');

check('canvas skips grades', canvasSkipsPrivate('https://school.instructure.com/courses/1/grades', false));
check('canvas skips other students', canvasSkipsPrivate('https://school.instructure.com/courses/1/users/99', false));
check('canvas keeps self', !canvasSkipsPrivate('https://school.instructure.com/courses/1/users/self', false));
check('canvas keeps assignment', !canvasSkipsPrivate('https://school.instructure.com/courses/1/assignments/2', false));
check('canvas grades when asked', !canvasSkipsPrivate('https://school.instructure.com/courses/1/grades', true));

const post = xPostId('https://x.com/nori/status/123456789012345');
check('x post id', post === '123456789012345');
check('x dedupe stable', xDedupeKey(post) === 'browser:x:123456789012345' && xDedupeKey(post) === xDedupeKey(post, false));
check('x thread key differs', xDedupeKey(post, true) === 'browser:xthread:123456789012345');

const { ingestDocument, scrubSavedUrl } = await import('../../../engine/pipeline.ts');
const { prepareGmailMessage, saveGmailMessages, gmailSkipReason } = await import('../../../engine/gmailSync.ts');
const { isAllowedOauthRedirect, connectorFromRedirect } = await import('../../../engine/oauth.ts');
const { browserConnectorView, claimBrowserPair, createBrowserPair, forgetBrowserMemories } = await import('../../../engine/browserConnector.ts');

check('extension redirect allowed', isAllowedOauthRedirect('https://abcdefghijklmnop.chromiumapp.org/'));
check('extension maps to browser', connectorFromRedirect('https://abcdefghijklmnop.chromiumapp.org/') === 'browser');
check('http redirect rejected', !isAllowedOauthRedirect('http://evil.example/callback'));
check('url scrub', !scrubSavedUrl('https://example.com/a?token=sekret&q=1').includes('token='));

const tag = 'u_extuser--browser';
const first = await ingestDocument({
  title: 'Example',
  text: 'Example homepage says it is for examples.',
  containerTag: tag,
  source: 'browser-extension',
  sourceRef: 'browser:page:example',
  actorId: 'extuser',
  extract: false,
  metadata: { url: 'https://example.com/?token=sekret', browser: 'Chrome', capture_type: 'manual', site: '' },
});
const again = await ingestDocument({
  title: 'Example',
  text: 'Example homepage says it is for examples.',
  containerTag: tag,
  source: 'browser-extension',
  sourceRef: 'browser:page:example',
  actorId: 'extuser',
  extract: false,
});
const updated = await ingestDocument({
  title: 'Example',
  text: 'Example homepage now describes documentation.',
  containerTag: tag,
  source: 'browser-extension',
  sourceRef: 'browser:page:example',
  actorId: 'extuser',
  extract: false,
});
check('first save created', first.created === true && !!first.document.id);
check('same page deduped', again.duplicate === true && again.document.id === first.document.id);
check('changed page updates', updated.updated === true && updated.created === false && updated.document.id === first.document.id && updated.document.text.includes('documentation'));
check('token not stored on the doc', !String(updated.document.metadata?.url || '').includes('token=') && String(updated.document.metadata?.url || '').includes('example.com'));
check('browser label kept', updated.document.metadata?.browser === 'Chrome');
const view = browserConnectorView('extuser');
check('connector counts the browser doc', view.items === 1 && view.browsers.some((row) => row.name === 'Chrome' && row.items === 1));
const forgotten = forgetBrowserMemories('extuser');
check('browser forget removes it', forgotten.ok === true && browserConnectorView('extuser').items === 0);

const pair = createBrowserPair('extuser');
const claimed = await claimBrowserPair(pair.code, 'Edge');
check('pair claim connects that browser', String(claimed?.access_token || '').startsWith('rk_live_') && browserConnectorView('extuser').browsers.some((row) => row.name === 'Edge' && row.connected));
check('pair code cannot be reused', (await claimBrowserPair(pair.code, 'Edge')) === null);
check('unknown pair code fails', (await claimBrowserPair('not-a-code', 'Chrome')) === null);

check('gmail skips a sign-in code', gmailSkipReason('Your code', 'verification code 123456') === 'one-time code');
const mail = prepareGmailMessage({ id: 'm1', subject: 'Class notes', from: 'Ada <ada@school.edu>', date: 'Tue', body: 'Read chapter 2. Code in the repo is 4421.' });
check('gmail keeps a normal note', mail?.sourceRef === 'gmail:m1' && mail.text.includes('Read chapter 2'));
check('gmail drops a password reset', prepareGmailMessage({ id: 'm2', subject: 'Reset your password', from: 'security', date: '', body: 'click here to set a new password' }) === null);
const savedMail = await saveGmailMessages('extuser', [
  { id: 'm1', subject: 'Class notes', from: 'Ada <ada@school.edu>', date: 'Tue', body: 'Read chapter 2' },
  { id: 'm1', subject: 'Class notes', from: 'Ada <ada@school.edu>', date: 'Tue', body: 'Read chapter 2' },
]);
check('gmail save dedupes', savedMail.imported === 1 && savedMail.items >= 1);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('extension checks passed');
