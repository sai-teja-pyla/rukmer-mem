import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, [r, g, b]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.36;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2 + 0.5;
      const cy = y - size / 2 + 0.5;
      const inside = cx * cx + cy * cy <= radius * radius;
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
const colors = { on: [37, 99, 235], pause: [217, 119, 6], off: [113, 113, 122] };
for (const [name, color] of Object.entries(colors)) {
  for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(dist, 'icons', `icon-${name}-${size}.png`), png(size, color));
}

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [
    'src/background/service-worker.ts',
    'src/content/extract.ts',
    'src/content/read.ts',
    'src/content/gmail.ts',
    'src/content/canvas.ts',
    'src/content/x.ts',
    'src/content/ai.ts',
    'src/content/app.ts',
    'src/popup/popup.ts',
    'src/options/options.ts',
    'src/sidepanel/sidepanel.ts',
  ],
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  outbase: 'src',
  target: 'chrome120',
  legalComments: 'none',
});

const pages = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/options/options.html', 'options/options.html'],
  ['src/sidepanel/sidepanel.html', 'sidepanel/sidepanel.html'],
  ['src/theme.css', 'theme.css'],
];
for (const [from, to] of pages) {
  fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(dist, to));
}

const manifest = {
  manifest_version: 3,
  name: 'Rukmer',
  version: '1.0.0',
  description: 'Save the browsing you choose into Rukmer memory, then search it later.',
  minimum_chrome_version: '120',
  incognito: 'not_allowed',
  permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'identity', 'sidePanel', 'alarms'],
  optional_permissions: ['bookmarks', 'history'],
  host_permissions: ['https://app.rukmer.com/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  optional_host_permissions: [
    '<all_urls>',
    'https://mail.google.com/*',
    'https://*.instructure.com/*',
    'https://x.com/*',
    'https://twitter.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://grok.com/*',
    'https://gemini.google.com/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  background: { service_worker: 'background/service-worker.js' },
  content_scripts: [
    {
      matches: ['https://app.rukmer.com/*', 'http://localhost/*', 'http://127.0.0.1/*'],
      js: ['content/app.js'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_title: 'Rukmer',
    default_popup: 'popup/popup.html',
    default_icon: { 16: 'icons/icon-off-16.png', 32: 'icons/icon-off-32.png', 48: 'icons/icon-off-48.png', 128: 'icons/icon-off-128.png' },
  },
  icons: { 16: 'icons/icon-on-16.png', 32: 'icons/icon-on-32.png', 48: 'icons/icon-on-48.png', 128: 'icons/icon-on-128.png' },
  options_page: 'options/options.html',
  side_panel: { default_path: 'sidepanel/sidepanel.html' },
  commands: {
    'save-page': {
      suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
      description: 'Save this page to Rukmer',
    },
  },
};
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

const zipPath = path.join(dist, 'rukmer-browser.zip');
const { execFileSync } = await import('node:child_process');
execFileSync('zip', ['-qr', zipPath, '.', '-x', 'rukmer-browser.zip'], { cwd: dist });
console.log(zipPath);
