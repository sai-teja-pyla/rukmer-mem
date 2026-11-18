/**
 * Memory graph and container tags must not treat a failed load as an empty brain.
 * Run: npm run memory-load
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { requestJson } from '../../services/engineRetry.js';
import {
  ContainerTagsStatus,
  GraphCountLabel,
  GraphStatus,
  TagRows,
  graphCountText,
  graphView,
  nodeLabel,
  resourceView,
} from './memoryStates.js';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function visible(html: string) {
  return html.replace(/&#x27;|&apos;/g, "'");
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noWait = async () => {};

check('loading is not an empty count', graphCountText('loading', 0) === 'Loading memory…' && !graphCountText('loading', 0).includes('0 total memories'));
check('a failed graph stays an error', graphView('error', 0, false) === 'error');
check('a loaded empty graph is empty', graphView('ready', 0, false) === 'empty');
check('a loaded graph with memories is ready', graphView('ready', 2, true) === 'ready');
check('a failed tag list stays an error', resourceView('error', 0) === 'error');
check('an empty tag list is empty only after success', resourceView('ready', 0) === 'empty' && resourceView('loading', 0) === 'loading');

const loadingHtml = renderToStaticMarkup(
  <div>
    <GraphCountLabel phase="loading" count={0} />
    <GraphStatus phase="loading" onRetry={() => undefined} />
  </div>
);
check('loading graph does not show 0 total memories', visible(loadingHtml).includes('Loading memory…') && !visible(loadingHtml).includes('0 total memories') && !visible(loadingHtml).includes('Nothing to plot yet'));

const errorHtml = renderToStaticMarkup(
  <div>
    <GraphCountLabel phase="error" count={0} />
    <GraphStatus phase="error" onRetry={() => undefined} />
    <ContainerTagsStatus phase="error" onRetry={() => undefined} />
  </div>
);
check(
  'failed load renders the retry banner',
  visible(errorHtml).includes("Couldn't load your memories, retry") &&
    visible(errorHtml).includes('Retry') &&
    !visible(errorHtml).includes('0 total memories') &&
    !visible(errorHtml).includes('No container tags yet') &&
    !visible(errorHtml).includes('Nothing to plot yet') &&
    !visible(errorHtml).includes('Loading memory…')
);

const emptyHtml = renderToStaticMarkup(
  <div>
    <GraphCountLabel phase="empty" count={0} />
    <GraphStatus phase="empty" onRetry={() => undefined} />
    <ContainerTagsStatus phase="empty" onRetry={() => undefined} />
  </div>
);
check(
  'empty success renders the empty state',
  visible(emptyHtml).includes('0 total memories') &&
    visible(emptyHtml).includes('Nothing to plot yet') &&
    visible(emptyHtml).includes('No container tags yet') &&
    visible(emptyHtml).includes('Import data') &&
    !visible(emptyHtml).includes("Couldn't load your memories, retry")
);

let calls = 0;
let failedTags = '';
try {
  await requestJson('/v3/tags', undefined, {
    fetchImpl: async () => {
      calls += 1;
      return new Response('upstream unavailable', { status: 503 });
    },
    wait: noWait,
  });
} catch {
  failedTags = renderToStaticMarkup(<ContainerTagsStatus phase="error" onRetry={() => undefined} />);
}
check('a mocked 503 is retried then shown as an error', calls === 4 && visible(failedTags).includes('Retry') && visible(failedTags).includes("Couldn't load your memories, retry") && !visible(failedTags).includes('No container tags yet'));

const delays: number[] = [];
await requestJson('/v4/graph', undefined, {
  fetchImpl: async () => jsonResponse(503, { error: 'warming_up' }),
  wait: async (ms) => {
    delays.push(ms);
  },
}).catch(() => undefined);
check('transient 5xx backs off', delays.length === 3 && delays[0] < delays[1] && delays[1] < delays[2]);

const emptyBody = await requestJson('/v3/tags', undefined, {
  fetchImpl: async () => jsonResponse(200, { tags: [] }),
  wait: noWait,
});
const emptyView = resourceView('ready', emptyBody.tags.length);
const emptyRender = renderToStaticMarkup(<ContainerTagsStatus phase="empty" onRetry={() => undefined} />);
check('an empty 200 renders the empty state', emptyView === 'empty' && visible(emptyRender).includes('No container tags yet') && !visible(emptyRender).includes('Retry'));

const populated = await requestJson('/v3/tags', undefined, {
  fetchImpl: async () => jsonResponse(200, { tags: [{ tag: 'u_khNHseed', documents: 2, memories: 4, sites: ['gmail'] }] }),
  wait: noWait,
});
const populatedHtml = renderToStaticMarkup(<TagRows tags={populated.tags} />);
check(
  'a populated 200 renders the tag data',
  resourceView('ready', populated.tags.length) === 'ready' &&
    populatedHtml.includes('u_khNHseed') &&
    populatedHtml.includes('>2<') &&
    populatedHtml.includes('>4<') &&
    populatedHtml.includes('Gmail') &&
    !populatedHtml.includes('No container tags yet')
);

const graphBody = await requestJson('/v4/graph', undefined, {
  fetchImpl: async () => jsonResponse(200, { nodes: [{ id: 'n1', label: 'jasmine tea' }], edges: [], tags: ['u_khNHseed'] }),
  wait: noWait,
});
const graphHtml = renderToStaticMarkup(
  <div>
    <GraphCountLabel phase={graphView('ready', 4, graphBody.nodes.length > 0)} count={4} />
    <span>{nodeLabel(graphBody.nodes[0].label)}</span>
  </div>
);
check('a populated 200 renders the graph data', visible(graphHtml).includes('4 total memories') && visible(graphHtml).includes('jasmine tea') && !visible(graphHtml).includes("Couldn't load your memories"));

let posts = 0;
await requestJson('/v3/documents', { method: 'POST', body: '{}' }, {
  fetchImpl: async () => {
    posts += 1;
    return jsonResponse(503, { error: 'nope' });
  },
  wait: noWait,
}).catch(() => undefined);
check('a non-idempotent 503 is not retried', posts === 1);

if (failures.length) {
  console.error(`\n${failures.length} memory load check(s) failed`);
  process.exit(1);
}
console.log('\nmemory load checks passed');
