import { lines, mergeSettings, type Features, type Settings } from '../lib/settings.js';

const TOGGLES: [keyof Features, string][] = [
  ['manual', 'Manual save (menu, shortcut, Save this page)'],
  ['autoRead', 'Auto-capture pages read for 30 seconds'],
  ['highlights', 'Highlight Save button'],
  ['bookmarksImport', 'Bookmark import'],
  ['bookmarksSync', 'Sync new bookmarks'],
  ['history', 'History import'],
  ['aiChat', 'Save this conversation on AI chat sites'],
  ['gmail', 'Gmail'],
  ['gmailImportant', 'Gmail important only'],
  ['canvas', 'Canvas'],
  ['canvasAuto', 'Canvas auto-save assignments and announcements'],
  ['canvasGrades', 'Canvas include grades'],
  ['x', 'X'],
  ['xAuto', 'X save posts you like or bookmark'],
  ['xThread', 'X thread button'],
  ['xMessages', 'X messages'],
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let current = mergeSettings(null);

function note(text: string, bad = false) {
  $('note').textContent = text;
  $('note').className = bad ? 'err' : 'ok';
}

function draw() {
  const box = $('toggles');
  box.replaceChildren();
  for (const [key, label] of TOGGLES) {
    const row = document.createElement('label');
    row.className = 'line';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = current.features[key];
    input.dataset.key = key;
    row.append(span, input);
    box.append(row);
  }
  ($('gmail-senders') as HTMLTextAreaElement).value = current.gmailSenders.join('\n');
  ($('gmail-labels') as HTMLTextAreaElement).value = current.gmailLabels.join('\n');
  ($('gmail-keywords') as HTMLTextAreaElement).value = current.gmailKeywords.join('\n');
  ($('canvas-domain') as HTMLInputElement).value = current.canvasDomain;
  ($('history-days') as HTMLInputElement).value = String(current.historyDays);
  ($('allow-only') as HTMLInputElement).checked = current.allowlistOnly;
  ($('block') as HTMLTextAreaElement).value = current.blocklist.join('\n');
  ($('unblock') as HTMLTextAreaElement).value = current.removedDefaults.join('\n');
  ($('allow') as HTMLTextAreaElement).value = current.allowlist.join('\n');
  ($('tag') as HTMLInputElement).value = current.containerTag;
  ($('gmail-tag') as HTMLInputElement).value = current.gmailTag;
  ($('canvas-tag') as HTMLInputElement).value = current.canvasTag;
  ($('x-tag') as HTMLInputElement).value = current.xTag;
  ($('host') as HTMLInputElement).value = current.apiBase;
}

function collect(): Settings {
  const features = { ...current.features };
  for (const input of Array.from($('toggles').querySelectorAll('input'))) features[input.dataset.key as keyof Features] = input.checked;
  return mergeSettings({
    ...current,
    features,
    gmailSenders: lines(($('gmail-senders') as HTMLTextAreaElement).value),
    gmailLabels: lines(($('gmail-labels') as HTMLTextAreaElement).value),
    gmailKeywords: lines(($('gmail-keywords') as HTMLTextAreaElement).value),
    canvasDomain: ($('canvas-domain') as HTMLInputElement).value.trim(),
    historyDays: Number(($('history-days') as HTMLInputElement).value || 7),
    allowlistOnly: ($('allow-only') as HTMLInputElement).checked,
    blocklist: lines(($('block') as HTMLTextAreaElement).value),
    removedDefaults: lines(($('unblock') as HTMLTextAreaElement).value),
    allowlist: lines(($('allow') as HTMLTextAreaElement).value),
    containerTag: ($('tag') as HTMLInputElement).value.trim() || 'browser',
    gmailTag: ($('gmail-tag') as HTMLInputElement).value.trim() || 'gmail',
    canvasTag: ($('canvas-tag') as HTMLInputElement).value.trim() || 'canvas',
    xTag: ($('x-tag') as HTMLInputElement).value.trim() || 'x',
    apiBase: ($('host') as HTMLInputElement).value.trim() || 'https://app.rukmer.com',
  });
}

async function permit(next: Settings) {
  const origins: string[] = [];
  const permissions: chrome.runtime.ManifestPermission[] = [];
  if (next.features.autoRead || next.features.highlights) origins.push('<all_urls>');
  if (next.features.gmail) origins.push('https://mail.google.com/*');
  if (next.features.canvas) {
    origins.push('https://*.instructure.com/*');
    if (next.canvasDomain) origins.push('<all_urls>');
  }
  if (next.features.x || next.features.xMessages) origins.push('https://x.com/*', 'https://twitter.com/*');
  if (next.features.aiChat) origins.push('https://chatgpt.com/*', 'https://claude.ai/*', 'https://grok.com/*', 'https://gemini.google.com/*');
  if (next.apiBase.includes('localhost') || next.apiBase.includes('127.0.0.1')) origins.push('http://localhost/*', 'http://127.0.0.1/*');
  if (next.features.bookmarksImport || next.features.bookmarksSync) permissions.push('bookmarks');
  if (next.features.history) permissions.push('history');
  if (!origins.length && !permissions.length) return true;
  return chrome.permissions.request({ origins, permissions });
}

$('save').addEventListener('click', async () => {
  const next = collect();
  const ok = await permit(next);
  if (!ok) {
    note('Permission was denied, so that feature stays off.', true);
    return;
  }
  const out = await chrome.runtime.sendMessage({ type: 'settings', settings: next });
  current = mergeSettings(out.settings || next);
  note('Saved.');
});

$('import-history').addEventListener('click', async () => {
  const next = collect();
  if (!(await permit({ ...next, features: { ...next.features, history: true } }))) return note('History permission is required.', true);
  await chrome.runtime.sendMessage({ type: 'settings', settings: { ...next, features: { ...next.features, history: true } } });
  const out = await chrome.runtime.sendMessage({ type: 'history', days: next.historyDays });
  note(out.error || `Queued ${out.queued || 0} history rows.`, !!out.error);
});

$('import-bookmarks').addEventListener('click', async () => {
  const next = collect();
  if (!(await permit({ ...next, features: { ...next.features, bookmarksImport: true } }))) return note('Bookmark permission is required.', true);
  await chrome.runtime.sendMessage({ type: 'settings', settings: { ...next, features: { ...next.features, bookmarksImport: true } } });
  const out = await chrome.runtime.sendMessage({ type: 'bookmarks' });
  note(out.error || `Queued ${out.queued || 0} bookmarks.`, !!out.error);
});

$('export').addEventListener('click', async () => {
  const data = await chrome.runtime.sendMessage({ type: 'export' });
  if (data.error) return note(data.error, true);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rukmer-browser.json';
  link.click();
  URL.revokeObjectURL(url);
});

$('forget').addEventListener('click', async () => {
  if (!confirm('Delete every memory saved by the browser extension?')) return;
  const out = await chrome.runtime.sendMessage({ type: 'forget-browser' });
  note(out.error || `Removed ${out.removed || 0} rows.`, !!out.error);
});

chrome.runtime.sendMessage({ type: 'status' }).then((status) => {
  current = mergeSettings(status.settings);
  draw();
});
