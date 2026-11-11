type Status = {
  connected: boolean;
  browser: string;
  settings: { onboarded: boolean; captureEnabled: boolean; pauseUntil: number; containerTag: string; apiBase?: string; features: { manual: boolean } };
  recent: { id: string; title: string; url: string; at: string; captureType: string }[];
  notice: string;
  queue: number;
  error?: string;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function send<T>(message: unknown) {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function render(status: Status) {
  const paused = status.settings.pauseUntil > Date.now();
  const on = status.connected && status.settings.onboarded && status.settings.captureEnabled && !paused;
  $('dot').className = `dot${on ? ' on' : paused ? ' pause' : ''}`;
  $('state-label').textContent = !status.connected ? 'Not connected' : paused ? 'Paused' : on ? `On · ${status.browser || 'browser'}` : 'Capture off';
  $('setup').hidden = status.settings.onboarded;
  $('app').hidden = !status.settings.onboarded;
  $('connect').hidden = status.connected;
  $('connect-help').hidden = status.connected;
  $('key-fallback').hidden = status.connected;
  $('signout').hidden = !status.connected;
  $('capture').textContent = status.settings.captureEnabled ? 'Capture on' : 'Capture off';
  $<HTMLInputElement>('tag').value = status.settings.containerTag || 'browser';
  $('notice').textContent = status.notice || (status.queue ? `${status.queue} waiting to sync` : '');
  $('notice').className = status.notice ? 'err' : 'muted';
  const list = $('recent');
  list.replaceChildren();
  if (!status.recent.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No captures yet';
    list.append(empty);
    return;
  }
  for (const item of status.recent) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = item.title || item.url;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = item.captureType;
    text.append(title, meta);
    const del = document.createElement('button');
    del.className = 'btn ghost';
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await send({ type: 'delete', id: item.id });
      await load();
    });
    li.append(text, del);
    list.append(li);
  }
}

async function load() {
  const status = await send<Status>({ type: 'status' });
  render(status);
  if (status.notice) await send({ type: 'clear-notice' });
}

$('finish').addEventListener('click', async () => {
  const status = await send<Status>({ type: 'status' });
  status.settings.onboarded = true;
  status.settings.captureEnabled = true;
  status.settings.features.manual = ($('opt-manual') as HTMLInputElement).checked;
  await send({ type: 'settings', settings: status.settings });
  await load();
});
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('connect').addEventListener('click', async () => {
  const status = await send<Status>({ type: 'status' });
  const base = status.settings.apiBase || 'https://app.rukmer.com';
  await chrome.tabs.create({ url: `${base}/connectors?connect=browser` });
  window.close();
});
$('signout').addEventListener('click', async () => {
  await send({ type: 'signout' });
  await load();
});
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const out = await send<{ error?: string }>({ type: 'use-key', key: $<HTMLInputElement>('key').value });
  $('notice').textContent = out.error || '';
  await load();
});
$('capture').addEventListener('click', async () => {
  const status = await send<Status>({ type: 'status' });
  status.settings.captureEnabled = !status.settings.captureEnabled;
  await send({ type: 'settings', settings: status.settings });
  await load();
});
$('pause').addEventListener('click', async () => {
  const status = await send<Status>({ type: 'status' });
  const choice = $<HTMLSelectElement>('pause-for').value;
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  status.settings.pauseUntil = choice === '0' ? 0 : choice === 'tomorrow' ? tomorrow.getTime() : Date.now() + Number(choice) * 60_000;
  await send({ type: 'settings', settings: status.settings });
  await load();
});
$('tag').addEventListener('change', async () => {
  const status = await send<Status>({ type: 'status' });
  status.settings.containerTag = $<HTMLInputElement>('tag').value.trim() || 'browser';
  await send({ type: 'settings', settings: status.settings });
});
$('save-page').addEventListener('click', async () => {
  const out = await send<{ ok?: boolean; error?: string; queued?: boolean; duplicate?: boolean }>({ type: 'save-page' });
  $('notice').textContent = out.error || (out.duplicate ? 'Already saved' : out.queued ? 'Will sync when online' : 'Saved this page');
  $('notice').className = out.error ? 'err' : 'ok';
  await load();
});
$('search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = $<HTMLInputElement>('search').value.trim();
  const box = $('hits');
  box.replaceChildren();
  if (!query) {
    box.textContent = 'Enter a query';
    return;
  }
  const out = await send<{ matches?: { title?: string; text?: string; score?: number }[]; error?: string }>({ type: 'search', query });
  if (out.error) {
    box.textContent = out.error;
    return;
  }
  const matches = out.matches || [];
  if (!matches.length) {
    box.textContent = 'No results';
    return;
  }
  for (const match of matches) {
    const row = document.createElement('div');
    row.className = 'hit';
    row.textContent = `${match.title || 'Memory'} · ${Number(match.score || 0).toFixed(2)}`;
    const body = document.createElement('div');
    body.className = 'muted';
    body.textContent = String(match.text || '').slice(0, 180);
    const wrap = document.createElement('div');
    wrap.append(row, body);
    box.append(wrap);
  }
});

void load();
