#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { RukmerClient } from './client.js';

type Flags = { apiKey: string; url: string; yes: boolean; help: boolean; command: string };

function parse(argv: string[]): Flags {
  const flags: Flags = { apiKey: '', url: 'https://app.rukmer.com', yes: false, help: false, command: '' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--api-key') flags.apiKey = argv[++i] || '';
    else if (arg === '--url') flags.url = argv[++i] || flags.url;
    else rest.push(arg);
  }
  flags.command = rest[0] || '';
  return flags;
}

function ask(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function detectEnvFile(cwd: string) {
  if (fs.existsSync(path.join(cwd, '.env.local'))) return '.env.local';
  return '.env';
}

function upsertEnv(file: string, values: Record<string, string>) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = current.split(/\n/);
  const keys = new Set(Object.keys(values));
  const next = lines.filter((line) => !keys.has(line.split('=')[0] || ''));
  for (const [key, value] of Object.entries(values)) next.push(`${key}=${value}`);
  const body = next.filter((line, index, all) => line !== '' || index < all.length - 1).join('\n');
  fs.writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
}

function ensureGitignore(cwd: string, name: string) {
  const file = path.join(cwd, '.gitignore');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (text.split('\n').some((line) => line.trim() === name)) return;
  fs.writeFileSync(file, text.endsWith('\n') ? `${text}${name}\n` : `${text}\n${name}\n`);
}

function writeMcp(cwd: string, url: string) {
  const cursorDir = path.join(cwd, '.cursor');
  const cursorFile = path.join(cursorDir, 'mcp.json');
  const claude = path.join(cwd, '.mcp.json');
  const target = fs.existsSync(cursorDir) || fs.existsSync(path.join(cwd, '.cursor')) ? cursorFile : fs.existsSync(path.dirname(claude)) ? claude : cursorFile;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let json: { mcpServers?: Record<string, { url: string }> } = {};
  if (fs.existsSync(target)) {
    try {
      json = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      json = {};
    }
  }
  json.mcpServers = { ...(json.mcpServers || {}), rukmer: { url } };
  fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
  return target;
}

function help(setup = false) {
  if (setup) {
    console.log(`rukmer setup

Options:
  --api-key <key>   Rukmer API key
  --url <url>       API base URL (default https://app.rukmer.com)
  --yes             Skip prompts and use the flags
  --help            Show this help
`);
    return;
  }
  console.log(`rukmer <command>

Commands:
  setup     Write RUKMER_API_KEY and wire MCP
  search    Search memory
  add       Save a note
  profile   Read the profile

Run rukmer setup --help for setup flags.
`);
}

async function setup(flags: Flags) {
  if (flags.help) return help(true);
  const cwd = process.cwd();
  const kind = fs.existsSync(path.join(cwd, 'package.json')) ? 'node' : fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt')) ? 'python' : 'unknown';
  let apiKey = flags.apiKey || process.env.RUKMER_API_KEY || '';
  let url = flags.url || process.env.RUKMER_URL || 'https://app.rukmer.com';
  if (!flags.yes && !apiKey) apiKey = await ask('Rukmer API key: ');
  if (!apiKey) {
    console.error('An API key is required. Create one in the Rukmer console, then rerun with --api-key.');
    process.exitCode = 1;
    return;
  }
  const envName = detectEnvFile(cwd);
  upsertEnv(path.join(cwd, envName), { RUKMER_API_KEY: apiKey, RUKMER_URL: url });
  ensureGitignore(cwd, envName);
  const mcpFile = writeMcp(cwd, `${url.replace(/\/$/, '')}/mcp`);
  const client = new RukmerClient({ baseUrl: url, apiKey });
  await client.search('rukmer setup');
  console.log(`You're set up (${kind}). Saved ${envName} and ${path.relative(cwd, mcpFile)}.`);
}

async function main() {
  const flags = parse(process.argv.slice(2));
  if (!flags.command) {
    help(false);
    return;
  }
  if (flags.command === 'setup') return setup(flags);
  const client = new RukmerClient({
    baseUrl: flags.url || process.env.RUKMER_URL || 'https://app.rukmer.com',
    apiKey: flags.apiKey || process.env.RUKMER_API_KEY || '',
  });
  if (flags.command === 'search') {
    const query = process.argv.slice(3).filter((arg) => !arg.startsWith('--')).join(' ');
    console.log(JSON.stringify(await client.search(query || 'rukmer'), null, 2));
    return;
  }
  if (flags.command === 'add') {
    const text = process.argv.slice(3).filter((arg) => !arg.startsWith('--')).join(' ');
    console.log(JSON.stringify(await client.add(text || 'note'), null, 2));
    return;
  }
  if (flags.command === 'profile') {
    console.log(JSON.stringify(await client.profile(), null, 2));
    return;
  }
  help(false);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'rukmer failed');
  process.exitCode = 1;
});
